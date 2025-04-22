import React, { createContext, useContext, useState, useEffect } from 'react';
import { Contact, useContacts } from './ContactsContext';
import { encryptMessage, decryptMessage } from '@/utils/encryption';
import { useToast } from '@/components/ui/use-toast';
import { db } from '@/utils/indexedDB';

export interface Message {
  id: string;
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

      // Encrypt the message content
      const encryptedContent = await encryptMessage(content, key);

      // Create the new message
      const newMessage: Message = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        contactId,
        content: encryptedContent,
        timestamp: new Date().toISOString(),
        sent: true,
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
