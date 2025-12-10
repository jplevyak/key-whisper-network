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
import { useToast } from "@/components/ui/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useContacts } from "@/contexts/ContactsContext";
import { useMessages, Message } from "@/contexts/MessagesContext";
import { Send, Fingerprint, Trash2, Users, User, Plus, Key, UserPlus } from "lucide-react"; // Added imports
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
  const {
    generateContactKey,
    addContact,
    updateContactKey,
    getContactKey,
    updateContact,
    activeItem,
    setActiveItem
  } = useContacts(); // Consolidated useContacts
  const {
    messages,
    sendMessage,
    markAsRead,
    clearHistory,
    moveContextualMessagesToGroup,
    reEncryptMessagesForKeyChange,
    stripAttachedKey, // Added
  } = useMessages();
  const [newMessage, setNewMessage] = useState("");
  const [isForwarding, setIsForwarding] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  // State for confirmation dialog
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [isAddGroupModalOpen, setIsAddGroupModalOpen] = useState(false);
  const [initialGroupDataForModal, setInitialGroupDataForModal] =
    useState<InitialGroupData | null>(null);
  const [attachedContactKey, setAttachedContactKey] = useState<string | null>(null);
  const [pendingAttachmentKey, setPendingAttachmentKey] = useState<string | null>(null);
  const [isAddContactModalOpen, setIsAddContactModalOpen] = useState(false);
  const { toast } = useToast();
  // File Sharing Logic
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  // useIsMobile is already imported and likely used elsewhere or can be used here.
  // const { isIsMobile } = useIsMobile(); // Removed redundant/incorrect usage if not needed globally or fixed.

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !activeItem) return;

    const key = await getContactKey(activeItem.id);
    if (!key) {
      toast({ title: "Error", description: "Encryption key not found.", variant: "destructive" });
      return;
    }

    setIsProcessingFile(true);
    try {
      // Dynamic import to avoid circular dependencies
      const { encryptFileForShare } = await import("@/services/fileTransferService");

      const { maskedFile, metadata } = await encryptFileForShare(file, key);

      // Web Share API
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [maskedFile] })) {
        await navigator.share({
          files: [maskedFile],
          title: "Secure File Share",
          text: "Sharing encrypted file via CCred"
        });

        const success = await sendMessage(activeItem.id, "Sent a secure file.", {
          fileTransfer: metadata
        });

        if (success) {
          toast({ title: "File Shared", description: "Secure file metadata sent." });
        }
      } else {
        toast({ title: "Sharing Not Supported", description: "Your browser does not support native file sharing.", variant: "destructive" });

        // Fallback download
        const url = URL.createObjectURL(maskedFile);
        const a = document.createElement('a');
        a.href = url;
        a.download = maskedFile.name;
        a.click();
        URL.revokeObjectURL(url);

        await sendMessage(activeItem.id, "Sent a secure file (manual share).", {
          fileTransfer: metadata
        });
      }

    } catch (error) {
      console.error("File share error:", error);
      toast({ title: "Error", description: "Failed to encrypt or share file.", variant: "destructive" });
    } finally {
      setIsProcessingFile(false);
      // Reset input
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };


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

  const handleSendMessage = async () => {
    if ((!newMessage.trim() && !isForwarding && !attachedContactKey) || !activeItem) return;

    if (isForwarding && selectedMessage) {
      // Forwarding logic here if needed, or delegated to dialog
    }

    const options: { introductionKey?: string } = {};
    if (attachedContactKey) {
      options.introductionKey = attachedContactKey;
    }

    const success = await sendMessage(activeItem.id, newMessage, options);

    if (success) {
      setNewMessage("");

      if (attachedContactKey) {
        // Provide UX to save this contact
        setPendingAttachmentKey(attachedContactKey);
        setAttachedContactKey(null);
        setIsAddContactModalOpen(true);
      }
    }
  };

  const handleForwardMessage = (message: Message) => {
    // If message has attached key, we verify if user wants to forward it?
    // Requirement: "Forward the message with the key attached".
    // Standard forward does this.
    // Requirement: "key should not be persisted... after they have forwarded".
    // So we need to strip it AFTER the forward completes.

    // We can pass a callback to ForwardMessageDialog?
    // Or just listen for the success of forwarding?
    // `ForwardMessageDialog` is a UI component. It calls `forwardMessage`.
    // Let's pass a `onSuccess` prop to it?
    setSelectedMessage(message);
    setIsForwarding(true);
  };

  // Note: ForwardMessageDialog needs to accept onForwardSuccess to trigger strip attached key.
  // I need to modify ForwardMessageDialog.tsx.
  // Or handle it here if I control the call?
  // `ForwardMessageDialog` likely calls `forwardMessage` internally.
  // I will check ForwardMessageDialog.tsx next tool call.  };

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
      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      <div className="p-4 border-b flex items-center justify-between bg-muted/30 z-10 shrink-0">
        <div
          className="flex items-center space-x-3 cursor-pointer hover:opacity-80 transition-opacity"
          onClick={() => activeItem && setShowProfile(true)}
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
        <div className="flex flex-col space-y-2">
          <div className="flex space-x-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="shrink-0" disabled={isProcessingFile}>
                  {isProcessingFile ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" /> : <Plus className="h-5 w-5" />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Chat Actions</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                  <UserPlus className="mr-2 h-4 w-4" /> {/* Reuse Icon or import FileIcon */}
                  Share File (Native)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={async () => {
                  // Attach New Contact Flow
                  const key = await generateContactKey();
                  if (key) {
                    setAttachedContactKey(key);
                    toast({ title: "New Contact Key Attached", description: "This key will be sent with your next message." });
                  }
                }}>
                  <Key className="mr-2 h-4 w-4" />
                  Attach New Contact
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsClearConfirmOpen(true)}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Clear History
                </DropdownMenuItem>
                {activeItem?.itemType === 'group' && (
                  <DropdownMenuItem onClick={() => setShowProfile(true)}>
                    <Users className="mr-2 h-4 w-4" />
                    Group Info
                  </DropdownMenuItem>
                )}
                {activeItem?.itemType === 'contact' && (
                  <DropdownMenuItem onClick={() => setShowProfile(true)}>
                    <User className="mr-2 h-4 w-4" />
                    Verfied Profile
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Input
              placeholder={isProcessingFile ? "Encrypting file..." : (attachedContactKey ? "Message with attached contact..." : "Type a message...")}
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              disabled={isProcessingFile}
              className="flex-1"
            />
            <Button onClick={handleSendMessage} size="icon" disabled={isProcessingFile}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
          {attachedContactKey && (
            <div className="flex items-center gap-2 mt-2 bg-secondary/30 p-2 rounded text-xs">
              <Key className="h-3 w-3" />
              <span>New Contact Key Attached</span>
              <Button variant="ghost" size="icon" className="h-4 w-4 ml-auto" onClick={() => setAttachedContactKey(null)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>

        <Dialog open={isAddContactModalOpen} onOpenChange={setIsAddContactModalOpen}>
          {/* ... existing dialog content ... */}
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Contact</DialogTitle>
              <DialogDescription>
                You have attached a new contact key. Please give this contact a name.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label>Name</label>
                <Input id="new-contact-name" placeholder="Contact Name" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddContactModalOpen(false)}>Cancel</Button>
              <Button onClick={async () => {
                const nameInput = document.getElementById("new-contact-name") as HTMLInputElement;
                const name = nameInput.value;
                if (name && pendingAttachmentKey) {
                  await addContact(name, "", pendingAttachmentKey, true);
                  toast({ title: "Contact Created", description: `Added ${name} to your contacts.` });
                  setIsAddContactModalOpen(false);
                  setPendingAttachmentKey(null);
                }
              }}>Add Contact</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
          onForwardSuccess={async () => {
            if (selectedMessage && selectedMessage.hasAttachedKey) {
              await stripAttachedKey(selectedMessage.id, selectedMessage.contactId);
            }
          }}
        />
      )}

      {activeItem && showProfile && activeItem.itemType === "contact" && (
        <ContactProfile
          contact={activeItem}
          isOpen={showProfile}
          onClose={() => setShowProfile(false)}
        />
      )}
      {activeItem && showProfile && activeItem.itemType === "group" && (
        <GroupProfile
          group={activeItem as Group}
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
              setActiveItem(createdGroup);
            }
            setIsAddGroupModalOpen(false);
            setInitialGroupDataForModal(null);
          }}
          initialGroupName={initialGroupDataForModal?.groupName}
          initialSelectedMemberIds={
            initialGroupDataForModal?.contactId
              ? [initialGroupDataForModal.contactId]
              : []
          }
          initialGroupId={initialGroupDataForModal?.groupId}
        />
      )}
    </div>
  );
};

export default ChatInterface;
