
import React, { useState } from 'react'; // Import useState
import { useContacts } from '@/contexts/ContactsContext';
import { useMessages } from '@/contexts/MessagesContext';
import { Contact } from '@/contexts/ContactsContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
// Import AlertDialog components
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
  // Added updateContactKey
  const { deleteContact, generateContactKey, updateContact, updateContactKey } = useContacts();
  const { messages, clearHistory } = useMessages();
  const { toast } = useToast();

  // State for confirmation dialog
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [confirmActionType, setConfirmActionType] = useState<'scan' | 'generate' | null>(null);
  const [pendingScanData, setPendingScanData] = useState<string | null>(null);


  const contactMessages = messages[contact.id] || [];
  const sentMessages = contactMessages.filter(m => m.sent).length;
  const receivedMessages = contactMessages.filter(m => !m.sent).length;
  const unreadMessages = contactMessages.filter(m => !m.sent && !m.read).length;

  const handleUpdateName = (newName: string) => {
    updateContact(contact.id, { name: newName });
    toast({
      title: 'Contact Updated',
      description: 'The contact name has been updated.',
    });
  };

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
            initialName={contact.name}
            onUpdateName={handleUpdateName}
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
              onGenerateKey={() => {
                 // Instead of immediate action, trigger confirmation
                setConfirmActionType('generate');
                setIsConfirmOpen(true);
                // Return a resolved promise as onGenerateKey expects a Promise<string>
                // The actual generation happens after confirmation.
                return Promise.resolve('');
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
            } else if (confirmActionType === 'generate') {
              try {
                const newKeyData = await generateContactKey(); // generateContactKey returns the exported key data string
                if (newKeyData) {
                  // Update the key in storage/memory using the generated data
                  const keyUpdateSuccess = await updateContactKey(contact.id, newKeyData);
                  if (keyUpdateSuccess) {
                    // Update the flag indicating the key was generated by the user
                    updateContact(contact.id, { userGeneratedKey: true });
                    toast({
                      title: 'New Key Generated',
                      description: 'A new encryption key has been generated and assigned.',
                    });
                  } else {
                    console.error("Failed to update key after generation.");
                  }
                } else {
                  throw new Error("Generated key data was empty.");
                }
              } catch (error) {
                 console.error("Failed to generate or update key:", error);
                 toast({
                   title: 'Key Generation Failed',
                   description: 'Could not generate or assign a new key.',
                   variant: 'destructive',
                 });
              });
            }

            // 3. Reset state
            setConfirmActionType(null);
            setPendingScanData(null);
            // No need to call setIsConfirmOpen(false) here, AlertDialogAction closes automatically
          }}>Confirm</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default ContactProfile;
