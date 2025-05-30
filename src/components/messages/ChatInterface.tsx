import React, { useState, useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useContacts } from "@/contexts/ContactsContext";
import { useMessages, Message } from "@/contexts/MessagesContext";
import { Send, Fingerprint, Trash2, Users, User } from "lucide-react"; // Added Users, User
import { useIsMobile } from "@/hooks/use-mobile";
import MessageBubble from "./MessageBubble";
import ForwardMessageDialog from "./ForwardMessageDialog";
import ContactProfile from "../contacts/ContactProfile";
import GroupProfile from "../contacts/GroupProfile"; // Import GroupProfile
import AddGroupModal from "../contacts/AddGroupModal"; // Import AddGroupModal
import { Group } from "@/contexts/ContactsContext"; // Import Group type

interface InitialGroupData {
  groupName: string;
  contactId: string;
  groupId?: string;
}

const ChatInterface = () => {
  const { activeItem, setActiveItem } = useContacts(); // Added setActiveItem
  const {
    messages,
    sendMessage,
    markAsRead,
    clearHistory,
    moveContextualMessagesToGroup,
  } = useMessages();
  const [newMessage, setNewMessage] = useState("");
  const [isForwarding, setIsForwarding] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  // State for confirmation dialog
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null); // Ref for the input field
  const [showProfile, setShowProfile] = useState(false);
  const [isAddGroupModalOpen, setIsAddGroupModalOpen] = useState(false);
  const [initialGroupDataForModal, setInitialGroupDataForModal] =
    useState<InitialGroupData | null>(null);

  // Get messages for the active item (contact or group)
  const activeMessages = activeItem ? messages[activeItem.id] || [] : [];

  // Mark unread messages as read when active item changes
  useEffect(() => {
    if (activeItem) {
      activeMessages
        .filter((msg) => !msg.sent && !msg.read)
        .forEach((msg) => {
          markAsRead(activeItem.id, msg.id);
        });
    }
  }, [activeItem, activeMessages, markAsRead]);

  const scrollToBottom = () => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLDivElement>(
      '[data-radix-scroll-area-viewport]',
    );
    if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    }
  };

  // Scroll to bottom when messages change or active item changes
  useEffect(() => {
    // Delay scrolling slightly to allow the layout to stabilize
    const timerId = setTimeout(() => {
      scrollToBottom();
    }, 100); // A timeout of 0ms is often enough to push execution after paint

    return () => clearTimeout(timerId); // Cleanup timer on unmount or re-run
  }, [activeMessages, activeItem]); // Added activeItem to scroll when chat initially loads

  // Scroll to bottom on window resize
  useEffect(() => {
    window.addEventListener("resize", scrollToBottom);
    return () => {
      window.removeEventListener("resize", scrollToBottom);
    };
  }, []); // Empty dependency array means this effect runs once on mount and cleans up on unmount

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!activeItem || !newMessage.trim()) return;
    const success = await sendMessage(activeItem.id, newMessage);
    if (success) {
      setNewMessage(""); // Clear the controlled input state
      inputRef.current?.focus();
    }
  };

  const handleForwardMessage = (message: Message) => {
    setSelectedMessage(message);
    setIsForwarding(true);
  };

  const handleClearHistory = () => {
    if (activeItem) {
      clearHistory(activeItem.id);
      setIsClearConfirmOpen(false);
    }
  };

  const handleGroupContextClick = (
    groupName: string,
    contactId: string,
    groupId: string,
  ) => {
    setInitialGroupDataForModal({ groupName, contactId, groupId });
    setIsAddGroupModalOpen(true);
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
              {activeItem?.itemType === "group" ? (
                <Users className="h-5 w-5" />
              ) : (
                activeItem?.name?.substring(0, 2).toUpperCase()
              )}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="font-medium">{activeItem?.name}</div>
            {activeItem?.itemType === "group" && (
              <div className="text-xs text-muted-foreground">
                {(activeItem as Group).memberIds.length} member(s)
              </div>
            )}
          </div>
        </div>
        {/* Clear History Button and Dialog */}
        <AlertDialog
          open={isClearConfirmOpen}
          onOpenChange={setIsClearConfirmOpen}
        >
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-5 w-5" />
              <span className="sr-only">Clear Messages</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete all
                messages in this conversation from your device.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleClearHistory}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Clear Messages
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Scrollable Messages Area */}
      <ScrollArea ref={scrollAreaRef} className="flex-1">
        <div className="flex flex-col justify-end px-4 py-2">
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
                  onGroupContextClick={handleGroupContextClick}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Fixed Message Input */}
      <div className="p-4 border-t bg-background z-10 shrink-0">
        <form onSubmit={handleSendMessage} className="flex space-x-2">
          <Input
            ref={inputRef} // Assign the ref to the input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onFocus={scrollToBottom} // Use the new scrollToBottom function
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

      {activeItem && showProfile && activeItem.itemType === "contact" && (
        <ContactProfile
          contact={activeItem} // activeItem is a Contact here
          isOpen={showProfile}
          onClose={() => setShowProfile(false)}
        />
      )}
      {activeItem && showProfile && activeItem.itemType === "group" && (
        <GroupProfile
          group={activeItem as Group} // activeItem is a Group here
          isOpen={showProfile}
          onClose={() => setShowProfile(false)}
        />
      )}

      {isAddGroupModalOpen && (
        <AddGroupModal
          isOpen={isAddGroupModalOpen}
          onClose={async (createdGroup?: Group) => {
            if (
              createdGroup &&
              initialGroupDataForModal?.contactId &&
              initialGroupDataForModal?.groupName
            ) {
              await moveContextualMessagesToGroup(
                initialGroupDataForModal.contactId,
                createdGroup,
              );
              // Optionally, switch active chat to the new group
              setActiveItem(createdGroup);
            }
            setIsAddGroupModalOpen(false);
            setInitialGroupDataForModal(null); // Reset initial data
          }}
          initialGroupName={initialGroupDataForModal?.groupName}
          initialSelectedMemberIds={
            initialGroupDataForModal?.contactId
              ? [initialGroupDataForModal.contactId]
              : []
          }
          initialGroupId={initialGroupDataForModal?.groupId} // Pass groupId as initialGroupId
        />
      )}
    </div>
  );
};

export default ChatInterface;
