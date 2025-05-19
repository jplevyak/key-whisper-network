import { fromByteArray, toByteArray } from "base64-js";
// Import the default db instance and alias it
import { db as defaultDbManager, type IndexedDBManager as IDBManagerType, STORES as APP_STORES } from "./indexedDB";
import { importKey } from "./encryption";


// A utility for encrypting/decrypting data with a non-extractable key
export class SecureStorage {
  private encryptionKey: CryptoKey | null = null;
  private readonly DB_NAME = "secure_storage"; // This DB is only for the "main_key" if used
  private readonly STORE_NAME = "keys";
  private readonly KEY_ID = "main_key";
  private isUsingDerivedKey = false;

  // dbManager is now optional; if not provided, the default instance will be used.
  async initializeWithKey(newDerivedKey: CryptoKey, dbManager?: IDBManagerType): Promise<void> {
    const effectiveDbManager = dbManager || defaultDbManager;

    console.log("SecureStorage: Attempting to initialize with derived PRF key.");
    const oldKey = this.encryptionKey;
    const wasPreviouslyUsingStandardKey = oldKey && !this.isUsingDerivedKey;

    if (wasPreviouslyUsingStandardKey && oldKey) {
      if (!effectiveDbManager) {
        console.error("SecureStorage: effectiveDbManager is undefined (neither passed nor default available). Cannot proceed with re-encryption.");
        throw new Error("SecureStorage: IndexedDBManager instance is required for data re-encryption and was not available.");
      }
      console.log("SecureStorage: Standard key was in use. Re-encrypting application data with new derived key.");
      try {
        await this._reEncryptAllData(oldKey, newDerivedKey, effectiveDbManager);
        console.log("SecureStorage: Application data re-encryption successful.");
        // After successful re-encryption, delete the old standard key's database
        await this.deleteOwnDatabase(); // This also nullifies this.encryptionKey and resets isUsingDerivedKey
        console.log("SecureStorage: Old standard key database ('secure_storage') deleted.");
      } catch (error) {
        console.error("SecureStorage: Failed to re-encrypt application data. Aborting derived key initialization.", error);
        // Do not proceed to set the new key if re-encryption fails,
        // leave the system in the state with the old key.
        throw new Error("Failed to re-encrypt data with new key."); // Propagate error
      }
    } else if (this.encryptionKey && this.isUsingDerivedKey && this.encryptionKey !== newDerivedKey) {
      console.warn("SecureStorage: Already initialized with a different derived key. Proceeding with the new derived key. Data re-encryption from a previous derived key to this new one is not automatically handled by this path.");
    } else if (!oldKey) {
      console.log("SecureStorage: No previous key found. Initializing directly with derived key.");
    }


    this.encryptionKey = newDerivedKey;
    this.isUsingDerivedKey = true;
    console.log("SecureStorage: Successfully initialized with derived PRF key.");
  }

  private async _reEncryptAllData(oldKey: CryptoKey, newKey: CryptoKey, dbManager: IDBManagerType): Promise<void> {
    // Stores that contain strings encrypted by SecureStorage's key
    const storesToReEncryptDirectly = ["contacts", "messages", "groups"] as const;

    for (const storeName of storesToReEncryptDirectly) {
      console.log(`SecureStorage: Re-encrypting store: ${storeName}`);
      const items = await dbManager.getAllItemsInStore(storeName);
      for (const item of items) {
        if (typeof item.value === 'string' && item.value.length > 0) { // Ensure value is a non-empty string
          // Decrypt with old key
          this.encryptionKey = oldKey;
          let decryptedData;
          try {
            decryptedData = await this.decrypt(item.value);
          } catch (e) {
            // Decryption with oldKey failed. Try with newKey.
            console.warn(`SecureStorage: Failed to decrypt item ${item.id} in store ${storeName} with old key. Attempting with new key. Error: ${e}`);
            try {
              this.encryptionKey = newKey; // Try newKey for decryption
              decryptedData = await this.decrypt(item.value);
              // If this succeeds, data is already using newKey. No need to re-encrypt.
              console.log(`SecureStorage: Item ${item.id} in store ${storeName} was already encrypted with new key. Skipping re-encryption for this item.`);
              continue; // Go to next item in the current store
            } catch (e2) {
              // Decryption failed with both old and new key. This is a genuine problem.
              console.error(`SecureStorage: Failed to decrypt item ${item.id} in store ${storeName} with both old and new keys. Skipping. Original error: ${e}, New key error: ${e2}`);
              continue; // Skip this item
            }
          }

          // If decryption with oldKey succeeded, proceed to re-encrypt with newKey
          this.encryptionKey = newKey; // Set for encryption
          
          // Pass the decrypted data to dbManager.set.
          // dbManager.set will internally call secureStorage.encrypt, which will now use the newKey.
          try {
            await dbManager.set(storeName, item.id, decryptedData);
          } catch (e) {
            console.error(`SecureStorage: Failed to set re-encrypted item ${item.id} in store ${storeName}. Skipping.`, e);
            // Potentially revert this.encryptionKey or handle more gracefully
            continue;
          }
        } else if (item.value && typeof item.value !== 'string') {
          console.warn(`SecureStorage: Item ${item.id} in store ${storeName} is not a string (type: ${typeof item.value}), skipping re-encryption.`);
        }
      }
      console.log(`SecureStorage: Finished re-encrypting store: ${storeName}`);
    }

    // Handle 'keys' store separately for old encrypted string formats
    console.log("SecureStorage: Processing 'keys' store for potential re-encryption/conversion.");
    const keyStoreItems = await dbManager.getAllItemsInStore("keys");
    for (const item of keyStoreItems) {
      if (typeof item.value === 'string' && item.value.length > 0) { // Old format: encrypted key string
        console.log(`SecureStorage: Key ${item.id} in 'keys' store is in old string format. Decrypting and converting to CryptoKey.`);
        this.encryptionKey = oldKey; // Use old key for decryption
        let decryptedKeyDataString;
        try {
          decryptedKeyDataString = await this.decrypt(item.value);
        } catch (e) {
          console.error(`SecureStorage: Failed to decrypt old format key string ${item.id} in 'keys' store. Skipping.`, e);
          continue;
        }
        
        const importedKey = await importKey(decryptedKeyDataString);

        // Store the CryptoKey directly. dbManager.set for 'keys' expects a CryptoKey.
        // The SecureStorage's main encryptionKey (oldKey/newKey) is not used to encrypt/decrypt the CryptoKey itself here.
        try {
          await dbManager.set("keys", item.id, importedKey);
          console.log(`SecureStorage: Key ${item.id} converted to CryptoKey and updated in 'keys' store.`);
        } catch (e) {
          console.error(`SecureStorage: Failed to set converted CryptoKey ${item.id} in 'keys' store. Skipping.`, e);
          continue;
        }
      } else if (item.value && !(item.value instanceof CryptoKey) && typeof item.value !== 'string') {
         console.warn(`SecureStorage: Item ${item.id} in 'keys' store is neither a string nor a CryptoKey (type: ${typeof item.value}), skipping.`);
      }
    }
    // Restore newKey as the active key for any subsequent operations outside this method
    this.encryptionKey = newKey;
    console.log("SecureStorage: Finished processing 'keys' store.");
  }


  public getIsUsingDerivedKey(): boolean {
    return this.isUsingDerivedKey;
  }

  async init(): Promise<void> {
    // If encryptionKey is already set (e.g., by initializeWithKey or a previous init), don't re-initialize.
    if (this.encryptionKey) {
      if (this.isUsingDerivedKey) {
        console.log("SecureStorage.init called, but already initialized with a derived key.");
      } else {
        console.log("SecureStorage.init called, but already initialized with a standard key.");
      }
      return;
    }

    // This part will only run if encryptionKey is null, meaning neither
    // initializeWithKey nor a previous standard init has run.
    console.log("SecureStorage.init: Initializing with standard key mechanism.");
    // Try to get existing key from IndexedDB
    const storedKey = await this.getStoredKey();
    if (storedKey) {
      this.encryptionKey = storedKey;
      return;
    }

    // Generate new key if none exists
    this.encryptionKey = await crypto.subtle.generateKey(
      {
        name: "AES-GCM",
        length: 256,
      },
      false, // Key is not extractable
      ["encrypt", "decrypt"],
    );

    // Store key in IndexedDB
    await this.storeKey(this.encryptionKey);
  }

  private async getStoredKey(): Promise<CryptoKey | null> {
    return new Promise((resolve) => {
      const request = indexedDB.open(this.DB_NAME, 1);

      request.onerror = () => {
        console.error("Error opening IndexedDB");
        resolve(null);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME);
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(this.STORE_NAME, "readonly");
        const store = transaction.objectStore(this.STORE_NAME);
        const keyRequest = store.get(this.KEY_ID);

        keyRequest.onerror = () => {
          console.error("Error retrieving key from IndexedDB");
          resolve(null);
        };

        keyRequest.onsuccess = () => {
          resolve(keyRequest.result || null);
        };
      };
    });
  }

  private async storeKey(key: CryptoKey): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, 1);

      request.onerror = () => reject(new Error("Failed to open IndexedDB"));

      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(this.STORE_NAME, "readwrite");
        const store = transaction.objectStore(this.STORE_NAME);
        const keyRequest = store.put(key, this.KEY_ID);

        keyRequest.onerror = () =>
          reject(new Error("Failed to store key in IndexedDB"));
        keyRequest.onsuccess = () => resolve();
      };
    });
  }

  async encrypt(data: string): Promise<string> {
    if (!this.encryptionKey) {
      throw new Error("SecureStorage not initialized. Call init() or initializeWithKey() first.");
    }

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encodedData = new TextEncoder().encode(data);

    const encryptedData = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
      },
      this.encryptionKey!,
      encodedData,
    );

    // Combine IV and encrypted data
    const combined = new Uint8Array(iv.length + encryptedData.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encryptedData), iv.length);

    return fromByteArray(combined);
  }

  async decrypt(encryptedData: string): Promise<string> {
    if (!this.encryptionKey) {
      throw new Error("SecureStorage not initialized. Call init() or initializeWithKey() first.");
    }

    try {
      const combined = toByteArray(encryptedData);
      const iv = combined.slice(0, 12);
      const data = combined.slice(12);

      const decrypted = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv,
        },
        this.encryptionKey!,
        data,
      );

      return new TextDecoder().decode(decrypted);
    } catch (error) {
      console.error("Decryption failed:", error);
      throw new Error("Failed to decrypt data");
    }
  }

  async deleteOwnDatabase(): Promise<void> {
    // No need to explicitly close a DB connection here as SecureStorage doesn't keep one open.
    // It opens and closes connections for each operation (getStoredKey, storeKey).
    // However, to mitigate "blocked" errors, we introduce a small delay.
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const request = indexedDB.deleteDatabase(this.DB_NAME);
        request.onerror = (event) => {
          console.error(`Error deleting SecureStorage database ${this.DB_NAME}:`, (event.target as IDBOpenDBRequest).error);
          reject((event.target as IDBOpenDBRequest).error);
        };
        request.onsuccess = () => {
          console.log(`SecureStorage database ${this.DB_NAME} deleted successfully after delay.`);
          this.encryptionKey = null;
          this.isUsingDerivedKey = false;
          resolve();
        };
        request.onblocked = () => {
          console.warn(`Deletion of SecureStorage database ${this.DB_NAME} is blocked even after delay.`);
          reject(new Error(`SecureStorage database ${this.DB_NAME} deletion blocked.`));
        };
      }, 100); // 100ms delay, similar to IndexedDBManager
    });
  }
}
        reject((event.target as IDBOpenDBRequest).error);
      };
      request.onsuccess = () => {
        console.log(`SecureStorage database ${this.DB_NAME} deleted successfully.`);
        this.encryptionKey = null;
        this.isUsingDerivedKey = false;
        resolve();
      };
      request.onblocked = () => {
        console.warn(`Deletion of SecureStorage database ${this.DB_NAME} is blocked.`);
        reject(new Error(`SecureStorage database ${this.DB_NAME} deletion blocked.`));
      };
    });
  }
}

export const secureStorage = new SecureStorage();
