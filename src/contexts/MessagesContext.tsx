import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { Contact, useContacts, ContactOrGroup, Group } from "./ContactsContext";
// Import generateStableRequestId, encryptMessage, decryptMessage
import {
  generateStableRequestId,
  encryptMessage,
  decryptMessage,
} from "@/utils/encryption";
import { useToast } from "@/components/ui/use-toast";
// Import storage service and polling hook
import {
  loadMessagesFromStorage,
  saveMessagesToStorage,
} from "@/services/messageStorage";
import { useMessagePolling } from "@/hooks/useMessagePolling";
// Buffer utils are no longer needed directly in this file

// Define the structure of the content being encrypted/decrypted
export interface MessageContent {
  message: string;
  group?: string; // Optional: name of the group if it's a group message
}

// Export the Message interface
export interface Message {
  id: string; // This will be the local message ID, not the server hash
  contactId: string;
  groupId?: string; // If message is part of an existing group chat, this is the group's ID.
  groupContextName?: string; // If message is received from a contact with a group context, this is the group name.
  content: string; // Encrypted MessageContent (JSON stringified)
  timestamp: string;
  sent: boolean; // true if sent by user, false if received
  read: boolean;
  pending?: boolean; // True if the message is pending send to the server
  originalSenderId?: string; // ID of the original sender (for received group messages)
  forwarded?: boolean; // True if the message was forwarded
  forwardedPath?: string[]; // Array of contact IDs representing the forwarding path
}

interface MessagesContextType {
  messages: Record<string, Message[]>; // Keyed by itemId (contactId or groupId)
  sendMessage: (itemId: string, textContent: string) => Promise<boolean>;
  forwardMessage: (
    messageId: string,
    originalItemId: string,
    targetItemId: string,
  ) => Promise<boolean>;
  getDecryptedContent: (message: Message) => Promise<MessageContent | null>;
  markAsRead: (itemId: string, messageId: string) => void;
  deleteMessage: (itemId: string, messageId: string) => void;
  clearHistory: (itemId: string) => void;
  moveContextualMessagesToGroup: (
    sourceContactId: string,
    targetGroup: Group,
    originalGroupContextName: string,
  ) => Promise<void>;
  deleteMessagesFromSenderInGroups: (senderContactId: string) => void;
  reEncryptMessagesForKeyChange: (
    contactId: string,
    oldKey: CryptoKey,
    newKey: CryptoKey,
  ) => Promise<void>;
}

// Type for the response from /api/get-messages
// This might need to be updated if server starts returning group info for messages
interface GetMessagesApiResponse {
  results: {
    message_id: string; // This is the encrypted request ID (e.g., encrypted "sending to key generator")
    message: string; // Base64 encoded encrypted message content
    timestamp: string; // ISO timestamp from backend
  }[];
}

const MessagesContext = createContext<MessagesContextType | undefined>(
  undefined,
);

// Mock storage functions moved to messageStorage.ts

export const MessagesProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const { getContactKey, listItems, activeItem } = useContacts(); // Use listItems and get activeItem
  const { toast } = useToast();
  // Fetching logic and refs moved to useMessagePolling hook

  // Load messages from IndexedDB on init
  useEffect(() => {
    const loadMessages = async () => {
      try {
        const loadedMessages = await loadMessagesFromStorage();
        if (loadedMessages) {
          setMessages(loadedMessages);
        }
      } catch (error) {
        console.error("Error loading messages:", error);
        toast({
          title: "Error",
          description: "Could not load your messages",
          variant: "destructive",
        });
      }
    };

    loadMessages();
  }, [toast]);

  // Save messages to IndexedDB whenever they change
  useEffect(() => {
    // No need to check length here, saveMessagesToStorage handles empty state
    saveMessagesToStorage(messages).catch((error) => {
      console.error("Failed to save messages to storage:", error);
      // Optionally show a toast here
    });
  }, [messages]);

  // Use the message polling hook - it runs automatically
  useMessagePolling({ setMessages, activeItemId: activeItem?.id });

  // Send a message to a contact or group
  const sendMessage = async (
    itemId: string, // Can be contactId or groupId
    textContent: string,
  ): Promise<boolean> => {
    const item = listItems.find((i) => i.id === itemId);
    if (!item) {
      toast({
        title: "Error",
        description: "Recipient not found.",
        variant: "destructive",
      });
      return false;
    }

    const localMessageIdBase = `local-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    if (item.itemType === "contact") {
      const contact = item as Contact;
      try {
        const key = await getContactKey(contact.id);
        if (!key) {
          toast({
            title: "Error",
            description: `Could not find encryption key for ${contact.name}.`,
            variant: "destructive",
          });
          return false;
        }
        const messageContent: MessageContent = { message: textContent };
        const encryptedMessageBase64 = await encryptMessage(
          JSON.stringify(messageContent),
          key,
        );
        const requestId = await generateStableRequestId(
          contact.userGeneratedKey,
          key,
        );

        let messageSentToServer = false;
        try {
          const response = await fetch("/api/put-message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message_id: requestId,
              message: encryptedMessageBase64,
            }),
          });
          if (!response.ok)
            throw new Error(
              `API error ${response.status}: ${await response.text()}`,
            );
          messageSentToServer = true;
        } catch (apiError) {
          console.error(
            `Failed to send message to backend for contact ${contact.name}:`,
            apiError,
          );
          toast({
            title: "Send Warning",
            description: `Message to ${contact.name} saved locally, but failed to send.`,
            variant: "warning",
          });
        }

        const newMessage: Message = {
          id: `${localMessageIdBase}-c-${contact.id}`,
          contactId: contact.id,
          content: encryptedMessageBase64,
          timestamp: new Date().toISOString(),
          sent: true,
          read: true,
          pending: !messageSentToServer,
        };
        setMessages((prev) => ({
          ...prev,
          [contact.id]: [...(prev[contact.id] || []), newMessage],
        }));
        return true; // Local save is successful
      } catch (error) {
        console.error(
          `Error sending message to contact ${contact.name}:`,
          error,
        );
        toast({
          title: "Error",
          description: `Could not send message to ${contact.name}.`,
          variant: "destructive",
        });
        return false;
      }
    } else if (item.itemType === "group") {
      const group = item as Group;
      if (group.memberIds.length === 0) {
        toast({
          title: "Cannot Send",
          description: "Group has no members.",
          variant: "info",
        });
        return false;
      }

      // For local display in sender's group chat
      const firstMemberId = group.memberIds[0];
      const firstMemberContact = listItems.find(
        (i) => i.id === firstMemberId && i.itemType === "contact",
      ) as Contact | undefined;
      if (!firstMemberContact) {
        toast({
          title: "Group Error",
          description: "First member of group not found for local encryption.",
          variant: "destructive",
        });
        return false;
      }
      const keyForLocalEncryption = await getContactKey(firstMemberId);
      if (!keyForLocalEncryption) {
        toast({
          title: "Encryption Error",
          description: `Cannot get key for ${firstMemberContact.name} (for local group message).`,
          variant: "destructive",
        });
        return false;
      }
      const groupMessageContent: MessageContent = {
        message: textContent,
        group: group.name,
      };
      const localEncryptedMessage = await encryptMessage(
        JSON.stringify(groupMessageContent),
        keyForLocalEncryption,
      );

      const localGroupMessage: Message = {
        id: `${localMessageIdBase}-g-${group.id}`,
        contactId: group.id, // For sender's view, contactId is the groupId
        groupId: group.id,
        content: localEncryptedMessage,
        timestamp: new Date().toISOString(),
        sent: true,
        read: true,
        pending: true, // Initially pending, will be updated after attempts
      };
      setMessages((prev) => ({
        ...prev,
        [group.id]: [...(prev[group.id] || []), localGroupMessage],
      }));

      let allSendsSuccessful = true;
      for (const memberId of group.memberIds) {
        const memberContact = listItems.find(
          (i) => i.id === memberId && i.itemType === "contact",
        ) as Contact | undefined;
        if (!memberContact) {
          console.warn(
            `Group member ${memberId} not found in contacts. Skipping.`,
          );
          allSendsSuccessful = false;
          continue;
        }
        try {
          const memberKey = await getContactKey(memberId);
          if (!memberKey) {
            console.warn(
              `Could not get encryption key for group member ${memberContact.name}. Skipping.`,
            );
            toast({
              title: "Partial Send Error",
              description: `No key for ${memberContact.name}.`,
              variant: "warning",
            });
            allSendsSuccessful = false;
            continue;
          }
          const memberMessageContent: MessageContent = {
            message: textContent,
            group: group.name,
          };
          const encryptedContentForMember = await encryptMessage(
            JSON.stringify(memberMessageContent),
            memberKey,
          );
          const requestId = await generateStableRequestId(
            memberContact.userGeneratedKey,
            memberKey,
          );

          const response = await fetch("/api/put-message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message_id: requestId,
              message: encryptedContentForMember,
            }),
          });
          if (!response.ok) {
            console.error(
              `API error sending to group member ${memberContact.name}: ${response.status} ${await response.text()}`,
            );
            toast({
              title: "Partial Send Error",
              description: `Failed to send to ${memberContact.name}.`,
              variant: "warning",
            });
            allSendsSuccessful = false;
          }
        } catch (memberError) {
          console.error(
            `Error sending message to group member ${memberContact.name}:`,
            memberError,
          );
          toast({
            title: "Partial Send Error",
            description: `Could not send to ${memberContact.name}.`,
            variant: "warning",
          });
          allSendsSuccessful = false;
        }
      }

      // Update pending status of the local group message
      setMessages((prev) => ({
        ...prev,
        [group.id]: (prev[group.id] || []).map((m) =>
          m.id === localGroupMessage.id
            ? { ...m, pending: !allSendsSuccessful }
            : m,
        ),
      }));

      if (!allSendsSuccessful) {
        toast({
          title: "Group Send Issue",
          description: `Message to ${group.name} sent with some errors.`,
          variant: "warning",
        });
      }
      return true; // Local save is successful, return true even if some remote sends fail
    }
    // Should not reach here if item is found
    return false;
  };

  // Forward a message to another contact or group
  const forwardMessage = async (
    messageId: string,
    originalItemId: string, // contactId or groupId from where the message is being forwarded
    targetItemId: string, // contactId or groupId to forward to
  ): Promise<boolean> => {
    try {
      const originalItemMessages = messages[originalItemId] || [];
      const originalMessage = originalItemMessages.find(
        (m) => m.id === messageId,
      );
      if (!originalMessage) {
        toast({
          title: "Error",
          description: "Could not find the message to forward.",
          variant: "destructive",
        });
        return false;
      }

      const decryptedMessageContent =
        await getDecryptedContent(originalMessage);
      if (!decryptedMessageContent || !decryptedMessageContent.message) {
        toast({
          title: "Error",
          description: "Could not decrypt the message to forward.",
          variant: "destructive",
        });
        return false;
      }

      return await sendMessage(targetItemId, decryptedMessageContent.message);
    } catch (error) {
      console.error("Error forwarding message:", error);
      toast({
        title: "Error",
        description: "Could not send message",
        variant: "destructive",
      });
      return false;
    }
  };

  // Get decrypted content of a message
  const getDecryptedContent = async (
    message: Message,
  ): Promise<MessageContent | null> => {
    try {
      let key: CryptoKey | null = null;
      if (message.sent) {
        // Message sent by the current user
        if (message.groupId) {
          // Sent to a group by the current user
          const group = listItems.find(
            (i) => i.id === message.groupId && i.itemType === "group",
          ) as Group | undefined;
          if (group && group.memberIds.length > 0) {
            // Convention: content for sender's view (local copy) was encrypted with the first member's key.
            // message.contactId is the groupId for the sender's local copy.
            key = await getContactKey(group.memberIds[0]);
          } else {
            return "[Could not decrypt - group/members missing for sent group message]";
          }
        } else {
          // Sent 1-to-1 by the current user
          // message.contactId is the recipient's ID. Key is recipient's key.
          key = await getContactKey(message.contactId);
        }
      } else {
        // Message received by the current user
        if (message.groupId && message.originalSenderId) {
          // Received message that is part of an existing group.
          // message.contactId is the groupId. Key is the originalSenderId's key.
          key = await getContactKey(message.originalSenderId);
        } else if (message.groupContextName && message.contactId) {
          // Received message from a contact, with a group context (group doesn't exist yet or was just a name).
          // message.contactId is the actual sender's ID. Key is the sender's key.
          key = await getContactKey(message.contactId);
        } else if (message.contactId) {
          // Standard 1-to-1 received message
          // message.contactId is the sender's ID. Key is the sender's key.
          key = await getContactKey(message.contactId);
        }
      }

      if (!key) {
        return null;
      }
      const decryptedJson = await decryptMessage(message.content, key);
      return JSON.parse(decryptedJson) as MessageContent;
    } catch (error) {
      console.error("Error decrypting message:", error, message);
      // Ensure a null is returned on error, matching the Promise type
      return null;
    }
  };

  // Mark a message as read
  const markAsRead = (itemId: string, messageId: string) => {
    setMessages((prev) => {
      const itemMessages = prev[itemId] || [];
      // Only mark received messages as read
      const updatedMessages = itemMessages.map((m) =>
        m.id === messageId && !m.sent ? { ...m, read: true } : m,
      );
      return { ...prev, [itemId]: updatedMessages };
    });
  };

  // Delete a message
  const deleteMessage = (itemId: string, messageId: string) => {
    setMessages((prev) => {
      const itemMessages = prev[itemId] || [];
      const updatedMessages = itemMessages.filter((m) => m.id !== messageId);
      if (updatedMessages.length === 0) {
        const { [itemId]: _, ...rest } = prev; // Remove item if no messages left
        return rest;
      }
      return { ...prev, [itemId]: updatedMessages };
    });
  };

  // Clear message history for a contact or group
  const clearHistory = (itemId: string) => {
    setMessages((prev) => {
      const { [itemId]: _, ...rest } = prev;
      return rest;
    });

    toast({
      title: "Conversation Cleared",
      description: "All messages have been deleted",
    });
  };

  // Retry sending pending messages
  const retryPendingMessages = useCallback(async () => {
    let changesMadeOverall = false;
    const currentMessagesSnapshot = { ...messages }; // Operate on a snapshot

    for (const itemIdKey in currentMessagesSnapshot) {
      if (
        !Object.prototype.hasOwnProperty.call(
          currentMessagesSnapshot,
          itemIdKey,
        )
      )
        continue;

      const item = listItems.find((i) => i.id === itemIdKey);
      if (!item) {
        console.warn(
          `Retry: Item ${itemIdKey} not found in listItems, skipping its messages.`,
        );
        continue;
      }

      const itemMessages = currentMessagesSnapshot[itemIdKey];
      const pendingMessagesInItem = itemMessages.filter(
        (m) => m.pending && m.sent,
      );

      if (pendingMessagesInItem.length === 0) continue;

      console.log(
        `Retrying ${pendingMessagesInItem.length} pending messages for ${item.itemType} ${item.name} (ID: ${itemIdKey})`,
      );

      if (item.itemType === "contact") {
        const contact = item as Contact;
        const contactKey = await getContactKey(contact.id);
        if (!contactKey) {
          console.warn(
            `Retry: Key not found for contact ${contact.name}, skipping messages.`,
          );
          continue;
        }
        let contactMessagesUpdated = false;
        const updatedContactMessages = [...(messages[contact.id] || [])]; // Get latest from state for update

        for (const message of pendingMessagesInItem) {
          try {
            const requestId = await generateStableRequestId(
              contact.userGeneratedKey,
              contactKey,
            );
            const response = await fetch("/api/put-message", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                message_id: requestId,
                message: message.content,
              }),
            });

            if (response.ok) {
              console.log(
                `Successfully resent message ID: ${message.id} to contact: ${contact.name}`,
              );
              const msgIndex = updatedContactMessages.findIndex(
                (m) => m.id === message.id,
              );
              if (msgIndex !== -1) {
                updatedContactMessages[msgIndex] = {
                  ...updatedContactMessages[msgIndex],
                  pending: false,
                };
                contactMessagesUpdated = true;
              }
            } else {
              console.error(
                `Failed to resend message ID: ${message.id} to ${contact.name}. API error ${response.status}: ${await response.text()}`,
              );
            }
          } catch (retryError) {
            console.error(
              `Error during retry of message ID: ${message.id} to ${contact.name}:`,
              retryError,
            );
          }
        }
        if (contactMessagesUpdated) {
          setMessages((prev) => ({
            ...prev,
            [contact.id]: updatedContactMessages,
          }));
          changesMadeOverall = true;
        }
      } else if (item.itemType === "group") {
        const group = item as Group;
        let groupMessagesUpdated = false;
        const updatedGroupMessages = [...(messages[group.id] || [])]; // Get latest from state for update

        for (const message of pendingMessagesInItem) {
          // message.contactId is groupId, message.groupId is groupId
          if (!message.groupId || message.contactId !== group.id) {
            // Sanity check
            console.warn(
              `Skipping retry for malformed group message ${message.id}`,
            );
            continue;
          }
          console.log(
            `Retrying group message ID: ${message.id} for group: ${group.name}`,
          );
          const decryptedMessage = await getDecryptedContent(message); // Decrypts using first member's key

          if (!decryptedMessage) {
            console.error(
              `Cannot retry group message ${message.id}: decryption failed.`,
            );
            continue;
          }

          let allMemberSendsSuccessful = true;
          for (const memberId of group.memberIds) {
            const memberContact = listItems.find(
              (i) => i.id === memberId && i.itemType === "contact",
            ) as Contact | undefined;
            if (!memberContact) {
              console.warn(
                `Retry: Group member ${memberId} not found. Skipping send for this member.`,
              );
              allMemberSendsSuccessful = false;
              continue;
            }
            const memberKey = await getContactKey(memberId);
            if (!memberKey) {
              console.warn(
                `Retry: No key for group member ${memberContact.name}. Skipping.`,
              );
              allMemberSendsSuccessful = false;
              continue;
            }
            try {
              const encryptedMessageForMember = await encryptMessage(
                JSON.stringify(decryptedMessage),
                memberKey,
              );
              const requestId = await generateStableRequestId(
                memberContact.userGeneratedKey,
                memberKey,
              );
              const response = await fetch("/api/put-message", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  message_id: requestId,
                  message: encryptedMessageForMember,
                  // group: group.name, // Group name is now part of the encrypted MessageContent
                }),
              });
              if (!response.ok) {
                console.error(
                  `Retry: API error sending to group member ${memberContact.name}: ${response.status} ${await response.text()}`,
                );
                allMemberSendsSuccessful = false;
              }
            } catch (memberError) {
              console.error(
                `Retry: Error sending to group member ${memberContact.name}:`,
                memberError,
              );
              allMemberSendsSuccessful = false;
            }
          }
          if (allMemberSendsSuccessful) {
            console.log(
              `Successfully resent group message ID: ${message.id} to all members of ${group.name}`,
            );
            const msgIndex = updatedGroupMessages.findIndex(
              (m) => m.id === message.id,
            );
            if (msgIndex !== -1) {
              updatedGroupMessages[msgIndex] = {
                ...updatedGroupMessages[msgIndex],
                pending: false,
              };
              groupMessagesUpdated = true;
            }
          } else {
            console.warn(
              `Retry for group message ID: ${message.id} was not successful for all members.`,
            );
          }
        }
        if (groupMessagesUpdated) {
          setMessages((prev) => ({
            ...prev,
            [group.id]: updatedGroupMessages,
          }));
          changesMadeOverall = true;
        }
      }
    }
    // No need to call setMessages(newMessagesState) if changes were applied directly with setMessages(prev => ...)
  }, [
    messages,
    listItems,
    getContactKey,
    toast,
    encryptMessage,
    decryptMessage,
  ]); // Added dependencies

  useEffect(() => {
    const intervalId = setInterval(() => {
      console.log("Checking for pending messages to retry...");
      retryPendingMessages();
    }, 30000); // 30 seconds

    return () => clearInterval(intervalId);
  }, [retryPendingMessages]);

  const moveContextualMessagesToGroup = async (
    sourceContactId: string,
    targetGroup: Group,
    originalGroupContextName: string,
  ) => {
    setMessages((prevMessages) => {
      const newMessagesState = { ...prevMessages };
      const sourceMessages = newMessagesState[sourceContactId] || [];
      const messagesToMove: Message[] = [];
      const remainingSourceMessages: Message[] = [];

      for (const msg of sourceMessages) {
        // We'll rely on msg.groupContextName for identification
        if (msg.groupContextName === originalGroupContextName) {
          const movedMessage = { ...msg };
          movedMessage.groupId = targetGroup.id;
          delete movedMessage.groupContextName; // Clear the context name

          if (movedMessage.sent) {
            // Message sent by current user
            movedMessage.contactId = targetGroup.id; // Associate with group for sender's view
          } else {
            // Message received from the contact
            // contactId remains the sourceContactId (actual sender)
            movedMessage.originalSenderId = sourceContactId;
          }
          messagesToMove.push(movedMessage);
        } else {
          remainingSourceMessages.push(msg);
        }
      }

      if (messagesToMove.length > 0) {
        newMessagesState[sourceContactId] = remainingSourceMessages;
        newMessagesState[targetGroup.id] = [
          ...(newMessagesState[targetGroup.id] || []),
          ...messagesToMove,
        ].sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        ); // Keep messages sorted

        if (remainingSourceMessages.length === 0) {
          delete newMessagesState[sourceContactId];
        }
        toast({
          title: "Messages Moved",
          description: `${messagesToMove.length} message(s) moved to group "${targetGroup.name}".`,
        });
      }
      return newMessagesState;
    });
  };

  const deleteMessagesFromSenderInGroups = (senderContactId: string) => {
    setMessages((prevMessages) => {
      const newMessagesState = { ...prevMessages };
      let changed = false;

      for (const itemId in newMessagesState) {
        if (Object.prototype.hasOwnProperty.call(newMessagesState, itemId)) {
          const item = listItems.find((i) => i.id === itemId);
          // Only process if the itemId corresponds to a group
          if (item && item.itemType === "group") {
            const originalGroupMessages = newMessagesState[itemId];
            const filteredGroupMessages = originalGroupMessages.filter(
              (msg) => {
                // Keep message if it's not from the specified senderContactId
                // This primarily targets received messages in a group.
                return !(!msg.sent && msg.originalSenderId === senderContactId);
              },
            );

            if (filteredGroupMessages.length < originalGroupMessages.length) {
              if (filteredGroupMessages.length === 0) {
                delete newMessagesState[itemId];
              } else {
                newMessagesState[itemId] = filteredGroupMessages;
              }
              changed = true;
            }
          }
        }
      }
      if (changed) {
        toast({
          title: "Group Messages Cleaned",
          description: `Messages from a contact (whose key changed or was deleted) have been removed from relevant groups.`,
        });
      }
      return changed ? newMessagesState : prevMessages;
    });
  };

  // Helper to decrypt with a specific key
  const _decryptMessageContent = async (
    encryptedContent: string,
    key: CryptoKey,
  ): Promise<MessageContent | null> => {
    try {
      const decryptedJson = await decryptMessage(encryptedContent, key);
      return JSON.parse(decryptedJson) as MessageContent;
    } catch (error) {
      console.error("Helper decryption failed:", error);
      return null;
    }
  };

  // Helper to encrypt with a specific key
  const _encryptMessageContent = async (
    messageContent: MessageContent,
    key: CryptoKey,
  ): Promise<string> => {
    return encryptMessage(JSON.stringify(messageContent), key);
  };

  const reEncryptMessagesForKeyChange = async (
    contactId: string,
    oldKey: CryptoKey,
    newKey: CryptoKey,
  ) => {
    // Get a snapshot of the current messages to avoid issues with processing stale state
    // if multiple key changes happen rapidly (though unlikely).
    const currentMessages = messages; // This will be the state at the time of the call.

    let finalMessagesState = { ...currentMessages };
    let overallReEncryptedCount = 0;

    // Direct messages
    if (finalMessagesState[contactId]) {
      const directMessages = finalMessagesState[contactId];
      const reEncryptedDirectMessages: Message[] = [];
      for (const msg of directMessages) {
        const decrypted = await _decryptMessageContent(msg.content, oldKey);
        if (decrypted) {
          const reEncrypted = await _encryptMessageContent(decrypted, newKey);
          reEncryptedDirectMessages.push({ ...msg, content: reEncrypted });
          overallReEncryptedCount++;
        } else {
          // If decryption fails (e.g., content was not encrypted with oldKey, or corrupted)
          // keep the original message to avoid data loss.
          reEncryptedDirectMessages.push(msg);
          console.warn(
            `Failed to decrypt/re-encrypt direct message ${msg.id} for contact ${contactId}. Keeping original.`,
          );
        }
      }
      finalMessagesState = {
        ...finalMessagesState,
        [contactId]: reEncryptedDirectMessages,
      };
    }

    // Group messages
    for (const itemId in finalMessagesState) {
      if (Object.prototype.hasOwnProperty.call(finalMessagesState, itemId)) {
        const item = listItems.find((i) => i.id === itemId);
        // Process if it's a group AND not the same as contactId (which is direct messages, already handled)
        if (item && item.itemType === "group" && itemId !== contactId) {
          const groupMessages = finalMessagesState[itemId];
          const reEncryptedGroupMessages: Message[] = [];
          for (const msg of groupMessages) {
            // Only re-encrypt messages sent BY this contact within the group
            if (!msg.sent && msg.originalSenderId === contactId) {
              const decrypted = await _decryptMessageContent(
                msg.content,
                oldKey,
              );
              if (decrypted) {
                const reEncrypted = await _encryptMessageContent(
                  decrypted,
                  newKey,
                );
                reEncryptedGroupMessages.push({ ...msg, content: reEncrypted });
                overallReEncryptedCount++;
              } else {
                reEncryptedGroupMessages.push(msg);
                console.warn(
                  `Failed to decrypt/re-encrypt group message ${msg.id} (original sender ${contactId}) in group ${itemId}. Keeping original.`,
                );
              }
            } else {
              reEncryptedGroupMessages.push(msg);
            }
          }
          finalMessagesState = {
            ...finalMessagesState,
            [itemId]: reEncryptedGroupMessages,
          };
        }
      }
    }

    if (overallReEncryptedCount > 0) {
      toast({
        title: "Messages Re-encrypted",
        description: `${overallReEncryptedCount} message(s) were re-encrypted with the new key.`,
      });
    } else {
      toast({
        title: "Key Updated",
        description:
          "Contact key updated. No messages required re-encryption or no messages found for this contact.",
      });
    }
    setMessages(finalMessagesState); // Update state once with all changes
  };

  return (
    <MessagesContext.Provider
      value={{
        messages,
        sendMessage,
        forwardMessage,
        getDecryptedContent,
        markAsRead,
        deleteMessage,
        clearHistory,
        moveContextualMessagesToGroup,
        deleteMessagesFromSenderInGroups,
        reEncryptMessagesForKeyChange,
      }}
    >
      {children}
    </MessagesContext.Provider>
  );
};

export const useMessages = () => {
  const context = useContext(MessagesContext);
  if (context === undefined) {
    throw new Error("useMessages must be used within a MessagesProvider");
  }
  return context;
};
