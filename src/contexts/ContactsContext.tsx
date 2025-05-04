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
  updateContactKey: (contactId: string, newKeyData: string) => Promise<boolean>; // Add new function
}

const ContactsContext = createContext<ContactsContextType | undefined>(undefined);

// Mock encryption functions removed as db.set/db.get handle secure encryption/decryption

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
        const storedContacts = await db.get('contacts', 'all'); // db.get handles decryption
        if (storedContacts) {
          // No need for mockDecryptFromStorage here
          setContacts(JSON.parse(storedContacts));
        } else {
          setContacts([]); // Initialize as empty array if nothing is stored
        }
      } catch (error) {
        console.error('Error loading contacts:', error);
        toast({
          title: 'Error',
          description: 'Could not load your contacts',
          variant: 'destructive',
        });
        setContacts([]); // Initialize as empty on error too
      }
    };

    loadContacts();
  }, [toast]);

  // Save contacts to IndexedDB whenever they change
  useEffect(() => {
    const saveContacts = async () => {
      try {
        // Consider removing the length check if you want to save empty lists
        // if (contacts.length === 0) {
        //    // Optionally handle saving an empty list explicitly if needed
        //    // await db.set('contacts', 'all', ''); // Or delete the entry
        //    console.log("Contacts list is empty, skipping save or handling explicitly.");
        //    return;
        // }

        console.log("Attempting to save contacts to IndexedDB..."); // Add log
        // Simplify: Remove mock encryption here
        const contactsJson = JSON.stringify(contacts);
        // Let db.set handle the real encryption
        await db.set('contacts', 'all', contactsJson);
        console.log("Contacts saved successfully."); // Add log
      } catch (error) {
        console.error('Failed to save contacts:', error);
        toast({
          title: 'Save Error',
          description: 'Could not save contact changes to persistent storage.',
          variant: 'destructive',
        });
      }
    };

    // Avoid running save immediately on initial load if contacts might still be loading
    // You might need a flag to check if initial load is complete
    // For now, let's assume it runs after initial load or changes
    // Also, don't save if contacts is still the initial empty array before loading finishes
    // A simple check might be to ensure it's not the *initial* empty array,
    // but this requires careful state management. A dedicated "isLoaded" state might be better.
    // For now, we'll save whenever contacts changes after the initial load.
    saveContacts();

  }, [contacts, toast]); // Add toast to dependency array

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

      // Save key data in IndexedDB - db.set handles encryption
      await db.set('keys', keyId, keyData);

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

      // keyData is already decrypted by db.get
      const key = await importKey(encryptedKeyData);

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

    // If the deleted contact was the active one, clear the active contact state
    if (activeContact && activeContact.id === contactId) {
      setActiveContact(null);
    }

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

  // Update the key for an existing contact
  const updateContactKey = async (contactId: string, newKeyData: string): Promise<boolean> => {
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) {
      console.error(`Contact not found for ID: ${contactId}`);
      toast({
        title: 'Error',
        description: 'Could not find the contact to update the key.',
        variant: 'destructive',
      });
      return false;
    }

    try {
      // Import the new key
      const newKey = await importKey(newKeyData);

      // Update the in-memory key map
      setContactKeys(prev => new Map(prev).set(contact.keyId, newKey));

      // Store the new key data in IndexedDB - db.set handles encryption
      await db.set('keys', contact.keyId, newKeyData);

      console.log(`Key updated successfully for contact ${contactId}`);
      return true;
    } catch (error) {
      console.error(`Error updating key for contact ${contactId}:`, error);
      toast({
        title: 'Key Update Failed',
        description: 'Could not import or save the new encryption key.',
        variant: 'destructive',
      });
      return false;
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
        updateContactKey, // Expose the new function
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
