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

import { arrayBufferToBase64, base64ToArrayBuffer } from "./encryption"; // For key wrapping

// ... (rest of the imports and existing code)

// IMPORTANT: This class will require a new method in SecureStorage:
// `async getInternalKey(): Promise<CryptoKey | null>`
// This method should return the `this.encryptionKey` from SecureStorage.

class IndexedDBManager {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> { // Removed derivedKey parameter
    if (this.db) return;

    // SecureStorage must be initialized before any DB operations.
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
    value: T extends "keys" ? CryptoKey : string,
  ): Promise<void> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    let valueToStore: string;

    if (store === "keys") {
      const cryptoKeyToWrap = value as CryptoKey;
      // @ts-ignore // TODO: Add getInternalKey to SecureStorage class definition
      const wrappingKey = await secureStorage.getInternalKey();
      if (!wrappingKey) {
        throw new Error("SecureStorage key not available for wrapping contact key.");
      }

      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      // The cryptoKeyToWrap MUST be extractable for "raw" format wrapKey
      const wrappedKeyBuffer = await window.crypto.subtle.wrapKey(
        "raw",
        cryptoKeyToWrap,
        wrappingKey,
        { name: "AES-GCM", iv },
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
    (T extends "keys" ? { cryptoKey: CryptoKey } | null : string | null)
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
            // @ts-ignore // TODO: Add getInternalKey to SecureStorage class definition
            const wrappingKey = await secureStorage.getInternalKey();
            if (!wrappingKey) {
              throw new Error("SecureStorage key not available for unwrapping contact key.");
            }

            const combinedBuffer = base64ToArrayBuffer(retrievedValue);
            const iv = combinedBuffer.slice(0, 12);
            const wrappedKeyBuffer = combinedBuffer.slice(12);

            const cryptoKey = await window.crypto.subtle.unwrapKey(
              "raw",
              wrappedKeyBuffer,
              wrappingKey,
              { name: "AES-GCM", iv },
              { name: "AES-GCM", length: 256 }, // Algorithm of the key to unwrap
              false, // Make the unwrapped key non-extractable
              ["encrypt", "decrypt"],
            );
            resolve({ cryptoKey } as any); // Cast to satisfy complex conditional type
          } catch (error) {
            console.error(`Error processing wrapped key from store ${store} for id ${id}:`, error);
            resolve(null);
          }
        } else {
          // For other stores, decrypt the string value
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
