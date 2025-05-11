import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Message, useMessages } from '@/contexts/MessagesContext';
import { useContacts, Contact } from '@/contexts/ContactsContext'; // Import Contact
import { formatDistanceToNow } from 'date-fns';
import { Check, MessageSquare, Users } from 'lucide-react'; // Added Users for group icon

interface MessageBubbleProps {
  message: Message;
  onForward: (message: Message) => void;
  onGroupContextClick?: (groupName: string, contactId: string, groupContextId?: string) => void;
}

const MessageBubble = ({ message, onForward, onGroupContextClick }: MessageBubbleProps) => {
  const { getDecryptedContent } = useMessages();
  const { listItems } = useContacts(); // Use listItems to find contacts
  const [decryptedContent, setDecryptedContent] = useState<string>('');
  const [decrypting, setDecrypting] = useState<boolean>(true);
  const [senderDisplayName, setSenderDisplayName] = useState<string | null>(null);

  // Decrypt the message content and determine sender display name
  useEffect(() => {
    const processMessage = async () => {
      setDecrypting(true);
      const decryptedData = await getDecryptedContent(message);
      setDecryptedContent(decryptedData ? decryptedData.message : '[Decryption Error]');
      setDecrypting(false);

      // Access original message prop for sender info, not the decrypted content object
      if (!message.sent && message.groupId && message.originalSenderId) { 
        const sender = listItems.find(item => item.id === message.originalSenderId && item.itemType === 'contact') as Contact | undefined;
        setSenderDisplayName(sender?.name || 'Unknown Sender');
      } else {
        setSenderDisplayName(null);
      }
    };
    
    processMessage();
  }, [message, getDecryptedContent, listItems]);
  
  // Format message timestamp
  const formattedTime = formatDistanceToNow(new Date(message.timestamp), { addSuffix: true });
  
  // Get forwarded info
  const forwardingInfo = message.forwarded && message.forwardedPath 
    ? message.forwardedPath.map(id => {
        const contact = listItems.find(c => c.id === id && c.itemType === 'contact') as Contact | undefined;
        return contact?.name;
      }).filter(Boolean)
    : [];
  
  // Check if message is sent or received
  const isSent = message.sent;

  const handleGroupContextNameClick = () => {
    if (onGroupContextClick && message.groupContextName && message.contactId) {
      onGroupContextClick(message.groupContextName, message.contactId, message.groupContextId);
    }
  };
  
  return (
    <div className={`flex ${isSent ? 'justify-end' : 'justify-start'}`}>
      <Card className={`max-w-[80%] p-3 shadow-sm ${
        isSent 
          ? 'bg-primary text-primary-foreground rounded-tr-none' 
          : 'bg-muted rounded-tl-none'
      }`}>
        {/* Display sender name for group messages received */}
        {!isSent && senderDisplayName && (
          <div className="text-xs font-semibold mb-1">
            {senderDisplayName}
          </div>
        )}

        {/* Display group context name if present and clickable */}
        {!isSent && message.groupContextName && (
          <div 
            className={`text-xs mb-1 italic ${onGroupContextClick ? 'cursor-pointer hover:underline text-blue-500' : (isSent ? 'text-primary-foreground/80' : 'text-muted-foreground')}`}
            onClick={onGroupContextClick ? handleGroupContextNameClick : undefined}
          >
            via <Users size={12} className="inline mr-1" /> {message.groupContextName}
          </div>
        )}

        {message.forwarded && forwardingInfo.length > 0 && (
          <div className={`text-xs mb-1 italic ${
            isSent ? 'text-primary-foreground/80' : 'text-muted-foreground'
          }`}>
            Forwarded from {forwardingInfo.join(' → ')}
          </div>
        )}
        
        <div className="whitespace-pre-wrap break-words">
          {decrypting ? (
            <div className="animate-pulse text-sm">Decrypting message...</div>
          ) : (
            decryptedContent
          )}
        </div>
        
        <div className="flex justify-between items-center gap-2 mt-2">
          <div className={`text-xs ${
            isSent ? 'text-primary-foreground/70' : 'text-muted-foreground'
          }`}>
            {formattedTime}
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className={`px-2 py-1 h-auto text-xs ${
                isSent 
                  ? 'hover:bg-primary-foreground/10 text-primary-foreground/90' 
                  : 'hover:bg-background/50 text-foreground/90'
              }`}
              onClick={() => onForward(message)}
            >
              Forward
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default MessageBubble;
