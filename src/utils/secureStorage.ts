
// A utility for encrypting/decrypting data with a non-extractable key
export class SecureStorage {
  private encryptionKey: CryptoKey | null = null;

  async init(): Promise<void> {
    if (this.encryptionKey) return;

    // Try to get existing key from IndexedDB
    const storedKey = await this.getStoredKey();
    if (storedKey) {
      this.encryptionKey = storedKey;
      return;
    }

    // Generate new non-extractable key
    this.encryptionKey = await crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256,
      },
      false, // Make key non-extractable
      ['encrypt', 'decrypt']
    );

    // Store key securely
    await this.storeKey(this.encryptionKey);
  }

  private async getStoredKey(): Promise<CryptoKey | null> {
    try {
      const keyData = localStorage.getItem('storage_key');
      if (!keyData) return null;

      // Convert stored key data back to CryptoKey
      return await crypto.subtle.importKey(
        'jwk',
        JSON.parse(keyData),
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    } catch (error) {
      console.error('Error retrieving storage key:', error);
      return null;
    }
  }

  private async storeKey(key: CryptoKey): Promise<void> {
    try {
      // Export key as JWK for storage
      const exportedKey = await crypto.subtle.exportKey('jwk', key);
      localStorage.setItem('storage_key', JSON.stringify(exportedKey));
    } catch (error) {
      console.error('Error storing key:', error);
      throw new Error('Failed to store encryption key');
    }
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
