import React, { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Message, useMessages } from "@/contexts/MessagesContext";
import { useContacts, Contact } from "@/contexts/ContactsContext";
import { formatDistanceToNow } from "date-fns";
import { Check, MessageSquare, Users, Key, UserPlus, ArrowRight } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

interface MessageBubbleProps {
  message: Message;
  onForward: (message: Message) => void;
  onGroupContextClick?: (
    groupName: string,
    contactId: string,
    groupId: string,
  ) => void;
}

const MessageBubble = ({
  message,
  onForward,
  onGroupContextClick,
}: MessageBubbleProps) => {
  const {
    messages,
    getDecryptedContent,
    reEncryptMessagesForKeyChange,
    forwardMessage,
    sendMessage,
    stripAttachedKey,
    stripFileKey,
  } = useMessages();
  const { listItems, updateContactKey, getContactKey, addContact, updateContact, setActiveItem } = useContacts();
  const [decryptedContent, setDecryptedContent] = useState<string>("");
  const [introductionKeyData, setIntroductionKeyData] = useState<string | null>(null);
  const [decrypting, setDecrypting] = useState<boolean>(true);
  const [senderDisplayName, setSenderDisplayName] = useState<string | null>(
    null,
  );
  const { toast } = useToast();
  const [fileTransferData, setFileTransferData] = useState<any>(null); // Type should be inferred or imported
  const [isImporting, setIsImporting] = useState(false);
  const importInputRef = React.useRef<HTMLInputElement>(null);

  // Decrypt the message content and determine sender display name
  useEffect(() => {
    let isMounted = true; // Added for cleanup
    const processMessage = async () => {
      setDecrypting(true);
      const decryptedData = await getDecryptedContent(message);

      if (isMounted && decryptedData) { // Check isMounted
        setDecryptedContent(decryptedData.message);
        setIntroductionKeyData(decryptedData.introductionKey || null);
        setFileTransferData(decryptedData.fileTransfer || null);

      } else {
        setDecryptedContent("[Decryption Error]");
      }
      setDecrypting(false);

      // Access original message prop for sender info, not the decrypted content object
      if (!message.sent && message.groupId && message.originalSenderId) {
        const sender = listItems.find(
          (item) =>
            item.id === message.originalSenderId && item.itemType === "contact",
        ) as Contact | undefined;
        setSenderDisplayName(sender?.name || "Unknown Sender");
      } else {
        setSenderDisplayName(null);
      }
    };

    processMessage();
  }, [message, getDecryptedContent, listItems]);

  // Format message timestamp
  const formattedTime = formatDistanceToNow(new Date(message.timestamp), {
    addSuffix: true,
  });

  // Get forwarded info
  const forwardingInfo =
    message.forwarded && message.forwardedPath
      ? message.forwardedPath
        .map((id) => {
          const contact = listItems.find(
            (c) => c.id === id && c.itemType === "contact",
          ) as Contact | undefined;
          return contact?.name;
        })
        .filter(Boolean)
      : [];

  // Check if message is sent or received
  const isSent = message.sent;

  const handleGroupContextNameClick = () => {
    if (onGroupContextClick && message.groupContextName && message.contactId) {
      onGroupContextClick(
        message.groupContextName,
        message.contactId,
        message.groupContextId,
      );
    }
  };


  const handleAddContactFromIntroduction = async () => {
    if (!introductionKeyData) return;
    const name = window.prompt("Enter name for new contact:", "New Contact");
    if (name) {
      const result = await addContact(name, "", introductionKeyData, false); // false = user didn't generate key (it was imported)
      if (result) {
        if (message.contactId) {
          await stripAttachedKey(message.id, message.contactId);
        }
        setIntroductionKeyData(null); // Clear local state immediately
        toast({ title: "Contact Added", description: `${name} has been added to your contacts.` });
      }
    }
  };

  const handleDecryptFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !fileTransferData) return;

    setIsImporting(true);
    try {
      const { decryptSharedFile } = await import("@/services/fileTransferService");
      const { importKey } = await import("@/utils/encryption");

      let key: CryptoKey | null = null;

      // 1. Check for attached key (New Flow)
      if (fileTransferData.key) {
        key = await importKey(fileTransferData.key);
      } else {
        // 2. Fallback to shared contact key (Legacy)
        if (message.sent) {
          if (message.groupId) {
            // Best effort for legacy group messages
            // key = await getContactKey(message.groupId); // Not accessible here easily?
          } else {
            key = await getContactKey(message.contactId);
          }
        } else {
          if (message.groupId && message.originalSenderId) {
            key = await getContactKey(message.originalSenderId);
          } else if (message.contactId) {
            key = await getContactKey(message.contactId);
          }
        }
      }

      if (!key) throw new Error("Could not retrieve decryption key.");

      const decryptedFile = await decryptSharedFile(file, key, fileTransferData);

      const url = URL.createObjectURL(decryptedFile);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileTransferData.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "File Decrypted", description: "File saved to your downloads. Key deleted." });

      // Delete the key after successful decryption
      if (message.contactId) {
        await stripFileKey(message.id, message.contactId);
      }

    } catch (error: any) {
      console.error("Import error:", error);
      toast({ title: "Decryption Failed", description: "Could not decrypt file. Ensure you selected the correct .ccred file.", variant: "destructive" });
    } finally {
      setIsImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  return (
    <div className={`flex ${isSent ? "justify-end" : "justify-start"}`}>
      <input type="file" ref={importInputRef} style={{ display: 'none' }} onChange={handleDecryptFile} accept=".ccred,.txt,application/octet-stream" />
      <Card
        className={`max-w-[80%] p-3 shadow-sm ${isSent
          ? "bg-primary text-primary-foreground rounded-tr-none"
          : "bg-muted rounded-tl-none"
          }`}
      >
        {/* Display sender name for group messages received */}
        {!isSent && senderDisplayName && (
          <div className="text-xs font-semibold mb-1">{senderDisplayName}</div>
        )}

        {/* Display group context name if present and clickable */}
        {!isSent && message.groupContextName && (
          <div
            className={`text-xs mb-1 italic ${onGroupContextClick ? "cursor-pointer hover:underline text-blue-500" : isSent ? "text-primary-foreground/80" : "text-muted-foreground"}`}
            onClick={
              onGroupContextClick ? handleGroupContextNameClick : undefined
            }
          >
            via <Users size={12} className="inline mr-1" />{" "}
            {message.groupContextName}
          </div>
        )}

        {message.forwarded && forwardingInfo.length > 0 && (
          <div
            className={`text-xs mb-1 italic ${isSent ? "text-primary-foreground/80" : "text-muted-foreground"
              }`}
          >
            Forwarded from {forwardingInfo.join(" → ")}
          </div>
        )}

        <div className="whitespace-pre-wrap break-words">
          {decrypting ? (
            <div className="animate-pulse text-sm">Decrypting message...</div>
          ) : (
            <div className="space-y-2">
              {/* Introduction Key UI */}
              {introductionKeyData && (
                <div className="bg-blue-500/10 border border-blue-500/20 p-2 rounded text-xs flex flex-col gap-2">
                  <div className="flex items-center font-semibold text-blue-600">
                    <UserPlus className="w-3 h-3 mr-1" /> New Contact Attached
                  </div>
                  {!message.sent && (
                    <Button size="sm" variant="outline" className="h-6 text-xs" onClick={handleAddContactFromIntroduction}>
                      Add Contact
                    </Button>
                  )}
                  {message.sent && <span className="text-muted-foreground italic">You attached a contact.</span>}
                </div>
              )}

              {/* File Transfer UI */}
              {fileTransferData && (
                <div className="bg-secondary/50 border border-border p-3 rounded text-sm flex flex-col gap-2">
                  <div className="font-semibold flex items-center gap-2">
                    {/* File Icon */}
                    <span>📄</span>
                    <span className="truncate max-w-[200px]">{fileTransferData.filename}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Size: {(fileTransferData.size / 1024).toFixed(1)} KB
                  </div>

                  {!message.sent && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full mt-1"
                      onClick={() => importInputRef.current?.click()}
                      disabled={isImporting}
                    >
                      {isImporting ? "Decrypting..." : "Decrypt File"}
                    </Button>
                  )}
                  {message.sent && (
                    <div className="text-xs italic opacity-70">
                      Sent secure file metadata.
                    </div>
                  )}
                </div>
              )}

              <div>{decryptedContent}</div>
            </div>
          )}
        </div>

        <div className="flex justify-between items-center gap-2 mt-2">
          <div
            className={`text-xs ${isSent ? "text-primary-foreground/70" : "text-muted-foreground"
              }`}
          >
            {isSent && message.pending && (
              <span className="italic mr-1">Pending...</span>
            )}
            {formattedTime}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className={`px-2 py-1 h-auto text-xs ${isSent
                ? "hover:bg-primary-foreground/10 text-primary-foreground/90"
                : "hover:bg-background/50 text-foreground/90"
                }`}
              onClick={() => onForward(message)}
            >
              Forward
            </Button>
          </div>
        </div>
      </Card >
    </div >
  );
};

export default MessageBubble;
