import React, { createContext, useContext, useState, useEffect } from "react";
import {
  generateAESKey,
  exportKey,
  importKey,
  generateStableRequestId,
  importRawKey,
} from "@/utils/encryption";
import { secureStorage } from "@/utils/secureStorage";
import { useToast } from "@/components/ui/use-toast";
import { db } from "@/utils/indexedDB";
// Removed: import { useMessages } from './MessagesContext';

// Base interface for items in the list
interface BaseListItem {
  id: string;
  name: string;
  avatar: string;
}

// Modified Contact interface
export interface Contact extends BaseListItem {
  itemType: "contact";
  keyId: string; // Identifier for the encrypted key
  lastActive?: string; // ISO date string
  userGeneratedKey: boolean; // True if the user generated the key, false if scanned from contact
}

// New Group interface
export interface Group extends BaseListItem {
  itemType: "group";
  memberIds: string[]; // Array of contact IDs
}

export type ContactOrGroup = Contact | Group;

// New interface for the stored key data
interface StoredKeyData {
  key: string; // The original exported key string (base64)
  putRequestId: string; // For sending messages TO this contact, generated with contact.userGeneratedKey
  getRequestId: string; // For fetching messages FROM this contact, generated with !contact.userGeneratedKey
}

interface ContactsContextType {
  listItems: ContactOrGroup[];
  activeItem: ContactOrGroup | null;
  setActiveItem: (item: ContactOrGroup | null) => void;
  addContact: (
    name: string,
    avatar: string,
    keyData: string,
    userGeneratedKey: boolean,
  ) => Promise<boolean>;
  addGroup: (
    name: string,
    memberIds: string[],
    avatar?: string,
    groupId?: string, // Added optional groupId
  ) => Promise<Group | null>; // Return Group or null
  getContactKey: (contactId: string) => Promise<CryptoKey | null>; // Still operates on contactId
  getGetRequestId: (contactId: string) => Promise<string | null>; // For fetching messages
  getPutRequestId: (contactId: string) => Promise<string | null>; // For sending messages
  generateContactKey: () => Promise<string>; // For contacts
  deleteContact: (contactId: string) => void; // Handles both contacts and groups
  updateContact: (contactId: string, updates: Partial<Contact>) => void;
  updateGroup: (
    groupId: string,
    updates: Partial<Omit<Group, "id" | "itemType">>,
  ) => Promise<boolean>;
  updateContactKey: (
    contactId: string,
    newKeyData: string,
  ) => Promise<{
    success: boolean;
    oldKey: CryptoKey | null;
    newKey: CryptoKey | null;
  }>;
}

const ContactsContext = createContext<ContactsContextType | undefined>(
  undefined,
);

export const ContactsProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [listItems, setListItems] = useState<ContactOrGroup[]>([]);
  const [activeItem, setActiveItem] = useState<ContactOrGroup | null>(null);
  const [contactKeys, setContactKeys] = useState<Map<string, CryptoKey>>(
    new Map(),
  );
  const { toast } = useToast();
  // Removed: const messagesContext = useMessages();
  const [isDbInitialized, setIsDbInitialized] = useState(false);

  // Initialize DB
  useEffect(() => {
    const initializeDatabase = async () => {
      try {
        await db.init(); // Call init on the imported db instance
        setIsDbInitialized(true);
        console.log("Database initialized successfully.");
      } catch (error) {
        console.error("Failed to initialize database:", error);
        toast({
          title: "Database Error",
          description:
            "Could not initialize local database. Some features may not work.",
          variant: "destructive",
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
        const storedContactsData = await db.get("contacts", "all");
        const loadedContacts: Contact[] = storedContactsData
          ? JSON.parse(storedContactsData)
          : [];

          const storedGroupsData = await db.get("groups", "all");
          const loadedGroups: Group[] = storedGroupsData
            ? JSON.parse(storedGroupsData)
            : [];

            setListItems([...loadedContacts, ...loadedGroups]);
      } catch (error) {
        console.error("Error loading list items:", error);
        toast({
          title: "Error",
          description: "Could not load your contacts and groups",
          variant: "destructive",
        });
        setListItems([]);
      }
    };

    loadListItems();
  }, [isDbInitialized, toast]);

  // Save contacts and groups to IndexedDB whenever listItems change
  useEffect(() => {
    if (!isDbInitialized) {
      // Only proceed if DB is initialized
      return;
    }

    const saveListItems = async () => {
      try {
        const currentContacts = listItems.filter(
          (item) => item.itemType === "contact",
        ) as Contact[];
          const currentGroups = listItems.filter(
            (item) => item.itemType === "group",
          ) as Group[];

            if (
              currentContacts.length > 0 ||
              listItems.some((item) => item.itemType === "contact")
            ) {
              // Save even if it becomes empty
              const contactsJson = JSON.stringify(currentContacts);
              await db.set("contacts", "all", contactsJson);
              console.log("Contacts saved successfully.");
            } else {
              await db.set("contacts", "all", JSON.stringify([])); // Save empty array if all contacts removed
              console.log(
                "No contacts to save, or all contacts removed. Saved empty array.",
              );
            }

            if (
              currentGroups.length > 0 ||
              listItems.some((item) => item.itemType === "group")
            ) {
              // Save even if it becomes empty
              const groupsJson = JSON.stringify(currentGroups);
              await db.set("groups", "all", groupsJson);
              console.log("Groups saved successfully.");
            } else {
              await db.set("groups", "all", JSON.stringify([])); // Save empty array if all groups removed
              console.log(
                "No groups to save, or all groups removed. Saved empty array.",
              );
            }
      } catch (error) {
        console.error("Failed to save list items:", error);
        toast({
          title: "Save Error",
          description: `Could not save changes to persistent storage. Error: ${error}`,
          variant: "destructive",
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
      console.error("Error generating contact key:", error);
      toast({
        title: "Error",
        description: "Could not generate encryption key",
        variant: "destructive",
      });
      return "";
    }
  };

  const addContact = async (
    name: string,
    avatar: string,
    keyData: string,
    userGeneratedKey: boolean,
  ): Promise<boolean> => {
    if (!isDbInitialized) {
      toast({
        title: "Database Not Ready",
        description: "Please wait a moment and try again.",
        variant: "destructive",
      });
      return false;
    }
    try {
      const key = await importKey(keyData);
      const keyId = `key-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      setContactKeys((prev) => new Map(prev).set(keyId, key));

      // Generate request IDs
      const putRequestId = await generateStableRequestId(userGeneratedKey, key);
      const getRequestId = await generateStableRequestId(!userGeneratedKey, key);

      const storedKeyObject: StoredKeyData = {
        key: keyData, // keyData is the exported string representation of the key
        putRequestId,
        getRequestId,
      };

      // Save structured key data in IndexedDB - db.set handles encryption
      await db.set("keys", keyId, storedKeyObject);

      // Create the new contact
      const newContact: Contact = {
        id: `contact-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        name,
        avatar,
        itemType: "contact", // Explicitly set itemType
        keyId,
        lastActive: new Date().toISOString(),
        userGeneratedKey,
      };

      setListItems((prev) => [...prev, newContact]);

      return true;
    } catch (error) {
      console.error("Error adding contact:", error);
      toast({
        title: "Error",
        description: "Could not add contact",
        variant: "destructive",
      });
      return false;
    }
  };

  const addGroup = async (
    name: string,
    memberIds: string[],
    avatar?: string,
    groupId?: string, // Added groupId parameter
  ): Promise<Group | null> => {
    try {
      const newGroup: Group = {
        id: groupId || `group-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`, // Use provided groupId or generate new
        name,
        avatar: avatar,
        itemType: "group",
        memberIds,
      };

      setListItems((prev) => [...prev, newGroup]);
      // Persistence is handled by the useEffect watching listItems

      return newGroup;
    } catch (error) {
      console.error("Error creating group:", error);
      toast({
        title: "Error",
        description: "Could not create group.",
        variant: "destructive",
      });
      return null;
    }
  };

  // Helper function to get StoredKeyData and handle upgrade
  const _getStoredKeyDataForContact = async (
    contactId: string,
  ): Promise<StoredKeyData | null> => {
    if (!isDbInitialized) {
      toast({
        title: "Database Not Ready",
        description:
          "Cannot retrieve contact key data. Please wait and try again.",
        variant: "destructive",
      });
      return null;
    }

    const contactItem = listItems.find(
      (item) => item.id === contactId && item.itemType === "contact",
    );
      if (!contactItem) {
        console.warn(`Contact not found for ID: ${contactId} in _getStoredKeyDataForContact`);
        return null;
      }
      const contact = contactItem as Contact;

      const storedData = await db.get("keys", contact.keyId);
      if (!storedData) {
        console.warn(`No key data found in DB for keyId: ${contact.keyId}`);
        return null;
      }

      let keyStringToImport: string | null = null;
      let existingPutRequestId: string | null = null;
      let existingGetRequestId: string | null = null;

      try {
        // Attempt to decrypt it as if it's an encrypted StoredKeyData JSON string
        const parsedObject = JSON.parse(storedData) as StoredKeyData;

        if (parsedObject && !!parsedObject.key && typeof parsedObject.putRequestId === 'string' && typeof parsedObject.getRequestId === 'string') {
          console.log(`Successfully decrypted and parsed StoredKeyData for keyId: ${contact.keyId}`);
          return parsedObject;
        } else {
          // Decrypted, but not the expected StoredKeyData structure. Fallback.
          console.warn(`Decrypted data for keyId ${contact.keyId} was not valid StoredKeyData. Assuming raw key string.`);
          keyStringToImport = await secureStorage.decrypt(storedData); // Treat storedData itself as the raw key string
        }
      } catch (e) {
        // Decryption failed, assume storedData is a raw key string (oldest format)
        console.warn(`Failed to decrypt stored string for keyId ${contact.keyId}. Assuming raw key string. Error:`, e);
        keyStringToImport = await secureStorage.decrypt(storedData);
      }

      const rawKey = await importRawKey(keyStringToImport);
      const key = await importKey(keyStringToImport);
      const putRequestId = await generateStableRequestId(contact.userGeneratedKey, rawKey);
      const getRequestId = await generateStableRequestId(!contact.userGeneratedKey, rawKey);
      const upgradedKeyData: StoredKeyData = { key, putRequestId, getRequestId, };

      await db.set("keys", contact.keyId, JSON.stringify(upgradedKeyData));
      console.log(`Key ${contact.keyId} upgraded to new object format and saved.`);
      return upgradedKeyData;
  };

  const getContactKey = async (
    contactId: string,
  ): Promise<CryptoKey | null> => {
    try {
      const contactItem = listItems.find(
        (item) => item.id === contactId && item.itemType === "contact",
      );
        if (!contactItem) {
          // console.warn(`Contact not found for ID: ${contactId} in getContactKey`);
          return null;
        }
        const contact = contactItem as Contact; // Type assertion

        // Check in-memory cache first
        if (contactKeys.has(contact.keyId)) {
          return contactKeys.get(contact.keyId) || null;
        }

        const storedKeyData = await _getStoredKeyDataForContact(contactId);
        if (!storedKeyData || !storedKeyData.key) {
          return null;
        }

        const cryptoKey = await importKey(storedKeyData.key);
        setContactKeys((prev) => new Map(prev).set(contact.keyId, cryptoKey));
        return cryptoKey;
    } catch (error) {
      console.error(`Error getting contact key for ${contactId}:`, error);
      return null;
    }
  };

  const getGetRequestId = async (
    contactId: string,
  ): Promise<string | null> => {
    try {
      const storedKeyData = await _getStoredKeyDataForContact(contactId);
      return storedKeyData ? storedKeyData.getRequestId : null;
    } catch (error) {
      console.error(`Error getting GET request ID for ${contactId}:`, error);
      return null;
    }
  };

  const getPutRequestId = async (
    contactId: string,
  ): Promise<string | null> => {
    try {
      const storedKeyData = await _getStoredKeyDataForContact(contactId);
      return storedKeyData ? storedKeyData.putRequestId : null;
    } catch (error) {
      console.error(`Error getting PUT request ID for ${contactId}:`, error);
      return null;
    }
  };

  const deleteContact = async (itemId: string) => {
    // Renamed to itemId, can be contact or group
    if (!isDbInitialized) {
      toast({
        title: "Database Not Ready",
        description: "Cannot delete item. Please wait and try again.",
        variant: "destructive",
      });
      return;
    }
    const itemToDelete = listItems.find((item) => item.id === itemId);
    if (!itemToDelete) return;

    setListItems((prevListItems) => {
      let updatedListItems = prevListItems.filter((item) => item.id !== itemId);

      if (itemToDelete.itemType === "contact") {
        // Remove the contact from any groups it was a member of
        updatedListItems = updatedListItems.map((item) => {
          if (item.itemType === "group") {
            const group = item as Group;
            return {
              ...group,
              memberIds: group.memberIds.filter(
                (memberId) => memberId !== itemId,
              ),
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
        db.delete("keys", contact.keyId).catch((error) => {
          console.error("Error deleting contact key from DB:", error);
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

    // Message clearing logic will be handled by the calling component (e.g., ContactProfile)
    // Removed: messagesContext.clearHistory(itemId);
    // Removed: if (itemToDelete.itemType === 'contact') { messagesContext.deleteMessagesFromSenderInGroups(itemId); }

    toast({
      title: `${itemToDelete.itemType === "contact" ? "Contact" : "Group"} Deleted`,
      description: `${itemToDelete.name} has been removed.`,
    });
  };

  const updateContact = (contactId: string, updates: Partial<Contact>) => {
    setListItems(
      (prevListItems) =>
      prevListItems.map((item) =>
                        item.id === contactId && item.itemType === "contact"
                          ? { ...item, ...updates }
                          : item,
                       ) as ContactOrGroup[], // Ensure the map returns the correct union type
    );

    if (
      activeItem &&
      activeItem.id === contactId &&
    activeItem.itemType === "contact"
    ) {
      setActiveItem((prev) =>
                    prev ? ({ ...prev, ...updates } as Contact) : null,
                   );
    }
  };

  const updateGroup = async (
    groupId: string,
    updates: Partial<Omit<Group, "id" | "itemType">>,
  ): Promise<boolean> => {
    if (!isDbInitialized) {
      toast({
        title: "Database Not Ready",
        description: "Cannot update group. Please wait and try again.",
        variant: "destructive",
      });
      return false;
    }
    setListItems(
      (prevListItems) =>
      prevListItems.map((item) =>
                        item.id === groupId && item.itemType === "group"
                          ? { ...item, ...updates }
                          : item,
                       ) as ContactOrGroup[],
    );

    if (
      activeItem &&
      activeItem.id === groupId &&
    activeItem.itemType === "group"
    ) {
      setActiveItem((prev) =>
                    prev ? ({ ...prev, ...updates } as Group) : null,
                   );
    }
    // Persistence is handled by the useEffect watching listItems
    return true; // Assuming success if state is set, persistence handles errors
  };

  // Update the key for an existing contact
  const updateContactKey = async (
    contactId: string,
    newKeyData: string,
  ): Promise<{
    success: boolean;
    oldKey: CryptoKey | null;
    newKey: CryptoKey | null;
  }> => {
    if (!isDbInitialized) {
      toast({
        title: "Database Not Ready",
        description: "Cannot update contact key. Please wait and try again.",
        variant: "destructive",
      });
      return { success: false, oldKey: null, newKey: null };
    }
    const contactItem = listItems.find(
      (item) => item.id === contactId && item.itemType === "contact",
    );
      if (!contactItem) {
        console.error(`Contact not found for ID: ${contactId}`);
        toast({
          title: "Error",
          description: "Could not find the contact to update the key.",
          variant: "destructive",
        });
        return { success: false, oldKey: null, newKey: null };
      }
      const contact = contactItem as Contact; // Type assertion

      let oldKey: CryptoKey | null = null;
      let newImportedKey: CryptoKey | null = null;

      try {
        oldKey = await getContactKey(contactId); // Get OLD key before updating

        newImportedKey = await importKey(newKeyData);

        // Update the key in memory and DB
        setContactKeys((prev) =>
                       new Map(prev).set(contact.keyId, newImportedKey!),
                      ); // newImportedKey won't be null if importKey succeeds

                      // Generate new request IDs for the updated key
                      const putRequestId = await generateStableRequestId(
                        contact.userGeneratedKey,
                        newImportedKey!,
                      );
                      const getRequestId = await generateStableRequestId(
                        !contact.userGeneratedKey,
                        newImportedKey!,
                      );

                      const updatedStoredKey: StoredKeyData = {
                        key: newKeyData, // newKeyData is the exported string representation of the new key
                        putRequestId,
                        getRequestId,
                      };

                      await db.set("keys", contact.keyId, updatedStoredKey); // db.set handles encryption
                      console.log(`Key updated successfully for contact ${contact.name}`);

                      // Message re-encryption will be handled by the calling component (e.g., ContactProfile)
                      // Removed: await messagesContext.reEncryptMessagesForKeyChange(contactId, oldKey, newKey);

                      if (!oldKey) {
                        // This toast is relevant if it's the first time a key is set.
                        // If oldKey existed, re-encryption toasts will be shown by MessagesContext.
                        toast({
                          title: "Contact Key Set",
                          description: `The encryption key for ${contact.name} has been set.`,
                        });
                      }
                      // The calling component will handle toasts related to message re-encryption.
                      return { success: true, oldKey, newKey: newImportedKey };
      } catch (error) {
        console.error(`Error updating key for contact ${contactId}:`, error);
        toast({
          title: "Key Update Failed",
          description: "Could not import or save the new encryption key.",
          variant: "destructive",
        });
        return { success: false, oldKey, newKey: newImportedKey };
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
      getGetRequestId,
      getPutRequestId,
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
    throw new Error("useContacts must be used within a ContactsProvider");
  }
  return context;
};
