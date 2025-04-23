import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'; // Removed useRef if no longer needed directly here
import { Contact, useContacts } from './ContactsContext';
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
  contactId: string;
  content: string; // Encrypted content
  timestamp: string;
  sent: boolean; // true if sent by user, false if received
  read: boolean;
  forwarded: boolean;
  forwardedPath?: string[]; // IDs of contacts in forwarding path
}

interface MessagesContextType {
  messages: Record<string, Message[]>; // Keyed by contactId
  sendMessage: (contactId: string, content: string, forwarding?: Contact[]) => Promise<boolean>;
  forwardMessage: (messageId: string, contactId: string, targetContactId: string) => Promise<boolean>;
  getDecryptedContent: (message: Message) => Promise<string>;
  markAsRead: (contactId: string, messageId: string) => void;
  deleteMessage: (contactId: string, messageId: string) => void;
  clearHistory: (contactId: string) => void;
  // triggerFetch: () => void; // Removed - long polling handles this
}

// Type for the response from /api/get-messages
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
  const { getContactKey, contacts } = useContacts();
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
 useMessagePolling({ setMessages });


 // Send a message to a contact
 const sendMessage = async (
    contactId: string, 
    content: string, 
    forwarding: Contact[] = []
  ): Promise<boolean> => {
    try {
      // Get the contact's encryption key
      const key = await getContactKey(contactId);
      if (!key) {
        toast({
          title: 'Error',
          description: 'Could not find encryption key for this contact',
          variant: 'destructive',
        });
        return false;
      }

      // Encrypt the message content (assuming encryptMessage returns base64)
      const encryptedContentBase64 = await encryptMessage(content, key);

     // --- Send to backend ---
     try {
       // Find the contact to check userGeneratedKey
       const contact = contacts.find(c => c.id === contactId);
       if (!contact) {
         throw new Error(`Contact with ID ${contactId} not found.`);
       }

       // Determine the plaintext ID based on who generated the key
       // const idPlainText = contact.userGeneratedKey
       //  ? "sending to key receiver"
       //  : "sending to key generator";

       // Encrypt the plaintext ID using the shared key
       // const encryptedIdBase64 = await encryptMessage(idPlainText, key);

       // Generate the stable request ID instead
       const requestId = await generateStableRequestId(contact.userGeneratedKey, key);


       // Send the stable request ID and encrypted message content to the backend
       const response = await fetch('/api/put-message', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
         },
         body: JSON.stringify({
           message_id: requestId, // Use the generated stable request ID (hash)
           message: encryptedContentBase64, // Keep the encrypted message content
         }),
       });

       console.log(response);
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API error ${response.status}: ${errorText}`);
        }
        console.log('Message sent to backend successfully');
      } catch (apiError) {
        console.error('Failed to send message to backend:', apiError);
        toast({
          title: 'Send Warning',
          description: 'Message saved locally, but failed to send to the server.',
          variant: 'destructive', // Or a 'warning' variant if available
        });
        // Note: We still proceed to add the message locally even if backend fails
      }
      // --- End send to backend ---


      // Create the new message for local state
      const newMessage: Message = {
        // Use a local unique ID for React keys and local operations
        id: `local-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        contactId,
        content: encryptedContentBase64, // Store the base64 content locally
        timestamp: new Date().toISOString(),
        sent: true, // Mark as sent from the user's perspective
        read: true, // Sent messages are read by default
        forwarded: forwarding.length > 0,
        forwardedPath: forwarding.length > 0 ? forwarding.map(c => c.id) : undefined,
      };

      // Add the message to the list
      setMessages(prev => {
        const contactMessages = prev[contactId] || [];
        return {
          ...prev,
          [contactId]: [...contactMessages, newMessage],
       };
     });

     // No need to manually trigger fetch, long polling will handle it
     // triggerFetch(); // Removed call

     return true;
   } catch (error) {
     console.error('Error sending message:', error);
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
      // Get the contact's encryption key
      const key = await getContactKey(message.contactId);
      if (!key) {
        return '[Could not decrypt - key missing]';
      }

      // Decrypt the message content
      return await decryptMessage(message.content, key);
    } catch (error) {
      console.error('Error decrypting message:', error);
      return '[Decryption failed]';
    }
  };

  // Mark a message as read
  const markAsRead = (contactId: string, messageId: string) => {
    setMessages(prev => {
      const contactMessages = prev[contactId] || [];
      const updatedMessages = contactMessages.map(m => 
        m.id === messageId ? { ...m, read: true } : m
      );
      return { ...prev, [contactId]: updatedMessages };
    });
  };

  // Delete a message
  const deleteMessage = (contactId: string, messageId: string) => {
    setMessages(prev => {
      const contactMessages = prev[contactId] || [];
      const updatedMessages = contactMessages.filter(m => m.id !== messageId);
      return { ...prev, [contactId]: updatedMessages };
    });
  };

  // Clear message history for a contact
  const clearHistory = (contactId: string) => {
    setMessages(prev => {
      const { [contactId]: _, ...rest } = prev;
      return rest;
    });
    
    toast({
      title: 'Conversation Cleared',
      description: 'All messages have been deleted',
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
      triggerFetch, // Expose fetch function from the hook
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
