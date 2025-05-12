import React, { useState } from "react"; // Added useState
import {
  Contact,
  Group,
  ContactOrGroup,
  useContacts,
} from "@/contexts/ContactsContext"; // Updated imports
import { useMessages } from "@/contexts/MessagesContext";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Users, UserPlus } from "lucide-react"; // Added Users icon for groups
import AddGroupModal from "./AddGroupModal"; // Import the new modal

interface ContactsListProps {
  onAddContact: () => void;
  onItemSelect?: (item: ContactOrGroup) => void; // Renamed from onContactSelect and accepts ContactOrGroup
}

const ContactsList = ({ onAddContact, onItemSelect }: ContactsListProps) => {
  // Use onItemSelect
  const { listItems, activeItem, setActiveItem } = useContacts();
  const { messages } = useMessages();
  const [isAddGroupModalOpen, setIsAddGroupModalOpen] = useState(false);

  const handleItemClick = (item: ContactOrGroup) => {
    setActiveItem(item);
    // Call onItemSelect for any selected item (contact or group)
    // This allows the parent component (Index.tsx) to react, e.g., by hiding the list on mobile.
    onItemSelect?.(item);
  };

  // Function to count unread messages for a contact (groups don't have direct unread counts yet)
  const countUnread = (contactId: string): number => {
    const contactMessages = messages[contactId] || [];
    return contactMessages.filter((m) => !m.sent && !m.read).length;
  };

  // Get last message time for a contact (groups don't have this directly yet)
  const getLastMessageTime = (contactId: string): string => {
    const contactMessages = messages[contactId] || [];
    if (contactMessages.length === 0) return "";

    const lastMessage = contactMessages.reduce((latest, current) =>
      new Date(current.timestamp) > new Date(latest.timestamp)
        ? current
        : latest,
    );
    const date = new Date(lastMessage.timestamp);
    const now = new Date();
    const diffDays = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (diffDays === 0) {
      // Today - show time
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } else if (diffDays === 1) {
      // Yesterday
      return "Yesterday";
    } else if (diffDays < 7) {
      // Within a week - show day of week
      return date.toLocaleDateString([], { weekday: "short" });
    } else {
      // Older - show date
      return date.toLocaleDateString([], { month: "short", day: "numeric" });
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b space-y-2">
        <Button onClick={onAddContact} className="w-full">
          <UserPlus className="mr-2 h-4 w-4" /> Add New Contact
        </Button>
        <Button
          onClick={() => setIsAddGroupModalOpen(true)}
          className="w-full"
          variant="outline"
        >
          <Users className="mr-2 h-4 w-4" /> Add Group
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-1 p-2">
          {listItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No contacts or groups yet</p>
              <p className="text-sm">
                Add contacts or create groups to start chatting
              </p>
            </div>
          ) : (
            listItems.map((item) => (
              <ContactItem
                key={item.id}
                item={item}
                isActive={activeItem?.id === item.id}
                // For groups, unreadCount and lastMessageTime might be 0 or empty
                unreadCount={
                  item.itemType === "contact" ? countUnread(item.id) : 0
                }
                lastMessageTime={
                  item.itemType === "contact" ? getLastMessageTime(item.id) : ""
                }
                onClick={() => handleItemClick(item)}
              />
            ))
          )}
        </div>
      </ScrollArea>
      <AddGroupModal
        isOpen={isAddGroupModalOpen}
        onClose={() => setIsAddGroupModalOpen(false)}
      />
    </div>
  );
};

interface ContactItemProps {
  item: ContactOrGroup; // Changed to ContactOrGroup
  isActive: boolean;
  unreadCount: number; // Will be 0 for groups for now
  lastMessageTime: string; // Will be empty for groups for now
  onClick: () => void;
}

const ContactItem = ({
  item,
  isActive,
  unreadCount,
  lastMessageTime,
  onClick,
}: ContactItemProps) => {
  const isGroup = item.itemType === "group";

  return (
    <div
      className={`flex items-center space-x-3 p-3 rounded-md cursor-pointer hover:bg-muted/50 transition-colors ${
        isActive ? "bg-muted" : ""
      }`}
      onClick={onClick}
    >
      <Avatar className="h-10 w-10">
        <AvatarImage src={item.avatar} alt={item.name} />
        <AvatarFallback>
          {isGroup ? (
            <Users size={20} />
          ) : (
            item.name.substring(0, 2).toUpperCase()
          )}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center">
          <div className="font-medium truncate flex items-center">
            {item.name}
            {isGroup && (
              <Users className="ml-2 h-3 w-3 text-muted-foreground" />
            )}
          </div>

          {lastMessageTime &&
            !isGroup && ( // Only show for contacts
              <div className="text-xs text-muted-foreground">
                {lastMessageTime}
              </div>
            )}
        </div>

        <div className="flex justify-between items-center mt-1">
          {unreadCount > 0 &&
            !isGroup && ( // Only show for contacts
              <div className="bg-primary text-primary-foreground text-xs rounded-full h-5 min-w-5 flex items-center justify-center px-1.5">
                {unreadCount}
              </div>
            )}
          {/* Placeholder for group-specific info if any, or just empty space */}
          {isGroup && <div className="h-5"></div>}
        </div>
      </div>
    </div>
  );
};

export default ContactsList;
