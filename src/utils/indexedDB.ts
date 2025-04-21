
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
}

const DB_NAME = 'ccred_db';
const DB_VERSION = 1;
const STORES = ['contacts', 'messages', 'keys'] as const;

class IndexedDBManager {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        STORES.forEach(storeName => {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, { keyPath: 'id' });
          }
        });
      };
    });
  }

  async set<T extends keyof DBSchema>(store: T, id: string, value: string): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(store, 'readwrite');
      const objectStore = transaction.objectStore(store);
      const request = objectStore.put({ id, value });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async get<T extends keyof DBSchema>(store: T, id: string): Promise<string | null> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(store, 'readonly');
      const objectStore = transaction.objectStore(store);
      const request = objectStore.get(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        resolve(request.result ? request.result.value : null);
      };
    });
  }

  async delete<T extends keyof DBSchema>(store: T, id: string): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(store, 'readwrite');
      const objectStore = transaction.objectStore(store);
      const request = objectStore.delete(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
}

export const db = new IndexedDBManager();

