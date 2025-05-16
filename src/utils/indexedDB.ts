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
    value: string; // encrypted key data
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
    value: string,
  ): Promise<void> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    // Encrypt the value before storing
    const encryptedValue = await secureStorage.encrypt(value);

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(store, "readwrite");
      const objectStore = transaction.objectStore(store);
      const request = objectStore.put({ id, value: encryptedValue });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async get<T extends keyof DBSchema>(
    store: T,
    id: string,
  ): Promise<string | null> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(store, "readonly");
      const objectStore = transaction.objectStore(store);
      const request = objectStore.get(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = async () => {
        if (!request.result) {
          resolve(null);
          return;
        }

        try {
          // Decrypt the value before returning
          const decryptedValue = await secureStorage.decrypt(
            request.result.value,
          );
          resolve(decryptedValue);
        } catch (error) {
          console.error("Error decrypting value:", error);
          resolve(null);
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
