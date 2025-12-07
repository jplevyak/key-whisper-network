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
import { secureStorage } from "@/utils/secureStorage"; // Import secureStorage
import { useMessages, Message } from "@/contexts/MessagesContext"; // Import Message type
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge"; // For displaying PRF status
import { Trash2 } from "lucide-react";

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const UserProfileModal = ({ isOpen, onClose }: UserProfileModalProps) => {
  const { username, supportsPasskeys, hasPasskey, deleteEverything, upgradeToPrf, isLoading } = useAuth();
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

  const handleConfirmDeleteEverything = async () => {
    await deleteEverything();
    onClose();
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
                {secureStorage.getIsUsingDerivedKey() ? (
                  <Badge variant="default" className="bg-green-600 hover:bg-green-700">
                    Passkey Enhanced
                  </Badge>
                ) : (
                  <Badge variant="secondary">Standard</Badge>
                )}
              </div>
              {secureStorage.getIsUsingDerivedKey() && (
                <p className="text-xs text-muted-foreground">
                  Your local database is encrypted with a key derived from your passkey&apos;s PRF extension.
                </p>
              )}
              {!secureStorage.getIsUsingDerivedKey() && (
                <>
                  <p className="text-xs text-muted-foreground">
                    Your local database is encrypted with a standard device-generated key.
                  </p>
                  {supportsPasskeys && hasPasskey && (
                    <div className="mt-3">
                      <Button
                        variant="default"
                        size="sm"
                        onClick={upgradeToPrf}
                        disabled={isLoading}
                        className="w-full sm:w-auto"
                      >
                        {isLoading ? "Upgrading..." : "Upgrade to Enhanced Security"}
                      </Button>
                      <p className="text-xs text-muted-foreground mt-1">
                        encrypt existing data with your passkey.
                      </p>
                    </div>
                  )}

                  {supportsPasskeys && !hasPasskey && ( // Check if passkeys (and thus potentially PRF) are supported by the browser
                    <div className="mt-1 text-xs text-amber-500 space-y-1">
                      <p>
                        <strong>Recommendation for Enhanced Security:</strong>
                      </p>
                      {navigator.userAgent.toLowerCase().includes("firefox") ? (
                        <p>
                          Firefox currently has limited support for the PRF extension needed for enhanced database security. For better protection, consider using a browser like Chrome, Edge, or Safari on supported platforms, or use a hardware security key.
                        </p>
                      ) : navigator.userAgent.toLowerCase().includes("win") ? (
                        <p>
                          To enable Passkey Enhanced database security on Windows, ensure you are using a compatible browser (like Chrome or Edge) and consider using a hardware security key (e.g., YubiKey) or Windows Hello if your device supports it with PRF.
                        </p>
                      ) : (
                        <p>
                          Your browser supports passkeys, but enhanced database security (PRF) might not be active. This could be due to the specific authenticator used (e.g., some built-in authenticators might not support PRF, or it wasn't enabled during passkey creation). Consider re-registering your passkey or using a hardware security key that supports the PRF extension.
                        </p>
                      )}
                    </div>
                  )}
                  {!supportsPasskeys && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Your browser does not support passkeys, which are required for enhanced database security.
                    </p>
                  )}
                </>
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
              {/* "Danger Zone" heading removed */}
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

            <div className="space-y-2 pt-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="w-full justify-start">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete Everything
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      DANGER: Are you absolutely sure?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This action is irreversible. This will permanently delete
                      ALL messages, ALL contacts, ALL groups, your user profile,
                      and your passkey from this device. The application will be reset.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleConfirmDeleteEverything}
                      className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                    >
                      Confirm Delete Everything
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <p className="text-xs text-muted-foreground">
                This will erase all application data from this browser, including your identity (passkey).
                You will need to register again to use the application.
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
