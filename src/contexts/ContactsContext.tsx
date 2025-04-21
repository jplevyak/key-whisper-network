import React, { createContext, useContext, useState, useEffect } from 'react';
import { generateAESKey, exportKey, importKey } from '@/utils/encryption';
import { useToast } from '@/components/ui/use-toast';

export interface Contact {
  id: string;
  name: string;
  avatar: string; // base64 image
  keyId: string; // Identifier for the encrypted key
  lastActive?: string; // ISO date string
  connected: boolean; // Currently online/available
  transportMethods: ('server' | 'bluetooth' | 'wifi' | 'qr')[];
}

interface ContactsContextType {
  contacts: Contact[];
  activeContact: Contact | null;
  setActiveContact: (contact: Contact | null) => void;
  addContact: (name: string, avatar: string, keyData: string) => Promise<boolean>;
  getContactKey: (contactId: string) => Promise<CryptoKey | null>;
  generateContactKey: () => Promise<string>;
  deleteContact: (contactId: string) => void;
  forwardingPath: Contact[];
  setForwardingPath: (path: Contact[]) => void;
}

const ContactsContext = createContext<ContactsContextType | undefined>(undefined);

// Mock encryption for the local storage (in a real app, this would use the passkey-protected key)
const mockEncryptForStorage = (data: string): string => {
  // This is a placeholder. In a real app, encrypt with the passkey-protected key
  return btoa(data);
};

const mockDecryptFromStorage = (encryptedData: string): string => {
  // This is a placeholder. In a real app, decrypt with the passkey-protected key
  return atob(encryptedData);
};

export const ContactsProvider = ({ children }: { children: React.ReactNode }) => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  const [contactKeys, setContactKeys] = useState<Map<string, CryptoKey>>(new Map());
  const [forwardingPath, setForwardingPath] = useState<Contact[]>([]);
  const { toast } = useToast();

  // Load contacts from localStorage on init
  useEffect(() => {
    const loadContacts = () => {
      const storedContacts = localStorage.getItem('contacts');
      if (storedContacts) {
        try {
          const decryptedData = mockDecryptFromStorage(storedContacts);
          setContacts(JSON.parse(decryptedData));
        } catch (error) {
          console.error('Error loading contacts:', error);
          toast({
            title: 'Error',
            description: 'Could not load your contacts',
            variant: 'destructive',
          });
        }
      }
    };

    loadContacts();
  }, [toast]);

  // Save contacts to localStorage whenever they change
  useEffect(() => {
    if (contacts.length > 0) {
      const encryptedData = mockEncryptForStorage(JSON.stringify(contacts));
      localStorage.setItem('contacts', encryptedData);
    }
  }, [contacts]);

  // Generate a new AES-256 key for a new contact
  const generateContactKey = async (): Promise<string> => {
    try {
      const key = await generateAESKey();
      const exportedKey = await exportKey(key);
      return exportedKey;
    } catch (error) {
      console.error('Error generating contact key:', error);
      toast({
        title: 'Error',
        description: 'Could not generate encryption key',
        variant: 'destructive',
      });
      return '';
    }
  };

  // Add a new contact with their key
  const addContact = async (name: string, avatar: string, keyData: string): Promise<boolean> => {
    try {
      // Import the key to verify it's valid
      const key = await importKey(keyData);
      
      // Store the key in the encrypted keyring (for this demo, in memory)
      const keyId = `key-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      setContactKeys(prev => new Map(prev).set(keyId, key));
      
      // Save encrypted key data in localStorage (in a real app)
      const encryptedKeyData = mockEncryptForStorage(keyData);
      localStorage.setItem(`key-${keyId}`, encryptedKeyData);
      
      // Create the new contact
      const newContact: Contact = {
        id: `contact-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        name,
        avatar,
        keyId,
        lastActive: new Date().toISOString(),
        connected: false,
        transportMethods: ['server', 'qr'], // Default methods
      };
      
      setContacts(prev => [...prev, newContact]);
      
      toast({
        title: 'Contact Added',
        description: `${name} has been added to your contacts`,
      });
      
      return true;
    } catch (error) {
      console.error('Error adding contact:', error);
      toast({
        title: 'Error',
        description: 'Could not add contact',
        variant: 'destructive',
      });
      return false;
    }
  };

  // Get a contact's encryption key
  const getContactKey = async (contactId: string): Promise<CryptoKey | null> => {
    try {
      const contact = contacts.find(c => c.id === contactId);
      if (!contact) return null;
      
      // Check if we already have the key in memory
      if (contactKeys.has(contact.keyId)) {
        return contactKeys.get(contact.keyId) || null;
      }
      
      // Otherwise, load it from localStorage
      const encryptedKeyData = localStorage.getItem(`key-${contact.keyId}`);
      if (!encryptedKeyData) return null;
      
      const keyData = mockDecryptFromStorage(encryptedKeyData);
      const key = await importKey(keyData);
      
      // Cache the key in memory
      setContactKeys(prev => new Map(prev).set(contact.keyId, key));
      
      return key;
    } catch (error) {
      console.error('Error getting contact key:', error);
      return null;
    }
  };

  // Delete a contact
  const deleteContact = (contactId: string) => {
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return;
    
    // Remove the contact from the list
    setContacts(prev => prev.filter(c => c.id !== contactId));
    
    // Remove the contact key from memory
    const newContactKeys = new Map(contactKeys);
    newContactKeys.delete(contact.keyId);
    setContactKeys(newContactKeys);
    
    // Remove the encrypted key from localStorage
    localStorage.removeItem(`key-${contact.keyId}`);
    
    toast({
      title: 'Contact Deleted',
      description: `${contact.name} has been removed from your contacts`,
    });
  };

  return (
    <ContactsContext.Provider
      value={{
        contacts,
        activeContact,
        setActiveContact,
        addContact,
        getContactKey,
        generateContactKey,
        deleteContact,
        forwardingPath,
        setForwardingPath,
      }}
    >
      {children}
    </ContactsContext.Provider>
  );
};

export const useContacts = () => {
  const context = useContext(ContactsContext);
  if (context === undefined) {
    throw new Error('useContacts must be used within a ContactsProvider');
  }
  return context;
};
