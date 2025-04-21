
import React from 'react';
import { useContacts } from '@/contexts/ContactsContext';
import { useMessages } from '@/contexts/MessagesContext';
import { Contact } from '@/contexts/ContactsContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
  const { deleteContact, generateContactKey, updateContact } = useContacts();
  const { messages, clearHistory } = useMessages();
  const { toast } = useToast();

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
  };

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
                // Implement key update logic
                toast({
                  title: 'Key Updated',
                  description: 'The encryption key has been updated successfully.',
                });
              }}
              onGenerateKey={generateContactKey}
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
  );
};

export default ContactProfile;
