import { secureStorage } from "./secureStorage";
import { importKey, arrayBufferToBase64, base64ToArrayBuffer } from "./encryption"; // Added importKey

interface DBSchema {
  contacts: {
    id: string;
    value: string; // encrypted contacts data
  };
  messages: {
    id: string;
    value: string; // encrypted messages data
  };
  keys: {
    id: string;
    // value will be a base64 string representing the IV + wrapped CryptoKey,
    // where wrapping is done using secureStorage's internal key.
    value: string;
  };
  groups: {
    // New store for groups
    id: string;
    value: string; // encrypted group data
  };
}

const DB_NAME = "ccred_db";
const DB_VERSION = 4;
// Add 'groups' to the list of stores
const STORES = ["contacts", "messages", "keys", "groups"] as const;

class IndexedDBManager {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> { // Removed derivedKey parameter
    if (this.db) return;

    // SecureStorage must be initialized before any DB operations.
    // SecureStorage must be initialized before any DB operations.
    // If AuthContext called secureStorage.initializeWithKey(), secureStorage.init() will just return.
    // Otherwise, secureStorage.init() will set up secureStorage with its default "main_key".
    await secureStorage.init();

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        STORES.forEach((storeName) => {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, { keyPath: "id" });
          }
        });
      };
    });
  }

  // Removed duplicate class definition and redundant import.
  // The class definition above is the correct one.

  async set<T extends keyof DBSchema>(
    store: T,
    id: string,
    value: T extends "keys" ? CryptoKey : string, // This type signature is correct
  ): Promise<void> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    let valueToStore: string;

    if (store === "keys") {
      const cryptoKeyToWrap = value as CryptoKey;
      const wrappingKey = await secureStorage.getInternalKey();
      if (!wrappingKey) {
        throw new Error("SecureStorage internal key not available for wrapping contact key.");
      }

      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      // cryptoKeyToWrap is now non-extractable, so use "jwk" format for wrapping
      const wrappedKeyBuffer = await window.crypto.subtle.wrapKey(
        "jwk", // Use JSON Web Key format for non-extractable keys
        cryptoKeyToWrap,
        wrappingKey,
        { name: "AES-GCM", iv }, // Algorithm used for wrapping
      );

      const combinedBuffer = new Uint8Array(iv.length + wrappedKeyBuffer.byteLength);
      combinedBuffer.set(iv);
      combinedBuffer.set(new Uint8Array(wrappedKeyBuffer), iv.length);
      valueToStore = arrayBufferToBase64(combinedBuffer);
    } else {
      // For other stores, encrypt the string value
      if (typeof value !== 'string') {
        throw new Error(`Invalid value type for store ${store}. Expected string.`);
      }
      valueToStore = await secureStorage.encrypt(value as string);
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(store, "readwrite");
      const objectStore = transaction.objectStore(store);
      const request = objectStore.put({ id, value: valueToStore });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async get<T extends keyof DBSchema>(
    store: T,
    id: string,
  ): Promise<
    (T extends "keys" ? { cryptoKey: CryptoKey; keyDataString?: string } | null : string | null)
  > {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(store, "readonly");
      const objectStore = transaction.objectStore(store);
      const request = objectStore.get(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = async () => {
        if (!request.result || request.result.value === undefined) {
          resolve(null);
          return;
        }

        const retrievedValue = request.result.value;

        if (store === "keys") {
          if (typeof retrievedValue !== "string") {
            console.error(`Corrupted data in store ${store} for id ${id}: expected base64 wrapped key string.`);
            resolve(null);
            return;
          }
          try {
            const wrappingKey = await secureStorage.getInternalKey();
            if (!wrappingKey) {
              throw new Error("SecureStorage internal key not available for unwrapping contact key.");
            }

            const combinedBuffer = base64ToArrayBuffer(retrievedValue);
            if (combinedBuffer.length < 12) { // Basic check for IV presence
              console.error(`Corrupted wrapped key in store ${store} for id ${id}: too short.`);
              resolve(null);
              return;
            }
            const iv = combinedBuffer.slice(0, 12);
            const wrappedKeyBuffer = combinedBuffer.slice(12);

            const cryptoKey = await window.crypto.subtle.unwrapKey(
              "jwk",
              wrappedKeyBuffer,
              wrappingKey,
              { name: "AES-GCM", iv },
              { name: "AES-GCM", length: 256 },
              false,
              ["encrypt", "decrypt"],
            );
            resolve({ cryptoKey } as any); // New format successfully unwrapped
          } catch (jwkError) {
            // JWK unwrap failed, assume it's an old-style encrypted string
            console.warn(`JWK unwrap failed for key ${id} (may be old format):`, jwkError);
            try {
              const keyDataString = await secureStorage.decrypt(retrievedValue);
              if (keyDataString) {
                const importedOldKey = await importKey(keyDataString); // from '@/utils/encryption'
                resolve({ cryptoKey: importedOldKey, keyDataString } as any); // Old format decrypted and imported
              } else {
                console.error(`Failed to decrypt old format key ${id} after JWK unwrap failure.`);
                resolve(null);
              }
            } catch (decryptError) {
              console.error(`Both JWK unwrap and old format decryption failed for key ${id}:`, decryptError);
              resolve(null);
            }
          }
        } else {
          // For other stores (contacts, messages, groups), decrypt the string value
          if (typeof retrievedValue !== "string") {
            console.error(`Corrupted data in store ${store} for id ${id}: expected encrypted string.`);
            resolve(null);
            return;
          }
          try {
            const decryptedValue = await secureStorage.decrypt(retrievedValue);
            resolve(decryptedValue as any); // Cast to satisfy complex conditional type
          } catch (error) {
            console.error(`Error decrypting value from store ${store} for id ${id}:`, error);
            resolve(null);
          }
        }
      };
    });
  }

  async getRawValue<T extends keyof DBSchema>(
    store: T,
    id: string,
  ): Promise<any | null> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(store, "readonly");
      const objectStore = transaction.objectStore(store);
      const request = objectStore.get(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        if (!request.result || request.result.value === undefined) {
          resolve(null);
        } else {
          // Resolve with the raw value from DB, which includes the { id, value } wrapper
          resolve(request.result.value);
        }
      };
    });
  }

  async delete<T extends keyof DBSchema>(store: T, id: string): Promise<void> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(store, "readwrite");
      const objectStore = transaction.objectStore(store);
      const request = objectStore.delete(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
}

export const db = new IndexedDBManager();
