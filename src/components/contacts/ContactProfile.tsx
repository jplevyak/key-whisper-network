
import React, { useState } from 'react';
import { useContacts } from '@/contexts/ContactsContext';
import { useMessages } from '@/contexts/MessagesContext';
import { Contact } from '@/contexts/ContactsContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Trash2, QrCode, Pencil, Image, TrashIcon } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import QRCodeScanner from './QRCodeScanner';
import QRCodeGenerator from './QRCodeGenerator';

interface ContactProfileProps {
  contact: Contact;
  isOpen: boolean;
  onClose: () => void;
}

const ContactProfile = ({ contact, isOpen, onClose }: ContactProfileProps) => {
  const { deleteContact, generateContactKey, updateContact } = useContacts();
  const { messages, clearHistory } = useMessages();
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [newName, setNewName] = useState(contact.name);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [showQRGenerator, setShowQRGenerator] = useState(false);
  const [qrData, setQrData] = useState('');

  const contactMessages = messages[contact.id] || [];
  const sentMessages = contactMessages.filter(m => m.sent).length;
  const receivedMessages = contactMessages.filter(m => !m.sent).length;
  const unreadMessages = contactMessages.filter(m => !m.sent && !m.read).length;

  const handleUpdateName = async () => {
    if (newName.trim() === '') return;
    updateContact(contact.id, { name: newName.trim() });
    setIsEditing(false);
    toast({
      title: 'Contact Updated',
      description: 'The contact name has been updated.',
    });
  };

  const handleGenerateNewKey = async () => {
    const newKey = await generateContactKey();
    setQrData(newKey);
    setShowQRGenerator(true);
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
          {/* Profile Picture */}
          <div className="flex items-center space-x-4">
            <div className="relative">
              <img
                src={contact.avatar}
                alt={contact.name}
                className="w-20 h-20 rounded-full object-cover"
              />
              <Button
                size="icon"
                variant="ghost"
                className="absolute bottom-0 right-0"
                onClick={() => {/* Implement image update */}}
              >
                <Image className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label>Name</Label>
            {isEditing ? (
              <div className="flex space-x-2">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="flex-1"
                />
                <Button onClick={handleUpdateName}>Save</Button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-lg font-medium">{contact.name}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setIsEditing(true)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {/* Statistics */}
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

          {/* Actions */}
          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => setShowQRScanner(true)}
            >
              <QrCode className="mr-2 h-4 w-4" />
              Update Key via QR Code
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={handleGenerateNewKey}
            >
              <QrCode className="mr-2 h-4 w-4" />
              Generate New Key
            </Button>
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

      {/* QR Code Scanner Dialog */}
      {showQRScanner && (
        <Dialog open={showQRScanner} onOpenChange={() => setShowQRScanner(false)}>
          <DialogContent>
            <QRCodeScanner
              onScanSuccess={(keyData) => {
                // Implement key update logic
                setShowQRScanner(false);
              }}
              onClose={() => setShowQRScanner(false)}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* QR Code Generator Dialog */}
      {showQRGenerator && (
        <Dialog open={showQRGenerator} onOpenChange={() => setShowQRGenerator(false)}>
          <DialogContent>
            <QRCodeGenerator
              data={qrData}
              title="New Encryption Key"
              description="Scan this QR code to update the encryption key on another device"
              onClose={() => setShowQRGenerator(false)}
              onAccept={() => setShowQRGenerator(false)}
            />
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
};

export default ContactProfile;
