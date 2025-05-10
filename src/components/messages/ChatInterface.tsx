import React, { useState, useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { useContacts } from '@/contexts/ContactsContext';
import { useMessages, Message } from '@/contexts/MessagesContext';
import { Send, Fingerprint, Trash2, Users, User } from 'lucide-react'; // Added Users, User
import { useIsMobile } from '@/hooks/use-mobile';
import MessageBubble from './MessageBubble';
import ForwardMessageDialog from './ForwardMessageDialog';
import ContactProfile from '../contacts/ContactProfile';
import GroupProfile from '../contact/GroupProfile'; // Import GroupProfile
import { Group } from '@/contexts/ContactsContext'; // Import Group type

const ChatInterface = () => {
  const { activeItem } = useContacts(); 
  const { messages, sendMessage, markAsRead, clearHistory } = useMessages();
  const [newMessage, setNewMessage] = useState('');
  const [isForwarding, setIsForwarding] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  // State for confirmation dialog
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  // Removed About dialog state
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const [showProfile, setShowProfile] = useState(false); // This state will toggle visibility for both profile types
  
  // Get messages for the active item (contact or group)
  const activeMessages = activeItem ? messages[activeItem.id] || [] : [];
  
  // Mark unread messages as read when active item changes
  useEffect(() => {
    if (activeItem) {
      activeMessages
       .filter(msg => !msg.sent && !msg.read)
       .forEach(msg => {
         markAsRead(activeItem.id, msg.id);
       });
   }
 }, [activeItem, activeMessages, markAsRead]);


 // Scroll to bottom when messages change
 useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages]); // activeMessages dependency is correct
  
  // Effect to set viewport height for mobile devices
  useEffect(() => {
    const setVh = () => {
      // Set the value of --vh CSS variable to the actual viewport height
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    };
    
    // Set the initial value
    setVh();
    
    // Update on resize and orientation change
    window.addEventListener('resize', setVh);
    window.addEventListener('orientationchange', setVh);
    
    return () => {
      window.removeEventListener('resize', setVh);
      window.removeEventListener('orientationchange', setVh);
    };
  }, []);
  
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!activeItem || !newMessage.trim()) return; // Use activeItem
    
    const success = await sendMessage(activeItem.id, newMessage);
    if (success) {
      setNewMessage('');
    }
  };
  
  const handleForwardMessage = (message: Message) => {
    setSelectedMessage(message);
    setIsForwarding(true);
  };

  const handleClearHistory = () => {
    if (activeItem) { // Use activeItem
      clearHistory(activeItem.id);
      setIsClearConfirmOpen(false); // Close the dialog after clearing
    }
  };
  
  // If no active item, show empty state
  if (!activeItem) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8">
        <div className="p-4 rounded-full bg-muted">
          <Fingerprint className="h-12 w-12 text-muted-foreground" />
        </div>
        <h3 className="mt-6 text-xl font-semibold">Select a Chat</h3>
        <p className="mt-2 text-center text-muted-foreground">
          Choose a contact to start an end-to-end encrypted conversation
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Fixed Chat Header */}
      <div className="p-4 border-b flex items-center justify-between bg-muted/30 z-10 shrink-0">
        <div 
          className="flex items-center space-x-3 cursor-pointer hover:opacity-80 transition-opacity"
          onClick={() => activeItem && setShowProfile(true)} // Use activeItem
        >
          <Avatar className="h-10 w-10">
            <AvatarImage src={activeItem?.avatar} alt={activeItem?.name} />
            <AvatarFallback>
              {activeItem?.itemType === 'group' ? <Users className="h-5 w-5" /> : activeItem?.name?.substring(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="font-medium">{activeItem?.name}</div>
            {activeItem?.itemType === 'group' && (
              <div className="text-xs text-muted-foreground">
                {(activeItem as Group).memberIds.length} member(s)
              </div>
            )}
          </div>
        </div>
        {/* Clear History Button and Dialog */}
        <AlertDialog open={isClearConfirmOpen} onOpenChange={setIsClearConfirmOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive">
              <Trash2 className="h-5 w-5" />
              <span className="sr-only">Clear Messages</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete all messages
                in this conversation from your device.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleClearHistory} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Clear Messages
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      
      {/* Scrollable Messages Area */}
      <ScrollArea className="flex-1">
        <div className="min-h-full flex flex-col justify-end px-4 py-2">
          {activeMessages.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No messages yet</p>
              <p className="text-sm">Start your secure conversation</p>
            </div>
          ) : (
            <div className="space-y-4">
              {activeMessages.map((message) => (
                <MessageBubble 
                  key={message.id}
                  message={message}
                  onForward={handleForwardMessage}
                />
              ))}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>
      
      {/* Fixed Message Input */}
      <div className="p-4 border-t bg-background z-10 shrink-0">
        <form onSubmit={handleSendMessage} className="flex space-x-2">
          <Input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a secure message..."
            className="flex-1"
          />
          <Button type="submit" disabled={!newMessage.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
      
      {/* Dialogs */}
      {isForwarding && selectedMessage && (
        <ForwardMessageDialog
          message={selectedMessage}
          isOpen={isForwarding}
          onClose={() => {
            setIsForwarding(false);
            setSelectedMessage(null);
          }}
        />
      )}

      {activeItem && showProfile && activeItem.itemType === 'contact' && (
        <ContactProfile
          contact={activeItem} // activeItem is a Contact here
          isOpen={showProfile}
          onClose={() => setShowProfile(false)}
        />
      )}
      {activeItem && showProfile && activeItem.itemType === 'group' && (
        <GroupProfile
          group={activeItem as Group} // activeItem is a Group here
          isOpen={showProfile}
          onClose={() => setShowProfile(false)}
        />
      )}
    </div>
  );
};

export default ChatInterface;
