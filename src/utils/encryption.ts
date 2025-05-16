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
    ["encrypt", "decrypt"],
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
    ["encrypt", "decrypt"],
  );
};

// Encrypt a message
export const encryptMessage = async (
  message: string,
  key: CryptoKey,
): Promise<string> => {
  const encodedMessage = new TextEncoder().encode(message);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  const encryptedData = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    encodedMessage,
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
  key: CryptoKey,
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
      data,
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
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  // Use URL-safe base64 encoding
  return window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

export const base64ToArrayBuffer = (base64: string): Uint8Array => {
  // Restore non-URL safe characters and padding
  const base64Std = base64.replace(/-/g, "+").replace(/_/g, "/");

  // Add padding if needed
  const padding = base64Std.length % 4;
  const paddedBase64 = padding
    ? base64Std + "=".repeat(4 - padding)
    : base64Std;

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
type AuthenticatorTransport = "usb" | "nfc" | "ble" | "internal";
type AttestationConveyancePreference =
  | "none"
  | "indirect"
  | "direct"
  | "enterprise";
type UserVerificationRequirement = "required" | "preferred" | "discouraged";

// Generate a new passkey
export const createPasskey = async (username: string) => {
  try {
    // Check if the browser supports the WebAuthn API
    if (!window.PublicKeyCredential) {
      console.error("WebAuthn is not supported in this browser");
      return false;
    }

    // Create a random user ID
    const userId = new Uint8Array(16);
    window.crypto.getRandomValues(userId);
    const saltForPrfEnable = window.crypto.getRandomValues(new Uint8Array(32));
    const saltForKeyGen = window.crypto.getRandomValues(new Uint8Array(32));

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
        // authenticatorAttachment: "platform",
        userVerification: "preferred" as UserVerificationRequirement,
        requireResidentKey: true,
      },
      timeout: 60000,
      extensions: {
        // Attempt to evaluate PRF during creation to check for support
        // This also helps some authenticators "initialize" the PRF capability for the credential
        prf: {
          eval: {
            first: saltForPrfEnable,
          }
        }
      },
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
        new Uint8Array(credential.rawId),
      );
      localStorage.setItem("passkey-credential-id", credentialIdBase64);
      // Store salt as a base64 string
      localStorage.setItem("passkey-saltForKeyGen", arrayBufferToBase64(saltForKeyGen.buffer));

      const extensionResults = credential.getClientExtensionResults();
      if (extensionResults.prf) {
          console.log("PRF extension was processed during registration.", extensionResults.prf);
          if (extensionResults.prf.enabled) { // Some interpretations suggest an 'enabled' field
              console.log("PRF capability explicitly enabled for this credential.");
          }
          if (extensionResults.prf.results && extensionResults.prf.results.first) {
              console.log("PRF value obtained during registration (used for checking support).");
          }
      } else {
          console.log("PRF extension not supported or not evaluated during registration by this authenticator.");
      }
      return credential;
    }

    return null;
  } catch (error) {
    console.error("Error creating passkey", error);
    return null;
  }
};

export const deriveEncryptionKeyFromPrf = async (
  prfSecret: Uint8Array,
  saltForKeyGenString: string,
): Promise<CryptoKey | null> => {
  if (!prfSecret || !saltForKeyGenString) {
    console.error("PRF secret or salt for key generation is missing.");
    return null;
  }

  const info = "encryption-key";
  const saltForHkdfExtract = base64ToArrayBuffer(saltForKeyGenString);

  if (saltForHkdfExtract.length === 0 && saltForKeyGenString.length > 0) {
    console.error("Failed to decode salt for key generation.");
    return null; // Error during base64 decoding
  }


  try {
    // 1. Import the PRF secret as an HMAC key for HKDF's extract phase
    const hmacKey = await crypto.subtle.importKey(
      "raw",
      prfSecret,
      { name: "HMAC", hash: "SHA-256" },
      false, // not extractable
      ["sign"] // usage for HMAC
    );

    // 2. HKDF Extract phase: Creates a pseudo-random key (PRK)
    // The 'salt' here is for the HKDF itself, not the PRF salt.
    // You can use a fixed salt for HKDF or a randomly generated one.
    // If prfSecret is already cryptographically strong, salt might be optional or an all-zero array.
    const prk = await crypto.subtle.sign(
      "HMAC",
      hmacKey,
      saltForHkdfExtract,
    );

    // 3. HKDF Expand phase: Derives the actual encryption key of desired length
    // The 'info' parameter provides context, ensuring different keys are generated for different purposes
    // even from the same PRK.
    const keyLengthBytes = 32; // For AES-256
    const derivedKey = await crypto.subtle.deriveKey(
      {
        name: "HKDF",
        salt: new Uint8Array(), // Salt for expand phase (often empty if extract used salt)
        info: new TextEncoder().encode(info), // Context-specific info
        hash: "SHA-256",
      },
      await crypto.subtle.importKey("raw", prk, "HKDF", false, ["deriveKey"]), // Import PRK for deriveKey
      { name: "AES-GCM", length: keyLengthBytes * 8 }, // Algorithm and length for the derived key
      false, // Make non-exportable, consistent with SecureStorage's own keys
      ["encrypt", "decrypt"] // Key usages
    );
    console.log("Derived encryption key (non-exportable):", derivedKey);
    return derivedKey;
  } catch (err) {
    console.error("Key derivation failed:", err);
    return null;
  }
}

// Get a passkey
export const getPasskey = async () => {
  try {
    // Get the credential ID from localStorage
    const credentialId = localStorage.getItem("passkey-credential-id");
    if (!credentialId) {
      console.error("No passkey credential found");
      return null;
    }

    // Create the publicKey options for authentication with correct types
    const salt1 = crypto.getRandomValues(new Uint8Array(32)); // Salt for deriving the local encryption key
    const publicKeyOptions: PublicKeyCredentialRequestOptions = {
      challenge: window.crypto.getRandomValues(new Uint8Array(32)),
      rpId: window.location.hostname,
      allowCredentials: [
        //{
        //  type: "public-key",
        //  id: base64ToArrayBuffer(credentialId),
        //  transports: ["internal"] as AuthenticatorTransport[],
        //},
      ],
      extensions: {
        prf: {
          eval: {
            first: salt1,
          },
        },
      },
      timeout: 60000,
      userVerification: "preferred" as UserVerificationRequirement,
    };

    // @ts-ignore - TypeScript doesn't recognize the navigator.credentials.get method
    const credential = await navigator.credentials.get({
      publicKey: publicKeyOptions,
    });
    const extensionResults = credential.getClientExtensionResults();

    let prfSecret = null;
    if (extensionResults.prf && extensionResults.prf.results && extensionResults.prf.results.first) {
      // prfSecret will be extracted and used by AuthContext to call deriveEncryptionKeyFromPrf
      console.log("PRF Secret (first) received and available in extensionResults.");
    }

    return credential;
  } catch (error) {
    console.error("Error getting passkey", error);
    return null;
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
  key: CryptoKey,
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
    const hashBuffer = await window.crypto.subtle.digest(
      "SHA-256",
      combinedBytes,
    );

    // 6. Encode the hash digest using URL-safe base64
    return arrayBufferToBase64(hashBuffer);
  } catch (error) {
    console.error("Error generating stable request ID:", error);
    // Return a fallback or re-throw, depending on desired error handling
    throw new Error("Failed to generate stable request ID");
  }
};
