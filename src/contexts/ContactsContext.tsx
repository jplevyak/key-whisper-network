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
  // keyId?: string; // Identifier for the encrypted key - removed, will be handled by contact.id
  lastActive?: string; // ISO date string
  userGeneratedKey: boolean; // True if the user generated the key, false if scanned from contact
  putRequestId?: string; // For sending messages TO this contact
  getRequestId?: string; // For fetching messages FROM this contact
}

// New Group interface
export interface Group extends BaseListItem {
  itemType: "group";
  memberIds: string[]; // Array of contact IDs
}

export type ContactOrGroup = Contact | Group;

// Removed StoredKeyData interface as key data (string) will be stored directly in DB (encrypted)
// and request IDs will be on the Contact object.

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
      // Import key as non-extractable for in-memory cache and for DB storage.
      // db.set will handle wrapping this non-extractable key using "jwk" format.
      const nonExtractableCryptoKey = await importKey(keyData);

      // Generate request IDs using the original keyData string
      const putRequestId = await generateStableRequestId(userGeneratedKey, keyData);
      const getRequestId = await generateStableRequestId(!userGeneratedKey, keyData);
      
      const contactId = `contact-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      // Store the non-extractable CryptoKey in IndexedDB; db.set will handle wrapping.
      await db.set("keys", contactId, nonExtractableCryptoKey);

      // Create the new contact
      const newContact: Contact = {
        id: contactId,
        name,
        avatar,
        itemType: "contact",
        lastActive: new Date().toISOString(),
        userGeneratedKey,
        putRequestId,
        getRequestId,
      };

      setContactKeys((prev) => new Map(prev).set(newContact.id, nonExtractableCryptoKey));
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

  // Interface for the old StoredKeyData structure for upgrade purposes
  interface OldStoredKeyData {
    key: string;
    putRequestId: string;
    getRequestId: string;
  }

  // Helper function to get/upgrade contact key and request IDs
  const _getOrUpgradeContactData = async (
    contact: Contact & { keyId?: string }, // Allow keyId for upgrade
  ): Promise<{ key: CryptoKey; putRequestId: string; getRequestId: string } | null> => {
    if (!isDbInitialized) {
      toast({ title: "Database Not Ready", description: "Please wait and try again.", variant: "destructive" });
      return null;
    }

    let currentPutId = contact.putRequestId;
    let currentGetId = contact.getRequestId;
    let cryptoKey: CryptoKey | null = contactKeys.get(contact.id) || null;
    let keyDataStringToUse: string | null = null;

    // Step 1: Try to get key and IDs using the new system (contact.id)
    if (cryptoKey && currentPutId && currentGetId) {
      return { key: cryptoKey, putRequestId: currentPutId, getRequestId: currentGetId };
    }

    const keyResultFromDb = await db.get("keys", contact.id); // Returns { cryptoKey }
    if (keyResultFromDb && keyResultFromDb.cryptoKey) {
      cryptoKey = keyResultFromDb.cryptoKey; // This key is non-extractable
      // keyDataStringToUse is not available from db.get("keys") anymore.
      // Request IDs must come from the contact object or be generated during upgrade.
      if (!contactKeys.has(contact.id)) {
        setContactKeys((prev) => new Map(prev).set(contact.id, cryptoKey!));
      }
    }

    // Step 2: If key not found by contact.id, or IDs missing from contact, attempt upgrade using contact.keyId
    // The primary goal of upgrade here is to get the key into the new store format and ensure IDs are on the contact.
    if ((!cryptoKey || !currentPutId || !currentGetId) && contact.keyId) {
      const oldKeyId = contact.keyId;
      console.log(`Attempting upgrade for contact ${contact.name} (ID: ${contact.id}) from old keyId ${oldKeyId}`);
      
      // Get the raw value from DB, which was an encrypted string in old versions.
      const rawOldValueFromDB = await db.getRawValue("keys", oldKeyId);

      if (rawOldValueFromDB && typeof rawOldValueFromDB === 'string') {
        try {
          const decryptedOldValueString = await secureStorage.decrypt(rawOldValueFromDB);
          let successfullyProcessedOldData = false;

          try {
            // Attempt to parse as OldStoredKeyData JSON string
            const parsedJson = JSON.parse(decryptedOldValueString) as OldStoredKeyData;
            if (parsedJson && parsedJson.key && parsedJson.putRequestId && parsedJson.getRequestId) {
              keyDataStringToUse = parsedJson.key;
              currentPutId = parsedJson.putRequestId;
              currentGetId = parsedJson.getRequestId;
              successfullyProcessedOldData = true;
              console.log(`Upgraded from decrypted JSON StoredKeyData for ${contact.name}`);
            } else {
              // Parsed, but not the expected structure, assume it's a raw key string
              keyDataStringToUse = decryptedOldValueString;
              successfullyProcessedOldData = true;
              console.log(`Upgraded from decrypted raw key string (JSON parse did not match OldStoredKeyData) for ${contact.name}`);
            }
          } catch (e) {
            // JSON parsing failed, assume decryptedOldValueString is the raw keyDataString
            keyDataStringToUse = decryptedOldValueString;
            successfullyProcessedOldData = true;
            console.log(`Upgraded from decrypted raw key string (JSON parse failed) for ${contact.name}`);
          }

          if (successfullyProcessedOldData && keyDataStringToUse) {
            // Import as non-extractable for both DB (via "jwk" wrapping) and cache
            const nonExtractableKeyForDbAndCache = await importKey(keyDataStringToUse);
            await db.set("keys", contact.id, nonExtractableKeyForDbAndCache); // Save in new wrapped format
            
            cryptoKey = nonExtractableKeyForDbAndCache; // Use this for the current operation and cache

            if (!contactKeys.has(contact.id)) {
              setContactKeys((prev) => new Map(prev).set(contact.id, cryptoKey!));
            }
            await db.delete("keys", oldKeyId); // Delete old entry
            console.log(`Contact ${contact.name} (ID: ${contact.id}) key upgraded from old keyId ${oldKeyId}.`);
          }
        } catch (decryptionError) {
          console.error(`Failed to decrypt old key data for keyId ${oldKeyId} during upgrade:`, decryptionError);
          toast({ title: "Upgrade Error", description: `Could not decrypt old key for ${contact.name}.`, variant: "destructive" });
        }
      } else if (rawOldValueFromDB) {
        // This case should ideally not happen if old keys were always encrypted strings.
        console.warn(`Old key data for keyId ${oldKeyId} is not an encrypted string. Type: ${typeof rawOldValueFromDB}. Skipping upgrade for this key.`);
      } else {
        console.warn(`No raw old value found for keyId ${oldKeyId} during upgrade attempt.`);
      }
    }

    if (!cryptoKey) {
      // If after all attempts (direct fetch or upgrade), cryptoKey is still null.
      toast({ title: "Key Error", description: `Could not load or upgrade encryption key for ${contact.name}.`, variant: "destructive" });
      return null;
    }

    // Step 3: Generate IDs if still missing AND we have the keyDataString from an upgrade.
    // If keyDataStringToUse is null here, it means we didn't go through an upgrade path that provided it,
    // or the contact is new and IDs should already be on the contact object.
    if ((!currentPutId || !currentGetId) && keyDataStringToUse) { // keyDataStringToUse is primarily from upgrade path
      console.log(`Generating missing request IDs for ${contact.name} using key data from upgrade.`);
      currentPutId = await generateStableRequestId(contact.userGeneratedKey, keyDataStringToUse);
      currentGetId = await generateStableRequestId(!contact.userGeneratedKey, keyDataStringToUse);
    } else if (!currentPutId || !currentGetId) {
      // If IDs are still missing, and we don't have keyDataStringToUse (e.g. normal path, but contact object is incomplete)
      // This indicates a problem, as we cannot regenerate IDs from a non-extractable cryptoKey without its original string form.
      console.error(`Critical: Request IDs missing for contact ${contact.name} and cannot regenerate without original key data string.`);
      toast({ title: "ID Error", description: `Request IDs missing for ${contact.name}. Data might be corrupted.`, variant: "destructive" });
      return null;
    }
    
    // Step 4: Update contact in listItems state if IDs changed or keyId was present (indicating an upgrade occurred)
    const needsContactUpdateInList = contact.putRequestId !== currentPutId ||
                                   contact.getRequestId !== currentGetId ||
                                   (contact as any).keyId; // Check if keyId was present

    if (needsContactUpdateInList) {
      setListItems((prevListItems) =>
        prevListItems.map((item) => {
          if (item.id === contact.id && item.itemType === "contact") {
            const updatedContact = {
              ...item,
              putRequestId: currentPutId,
              getRequestId: currentGetId,
            } as Contact;
            delete (updatedContact as any).keyId; // Ensure keyId is removed
            return updatedContact;
          }
          return item;
        }),
      );
    }
    return { key: cryptoKey, putRequestId: currentPutId, getRequestId: currentGetId };
  };

  const getContactKey = async (contactId: string): Promise<CryptoKey | null> => {
    const contactItem = listItems.find(
      (item): item is Contact => item.id === contactId && item.itemType === "contact",
    );
    if (!contactItem) return null;

    const contactData = await _getOrUpgradeContactData(contactItem);
    return contactData ? contactData.key : null;
    } catch (error) {
      console.error(`Error getting contact key for ${contactId}:`, error);
      return null;
    }
  };

  const getGetRequestId = async (contactId: string): Promise<string | null> => {
    const contactItem = listItems.find(
      (item): item is Contact => item.id === contactId && item.itemType === "contact",
    );
    if (!contactItem) return null;

    if (contactItem.getRequestId) return contactItem.getRequestId; // Prefer direct from object

    const contactData = await _getOrUpgradeContactData(contactItem);
    return contactData ? contactData.getRequestId : null;
  };

  const getPutRequestId = async (contactId: string): Promise<string | null> => {
    const contactItem = listItems.find(
      (item): item is Contact => item.id === contactId && item.itemType === "contact",
    );
    if (!contactItem) return null;

    if (contactItem.putRequestId) return contactItem.putRequestId; // Prefer direct from object

    const contactData = await _getOrUpgradeContactData(contactItem);
    return contactData ? contactData.putRequestId : null;
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
        newContactKeys.delete(contact.id); // Use contact.id
        setContactKeys(newContactKeys);
        // Asynchronously delete the key from DB, don't block UI updates
        db.delete("keys", contact.id).catch((error) => { // Use contact.id
          console.error("Error deleting contact key from DB:", error);
        });
      }
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

      let oldKey: CryptoKey | null = null; // This will be non-extractable
      let newNonExtractableCryptoKey: CryptoKey | null = null;

      try {
        oldKey = await getContactKey(contactId); // Get OLD key (non-extractable) before updating

        // Import new key as non-extractable for cache, return, and DB storage (via "jwk" wrapping)
        newNonExtractableCryptoKey = await importKey(newKeyData);

        // Store the non-extractable CryptoKey in DB; db.set handles wrapping.
        await db.set("keys", contact.id, newNonExtractableCryptoKey!);
        
        // Update the key in memory cache with the non-extractable version
        setContactKeys((prev) => new Map(prev).set(contact.id, newNonExtractableCryptoKey!));


        // Generate new request IDs using the newKeyData string
        const newPutRequestId = await generateStableRequestId(
          contact.userGeneratedKey,
          newKeyData,
        );
        const newGetRequestId = await generateStableRequestId(
          !contact.userGeneratedKey,
          newKeyData,
        );

        // Update the contact object in listItems with new request IDs
        setListItems((prevListItems) =>
          prevListItems.map((item) =>
            item.id === contactId && item.itemType === "contact"
              ? {
                  ...item,
                  putRequestId: newPutRequestId,
                  getRequestId: newGetRequestId,
                }
              : item,
          ),
        );
        
        if (activeItem && activeItem.id === contactId && activeItem.itemType === "contact") {
          setActiveItem(prev => prev ? ({...prev, putRequestId: newPutRequestId, getRequestId: newGetRequestId } as Contact) : null);
        }

        console.log(`Key updated successfully for contact ${contact.name}`);
        
        if (!oldKey) {
          toast({
            title: "Contact Key Set",
            description: `The encryption key for ${contact.name} has been set.`,
          });
        }
        // Message re-encryption logic (if any) is handled by the caller.
        return { success: true, oldKey, newKey: newNonExtractableCryptoKey };
      } catch (error) {
        console.error(`Error updating key for contact ${contactId}:`, error);
        toast({
          title: "Key Update Failed",
          description: "Could not import or save the new encryption key.",
          variant: "destructive",
        });
        return { success: false, oldKey, newKey: newNonExtractableCryptoKey };
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
