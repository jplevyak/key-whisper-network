import React, { createContext, useContext, useState, useEffect } from 'react';
import { Contact, useContacts } from './ContactsContext';
import { encryptMessage, decryptMessage } from '@/utils/encryption';
import { useToast } from '@/components/ui/use-toast';
import { db } from '@/utils/indexedDB';

// Helper function to convert ArrayBuffer to Hex string
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('');
}

// Helper function to convert Base64 string to ArrayBuffer
// Needed for hashing the encrypted content
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}


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
  triggerFetch: () => void; // Add function to trigger fetch manually
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

// Mock encryption for the local storage (in a real app, this would use the passkey-protected key)
const mockEncryptForStorage = (data: string): string => {
  return btoa(data);
};

const mockDecryptFromStorage = (encryptedData: string): string => {
  return atob(encryptedData);
};

export const MessagesProvider = ({ children }: { children: React.ReactNode }) => {
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const { getContactKey, contacts } = useContacts();
  const { toast } = useToast();
  const fetchIntervalRef = useRef<NodeJS.Timeout | null>(null); // Ref to store interval ID
  const isFetchingRef = useRef(false); // Ref to prevent concurrent fetches


  // --- Fetch Messages from Server ---
  const fetchMessagesFromServer = async () => {
    if (isFetchingRef.current || contacts.length === 0) {
      console.log('Skipping fetch: already fetching or no contacts.');
      return;
    }
    isFetchingRef.current = true;
    console.log('Starting message fetch...');

    const requestIds: string[] = [];
    const idToContactMap: Map<string, string> = new Map(); // Map encrypted request ID -> contactId
    const contactKeysMap: Map<string, CryptoKey> = new Map(); // Cache keys used for this fetch

    try {
      // 1. Generate request IDs for all contacts
      for (const contact of contacts) {
        const key = await getContactKey(contact.id);
        if (!key) {
          console.warn(`Skipping fetch for contact ${contact.id}: key not found.`);
          continue;
        }
        contactKeysMap.set(contact.id, key); // Store key for decryption later

        // Determine the *request* plaintext based on INVERTED logic
        const requestPlainText = contact.userGeneratedKey
          ? "sending to key generator" // If user generated key, ask for messages sent TO generator
          : "sending to key receiver";  // If user scanned key, ask for messages sent TO receiver

        const encryptedRequestId = await encryptMessage(requestPlainText, key);
        requestIds.push(encryptedRequestId);
        idToContactMap.set(encryptedRequestId, contact.id); // Map for lookup later
      }

      if (requestIds.length === 0) {
        console.log('No valid contacts/keys to fetch messages for.');
        isFetchingRef.current = false;
        return;
      }

      // 2. Make API call
      const response = await fetch('/api/get-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_ids: requestIds }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText}`);
      }

      const data: GetMessagesApiResponse = await response.json();

      if (data.results.length > 0) {
        console.log(`Received ${data.results.length} new messages.`);
        let newMessagesAdded = false;

        // 3. Process received messages
        setMessages(prevMessages => {
          const updatedMessages = { ...prevMessages };
          let changed = false;

          for (const receivedMsg of data.results) {
            const contactId = idToContactMap.get(receivedMsg.message_id);
            const key = contactId ? contactKeysMap.get(contactId) : null;

            if (!contactId || !key) {
              console.warn(`Could not find contact or key for received message_id: ${receivedMsg.message_id}`);
              continue;
            }

            // Decrypt content (handle potential errors)
            let decryptedContent: string;
            try {
              decryptedContent = await decryptMessage(receivedMsg.message, key);
            } catch (decryptError) {
              console.error(`Failed to decrypt message for contact ${contactId}:`, decryptError);
              // Optionally add a placeholder message or skip
              continue;
            }

            // Create new message object
            const newMessage: Message = {
              // Generate a unique local ID
              id: `local-${Date.now()}-${Math.random().toString(36).substring(2, 9)}-received`,
              contactId: contactId,
              content: receivedMsg.message, // Store encrypted content
              timestamp: receivedMsg.timestamp, // Use server timestamp
              sent: false, // Mark as received
              read: false, // Mark as unread initially
              forwarded: false, // Assume not forwarded initially
            };

            // Add to state, preventing duplicates based on content and timestamp
            const contactMessages = updatedMessages[contactId] || [];
            const exists = contactMessages.some(
              m => m.content === newMessage.content && m.timestamp === newMessage.timestamp
            );

            if (!exists) {
              updatedMessages[contactId] = [...contactMessages, newMessage].sort(
                (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
              );
              changed = true;
              newMessagesAdded = true; // Track if any messages were actually added
            }
          }
          return changed ? updatedMessages : prevMessages;
        });
         if (newMessagesAdded) {
           toast({ title: "New Messages", description: "You have received new messages." });
         }
      } else {
        console.log('No new messages received from server.');
      }

    } catch (error) {
      console.error('Failed to fetch messages from server:', error);
      // Avoid spamming toasts on background fetches, maybe only toast on manual trigger?
      // toast({ title: 'Fetch Error', description: 'Could not check for new messages.', variant: 'destructive' });
    } finally {
      isFetchingRef.current = false;
      console.log('Message fetch finished.');
    }
  };
  // --- End Fetch Messages ---


  // Load messages from IndexedDB on init
  useEffect(() => {
    const loadMessages = async () => {
      try {
        const storedMessages = await db.get('messages', 'all');
        if (storedMessages) {
          const decryptedData = mockDecryptFromStorage(storedMessages);
          setMessages(JSON.parse(decryptedData));
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
    if (Object.keys(messages).length > 0) {
      const saveMessages = async () => {
        const encryptedData = mockEncryptForStorage(JSON.stringify(messages));
        await db.set('messages', 'all', encryptedData);
      };
      saveMessages();
    }
  }, [messages]);

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
       const idPlainText = contact.userGeneratedKey
         ? "sending to key receiver"
         : "sending to key generator";

       // Encrypt the plaintext ID using the shared key
       const encryptedIdBase64 = await encryptMessage(idPlainText, key);


       // Send encrypted ID and encrypted message content to the backend
       const response = await fetch('/api/put-message', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
         },
         body: JSON.stringify({
           message_id: encryptedIdBase64, // Use the encrypted ID string (base64)
           message: encryptedContentBase64, // Keep the encrypted message content
         }),
       });

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
       triggerFetch: fetchMessagesFromServer, // Expose fetch function
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
