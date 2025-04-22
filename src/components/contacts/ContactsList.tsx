import React from 'react';
import { Contact, useContacts } from '@/contexts/ContactsContext';
import { useMessages } from '@/contexts/MessagesContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { BadgeCheck } from 'lucide-react';

interface ContactsListProps {
  onAddContact: () => void;
  onContactSelect?: () => void;
}

const ContactsList = ({ onAddContact, onContactSelect }: ContactsListProps) => {
  const { contacts, activeContact, setActiveContact } = useContacts();
  const { messages } = useMessages();

  const handleContactClick = (contact: Contact) => {
    setActiveContact(contact);
    onContactSelect?.();
  };

  // Function to count unread messages for a contact
  const countUnread = (contactId: string): number => {
    const contactMessages = messages[contactId] || [];
    return contactMessages.filter(m => !m.sent && !m.read).length;
  };

  const getLastMessageTime = (contactId: string): string => {
    const contactMessages = messages[contactId] || [];
    if (contactMessages.length === 0) return '';

    // Get the most recent message
    const lastMessage = contactMessages.reduce((latest, current) => 
      new Date(current.timestamp) > new Date(latest.timestamp) ? current : latest
    );

    // Format the timestamp
    const date = new Date(lastMessage.timestamp);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      // Today - show time
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      // Yesterday
      return 'Yesterday';
    } else if (diffDays < 7) {
      // Within a week - show day of week
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      // Older - show date
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b">
        <Button onClick={onAddContact} className="w-full">
          Add New Contact
        </Button>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="space-y-1 p-2">
          {contacts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No contacts yet</p>
              <p className="text-sm">Add contacts to start chatting securely</p>
            </div>
          ) : (
            contacts.map((contact) => (
              <ContactItem 
                key={contact.id}
                contact={contact}
                isActive={activeContact?.id === contact.id}
                unreadCount={countUnread(contact.id)}
                lastMessageTime={getLastMessageTime(contact.id)}
                onClick={() => handleContactClick(contact)}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

interface ContactItemProps {
  contact: Contact;
  isActive: boolean;
  unreadCount: number;
  lastMessageTime: string;
  onClick: () => void;
}

const ContactItem = ({ contact, isActive, unreadCount, lastMessageTime, onClick }: ContactItemProps) => {
  return (
    <div 
      className={`flex items-center space-x-3 p-3 rounded-md cursor-pointer hover:bg-muted/50 transition-colors ${
        isActive ? 'bg-muted' : ''
      }`}
      onClick={onClick}
    >
      <Avatar className="h-10 w-10">
        <AvatarImage src={contact.avatar} alt={contact.name} />
        <AvatarFallback>{contact.name.substring(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center">
          <div className="font-medium truncate">{contact.name}</div>
          
          {lastMessageTime && (
            <div className="text-xs text-muted-foreground">
              {lastMessageTime}
            </div>
          )}
        </div>
        
        <div className="flex justify-between items-center">
          {unreadCount > 0 && (
            <div className="bg-primary text-primary-foreground text-xs rounded-full h-5 min-w-5 flex items-center justify-center px-1.5">
              {unreadCount}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ContactsList;
