import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Message, useMessages } from '@/contexts/MessagesContext';
import { useContacts } from '@/contexts/ContactsContext';
import { formatDistanceToNow } from 'date-fns';
import { Check, MessageSquare } from 'lucide-react';

interface MessageBubbleProps {
  message: Message;
  onForward: (message: Message) => void;
}

const MessageBubble = ({ message, onForward }: MessageBubbleProps) => {
  const { getDecryptedContent } = useMessages();
  const { contacts } = useContacts();
  const [decryptedContent, setDecryptedContent] = useState<string>('');
  const [decrypting, setDecrypting] = useState<boolean>(true);
  
  // Decrypt the message content when the component mounts
  useEffect(() => {
    const decrypt = async () => {
      setDecrypting(true);
      const content = await getDecryptedContent(message);
      setDecryptedContent(content);
      setDecrypting(false);
    };
    
    decrypt();
  }, [message, getDecryptedContent]);
  
  // Format message timestamp
  const formattedTime = formatDistanceToNow(new Date(message.timestamp), { addSuffix: true });
  
  // Get forwarded info
  const forwardingInfo = message.forwarded && message.forwardedPath 
    ? message.forwardedPath.map(id => contacts.find(c => c.id === id)?.name).filter(Boolean)
    : [];
  
  // Check if message is sent or received
  const isSent = message.sent;
  
  return (
    <div className={`flex ${isSent ? 'justify-end' : 'justify-start'}`}>
      <Card className={`max-w-[80%] p-3 shadow-sm ${
        isSent 
          ? 'bg-primary text-primary-foreground rounded-tr-none' 
          : 'bg-muted rounded-tl-none'
      }`}>
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
            {isSent && (
              <div className={`text-xs flex items-center gap-1 ${
                isSent ? 'text-primary-foreground/70' : 'text-muted-foreground'
              }`}>
                {message.read ? (
                  <div className="flex items-center">
                    <MessageSquare className="h-3 w-3 mr-0.5" />
                    <Check className="h-2.5 w-2.5 -ml-1.5" />
                  </div>
                ) : (
                  <MessageSquare className="h-3 w-3" />
                )}
                <span>{message.read ? 'Read' : 'Sent'}</span>
              </div>
            )}
            
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
