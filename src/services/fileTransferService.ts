
import { arrayBufferToBase64, base64ToArrayBuffer, generateAESKey, exportKey } from "../utils/encryption";

export interface FileTransferMetadata {
    transferId: string;
    filename: string;
    size: number;
    mimeType: string;
    chunkSize: number;
    iv: string; // Base64 encoded Base IV
    checksum: string; // SHA-256 hash of the CIPHERTEXT (masked content excluding header)
    maskedFilename: string;
}

export interface EncryptedFileResult {
    maskedFile: File;
    metadata: FileTransferMetadata;
    key: string; // Exported Base64 Raw Key
}

const CHUNK_SIZE = 1024 * 1024; // 1MB
const MAGIC_HEADER = "CCRED\x01";

// Helper to generate a random UUID v4
const generateUUID = () => {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
};

// Helper to read Blob as ArrayBuffer (JSDOM/Legacy compatibility)
const blobToArrayBuffer = (blob: Blob): Promise<ArrayBuffer> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
    });
};

/**
 * Encrypts a file using a fresh random AES-GCM key.
 * Masks the output as a .txt file with a magic header.
 */
export const encryptFileForShare = async (
    file: File
): Promise<EncryptedFileResult> => {
    const key = await generateAESKey();
    const transferId = generateUUID();
    const baseIv = window.crypto.getRandomValues(new Uint8Array(12));
    const encryptedChunks: BlobPart[] = [];

    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    // We need to process chunks sequentially
    for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);

        let arrayBuffer: ArrayBuffer;
        if (typeof chunk.arrayBuffer === 'function') {
            arrayBuffer = await chunk.arrayBuffer();
        } else {
            arrayBuffer = await blobToArrayBuffer(chunk);
        }

        const buffer = new Uint8Array(arrayBuffer);

        // Derive IV: Base IV (12 bytes) XOR Counter (last 4 bytes)
        const chunkIv = new Uint8Array(baseIv);
        const view = new DataView(chunkIv.buffer);
        const counter = view.getUint32(8, false) + i; // Big-endian
        view.setUint32(8, counter, false);

        const encryptedChunk = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: chunkIv },
            key,
            buffer
        );

        // Push ArrayBuffer directly
        encryptedChunks.push(encryptedChunk);
    }

    // Create the header bytes
    const headerString = `${MAGIC_HEADER}${transferId}\n`;
    const headerBytes = new TextEncoder().encode(headerString);

    // Calculate Checksum of the ciphertext (excluding header)
    // We need to concat them all to hash.
    // Manual concatenation to ensure no JSDOM/Blob issues
    const totalCiphertextLength = encryptedChunks.reduce((acc, chunk) => acc + (chunk as ArrayBuffer).byteLength, 0);
    const allCiphertext = new Uint8Array(totalCiphertextLength);

    let offset = 0;
    for (const chunk of encryptedChunks) {
        const chunkBytes = new Uint8Array(chunk as ArrayBuffer);
        allCiphertext.set(chunkBytes, offset);
        offset += chunkBytes.length;
    }

    const hashBuffer = await window.crypto.subtle.digest("SHA-256", allCiphertext);
    const checksum = arrayBufferToBase64(hashBuffer);

    // Combine Header + Ciphertext
    const finalFileBuffer = new Uint8Array(headerBytes.length + allCiphertext.length);
    finalFileBuffer.set(headerBytes, 0);
    finalFileBuffer.set(allCiphertext, headerBytes.length);

    // Create a real File object for browser compatibility (navigator.share requires it)
    // For Encrypt/Decrypt flow, we rename it to .ccred
    const maskedFile = new File(
        [finalFileBuffer],
        `${file.name}.ccred`, // Use .ccred extension
        {
            type: "application/ccred+octet-stream", // Custom mime type? or generic
            lastModified: Date.now(),
        }
    );

    const exportedKey = await exportKey(key);

    return {
        maskedFile,
        metadata: {
            transferId,
            filename: file.name,
            size: file.size,
            mimeType: file.type || "application/octet-stream",
            chunkSize: CHUNK_SIZE,
            // Create a copy of the buffer to ensure we only get the 12 bytes of IV, 
            // avoiding issues if the original Uint8Array is a view on a larger buffer.
            iv: arrayBufferToBase64(new Uint8Array(baseIv).buffer),
            checksum,
            maskedFilename: maskedFile.name
        },
        key: exportedKey
    };
};

/**
 * Decrypts a shared file using the provided metadata and key.
 */
export const decryptSharedFile = async (
    maskedFile: File,
    key: CryptoKey,
    metadata: FileTransferMetadata
): Promise<File> => {
    // 1. Validate Header
    // Header is "CCRED\x01" (6) + UUID (36) + \n (1) = 43 bytes.
    const HEADER_SIZE = MAGIC_HEADER.length + 36 + 1;
    const headerSlice = maskedFile.slice(0, HEADER_SIZE);
    const headerAb = await blobToArrayBuffer(headerSlice);
    const headerBytes = new Uint8Array(headerAb);

    // Check Magic Header
    const magicStr = "CCRED\x01";
    for (let i = 0; i < magicStr.length; i++) {
        if (headerBytes[i] !== magicStr.charCodeAt(i)) {
            throw new Error("Invalid file format: Missing magic header");
        }
    }

    // Extract Transfer ID (next 36 bytes after magic header)
    // UUID consists of hex digits and hyphens, all ASCII/UTF-8 compatible.
    const idBytes = headerBytes.subarray(magicStr.length, magicStr.length + 36);
    const embeddedId = new TextDecoder().decode(idBytes);

    if (embeddedId !== metadata.transferId) {
        throw new Error(`Transfer ID mismatch: Expected ${metadata.transferId}, got ${embeddedId}`);
    }

    // Calculate where ciphertext starts
    const headerLength = HEADER_SIZE;

    // 2. Validate Checksum
    const ciphertextBlob = maskedFile.slice(headerLength);
    const ciphertextAb = await blobToArrayBuffer(ciphertextBlob);
    const ciphertextBuffer = new Uint8Array(ciphertextAb);
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", ciphertextBuffer);
    const calculatedChecksum = arrayBufferToBase64(hashBuffer);

    if (calculatedChecksum !== metadata.checksum) {
        throw new Error("Integrity check failed: Checksum mismatch");
    }

    // 3. Decrypt Chunks
    const baseIv = base64ToArrayBuffer(metadata.iv);
    const decryptedChunks: BlobPart[] = [];

    const tagLength = 16;
    const encryptedChunkSize = metadata.chunkSize + tagLength;

    const totalChunks = Math.ceil(metadata.size / metadata.chunkSize);

    for (let i = 0; i < totalChunks; i++) {
        let currentEncryptedChunkSize = encryptedChunkSize;

        // If it's the last chunk, calculate expected size
        if (i === totalChunks - 1) {
            const remainingPlaintext = metadata.size - (i * metadata.chunkSize);
            currentEncryptedChunkSize = remainingPlaintext + tagLength;
        }

        const sliceStart = i * encryptedChunkSize;
        const sliceEnd = sliceStart + currentEncryptedChunkSize;

        const chunkBlob = ciphertextBlob.slice(sliceStart, sliceEnd);
        const chunkArrayBuffer = await blobToArrayBuffer(chunkBlob);
        const chunkBuffer = new Uint8Array(chunkArrayBuffer);

        // Reconstruct IV
        const chunkIv = new Uint8Array(baseIv);
        const view = new DataView(chunkIv.buffer);
        const counter = view.getUint32(8, false) + i;
        view.setUint32(8, counter, false);

        try {
            const decryptedBuffer = await window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: chunkIv },
                key,
                chunkBuffer
            );
            // Push ArrayBuffer directly
            decryptedChunks.push(decryptedBuffer);
        } catch (e) {
            throw new Error(`Decryption failed at chunk ${i}`);
        }
    }

    // Combine decrypted chunks manually
    const totalDecryptedLength = decryptedChunks.reduce((acc, chunk) => acc + (chunk as ArrayBuffer).byteLength, 0);
    const finalDecryptedBuffer = new Uint8Array(totalDecryptedLength);

    let offset = 0;
    for (const chunk of decryptedChunks) {
        const chunkBytes = new Uint8Array(chunk as ArrayBuffer);
        finalDecryptedBuffer.set(chunkBytes, offset);
        offset += chunkBytes.length;
    }

    // Return proper File object
    const decryptedFile = new File(
        [finalDecryptedBuffer],
        metadata.filename,
        {
            type: metadata.mimeType,
            lastModified: Date.now(),
        }
    );

    return decryptedFile;
};
