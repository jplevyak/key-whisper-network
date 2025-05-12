import { db } from "@/utils/indexedDB";
import { Message } from "@/contexts/MessagesContext"; // Assuming Message type is exported or moved

// Mock encryption for the local storage (in a real app, this would use the passkey-protected key)
const mockEncryptForStorage = (data: string): string => {
  // This is a placeholder. In a real app, encrypt with the passkey-protected key
  return btoa(data);
};

const mockDecryptFromStorage = (encryptedData: string): string => {
  // This is a placeholder. In a real app, decrypt with the passkey-protected key
  return atob(encryptedData);
};

export const loadMessagesFromStorage = async (): Promise<Record<
  string,
  Message[]
> | null> => {
  const storedMessages = await db.get("messages", "all");
  if (storedMessages) {
    const decryptedData = mockDecryptFromStorage(storedMessages);
    return JSON.parse(decryptedData) as Record<string, Message[]>;
  }
  return null;
};

export const saveMessagesToStorage = async (
  messages: Record<string, Message[]>,
): Promise<void> => {
  if (Object.keys(messages).length === 0) {
    // Avoid saving empty state, maybe delete the entry?
    // await db.delete('messages', 'all');
    return;
  }
  const encryptedData = mockEncryptForStorage(JSON.stringify(messages));
  await db.set("messages", "all", encryptedData);
};
