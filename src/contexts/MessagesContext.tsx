import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Contact, useContacts, ContactOrGroup, Group } from './ContactsContext';
// Import generateStableRequestId, encryptMessage, decryptMessage
import { generateStableRequestId, encryptMessage, decryptMessage } from '@/utils/encryption';
import { useToast } from '@/components/ui/use-toast';
// Import storage service and polling hook
import { loadMessagesFromStorage, saveMessagesToStorage } from '@/services/messageStorage';
import { useMessagePolling } from '@/hooks/useMessagePolling';
// Buffer utils are no longer needed directly in this file

// Export the Message interface
export interface Message {
  id: string; // This will be the local message ID, not the server hash
  contactId: string; // For 1-1: other user's ID. For group msg sent by user: groupID. For group msg received: actual sender's ID.
  groupId?: string;   // If message is part of a group chat, this is the group's ID.
  content: string; // Encrypted content
  timestamp: string;
  sent: boolean; // true if sent by user, false if received
  read: boolean;
  forwarded: boolean;
  forwardedPath?: string[]; // IDs of contacts in forwarding path
  pending?: boolean; // True if the message is pending send to the server
}

interface MessagesContextType {
  messages: Record<string, Message[]>; // Keyed by itemId (contactId or groupId)
  sendMessage: (itemId: string, content: string, forwarding?: Contact[]) => Promise<boolean>;
  forwardMessage: (messageId: string, originalItemId: string, targetItemId: string) => Promise<boolean>;
  getDecryptedContent: (message: Message) => Promise<string>;
  markAsRead: (itemId: string, messageId: string) => void;
  deleteMessage: (itemId: string, messageId: string) => void;
  clearHistory: (itemId: string) => void;
}

// Type for the response from /api/get-messages
// This might need to be updated if server starts returning group info for messages
interface GetMessagesApiResponse {
  results: {
    message_id: string; // This is the encrypted request ID (e.g., encrypted "sending to key generator")
    message: string;    // Base64 encoded encrypted message content
    timestamp: string;  // ISO timestamp from backend
  }[];
}


const MessagesContext = createContext<MessagesContextType | undefined>(undefined);

// Mock storage functions moved to messageStorage.ts

export const MessagesProvider = ({ children }: { children: React.ReactNode }) => {
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const { getContactKey, listItems } = useContacts(); // Use listItems
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
       console.error('Error loading messages:', error);
        toast({
          title: 'Error',
          description: 'Could not load your messages',
          variant: 'destructive',
        });
      }
    };

    loadMessages();
  }, [toast]);

 // Save messages to IndexedDB whenever they change
 useEffect(() => {
   // No need to check length here, saveMessagesToStorage handles empty state
   saveMessagesToStorage(messages).catch(error => {
     console.error("Failed to save messages to storage:", error);
     // Optionally show a toast here
   });
 }, [messages]);

 // Use the message polling hook - it runs automatically
 useMessagePolling({ setMessages }); // This hook might need adjustments for group messages


 // Send a message to a contact or group
 const sendMessage = async (
    itemId: string, // Can be contactId or groupId
    content: string,
    forwarding: Contact[] = [] // Forwarding path still consists of Contacts
  ): Promise<boolean> => {
    const item = listItems.find(i => i.id === itemId);
    if (!item) {
      toast({ title: 'Error', description: 'Recipient not found.', variant: 'destructive' });
      return false;
    }

    const localMessageIdBase = `local-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const isForwarded = forwarding.length > 0;

    if (item.itemType === 'contact') {
      const contact = item as Contact;
      try {
        const key = await getContactKey(contact.id);
        if (!key) {
          toast({ title: 'Error', description: `Could not find encryption key for ${contact.name}.`, variant: 'destructive' });
          return false;
        }
        const encryptedContentBase64 = await encryptMessage(content, key);
        const requestId = await generateStableRequestId(contact.userGeneratedKey, key);

        let messageSentToServer = false;
        try {
          const response = await fetch('/api/put-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message_id: requestId, message: encryptedContentBase64 }),
          });
          if (!response.ok) throw new Error(`API error ${response.status}: ${await response.text()}`);
          messageSentToServer = true;
        } catch (apiError) {
          console.error(`Failed to send message to backend for contact ${contact.name}:`, apiError);
          toast({ title: 'Send Warning', description: `Message to ${contact.name} saved locally, but failed to send.`, variant: 'warning' });
        }

        const newMessage: Message = {
          id: `${localMessageIdBase}-c-${contact.id}`,
          contactId: contact.id,
          content: encryptedContentBase64,
          timestamp: new Date().toISOString(),
          sent: true,
          read: true,
          forwarded: isForwarded,
          forwardedPath: isForwarded ? forwarding.map(c => c.id) : undefined,
          pending: !messageSentToServer,
        };
        setMessages(prev => ({ ...prev, [contact.id]: [...(prev[contact.id] || []), newMessage] }));
        return true; // Local save is successful
      } catch (error) {
        console.error(`Error sending message to contact ${contact.name}:`, error);
        toast({ title: 'Error', description: `Could not send message to ${contact.name}.`, variant: 'destructive' });
        return false;
      }
    } else if (item.itemType === 'group') {
      const group = item as Group;
      if (group.memberIds.length === 0) {
        toast({ title: 'Cannot Send', description: 'Group has no members.', variant: 'info' });
        return false;
      }

      // For local display in sender's group chat
      const firstMemberId = group.memberIds[0];
      const firstMemberContact = listItems.find(i => i.id === firstMemberId && i.itemType === 'contact') as Contact | undefined;
      if (!firstMemberContact) {
         toast({ title: 'Group Error', description: 'First member of group not found for local encryption.', variant: 'destructive'});
         return false;
      }
      const keyForLocalEncryption = await getContactKey(firstMemberId);
      if (!keyForLocalEncryption) {
        toast({ title: 'Encryption Error', description: `Cannot get key for ${firstMemberContact.name} (for local group message).`, variant: 'destructive' });
        return false;
      }
      const localEncryptedContent = await encryptMessage(content, keyForLocalEncryption);
      
      const localGroupMessage: Message = {
        id: `${localMessageIdBase}-g-${group.id}`,
        contactId: group.id, // For sender's view, contactId is the groupId
        groupId: group.id,
        content: localEncryptedContent,
        timestamp: new Date().toISOString(),
        sent: true,
        read: true,
        forwarded: isForwarded,
        forwardedPath: isForwarded ? forwarding.map(c => c.id) : undefined,
        pending: true, // Initially pending, will be updated after attempts
      };
      setMessages(prev => ({ ...prev, [group.id]: [...(prev[group.id] || []), localGroupMessage] }));

      let allSendsSuccessful = true;
      for (const memberId of group.memberIds) {
        const memberContact = listItems.find(i => i.id === memberId && i.itemType === 'contact') as Contact | undefined;
        if (!memberContact) {
          console.warn(`Group member ${memberId} not found in contacts. Skipping.`);
          allSendsSuccessful = false;
          continue;
        }
        try {
          const memberKey = await getContactKey(memberId);
          if (!memberKey) {
            console.warn(`Could not get encryption key for group member ${memberContact.name}. Skipping.`);
            toast({ title: 'Partial Send Error', description: `No key for ${memberContact.name}.`, variant: 'warning' });
            allSendsSuccessful = false;
            continue;
          }
          const encryptedContentForMember = await encryptMessage(content, memberKey);
          const requestId = await generateStableRequestId(memberContact.userGeneratedKey, memberKey);
          
          const response = await fetch('/api/put-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message_id: requestId,
              message: encryptedContentForMember,
              group: group.name, // Add group name to the POST body
            }),
          });
          if (!response.ok) {
            console.error(`API error sending to group member ${memberContact.name}: ${response.status} ${await response.text()}`);
            toast({ title: 'Partial Send Error', description: `Failed to send to ${memberContact.name}.`, variant: 'warning' });
            allSendsSuccessful = false;
          }
        } catch (memberError) {
          console.error(`Error sending message to group member ${memberContact.name}:`, memberError);
          toast({ title: 'Partial Send Error', description: `Could not send to ${memberContact.name}.`, variant: 'warning' });
          allSendsSuccessful = false;
        }
      }
      
      // Update pending status of the local group message
      setMessages(prev => ({
        ...prev,
        [group.id]: (prev[group.id] || []).map(m =>
          m.id === localGroupMessage.id ? { ...m, pending: !allSendsSuccessful } : m
        ),
      }));

      if (allSendsSuccessful) {
        toast({ title: 'Message Sent', description: `Message sent to group ${group.name}.` });
      } else {
         toast({ title: 'Group Send Issue', description: `Message to ${group.name} sent with some errors.`, variant: 'warning' });
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
    targetItemId: string // contactId or groupId to forward to
  ): Promise<boolean> => {
    try {
      const originalItemMessages = messages[originalItemId] || [];
      const originalMessage = originalItemMessages.find(m => m.id === messageId);
      if (!originalMessage) {
        toast({ title: 'Error', description: 'Could not find the message to forward.', variant: 'destructive' });
        return false;
      }

      const decryptedContent = await getDecryptedContent(originalMessage);
      // Check if decryption failed (returned placeholder error string)
      if (decryptedContent.startsWith('[Could not decrypt') || decryptedContent.startsWith('[Decryption failed')) {
        toast({ title: 'Error', description: 'Could not decrypt the message to forward.', variant: 'destructive' });
        return false;
      }
      
      const newForwardingPath: Contact[] = [];
      const sourceChatItem = listItems.find(i => i.id === originalItemId);

      // Add the contact representing the chat from which message is forwarded, if it's a contact.
      // If forwarding from a group, the "source" is implicitly the current user in context of that group.
      // The original sender of the message (if it was received) will be part of its existing forwardedPath or determined by originalMessage.contactId.
      if (sourceChatItem && sourceChatItem.itemType === 'contact') {
        newForwardingPath.push(sourceChatItem as Contact);
      }
      
      if (originalMessage.forwardedPath) {
        const pathContacts = originalMessage.forwardedPath
          .map(id => listItems.find(c => c.id === id && c.itemType === 'contact') as Contact | undefined)
          .filter((c): c is Contact => c !== undefined);
        newForwardingPath.push(...pathContacts); // Add previous path contacts
      } else if (!originalMessage.sent && originalMessage.contactId !== originalItemId) {
        // If it's a received message (not sent by user) and not already part of a long forward chain,
        // its original sender should be part of the path.
        const originalSenderContact = listItems.find(c => c.id === originalMessage.contactId && c.itemType === 'contact') as Contact | undefined;
        if (originalSenderContact && !newForwardingPath.some(p => p.id === originalSenderContact.id)) {
          newForwardingPath.unshift(originalSenderContact); // Add original sender at the beginning
        }
      }


      return await sendMessage(targetItemId, decryptedContent, newForwardingPath);
    } catch (error) {
      console.error('Error forwarding message:', error);
      toast({
        title: 'Error',
        description: 'Could not send message',
        variant: 'destructive',
      });
      return false;
    }
  };

  // Forward a message to another contact
  const forwardMessage = async (
    messageId: string, 
    contactId: string, 
    targetContactId: string
  ): Promise<boolean> => {
    try {
      // Find the original message
      const contactMessages = messages[contactId] || [];
      const originalMessage = contactMessages.find(m => m.id === messageId);
      if (!originalMessage) {
        toast({
          title: 'Error',
          description: 'Could not find the message to forward',
          variant: 'destructive',
        });
        return false;
      }

      // Decrypt the original message
      const decryptedContent = await getDecryptedContent(originalMessage);
      if (!decryptedContent) {
        toast({
          title: 'Error',
          description: 'Could not decrypt the message to forward',
          variant: 'destructive',
        });
        return false;
      }

      // Get the forwarding path
      const forwardedFromContact = contacts.find(c => c.id === contactId);
      const targetContact = contacts.find(c => c.id === targetContactId);
      
      if (!forwardedFromContact || !targetContact) {
        toast({
          title: 'Error',
          description: 'Could not find the contacts for forwarding',
          variant: 'destructive',
        });
        return false;
      }

      // Create forwarding information
      const forwardingPath = [forwardedFromContact];
      if (originalMessage.forwardedPath) {
        // Add original forwarding path contacts if they exist
        const pathContacts = originalMessage.forwardedPath
          .map(id => contacts.find(c => c.id === id))
          .filter((c): c is Contact => c !== undefined);
        forwardingPath.unshift(...pathContacts);
      }

      // Send the forwarded message
      return await sendMessage(targetContactId, decryptedContent, forwardingPath);
    } catch (error) {
      console.error('Error forwarding message:', error);
      toast({
        title: 'Error',
        description: 'Could not forward message',
        variant: 'destructive',
      });
      return false;
    }
  };

  // Get decrypted content of a message
  const getDecryptedContent = async (message: Message): Promise<string> => {
    try {
      let key: CryptoKey | null = null;
      if (message.sent) { // Message sent by the current user
        if (message.groupId) { // Sent to a group
          const group = listItems.find(i => i.id === message.groupId && i.itemType === 'group') as Group | undefined;
          if (group && group.memberIds.length > 0) {
            // Convention: content for sender's view was encrypted with the first member's key.
            // message.contactId would be the groupId in this case for the sender's local copy.
            key = await getContactKey(group.memberIds[0]);
          } else {
            return '[Could not decrypt - group or members missing for sent group message]';
          }
        } else { // Sent 1-to-1
          // message.contactId is the recipient's ID
          key = await getContactKey(message.contactId);
        }
      } else { // Message received by the current user
        // message.contactId is the actual sender's ID (for both 1-to-1 and group messages received)
        key = await getContactKey(message.contactId);
      }

      if (!key) {
        return '[Could not decrypt - key missing]';
      }
      return await decryptMessage(message.content, key);
    } catch (error) {
      console.error('Error decrypting message:', error, message);
      return '[Decryption failed]';
    }
  };

  // Mark a message as read
  const markAsRead = (itemId: string, messageId: string) => {
    setMessages(prev => {
      const itemMessages = prev[itemId] || [];
      // Only mark received messages as read
      const updatedMessages = itemMessages.map(m =>
        (m.id === messageId && !m.sent) ? { ...m, read: true } : m
      );
      return { ...prev, [itemId]: updatedMessages };
    });
  };

  // Delete a message
  const deleteMessage = (itemId: string, messageId: string) => {
    setMessages(prev => {
      const itemMessages = prev[itemId] || [];
      const updatedMessages = itemMessages.filter(m => m.id !== messageId);
      if (updatedMessages.length === 0) {
        const { [itemId]: _, ...rest } = prev; // Remove item if no messages left
        return rest;
      }
      return { ...prev, [itemId]: updatedMessages };
    });
  };

  // Clear message history for a contact or group
  const clearHistory = (itemId: string) => {
    setMessages(prev => {
      const { [itemId]: _, ...rest } = prev;
      return rest;
    });
    
    toast({
      title: 'Conversation Cleared',
      description: 'All messages have been deleted',
    });
  };

  // Retry sending pending messages
  const retryPendingMessages = useCallback(async () => {
    let changesMadeOverall = false;
    const currentMessagesSnapshot = { ...messages }; // Operate on a snapshot

    for (const itemIdKey in currentMessagesSnapshot) {
      if (!Object.prototype.hasOwnProperty.call(currentMessagesSnapshot, itemIdKey)) continue;

      const item = listItems.find(i => i.id === itemIdKey);
      if (!item) {
        console.warn(`Retry: Item ${itemIdKey} not found in listItems, skipping its messages.`);
        continue;
      }

      const itemMessages = currentMessagesSnapshot[itemIdKey];
      const pendingMessagesInItem = itemMessages.filter(m => m.pending && m.sent);
      
      if (pendingMessagesInItem.length === 0) continue;

      console.log(`Retrying ${pendingMessagesInItem.length} pending messages for ${item.itemType} ${item.name} (ID: ${itemIdKey})`);

      if (item.itemType === 'contact') {
        const contact = item as Contact;
        const contactKey = await getContactKey(contact.id);
        if (!contactKey) {
          console.warn(`Retry: Key not found for contact ${contact.name}, skipping messages.`);
          continue;
        }
        let contactMessagesUpdated = false;
        const updatedContactMessages = [...(messages[contact.id] || [])]; // Get latest from state for update

        for (const message of pendingMessagesInItem) {
          try {
            const requestId = await generateStableRequestId(contact.userGeneratedKey, contactKey);
            const response = await fetch('/api/put-message', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message_id: requestId, message: message.content }),
            });

            if (response.ok) {
              console.log(`Successfully resent message ID: ${message.id} to contact: ${contact.name}`);
              const msgIndex = updatedContactMessages.findIndex(m => m.id === message.id);
              if (msgIndex !== -1) {
                updatedContactMessages[msgIndex] = { ...updatedContactMessages[msgIndex], pending: false };
                contactMessagesUpdated = true;
              }
            } else {
              console.error(`Failed to resend message ID: ${message.id} to ${contact.name}. API error ${response.status}: ${await response.text()}`);
            }
          } catch (retryError) {
            console.error(`Error during retry of message ID: ${message.id} to ${contact.name}:`, retryError);
          }
        }
        if (contactMessagesUpdated) {
          setMessages(prev => ({ ...prev, [contact.id]: updatedContactMessages }));
          changesMadeOverall = true;
        }
      } else if (item.itemType === 'group') {
        const group = item as Group;
        let groupMessagesUpdated = false;
        const updatedGroupMessages = [...(messages[group.id] || [])]; // Get latest from state for update

        for (const message of pendingMessagesInItem) { // message.contactId is groupId, message.groupId is groupId
          if (!message.groupId || message.contactId !== group.id) { // Sanity check
             console.warn(`Skipping retry for malformed group message ${message.id}`);
             continue;
          }
          console.log(`Retrying group message ID: ${message.id} for group: ${group.name}`);
          const decryptedContent = await getDecryptedContent(message); // Decrypts using first member's key
          
          if (decryptedContent.startsWith('[Could not decrypt') || decryptedContent.startsWith('[Decryption failed')) {
            console.error(`Cannot retry group message ${message.id}: decryption failed.`);
            continue;
          }

          let allMemberSendsSuccessful = true;
          for (const memberId of group.memberIds) {
            const memberContact = listItems.find(i => i.id === memberId && i.itemType === 'contact') as Contact | undefined;
            if (!memberContact) {
              console.warn(`Retry: Group member ${memberId} not found. Skipping send for this member.`);
              allMemberSendsSuccessful = false; continue;
            }
            const memberKey = await getContactKey(memberId);
            if (!memberKey) {
              console.warn(`Retry: No key for group member ${memberContact.name}. Skipping.`);
              allMemberSendsSuccessful = false; continue;
            }
            try {
              const encryptedContentForMember = await encryptMessage(decryptedContent, memberKey);
              const requestId = await generateStableRequestId(memberContact.userGeneratedKey, memberKey);
              const response = await fetch('/api/put-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  message_id: requestId,
                  message: encryptedContentForMember,
                  group: group.name,
                }),
              });
              if (!response.ok) {
                console.error(`Retry: API error sending to group member ${memberContact.name}: ${response.status} ${await response.text()}`);
                allMemberSendsSuccessful = false;
              }
            } catch (memberError) {
              console.error(`Retry: Error sending to group member ${memberContact.name}:`, memberError);
              allMemberSendsSuccessful = false;
            }
          }
          if (allMemberSendsSuccessful) {
            console.log(`Successfully resent group message ID: ${message.id} to all members of ${group.name}`);
            const msgIndex = updatedGroupMessages.findIndex(m => m.id === message.id);
            if (msgIndex !== -1) {
                updatedGroupMessages[msgIndex] = { ...updatedGroupMessages[msgIndex], pending: false };
                groupMessagesUpdated = true;
            }
          } else {
            console.warn(`Retry for group message ID: ${message.id} was not successful for all members.`);
          }
        }
        if (groupMessagesUpdated) {
            setMessages(prev => ({ ...prev, [group.id]: updatedGroupMessages }));
            changesMadeOverall = true;
        }
      }
    }
    // No need to call setMessages(newMessagesState) if changes were applied directly with setMessages(prev => ...)
  }, [messages, listItems, getContactKey, toast, encryptMessage, decryptMessage]); // Added dependencies

  useEffect(() => {
    const intervalId = setInterval(() => {
      console.log("Checking for pending messages to retry...");
      retryPendingMessages();
    }, 30000); // 30 seconds

    return () => clearInterval(intervalId);
  }, [retryPendingMessages]);

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
      // triggerFetch, // Removed
    }}
  >
      {children}
    </MessagesContext.Provider>
  );
};

export const useMessages = () => {
  const context = useContext(MessagesContext);
  if (context === undefined) {
    throw new Error('useMessages must be used within a MessagesProvider');
  }
  return context;
};
