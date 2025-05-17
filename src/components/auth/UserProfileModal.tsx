import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useMessages, Message } from "@/contexts/MessagesContext"; // Import Message type
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge"; // For displaying PRF status
import { Trash2 } from "lucide-react";

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const UserProfileModal = ({ isOpen, onClose }: UserProfileModalProps) => {
  const { username, isUsingDerivedKey } = useAuth();
  const { messages: allMessagesData, deleteAllMessages } = useMessages();

  // Calculate aggregate message stats
  let totalSent = 0;
  let totalReceived = 0;
  let totalUnread = 0;

  Object.values(allMessagesData).forEach((messageList: Message[]) => {
    messageList.forEach((msg: Message) => {
      if (msg.sent) {
        totalSent++;
      } else {
        totalReceived++;
        if (!msg.read) {
          totalUnread++;
        }
      }
    });
  });

  const userAgent = navigator.userAgent;

  const handleConfirmDeleteAll = () => {
    deleteAllMessages();
    onClose(); // Close the profile modal after deletion
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>User Profile</DialogTitle>
          <DialogDescription>
            Information about your account and device.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] p-1"> {/* Added padding for scrollbar */}
          <div className="space-y-6 py-4 pr-4"> {/* Added pr-4 for scrollbar */}
            <div>
              <h3 className="text-lg font-semibold">{username}</h3>
            </div>

            <div className="space-y-2">
              <h4 className="font-medium text-sm text-muted-foreground">
                Device Information
              </h4>
              <p className="text-xs bg-muted p-2 rounded-md break-all">
                {userAgent}
              </p>
            </div>

            <div className="space-y-2">
              <h4 className="font-medium text-sm text-muted-foreground">
                Security Status
              </h4>
              <div className="flex items-center space-x-2">
                <p className="text-sm">Database Encryption:</p>
                {isUsingDerivedKey ? (
                  <Badge variant="default" className="bg-green-600 hover:bg-green-700">
                    Passkey Enhanced
                  </Badge>
                ) : (
                  <Badge variant="secondary">Standard</Badge>
                )}
              </div>
              {isUsingDerivedKey && (
                 <p className="text-xs text-muted-foreground">
                   Your local database is encrypted with a key derived from your passkey&apos;s PRF extension.
                 </p>
              )}
               {!isUsingDerivedKey && (
                 <p className="text-xs text-muted-foreground">
                   Your local database is encrypted with a standard device-generated key.
                 </p>
              )}
            </div>

            <div className="space-y-2">
              <h4 className="font-medium text-sm text-muted-foreground">
                Message Statistics (All Time)
              </h4>
              <div className="grid grid-cols-3 gap-4 bg-muted p-4 rounded-lg text-center">
                <div>
                  <div className="text-xs text-muted-foreground">Sent</div>
                  <div className="text-xl font-bold">{totalSent}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Received</div>
                  <div className="text-xl font-bold">{totalReceived}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Unread</div>
                  <div className="text-xl font-bold">{totalUnread}</div>
                </div>
              </div>
            </div>

            <div className="space-y-2 pt-4">
              <h4 className="font-medium text-sm text-destructive">
                Danger Zone
              </h4>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="w-full justify-start">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete All Messages
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Are you absolutely sure?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This action cannot be undone. This will permanently delete
                      ALL messages from ALL contacts and groups on this device.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleConfirmDeleteAll}
                      className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                    >
                      Confirm Delete All
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
               <p className="text-xs text-muted-foreground">
                  This will remove all message history from your local device.
                  It does not affect messages stored on your contacts&apos; devices.
                </p>
            </div>
          </div>
        </ScrollArea>
        <DialogFooter className="sm:justify-end">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default UserProfileModal;
