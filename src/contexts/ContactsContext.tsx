import React, { createContext, useContext, useState, useEffect } from 'react';
import { generateAESKey, exportKey, importKey } from '@/utils/encryption';
import { useToast } from '@/components/ui/use-toast';
import { db } from '@/utils/indexedDB';

export interface Contact {
  id: string;
  name: string;
  avatar: string; // base64 image
  keyId: string; // Identifier for the encrypted key
  lastActive?: string; // ISO date string
  userGeneratedKey: boolean; // True if the user generated the key, false if scanned from contact
}

interface ContactsContextType {
  contacts: Contact[];
  activeContact: Contact | null;
  setActiveContact: (contact: Contact | null) => void;
  addContact: (name: string, avatar: string, keyData: string, userGeneratedKey: boolean) => Promise<boolean>;
  getContactKey: (contactId: string) => Promise<CryptoKey | null>;
  generateContactKey: () => Promise<string>;
  deleteContact: (contactId: string) => void;
  forwardingPath: Contact[];
  setForwardingPath: (path: Contact[]) => void;
  updateContact: (contactId: string, updates: Partial<Contact>) => void;
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

  // Load contacts from IndexedDB on init
  useEffect(() => {
    const loadContacts = async () => {
      try {
        const storedContacts = await db.get('contacts', 'all');
        if (storedContacts) {
          const decryptedData = mockDecryptFromStorage(storedContacts);
          setContacts(JSON.parse(decryptedData));
        }
      } catch (error) {
        console.error('Error loading contacts:', error);
        toast({
          title: 'Error',
          description: 'Could not load your contacts',
          variant: 'destructive',
        });
      }
    };

    loadContacts();
  }, [toast]);

  // Save contacts to IndexedDB whenever they change
  useEffect(() => {
    if (contacts.length > 0) {
      const saveContacts = async () => {
        const encryptedData = mockEncryptForStorage(JSON.stringify(contacts));
        await db.set('contacts', 'all', encryptedData);
      };
      saveContacts();
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

  const addContact = async (name: string, avatar: string, keyData: string, userGeneratedKey: boolean): Promise<boolean> => {
    try {
      const key = await importKey(keyData);
      const keyId = `key-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      setContactKeys(prev => new Map(prev).set(keyId, key));
      
      // Save encrypted key data in IndexedDB
      const encryptedKeyData = mockEncryptForStorage(keyData);
      await db.set('keys', keyId, encryptedKeyData);
      
      // Create the new contact
      const newContact: Contact = {
        id: `contact-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        name,
        avatar,
        keyId,
        lastActive: new Date().toISOString(),
        userGeneratedKey // Set the flag here
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

  const getContactKey = async (contactId: string): Promise<CryptoKey | null> => {
    try {
      const contact = contacts.find(c => c.id === contactId);
      if (!contact) return null;
      
      if (contactKeys.has(contact.keyId)) {
        return contactKeys.get(contact.keyId) || null;
      }
      
      const encryptedKeyData = await db.get('keys', contact.keyId);
      if (!encryptedKeyData) return null;
      
      const keyData = mockDecryptFromStorage(encryptedKeyData);
      const key = await importKey(keyData);
      
      setContactKeys(prev => new Map(prev).set(contact.keyId, key));
      
      return key;
    } catch (error) {
      console.error('Error getting contact key:', error);
      return null;
    }
  };

  const deleteContact = async (contactId: string) => {
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return;
    
    setContacts(prev => prev.filter(c => c.id !== contactId));
    
    const newContactKeys = new Map(contactKeys);
    newContactKeys.delete(contact.keyId);
    setContactKeys(newContactKeys);
    
    try {
      await db.delete('keys', contact.keyId);
      toast({
        title: 'Contact Deleted',
        description: `${contact.name} has been removed from your contacts`,
      });
    } catch (error) {
      console.error('Error deleting contact key:', error);
    }
  };

  const updateContact = (contactId: string, updates: Partial<Contact>) => {
    setContacts(prev => prev.map(contact => 
      contact.id === contactId ? { ...contact, ...updates } : contact
    ));

    // If the updated contact is the active one, update the activeContact state too
    if (activeContact && activeContact.id === contactId) {
      setActiveContact(prev => prev ? { ...prev, ...updates } : null);
    }
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
        updateContact,
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
