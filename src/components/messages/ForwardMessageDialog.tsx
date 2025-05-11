
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { CheckCircle } from 'lucide-react';
import { useContacts, Contact } from '@/contexts/ContactsContext';
import { Message, useMessages } from '@/contexts/MessagesContext';
import { useToast } from '@/components/ui/use-toast';

interface ForwardMessageDialogProps {
  message: Message;
  isOpen: boolean;
  onClose: () => void;
}

const ForwardMessageDialog = ({ message, isOpen, onClose }: ForwardMessageDialogProps) => {
  const { contacts } = useContacts();
  const { forwardMessage, getDecryptedContent } = useMessages();
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [forwardingInProgress, setForwardingInProgress] = useState(false);
  const { toast } = useToast();
  
  // Filter out the original contact
  const availableContacts = contacts.filter(contact => contact.id !== message.contactId);
  
  const handleForwardMessage = async () => {
    if (!selectedContact) return;
    
    setForwardingInProgress(true);
    
    try {
      const success = await forwardMessage(
        message.id, 
        message.contactId, 
        selectedContact.id
      );
      
      if (success) {
        toast({
          title: 'Message Forwarded',
          description: `Message forwarded to ${selectedContact.name}`,
        });
        onClose();
      } else {
        toast({
          title: 'Forwarding Failed',
          description: 'Could not forward the message',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Error forwarding message:', error);
      toast({
        title: 'Error',
        description: 'An error occurred while forwarding the message',
        variant: 'destructive',
      });
    }
    
    setForwardingInProgress(false);
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Forward Message</DialogTitle>
        </DialogHeader>
        
        <div className="py-4">
          <div className="text-sm text-muted-foreground mb-4">
            Select a contact to forward this message
          </div>
          
          <ScrollArea className="h-64">
            <div className="space-y-2">
              {availableContacts.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground">
                  No other contacts available
                </div>
              ) : (
                availableContacts.map((contact) => (
                  <div
                    key={contact.id}
                    className={`flex items-center space-x-3 p-3 rounded-md cursor-pointer transition-colors ${
                      selectedContact?.id === contact.id
                        ? 'bg-primary/10'
                        : 'hover:bg-muted/50'
                    }`}
                    onClick={() => setSelectedContact(contact)}
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={contact.avatar} alt={contact.name} />
                      <AvatarFallback>{contact.name.substring(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    
                    <div className="flex-1">
                      <div className="font-medium">{contact.name}</div>
                    </div>
                    
                    {selectedContact?.id === contact.id && (
                      <CheckCircle className="h-5 w-5 text-primary" />
                    )}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
          
          <div className="mt-4 p-3 bg-muted rounded-md">
            <div className="text-xs text-muted-foreground mb-1">Message to forward:</div>
            <ForwardPreview message={message} />
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button 
            onClick={handleForwardMessage} 
            disabled={!selectedContact || forwardingInProgress}
          >
            {forwardingInProgress ? 'Forwarding...' : 'Forward'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

interface ForwardPreviewProps {
  message: Message;
}

const ForwardPreview = ({ message }: ForwardPreviewProps) => {
  const { getDecryptedContent } = useMessages();
  const [decryptedContent, setDecryptedContent] = useState<string>('');
  
  React.useEffect(() => {
    const decrypt = async () => {
      const content = await getDecryptedContent(message).message;
      // Truncate long messages
      if (content.length > 100) {
        setDecryptedContent(content.substring(0, 100) + '...');
      } else {
        setDecryptedContent(content);
      }
    };
    
    decrypt();
  }, [message, getDecryptedContent]);
  
  return (
    <div className="text-sm font-medium">
      {decryptedContent || 'Decrypting...'}
    </div>
  );
};

export default ForwardMessageDialog;
