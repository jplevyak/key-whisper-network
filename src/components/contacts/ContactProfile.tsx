
import React, { useState } from 'react';
import { useContacts } from '@/contexts/ContactsContext';
import { useMessages } from '@/contexts/MessagesContext';
import { Contact } from '@/contexts/ContactsContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import { Trash2, TrashIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import ContactImageUpload from './shared/ContactImageUpload';
import ContactNameEdit from './shared/ContactNameEdit';
import QRCodeActions from './shared/QRCodeActions';

interface ContactProfileProps {
  contact: Contact;
  isOpen: boolean;
  onClose: () => void;
}

const ContactProfile = ({ contact, isOpen, onClose }: ContactProfileProps) => {
  const { deleteContact, generateContactKey, updateContact, updateContactKey } = useContacts();
  const { messages, clearHistory } = useMessages();
  const { toast } = useToast();

  // State for confirmation dialog
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [confirmActionType, setConfirmActionType] = useState<'scan' | 'generate' | null>(null);
  const [pendingScanData, setPendingScanData] = useState<string | null>(null);
  const [pendingGeneratedKeyData, setPendingGeneratedKeyData] = useState<string | null>(null);

  // State for name editing
  const [isNameEditing, setIsNameEditing] = useState(false);
  const [tempName, setTempName] = useState(contact.name); // Initialize with current name

  // Reset tempName if contact changes or modal reopens
  React.useEffect(() => {
    setTempName(contact.name);
    setIsNameEditing(false); // Ensure editing is off when contact changes
  }, [contact.id, contact.name, isOpen]);


  const contactMessages = messages[contact.id] || [];
  const sentMessages = contactMessages.filter(m => m.sent).length;
  const receivedMessages = contactMessages.filter(m => !m.sent).length;
  const unreadMessages = contactMessages.filter(m => !m.sent && !m.read).length;

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
    if (trimmedName === '') {
      toast({
        title: 'Invalid Name',
        description: 'Contact name cannot be empty.',
        variant: 'destructive',
      });
      return; // Don't save empty name
    }
    if (trimmedName !== contact.name) {
      updateContact(contact.id, { name: trimmedName });
      toast({
        title: 'Contact Updated',
        description: 'The contact name has been updated.',
      });
    }
    setIsNameEditing(false); // Exit editing mode
  };
  // --- End Name Editing Handlers ---


  const handleUpdateImage = (image: string) => {
    updateContact(contact.id, { avatar: image });
  };

  const handleDeleteContact = () => {
    deleteContact(contact.id);
    onClose();
    toast({
      title: 'Contact Deleted',
      description: 'The contact has been removed from your list.',
    });
  };

  const handleClearHistory = () => {
    clearHistory(contact.id);
    toast({
      title: 'Chat History Cleared',
      description: 'All messages have been deleted.',
    });
 }

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
            onClear={() => setTempName('')} // Pass the clear handler
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
                {contact.lastActive ? new Date(contact.lastActive).toLocaleDateString() : 'Never'}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <QRCodeActions
              onScanSuccess={(keyData) => {
                // Instead of immediate action, trigger confirmation
                setPendingScanData(keyData);
                setConfirmActionType('scan');
                setIsConfirmOpen(true);
              }}
              onGenerateKey={async () => {
                // Generate the key immediately to be shown in QR code
                const newKey = await generateContactKey();
                if (!newKey) {
                  toast({
                    title: 'Key Generation Failed',
                    description: 'Could not generate a new key. Please try again.',
                    variant: 'destructive',
                  });
                  return ''; // Return empty string, QRCodeActions might handle this
                }
                setPendingGeneratedKeyData(newKey); // Store for use after confirmation
                setConfirmActionType('generate');
                setIsConfirmOpen(true);
                return newKey; // Return the generated key for QRCodeActions to display
              }}
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

    <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Change Encryption Key?</AlertDialogTitle>
          <AlertDialogDescription>
            Changing the encryption key will clear the existing chat history for this contact,
            as old messages will no longer be decryptable. This action cannot be undone.
            Are you sure you want to proceed?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => {
            setConfirmActionType(null);
            setPendingScanData(null);
            setPendingGeneratedKeyData(null); // Reset pending generated key
          }}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={async () => {
            // 1. Clear history first
            clearHistory(contact.id);
            toast({
              title: 'Chat History Cleared',
              description: 'Previous messages removed due to key change.',
              variant: 'destructive' // Use a more prominent variant
            });

            // 2. Perform the original action
            if (confirmActionType === 'scan' && pendingScanData) {
              const keyUpdateSuccess = await updateContactKey(contact.id, pendingScanData);
              if (keyUpdateSuccess) {
                // Update the flag indicating the key was provided by the contact
                updateContact(contact.id, { userGeneratedKey: false });
                toast({
                  title: 'Key Updated via Scan',
                  description: 'The encryption key has been updated.',
                });
              } else {
                // Toast for failure is handled within updateContactKey
                console.error("Failed to update key via scan.");
              }
            } else if (confirmActionType === 'generate' && pendingGeneratedKeyData) {
              try {
                // Key already generated and stored in pendingGeneratedKeyData
                const keyUpdateSuccess = await updateContactKey(contact.id, pendingGeneratedKeyData);
                if (keyUpdateSuccess) {
                  // Update the flag indicating the key was generated by the user
                  updateContact(contact.id, { userGeneratedKey: true });
                  toast({
                    title: 'Key Updated', // Changed from "New Key Generated" for consistency
                    description: 'The encryption key has been updated.',
                  });
                } else {
                  // Failure toast might be handled by updateContactKey or needs to be explicit here
                  console.error("Failed to update key with pre-generated data.");
                  toast({
                    title: 'Key Update Failed',
                    description: 'Could not assign the new key after generation.',
                    variant: 'destructive',
                  });
                }
              } catch (error) {
                 console.error("Failed to update key with pre-generated data:", error);
                 toast({
                   title: 'Key Update Error',
                   description: 'An error occurred while assigning the new key.',
                   variant: 'destructive',
                 });
              }
            }

            // 3. Reset state
            setConfirmActionType(null);
            setPendingScanData(null);
            setPendingGeneratedKeyData(null); // Reset pending generated key
            // No need to call setIsConfirmOpen(false) here, AlertDialogAction closes automatically
          }}>Confirm</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
};

export default ContactProfile;
