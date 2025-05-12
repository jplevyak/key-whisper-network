import React, { useState } from "react";
import { useContacts } from "@/contexts/ContactsContext";
import { useMessages } from "@/contexts/MessagesContext";
import { Contact } from "@/contexts/ContactsContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2, TrashIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ContactImageUpload from "./shared/ContactImageUpload";
import ContactNameEdit from "./shared/ContactNameEdit";
import QRCodeActions from "./shared/QRCodeActions";

interface ContactProfileProps {
  contact: Contact;
  isOpen: boolean;
  onClose: () => void;
}

const ContactProfile = ({ contact, isOpen, onClose }: ContactProfileProps) => {
  const { deleteContact, generateContactKey, updateContact, updateContactKey } =
    useContacts();
  const {
    messages,
    clearHistory,
    deleteMessagesFromSenderInGroups,
    reEncryptMessagesForKeyChange,
  } = useMessages();
  const { toast } = useToast();

  // State for name editing
  const [isNameEditing, setIsNameEditing] = useState(false);
  const [tempName, setTempName] = useState(contact.name); // Initialize with current name

  // Reset tempName if contact changes or modal reopens
  React.useEffect(() => {
    setTempName(contact.name);
    setIsNameEditing(false); // Ensure editing is off when contact changes
  }, [contact.id, contact.name, isOpen]);

  const contactMessages = messages[contact.id] || [];
  const sentMessages = contactMessages.filter((m) => m.sent).length;
  const receivedMessages = contactMessages.filter((m) => !m.sent).length;
  const unreadMessages = contactMessages.filter(
    (m) => !m.sent && !m.read,
  ).length;

  // --- Name Editing Handlers ---
  const handleToggleNameEdit = () => {
    if (!isNameEditing) {
      // Entering edit mode: copy current saved name to tempName
      setTempName(contact.name);
    }
    // If leaving edit mode without saving, tempName is discarded implicitly
    setIsNameEditing(!isNameEditing);
  };

  const handleSaveName = () => {
    const trimmedName = tempName.trim();
    if (trimmedName === "") {
      toast({
        title: "Invalid Name",
        description: "Contact name cannot be empty.",
        variant: "destructive",
      });
      return; // Don't save empty name
    }
    if (trimmedName !== contact.name) {
      updateContact(contact.id, { name: trimmedName });
      toast({
        title: "Contact Updated",
        description: "The contact name has been updated.",
      });
    }
    setIsNameEditing(false); // Exit editing mode
  };
  // --- End Name Editing Handlers ---

  // Handler for when a scanned key is accepted in QRCodeActions
  const handleScanAccept = async (scannedKeyData: string) => {
    const keyUpdateResult = await updateContactKey(contact.id, scannedKeyData);
    if (keyUpdateResult.success) {
      updateContact(contact.id, { userGeneratedKey: false });
      if (keyUpdateResult.oldKey && keyUpdateResult.newKey) {
        await reEncryptMessagesForKeyChange(
          contact.id,
          keyUpdateResult.oldKey,
          keyUpdateResult.newKey,
        );
      }
      // Toasts are handled by updateContactKey (for initial set) or reEncryptMessagesForKeyChange
    } else {
      // Error toast is already shown by updateContactKey if it fails.
      console.error("Failed to update key via scan.");
    }
  };

  // Handler for when a newly generated key is accepted in QRCodeActions
  const handleGeneratedKeyAccept = async (newKeyData: string) => {
    const keyUpdateResult = await updateContactKey(contact.id, newKeyData);
    if (keyUpdateResult.success) {
      updateContact(contact.id, { userGeneratedKey: true });
      if (keyUpdateResult.oldKey && keyUpdateResult.newKey) {
        await reEncryptMessagesForKeyChange(
          contact.id,
          keyUpdateResult.oldKey,
          keyUpdateResult.newKey,
        );
      }
      // Toasts are handled by updateContactKey (for initial set) or reEncryptMessagesForKeyChange
    } else {
      // Error toast is already shown by updateContactKey if it fails.
      console.error("Failed to update key with generated data.");
    }
  };

  // Handler for QRCodeActions to request a new key generation
  const handleGenerateKeyRequest = async (): Promise<string> => {
    const newKey = await generateContactKey();
    if (!newKey) {
      toast({
        title: "Key Generation Failed",
        description: "Could not generate a new key. Please try again.",
        variant: "destructive",
      });
      return ""; // Return empty string, QRCodeActions should handle this
    }
    return newKey; // Return the generated key for QRCodeActions to display
  };

  const handleUpdateImage = (image: string) => {
    updateContact(contact.id, { avatar: image });
  };

  const handleDeleteContact = () => {
    deleteContact(contact.id); // This will show its own "Contact Deleted" toast.
    // Now, also clear/delete associated messages
    clearHistory(contact.id); // This will show "Conversation Cleared" toast.
    // Since 'contact' prop is of type Contact, itemType is 'contact'.
    deleteMessagesFromSenderInGroups(contact.id); // This will show "Group Messages Cleaned" toast.
    onClose();
    // The multiple toasts from individual operations might be verbose but confirm actions.
    // Consider a single summary toast here if preferred, and reduce toasts in context functions.
  };

  const handleClearHistory = () => {
    clearHistory(contact.id);
    toast({
      title: "Chat History Cleared",
      description: "All messages have been deleted.",
    });
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={() => onClose()}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Contact Profile</DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <ContactImageUpload
              currentImage={contact.avatar}
              onImageCapture={handleUpdateImage}
            />

            <ContactNameEdit
              name={isNameEditing ? tempName : contact.name} // Show tempName if editing, else saved name
              isEditing={isNameEditing}
              onNameChange={setTempName} // Update tempName directly
              onSave={handleSaveName}
              onEditToggle={handleToggleNameEdit}
              onClear={() => setTempName("")} // Pass the clear handler
            />

            <div className="grid grid-cols-2 gap-4 bg-muted p-4 rounded-lg">
              <div>
                <div className="text-sm text-muted-foreground">Sent</div>
                <div className="text-2xl font-bold">{sentMessages}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Received</div>
                <div className="text-2xl font-bold">{receivedMessages}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Unread</div>
                <div className="text-2xl font-bold">{unreadMessages}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Last Active</div>
                <div className="text-sm">
                  {contact.lastActive
                    ? new Date(contact.lastActive).toLocaleDateString()
                    : "Never"}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <QRCodeActions
                onScanAccept={handleScanAccept}
                onGenerateKeyRequest={handleGenerateKeyRequest}
                onGeneratedKeyAccept={handleGeneratedKeyAccept}
                variant="stacked"
              />
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={handleClearHistory}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Clear Chat History
              </Button>
              <Button
                variant="destructive"
                className="w-full justify-start"
                onClick={handleDeleteContact}
              >
                <TrashIcon className="mr-2 h-4 w-4" />
                Delete Contact
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ContactProfile;
