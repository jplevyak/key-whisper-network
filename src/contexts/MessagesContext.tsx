import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef, // Import useRef
} from "react";
import { Contact, useContacts, ContactOrGroup, Group } from "./ContactsContext";
import { encryptMessage, decryptMessage } from "@/utils/encryption";
import { useToast } from "@/components/ui/use-toast";
import {
  loadMessagesFromStorage,
  saveMessagesToStorage,
} from "@/services/messageStorage";
import { putMessage } from "@/services/apiService"; // Import the new service
import { useMessagePolling } from "@/hooks/useMessagePolling";
import { useAuth } from "./AuthContext"; // Added for authentication status

// Define the structure of the content being encrypted/decrypted
export interface MessageContent {
  message: string;
  group?: string; // Optional: name of the group if it's a group message
  groupId?: string; // Optional: id of the group if it's a group message
}

// Export the Message interface
export interface Message {
  id: string; // This will be the local message ID, not the server hash
  contactId: string;
  groupId?: string; // If message is part of an existing group chat, this is the group's ID.
  groupContextName?: string; // If message is received from a contact with a group context, this is the group name.
  groupContextId?: string; // If message is received from a contact with a group context, this is the group id.
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
  ) => Promise<void>;
  deleteMessagesFromSenderInGroups: (senderContactId: string) => void;
  reEncryptMessagesForKeyChange: (
    contactId: string,
    oldKey: CryptoKey,
    newKey: CryptoKey,
  ) => Promise<void>;
  deleteAllMessages: () => void; // Added to delete all messages
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
  const { getContactKey, listItems, activeItem, getPutRequestId } = // Added getPutRequestId
    useContacts();
  const { toast } = useToast();
  const { isAuthenticated, isSecurityContextEstablished } = useAuth(); // Get auth and security status
  const isSendingPendingRef = useRef(false); // Ref to track if sendPendingMessages is active
  // Fetching logic and refs moved to useMessagePolling hook

  // Load messages from IndexedDB on init
  useEffect(() => {
    if (!isAuthenticated || !isSecurityContextEstablished) {
      if (Object.keys(messages).length > 0) { // Only log if there was data
         console.info("MessagesContext: Load blocked, user not fully authenticated or security context not established.");
      }
      setMessages({}); // Clear messages if not fully ready
      return;
    }
    console.log("MessagesContext: Loading messages as user is authenticated and security context is established.");
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
  }, [isAuthenticated, isSecurityContextEstablished, toast]);

  // Save messages to IndexedDB whenever they change
  useEffect(() => {
    if (!isAuthenticated || !isSecurityContextEstablished) {
      if (Object.keys(messages).length > 0) { // Only log if there was something to save
        console.info("MessagesContext: Save blocked, user not fully authenticated or security context not established.");
      }
      return; // Don't save if not fully ready
    }
    // No need to check length here, saveMessagesToStorage handles empty state
    console.log("MessagesContext: Saving messages as user is authenticated and security context is established.");
    saveMessagesToStorage(messages).catch((error) => {
      console.error("Failed to save messages to storage:", error);
      // Optionally show a toast here
    });
  }, [messages, isAuthenticated, isSecurityContextEstablished]);

  // Use the message polling hook - it runs automatically
  // Its effectiveness will depend on activeItem, which becomes null if not authenticated due to ContactsContext changes.
  // And on isAuthenticated & isSecurityContextEstablished for its internal fetch operations.
  useMessagePolling({ 
    setMessages, 
    activeItemId: activeItem?.id,
    isReadyToFetch: isAuthenticated && isSecurityContextEstablished // Pass readiness
  });

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
        // Removed direct API call, message will be sent by sendPendingMessages

        const newMessage: Message = {
          id: `${localMessageIdBase}-c-${contact.id}`,
          contactId: contact.id,
          content: encryptedMessageBase64,
          timestamp: new Date().toISOString(),
          sent: true,
          read: true,
          pending: true, // Always true, sendPendingMessages will handle it
        };
        setMessages((prev) => ({
          ...prev,
          [contact.id]: [...(prev[contact.id] || []), newMessage],
        }));
        // Call sendPendingMessages after a short delay to allow state to update
        setTimeout(() => sendPendingMessages(), 100);
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
        groupId: group.id,
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

      // Removed direct API calls for each member.
      // The localGroupMessage is already marked as pending: true.
      // sendPendingMessages will handle iterating through members and sending.

      // Call sendPendingMessages to process the newly added pending group message
      setTimeout(() => sendPendingMessages(), 100);

      // No need to update pending status based on allSendsSuccessful here,
      // as sendPendingMessages will manage that for the group message.
      // The toast for partial send errors will now be handled within sendPendingMessages if necessary.

      return true; // Local save is successful
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

  // Send pending messages
  const sendPendingMessages = useCallback(async () => {
    if (isSendingPendingRef.current) {
      console.log("sendPendingMessages: Already in progress, skipping.");
      return;
    }
    isSendingPendingRef.current = true;
    console.log("sendPendingMessages: Starting to process pending messages.");

    try {
      let changesMadeOverall = false;
      // Operate on a snapshot of messages to avoid issues with state updates during the async loop.
      // The actual updates will use setMessages(prev => ...) to ensure they are based on the latest state.
      const currentMessagesSnapshot = { ...messages };

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
            `sendPendingMessages: Item ${itemIdKey} not found in listItems, skipping its messages.`,
          );
          continue;
        }

        const itemMessages = currentMessagesSnapshot[itemIdKey];
        const pendingMessagesInItem = itemMessages.filter(
          (m) => m.pending && m.sent,
        );

        if (pendingMessagesInItem.length === 0) continue;

        console.log(
          `sendPendingMessages: Processing ${pendingMessagesInItem.length} pending messages for ${item.itemType} ${item.name} (ID: ${itemIdKey})`,
        );

        if (item.itemType === "contact") {
          const contact = item as Contact;
          const contactKey = await getContactKey(contact.id);
          if (!contactKey) {
            console.warn(
              `sendPendingMessages: Key not found for contact ${contact.name}, skipping messages.`,
            );
            continue;
          }
          let contactMessagesUpdated = false;
          
          for (const message of pendingMessagesInItem) {
            try {
              const requestId = await getPutRequestId(contact.id);
              await putMessage(requestId, message.content);
              console.log(
                `sendPendingMessages: Successfully sent message ID: ${message.id} to contact: ${contact.name}`,
              );
              // Update this specific message's pending status using functional update
              setMessages(prev => ({
                ...prev,
                [contact.id]: (prev[contact.id] || []).map(m => 
                  m.id === message.id ? { ...m, pending: false } : m
                ),
              }));
              contactMessagesUpdated = true; // Flag that at least one message was processed
            } catch (sendError: any) {
              if (sendError.message && sendError.message.startsWith("API error")) {
                console.error(
                  `sendPendingMessages: Failed to send message ID: ${message.id} to ${contact.name}. ${sendError.message}`,
                );
              } else {
                console.error(
                  `sendPendingMessages: Error sending message ID: ${message.id} to ${contact.name}:`,
                  sendError,
                );
              }
            }
          }
          if (contactMessagesUpdated) changesMadeOverall = true;

        } else if (item.itemType === "group") {
          const group = item as Group;
          let groupMessagesLocallyUpdated = false;

          for (const message of pendingMessagesInItem) {
            if (!message.groupId || message.contactId !== group.id) {
              console.warn(
                `sendPendingMessages: Skipping malformed group message ${message.id}`,
              );
              continue;
            }
            console.log(
              `sendPendingMessages: Processing group message ID: ${message.id} for group: ${group.name}`,
            );
            const decryptedMessage = await getDecryptedContent(message);

            if (!decryptedMessage) {
              console.error(
                `sendPendingMessages: Cannot process group message ${message.id}: decryption failed.`,
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
                  `sendPendingMessages: Group member ${memberId} not found. Skipping send for this member.`,
                );
                allMemberSendsSuccessful = false;
                continue;
              }
              const memberKey = await getContactKey(memberId);
              if (!memberKey) {
                console.warn(
                  `sendPendingMessages: No key for group member ${memberContact.name}. Skipping.`,
                );
                allMemberSendsSuccessful = false;
                continue;
              }
              try {
                const encryptedMessageForMember = await encryptMessage(
                  JSON.stringify(decryptedMessage),
                  memberKey,
                );
                const requestId = await getPutRequestId(memberContact.id);
                await putMessage(requestId, encryptedMessageForMember);
              } catch (memberError: any) {
                if (memberError.message && memberError.message.startsWith("API error")) {
                  console.error(
                    `sendPendingMessages: API error sending to group member ${memberContact.name}: ${memberError.message}`,
                  );
                } else {
                  console.error(
                    `sendPendingMessages: Error sending to group member ${memberContact.name}:`,
                    memberError,
                  );
                }
                allMemberSendsSuccessful = false;
              }
            }
            if (allMemberSendsSuccessful) {
              console.log(
                `sendPendingMessages: Successfully sent group message ID: ${message.id} to all members of ${group.name}`,
              );
              // Update this specific message's pending status using functional update
              setMessages(prev => ({
                ...prev,
                [group.id]: (prev[group.id] || []).map(m => 
                  m.id === message.id ? { ...m, pending: false } : m
                ),
              }));
              groupMessagesLocallyUpdated = true;
            } else {
              console.warn(
                `sendPendingMessages: Group message ID: ${message.id} was not successful for all members. It remains pending.`,
              );
            }
          }
          if (groupMessagesLocallyUpdated) changesMadeOverall = true;
        }
      }
      // No explicit overall setMessages(newState) needed if all updates are functional.
      // The changesMadeOverall flag can be used for logging or other side effects if necessary.
      if (changesMadeOverall) {
        console.log("sendPendingMessages: Some pending messages were processed.");
      } else {
        console.log("sendPendingMessages: No pending messages required processing or updates.");
      }
    } catch (error) {
      console.error("sendPendingMessages: An unexpected error occurred:", error);
    } finally {
      isSendingPendingRef.current = false;
      console.log("sendPendingMessages: Finished processing.");
    }
  }, [
    messages, // messages is a dependency because we read it for the snapshot
    listItems,
    getContactKey,
    getPutRequestId,
    toast, // Though not directly used in this version, keeping it if toasts are re-added
    getDecryptedContent, // Added as it's used
    // encryptMessage is used, ensure it's stable or add if it's from context/props
    getContactKey,
    getPutRequestId, // Added dependency
    toast,
    // encryptMessage and decryptMessage are not direct dependencies of retryPendingMessages
    // but are used by getDecryptedContent and in the loop.
    // However, since they are stable utils, they don't need to be in the dep array.
    // If they were context methods, they would be.
  ]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      console.log("Interval: Triggering sendPendingMessages.");
      sendPendingMessages();
    }, 30000); // 30 seconds

    return () => clearInterval(intervalId);
  }, [sendPendingMessages]);

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
        if (msg.groupContextId === targetGroup.id) {
          const movedMessage = { ...msg };
          movedMessage.groupId = targetGroup.id;
          delete movedMessage.groupContextName; // Clear the context name
          delete movedMessage.groupContextId; // Clear the context id

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

  const deleteAllMessages = () => {
    setMessages({});
    toast({
      title: "All Messages Deleted",
      description: "All your conversations and group messages have been cleared.",
      variant: "destructive", // Or "default" if preferred
    });
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
        deleteAllMessages, // Added
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
