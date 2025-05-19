import { secureStorage } from "./secureStorage";
import { importKey } from "./encryption"; // Removed arrayBufferToBase64, base64ToArrayBuffer

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
    // value can be a CryptoKey (new format) or an encrypted string (old format)
    value: CryptoKey | string;
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
  private initializationPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.db) {
      return Promise.resolve(); // Already initialized
    }

    if (this.initializationPromise) {
      return this.initializationPromise; // Initialization in progress
    }

    // Start new initialization
    // Application is now responsible for calling secureStorage.init() or secureStorage.initializeWithKey()
    // *before* IndexedDBManager operations that require encryption/decryption.

    this.initializationPromise = new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error(`Error opening IndexedDB (${DB_NAME}, v${DB_VERSION}):`, request.error);
        this.initializationPromise = null; // Allow re-attempts
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log(`Database ${DB_NAME} (v${DB_VERSION}) initialized successfully.`);

        // Listen for version changes from other tabs/windows
        this.db.onversionchange = () => {
          if (this.db) {
            this.db.close(); // Close this connection to allow upgrade
            this.db = null;
            this.initializationPromise = null; // Allow re-initialization
            console.warn(`Database ${DB_NAME} version change detected. Connection closed to allow upgrade.`);
            // Application may need to notify user or reload.
          }
        };
        
        // Initialization successful, resolve the promise.
        // It remains as this fulfilled promise unless close() is called.
        resolve();
      };

      request.onupgradeneeded = (event) => {
        console.log(`Upgrading database ${DB_NAME} to version ${DB_VERSION}. Old version: ${event.oldVersion}`);
        const currentDb = (event.target as IDBOpenDBRequest).result;

        STORES.forEach((storeName) => {
          if (!currentDb.objectStoreNames.contains(storeName)) {
            console.log(`Creating object store: ${storeName}`);
            currentDb.createObjectStore(storeName, { keyPath: "id" });
          }
          // TODO: Add any necessary store-specific migration logic here
          // based on event.oldVersion and DB_VERSION.
        });
        // onupgradeneeded transaction commits automatically.
        // The main initializationPromise resolves/rejects via onsuccess/onerror.
      };

      request.onblocked = (event) => {
        console.warn(`Database ${DB_NAME} open request is blocked. Ensure other connections are closed on 'versionchange'. Event:`, event);
        this.initializationPromise = null; // Allow re-attempts
        reject(new Error(`Database ${DB_NAME} open request was blocked.`));
      };
    });

    return this.initializationPromise;
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

    let valueToStore: CryptoKey | string;

    if (store === "keys") {
      // Store CryptoKey directly for the "keys" store
      if (!(value instanceof CryptoKey)) {
        throw new Error(`Invalid value type for store ${store}. Expected CryptoKey.`);
      }
      valueToStore = value;
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
      // For "keys", valueToStore is CryptoKey; for others, it's an encrypted string.
      // IndexedDB can store CryptoKey objects directly.
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

        const storedRecordValue = request.result.value;

        if (store === "keys") {
          if (storedRecordValue instanceof CryptoKey) {
            // New format: CryptoKey stored directly
            resolve({ cryptoKey: storedRecordValue } as any);
          } else if (typeof storedRecordValue === 'string') {
            // Old format: encrypted keyDataString
            console.warn(`Key ${id} is in old string format. Attempting decryption and import.`);
            try {
              const keyDataString = await secureStorage.decrypt(storedRecordValue);
              if (keyDataString) {
                const importedOldKey = await importKey(keyDataString);
                resolve({ cryptoKey: importedOldKey, keyDataString } as any);
              } else {
                console.error(`Failed to decrypt old format key string for ${id}.`);
                resolve(null);
              }
            } catch (decryptError) {
              console.error(`Error decrypting old format key string for ${id}:`, decryptError);
              resolve(null);
            }
          } else {
            console.error(`Unexpected data type in 'keys' store for id ${id}:`, typeof storedRecordValue);
            resolve(null);
          }
        } else {
          // For other stores (contacts, messages, groups), value should be an encrypted string
          if (typeof storedRecordValue !== "string") {
            console.error(`Corrupted data in store ${store} for id ${id}: expected encrypted string, got ${typeof storedRecordValue}.`);
            resolve(null);
            return;
          }
          try {
            const decryptedValue = await secureStorage.decrypt(storedRecordValue);
            resolve(decryptedValue as any);
          } catch (error) {
            console.error(`Error decrypting value from store ${store} for id ${id}:`, error);
            resolve(null);
          }
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

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initializationPromise = null; // Reset initialization promise
      console.log(`Database ${DB_NAME} connection closed.`);
    }
  }

  async deleteEntireDatabase(): Promise<void> {
    // Ensure the connection is closed by calling the instance's close method.
    // This method handles the case where this.db might already be null.
    this.close();

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const request = indexedDB.deleteDatabase(DB_NAME);
        request.onerror = (event) => {
          console.error(`Error deleting database ${DB_NAME}:`, (event.target as IDBOpenDBRequest).error);
          reject((event.target as IDBOpenDBRequest).error);
        };
        request.onsuccess = () => {
          console.log(`Database ${DB_NAME} deleted successfully after delay.`);
          resolve();
        };
        request.onblocked = (event) => {
          // It's useful to log the event for onblocked to see more details if possible
          console.warn(`Deletion of database ${DB_NAME} is blocked even after delay. Event:`, event);
          reject(new Error(`Database ${DB_NAME} deletion blocked.`));
        };
      }, 100); // 100ms delay
    });
  }
}

export const db = new IndexedDBManager();
