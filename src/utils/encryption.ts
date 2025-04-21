
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

// Helper functions
export const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
};

export const base64ToArrayBuffer = (base64: string): Uint8Array => {
  const binaryString = window.atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
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
      // Store the credential ID in localStorage for later use
      localStorage.setItem("passkey-credential-id", credential.id);
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
