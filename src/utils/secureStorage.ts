// A utility for encrypting/decrypting data with a non-extractable key
export class SecureStorage {
  private encryptionKey: CryptoKey | null = null;
  private readonly DB_NAME = 'secure_storage';
  private readonly STORE_NAME = 'keys';
  private readonly KEY_ID = 'main_key';

  async init(): Promise<void> {
    if (this.encryptionKey) return;

    // Try to get existing key from IndexedDB
    const storedKey = await this.getStoredKey();
    if (storedKey) {
      this.encryptionKey = storedKey;
      return;
    }

    // Generate new key if none exists
    this.encryptionKey = await crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256,
      },
      false, // Key is not extractable
      ['encrypt', 'decrypt']
    );

    // Store key in IndexedDB
    await this.storeKey(this.encryptionKey);
  }

  private async getStoredKey(): Promise<CryptoKey | null> {
    return new Promise((resolve) => {
      const request = indexedDB.open(this.DB_NAME, 1);

      request.onerror = () => {
        console.error('Error opening IndexedDB');
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
        const transaction = db.transaction(this.STORE_NAME, 'readonly');
        const store = transaction.objectStore(this.STORE_NAME);
        const keyRequest = store.get(this.KEY_ID);

        keyRequest.onerror = () => {
          console.error('Error retrieving key from IndexedDB');
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

      request.onerror = () => reject(new Error('Failed to open IndexedDB'));

      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(this.STORE_NAME, 'readwrite');
        const store = transaction.objectStore(this.STORE_NAME);
        const keyRequest = store.put(key, this.KEY_ID);

        keyRequest.onerror = () => reject(new Error('Failed to store key in IndexedDB'));
        keyRequest.onsuccess = () => resolve();
      };
    });
  }

  async encrypt(data: string): Promise<string> {
    if (!this.encryptionKey) {
      await this.init();
    }

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encodedData = new TextEncoder().encode(data);

    const encryptedData = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      this.encryptionKey!,
      encodedData
    );

    // Combine IV and encrypted data
    const combined = new Uint8Array(iv.length + encryptedData.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encryptedData), iv.length);

    return btoa(String.fromCharCode(...combined));
  }

  async decrypt(encryptedData: string): Promise<string> {
    if (!this.encryptionKey) {
      await this.init();
    }

    try {
      const combined = new Uint8Array(
        atob(encryptedData)
          .split('')
          .map(char => char.charCodeAt(0))
      );

      const iv = combined.slice(0, 12);
      const data = combined.slice(12);

      const decrypted = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv,
        },
        this.encryptionKey!,
        data
      );

      return new TextDecoder().decode(decrypted);
    } catch (error) {
      console.error('Decryption failed:', error);
      throw new Error('Failed to decrypt data');
    }
  }
}

export const secureStorage = new SecureStorage();
