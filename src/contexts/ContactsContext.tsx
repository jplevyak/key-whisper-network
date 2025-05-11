import React, { createContext, useContext, useState, useEffect } from 'react';
import { generateAESKey, exportKey, importKey } from '@/utils/encryption';
import { useToast } from '@/components/ui/use-toast';
import { db } from '@/utils/indexedDB';

// Base interface for items in the list
interface BaseListItem {
  id: string;
  name: string;
  avatar: string;
}

// Modified Contact interface
export interface Contact extends BaseListItem {
  itemType: 'contact';
  keyId: string; // Identifier for the encrypted key
  lastActive?: string; // ISO date string
  userGeneratedKey: boolean; // True if the user generated the key, false if scanned from contact
}

// New Group interface
export interface Group extends BaseListItem {
  itemType: 'group';
  memberIds: string[]; // Array of contact IDs
}

export type ContactOrGroup = Contact | Group;

interface ContactsContextType {
  listItems: ContactOrGroup[];
  activeItem: ContactOrGroup | null;
  setActiveItem: (item: ContactOrGroup | null) => void;
  addContact: (name: string, avatar: string, keyData: string, userGeneratedKey: boolean) => Promise<boolean>;
  addGroup: (name: string, memberIds: string[], avatar?: string) => Promise<boolean>;
  getContactKey: (contactId: string) => Promise<CryptoKey | null>; // Still operates on contactId
  generateContactKey: () => Promise<string>; // For contacts
  deleteContact: (contactId: string) => void; // Handles both contacts and groups
  updateContact: (contactId: string, updates: Partial<Contact>) => void;
  updateGroup: (groupId: string, updates: Partial<Omit<Group, 'id' | 'itemType'>>) => Promise<boolean>;
  updateContactKey: (contactId: string, newKeyData: string) => Promise<boolean>;
}

const ContactsContext = createContext<ContactsContextType | undefined>(undefined);

export const ContactsProvider = ({ children }: { children: React.ReactNode }) => {
  const [listItems, setListItems] = useState<ContactOrGroup[]>([]);
  const [activeItem, setActiveItem] = useState<ContactOrGroup | null>(null);
  const [contactKeys, setContactKeys] = useState<Map<string, CryptoKey>>(new Map());
  const { toast } = useToast();
  const [isDbInitialized, setIsDbInitialized] = useState(false);

  // Initialize DB
  useEffect(() => {
    const initializeDatabase = async () => {
      try {
        await db.init(); // Call init on the imported db instance
        setIsDbInitialized(true);
        console.log("Database initialized successfully.");
      } catch (error) {
        console.error('Failed to initialize database:', error);
        toast({
          title: 'Database Error',
          description: 'Could not initialize local database. Some features may not work.',
          variant: 'destructive',
        });
        // setIsDbInitialized remains false
      }
    };
    initializeDatabase();
  }, [toast]); // toast is a stable dependency from useToast

  // Load contacts and groups from IndexedDB on init
  useEffect(() => {
    if (!isDbInitialized) return; // Wait for DB initialization
    const loadListItems = async () => {
      try {
        const storedContactsData = await db.get('contacts', 'all');
        const loadedContacts: Contact[] = storedContactsData ? JSON.parse(storedContactsData) : [];

        const storedGroupsData = await db.get('groups', 'all');
        const loadedGroups: Group[] = storedGroupsData ? JSON.parse(storedGroupsData) : [];
        
        setListItems([...loadedContacts, ...loadedGroups]);
      } catch (error) {
        console.error('Error loading list items:', error);
        toast({
          title: 'Error',
          description: 'Could not load your contacts and groups',
          variant: 'destructive',
        });
        setListItems([]);
      }
    };

    loadListItems();
  }, [isDbInitialized, toast]);

  // Save contacts and groups to IndexedDB whenever listItems change
  useEffect(() => {
    if (!isDbInitialized) { // Only proceed if DB is initialized
      return;
    }

    const saveListItems = async () => {
      try {
        const currentContacts = listItems.filter(item => item.itemType === 'contact') as Contact[];
        const currentGroups = listItems.filter(item => item.itemType === 'group') as Group[];

        if (currentContacts.length > 0 || listItems.some(item => item.itemType === 'contact')) { // Save even if it becomes empty
          const contactsJson = JSON.stringify(currentContacts);
          await db.set('contacts', 'all', contactsJson);
          console.log("Contacts saved successfully.");
        } else {
          await db.set('contacts', 'all', JSON.stringify([])); // Save empty array if all contacts removed
           console.log("No contacts to save, or all contacts removed. Saved empty array.");
        }

        if (currentGroups.length > 0 || listItems.some(item => item.itemType === 'group')) { // Save even if it becomes empty
          const groupsJson = JSON.stringify(currentGroups);
          await db.set('groups', 'all', groupsJson);
          console.log("Groups saved successfully.");
        } else {
          await db.set('groups', 'all', JSON.stringify([])); // Save empty array if all groups removed
          console.log("No groups to save, or all groups removed. Saved empty array.");
        }

      } catch (error) {
        console.error('Failed to save list items:', error);
        toast({
          title: 'Save Error',
          description: `Could not save changes to persistent storage. Error: ${error}`,
          variant: 'destructive',
        });
      }
    };
    // The saveListItems function itself handles the logic for empty or populated arrays.
    saveListItems();
  }, [listItems, isDbInitialized, toast]);

  // Generate a new AES-256 key for a new contact (remains contact-specific)
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
    if (!isDbInitialized) {
      toast({
        title: 'Database Not Ready',
        description: 'Please wait a moment and try again.',
        variant: 'destructive',
      });
      return false;
    }
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
        itemType: 'contact', // Explicitly set itemType
        keyId,
        lastActive: new Date().toISOString(),
        userGeneratedKey
      };

      setListItems(prev => [...prev, newContact]);

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

  const addGroup = async (name: string, memberIds: string[], avatar?: string): Promise<boolean> => {
    try {
      const newGroup: Group = {
        id: `group-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        name,
        avatar: avatar,
        itemType: 'group',
        memberIds,
      };

      setListItems(prev => [...prev, newGroup]);
      // Persistence is handled by the useEffect watching listItems

      toast({
        title: 'Group Created',
        description: `${name} has been created.`,
      });
      return true;
    } catch (error) {
      console.error('Error creating group:', error);
      toast({
        title: 'Error',
        description: 'Could not create group.',
        variant: 'destructive',
      });
      return false;
    }
  };

  const getContactKey = async (contactId: string): Promise<CryptoKey | null> => {
    if (!isDbInitialized) {
      toast({
        title: 'Database Not Ready',
        description: 'Cannot retrieve contact key. Please wait and try again.',
        variant: 'destructive',
      });
      return null;
    }
    try {
      // Find the contact within listItems
      const contactItem = listItems.find(item => item.id === contactId && item.itemType === 'contact');
      if (!contactItem) return null;
      
      const contact = contactItem as Contact; // Type assertion

      if (contactKeys.has(contact.keyId)) {
        return contactKeys.get(contact.keyId) || null;
      }
      
      const encryptedKeyData = await db.get('keys', contact.keyId); // keyData is decrypted by db.get
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

  const deleteContact = async (itemId: string) => { // Renamed to itemId, can be contact or group
    if (!isDbInitialized) {
      toast({
        title: 'Database Not Ready',
        description: 'Cannot delete item. Please wait and try again.',
        variant: 'destructive',
      });
      return;
    }
    const itemToDelete = listItems.find(item => item.id === itemId);
    if (!itemToDelete) return;

    setListItems(prevListItems => {
      let updatedListItems = prevListItems.filter(item => item.id !== itemId);

      if (itemToDelete.itemType === 'contact') {
        // Remove the contact from any groups it was a member of
        updatedListItems = updatedListItems.map(item => {
          if (item.itemType === 'group') {
            const group = item as Group;
            return {
              ...group,
              memberIds: group.memberIds.filter(memberId => memberId !== itemId),
            };
          }
          return item;
        });

        // Handle contact-specific key deletion
        const contact = itemToDelete as Contact;
        const newContactKeys = new Map(contactKeys);
        newContactKeys.delete(contact.keyId);
        setContactKeys(newContactKeys);
        // Asynchronously delete the key from DB, don't block UI updates
        db.delete('keys', contact.keyId).catch(error => {
          console.error('Error deleting contact key from DB:', error);
          // Optionally, inform the user if critical, though key deletion failure
          // might not be immediately apparent or critical for UI flow.
        });
      }
      // If itemToDelete.itemType === 'group', its deletion from listItems is already handled by the filter.
      // The useEffect watching listItems will persist these changes.
      return updatedListItems;
    });

    if (activeItem && activeItem.id === itemId) {
      setActiveItem(null);
    }
    toast({
      title: `${itemToDelete.itemType === 'contact' ? 'Contact' : 'Group'} Deleted`,
      description: `${itemToDelete.name} has been removed.`,
    });
  };

  const updateContact = (contactId: string, updates: Partial<Contact>) => {
    setListItems(prevListItems =>
      prevListItems.map(item =>
        item.id === contactId && item.itemType === 'contact'
          ? { ...item, ...updates }
          : item
      ) as ContactOrGroup[] // Ensure the map returns the correct union type
    );

    if (activeItem && activeItem.id === contactId && activeItem.itemType === 'contact') {
      setActiveItem(prev => prev ? { ...prev, ...updates } as Contact : null);
    }
  };
  
  const updateGroup = async (groupId: string, updates: Partial<Omit<Group, 'id' | 'itemType'>>): Promise<boolean> => {
    if (!isDbInitialized) {
      toast({
        title: 'Database Not Ready',
        description: 'Cannot update group. Please wait and try again.',
        variant: 'destructive',
      });
      return false;
    }
    setListItems(prevListItems =>
      prevListItems.map(item =>
        item.id === groupId && item.itemType === 'group'
          ? { ...item, ...updates }
          : item
      ) as ContactOrGroup[]
    );

    if (activeItem && activeItem.id === groupId && activeItem.itemType === 'group') {
      setActiveItem(prev => prev ? { ...prev, ...updates } as Group : null);
    }
    // Persistence is handled by the useEffect watching listItems
    return true; // Assuming success if state is set, persistence handles errors
  };

  // Update the key for an existing contact
  const updateContactKey = async (contactId: string, newKeyData: string): Promise<boolean> => {
    if (!isDbInitialized) {
      toast({
        title: 'Database Not Ready',
        description: 'Cannot update contact key. Please wait and try again.',
        variant: 'destructive',
      });
      return false;
    }
    const contactItem = listItems.find(item => item.id === contactId && item.itemType === 'contact');
    if (!contactItem) {
      console.error(`Contact not found for ID: ${contactId}`);
      toast({
        title: 'Error',
        description: 'Could not find the contact to update the key.',
        variant: 'destructive',
      });
      return false;
    }
    const contact = contactItem as Contact; // Type assertion

    try {
      const newKey = await importKey(newKeyData);
      setContactKeys(prev => new Map(prev).set(contact.keyId, newKey));
      await db.set('keys', contact.keyId, newKeyData); // db.set handles encryption
      console.log(`Key updated successfully for contact ${contact.name}`);
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
        listItems,
        activeItem,
        setActiveItem,
        addContact,
        addGroup, // Expose addGroup
        getContactKey,
        generateContactKey,
        deleteContact, // This now handles both based on itemType for deletion from listItems
        updateContact,
        updateGroup, // Expose updateGroup
        updateContactKey,
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
