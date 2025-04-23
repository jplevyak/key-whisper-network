
/**
 * Utility functions for encryption/decryption using AES-256
 */

// Generate a new random AES-256 key
export const generateAESKey = async (): Promise<CryptoKey> => {
  return await window.crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true, // extractable
    ["encrypt", "decrypt"]
  );
};

// Export the key to raw format for QR code generation
export const exportKey = async (key: CryptoKey): Promise<string> => {
  const exported = await window.crypto.subtle.exportKey("raw", key);
  return arrayBufferToBase64(exported);
};

// Import a key from raw format (from QR code)
export const importKey = async (keyData: string): Promise<CryptoKey> => {
  const keyBuffer = base64ToArrayBuffer(keyData);
  return await window.crypto.subtle.importKey(
    "raw",
    keyBuffer,
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"]
  );
};

// Encrypt a message
export const encryptMessage = async (
  message: string,
  key: CryptoKey
): Promise<string> => {
  const encodedMessage = new TextEncoder().encode(message);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  const encryptedData = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    encodedMessage
  );

  // Combine IV and encrypted data
  const combined = new Uint8Array(iv.length + encryptedData.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encryptedData), iv.length);
  
  return arrayBufferToBase64(combined);
};

// Decrypt a message
export const decryptMessage = async (
  encryptedMessage: string,
  key: CryptoKey
): Promise<string> => {
  try {
    const encryptedBuffer = base64ToArrayBuffer(encryptedMessage);
    const iv = encryptedBuffer.slice(0, 12);
    const data = encryptedBuffer.slice(12);

    const decryptedData = await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
      },
      key,
      data
    );

    return new TextDecoder().decode(decryptedData);
  } catch (error) {
    console.error("Decryption failed", error);
    return "[Decryption failed]";
  }
};

// Better, URL-safe base64 encoding/decoding functions
export const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  // Use URL-safe base64 encoding
  return window.btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

export const base64ToArrayBuffer = (base64: string): Uint8Array => {
  // Restore non-URL safe characters and padding
  const base64Std = base64
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  
  // Add padding if needed
  const padding = base64Std.length % 4;
  const paddedBase64 = padding ? 
    base64Std + '='.repeat(4 - padding) : 
    base64Std;
  
  try {
    const binaryString = window.atob(paddedBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } catch (error) {
    console.error("Base64 decoding error:", error);
    // Return empty array in case of error
    return new Uint8Array(0);
  }
};

// Define WebAuthn types to match the expected types
type AuthenticatorTransport = 'usb' | 'nfc' | 'ble' | 'internal';
type AttestationConveyancePreference = 'none' | 'indirect' | 'direct' | 'enterprise';
type UserVerificationRequirement = 'required' | 'preferred' | 'discouraged';

// Generate a new passkey
export const createPasskey = async (username: string): Promise<boolean> => {
  try {
    // Check if the browser supports the WebAuthn API
    if (!window.PublicKeyCredential) {
      console.error("WebAuthn is not supported in this browser");
      return false;
    }

    // Create a random user ID
    const userId = new Uint8Array(16);
    window.crypto.getRandomValues(userId);

    // Create the publicKey options with correct types
    const publicKeyOptions: PublicKeyCredentialCreationOptions = {
      challenge: window.crypto.getRandomValues(new Uint8Array(32)),
      rp: {
        name: "KeyWhisper",
        id: window.location.hostname,
      },
      user: {
        id: userId,
        name: username,
        displayName: username,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 }, // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "preferred" as UserVerificationRequirement,
        requireResidentKey: true,
      },
      timeout: 60000,
      attestation: "none" as AttestationConveyancePreference,
    };

    // @ts-ignore - TypeScript doesn't recognize the navigator.credentials.create method
    const credential = await navigator.credentials.create({
      publicKey: publicKeyOptions,
    });

    if (credential) {
      // Store the credential ID in localStorage using URL-safe base64
      const credentialIdBase64 = arrayBufferToBase64(
        // @ts-ignore - Access raw ID from credential
        new Uint8Array(credential.rawId)
      );
      localStorage.setItem("passkey-credential-id", credentialIdBase64);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error("Error creating passkey", error);
    return false;
  }
};

// Verify a passkey
export const verifyPasskey = async (): Promise<boolean> => {
  try {
    // Get the credential ID from localStorage
    const credentialId = localStorage.getItem("passkey-credential-id");
    if (!credentialId) {
      console.error("No passkey credential found");
      return false;
    }

    // Create the publicKey options for authentication with correct types
    const publicKeyOptions: PublicKeyCredentialRequestOptions = {
      challenge: window.crypto.getRandomValues(new Uint8Array(32)),
      rpId: window.location.hostname,
      allowCredentials: [
        {
          type: "public-key",
          id: base64ToArrayBuffer(credentialId),
          transports: ["internal"] as AuthenticatorTransport[],
        },
      ],
      timeout: 60000,
      userVerification: "preferred" as UserVerificationRequirement,
    };

    // @ts-ignore - TypeScript doesn't recognize the navigator.credentials.get method
    const assertion = await navigator.credentials.get({
      publicKey: publicKeyOptions,
    });

    return !!assertion;
  } catch (error) {
    console.error("Error verifying passkey", error);
    return false;
  }
};

// Check if passkeys are supported
export const isPasskeySupported = (): boolean => {
  return !!window.PublicKeyCredential;
};

// Check if biometric authentication is supported
export const isBiometricSupported = async (): Promise<boolean> => {
  if (!window.PublicKeyCredential) return false;
  
  // @ts-ignore - TypeScript doesn't recognize the isUserVerifyingPlatformAuthenticatorAvailable method
  return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
};

// Generate a stable request ID based on key and context string using SHA-256
export const generateStableRequestId = async (
  userGeneratedKey: boolean,
  key: CryptoKey
): Promise<string> => {
  try {
    // 1. Determine the context string
    const contextString = userGeneratedKey ? "key receiver" : "key generator";

    // 2. Encode the context string to bytes
    const contextBytes = new TextEncoder().encode(contextString);

    // 3. Export the raw key bytes
    const exportedKeyBuffer = await window.crypto.subtle.exportKey("raw", key);
    const keyBytes = new Uint8Array(exportedKeyBuffer);

    // 4. Concatenate context string bytes and key bytes
    const combinedBytes = new Uint8Array(contextBytes.length + keyBytes.length);
    combinedBytes.set(contextBytes, 0);
    combinedBytes.set(keyBytes, contextBytes.length);

    // 5. Compute the SHA-256 hash
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", combinedBytes);

    // 6. Encode the hash digest using URL-safe base64
    return arrayBufferToBase64(hashBuffer);
  } catch (error) {
    console.error("Error generating stable request ID:", error);
    // Return a fallback or re-throw, depending on desired error handling
    throw new Error("Failed to generate stable request ID");
  }
};

