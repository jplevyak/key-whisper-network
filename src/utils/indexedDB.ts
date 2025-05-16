import { secureStorage } from "./secureStorage";

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
    // value will be StoredKeyData object directly, not an encrypted string
    // StoredKeyData contains a non-extractable CryptoKey and two request ID strings.
    value: any; // Using 'any' here as CryptoKey is not directly serializable by JSON for stricter typing.
                // In practice, this will be StoredKeyData from ContactsContext.
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
    // If AuthContext called secureStorage.initializeWithKey(), it's already set up with the derived key.
    // Otherwise, this secureStorage.init() will set up secureStorage with its default "main_key".
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

  async set<T extends keyof DBSchema>(
    store: T,
    id: string,
    value: T extends "keys" ? any : string, // 'value' is 'any' for 'keys', 'string' otherwise
  ): Promise<void> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    let valueToStore: any;

    if (store === "keys") {
      // For the 'keys' store, value is StoredKeyData (which includes a CryptoKey)
      // and should be stored directly without encryption by secureStorage.
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
      // The structure in DB is { id: string, value: actual_data_or_encrypted_string }
      const request = objectStore.put({ id, value: valueToStore });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async get<T extends keyof DBSchema>(
    store: T,
    id: string,
  ): Promise<(T extends "keys" ? any : string) | null> { // Return type depends on T
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
          // For the 'keys' store, the value is StoredKeyData (containing a CryptoKey)
          // and is retrieved directly, not decrypted by secureStorage.
          resolve(retrievedValue as (T extends "keys" ? any : string));
        } else {
          // For other stores, decrypt the string value
          if (typeof retrievedValue !== 'string') {
            console.error(`Corrupted data in store ${store} for id ${id}: expected encrypted string.`);
            resolve(null);
            return;
          }
          try {
            const decryptedValue = await secureStorage.decrypt(retrievedValue);
            resolve(decryptedValue as (T extends "keys" ? any : string));
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
}

export const db = new IndexedDBManager();
