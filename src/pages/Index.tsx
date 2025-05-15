import React, { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { ContactsProvider } from "@/contexts/ContactsContext";
import { MessagesProvider } from "@/contexts/MessagesContext";
import { useContacts } from "@/contexts/ContactsContext";
import LoginForm from "@/components/auth/LoginForm";
import ContactsList from "@/components/contacts/ContactsList";
import ChatInterface from "@/components/messages/ChatInterface";
import AddContactModal from "@/components/contacts/AddContactModal";
import { Button } from "@/components/ui/button";
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
import { Fingerprint, Info, Bell, BellOff } from "lucide-react"; // Import Bell icons
import { useIsMobile } from "@/hooks/use-mobile";
import {
  requestNotificationPermissionAndSubscribe,
  unsubscribeFromNotifications,
} from "@/utils/notifications";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"; // Import Tooltip components

const IndexContent = () => {
  const appContainerRef = React.useRef<HTMLDivElement>(null);
  const { isAuthenticated, isLoading, logout, username } = useAuth();
  const { activeItem: activeContact, setActiveItem } = useContacts(); // Correctly destructure and get setActiveItem
  const [showAddContact, setShowAddContact] = useState(false);
  const [isAboutDialogOpen, setIsAboutDialogOpen] = useState(false);
  const isMobile = useIsMobile();
  const [showContacts, setShowContacts] = useState(true);
  const [notificationsSupported, setNotificationsSupported] = useState(false);
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermission>("default");
  const [notificationTooltipOpen, setNotificationTooltipOpen] = React.useState(false);

  // Check notification support and initial permission on mount
  useEffect(() => {
    const isSupported =
      "Notification" in window &&
      "PushManager" in window &&
      "serviceWorker" in navigator;
    setNotificationsSupported(isSupported);
    if (isSupported) {
      // Set the initial permission state based on the browser's current value
      console.log("isSupported", Notification.permission);
      setNotificationPermission(Notification.permission);
    }

    // Set the header height variable for mobile layout calculations
    if (isMobile) {
      const headerHeight = "4rem"; // Matches the header height
      document.documentElement.style.setProperty(
        "--header-height",
        headerHeight,
      );
      document.documentElement.style.setProperty("--input-height", "4rem"); // Set input height var
    }
  }, [isMobile]);

  // Manage showContacts state based on isMobile and activeContact
  useEffect(() => {
    if (!isMobile) {
      setShowContacts(true); // On desktop, always ensure showContacts state is true
    } else {
      // On mobile
      if (!activeContact) {
        setShowContacts(true); // If no active contact, show the list
      }
      // If a contact is active on mobile, onContactSelect handles setting showContacts to false.
    }
  }, [isMobile, activeContact]);

  // Effect to request notification permission on successful authentication
  useEffect(() => {
    const requestPermission = async () => {
      // Only proceed if authenticated, supported, AND permission state is currently 'default'
      if (
        isAuthenticated &&
        notificationsSupported &&
        notificationPermission === "default"
      ) {
        console.log(
          "User authenticated, permission is default, requesting notification permission...",
        );
        const currentPermission =
          await requestNotificationPermissionAndSubscribe();
        setNotificationPermission(currentPermission); // Update state with the result
      } else if (
        isAuthenticated &&
        notificationsSupported &&
        notificationPermission !== Notification.permission
      ) {
        // If authenticated and supported, but the state doesn't match the browser's current permission
        // (e.g., user changed it in settings), update the state.
        console.log(
          "Notification permission mismatch detected, updating state.",
        );
        setNotificationPermission(Notification.permission);
      }
    };
    requestPermission();
    // We don't need a cleanup here to unsubscribe on logout,
    // as the subscription should persist. We'll handle unsubscription
    // explicitly in the logout function if needed.
  }, [isAuthenticated, notificationsSupported, notificationPermission]); // Run when auth status, support, or permission state changes

  const handleLogout = () => {
    // Optional: Unsubscribe from push notifications on logout
    // unsubscribeFromNotifications(); // Uncomment if you want to remove subscription on logout
    logout();
  };

  if (isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <div className="animate-pulse">
            <Fingerprint className="h-16 w-16 mx-auto text-primary" />
          </div>
          <p className="text-lg">Initializing secure environment...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background p-4">
        <LoginForm />
      </div>
    );
  }

  const handleLogoClick = () => {
    if (isMobile) {
      setShowContacts(true);
    }
  };

  return (
    <div
      ref={appContainerRef}
      className="bg-background h-dvh w-full flex flex-col overflow-hidden" // Use fixed positioning and ensure full width
    >
      {/* Fixed Header */}
      <header className="bg-card p-4 border-b flex justify-between items-center shrink-0">
        <div
          className="flex items-center space-x-2 cursor-pointer"
          onClick={handleLogoClick}
        >
          <Fingerprint className="h-6 w-6 text-primary" />
          <h1 className="font-bold text-xl">CCred</h1>
        </div>

        <div className="flex items-center space-x-1 sm:space-x-2">
          {" "}
          {/* Adjusted spacing for smaller screens */}
          {/* Notification Status/Toggle Button */}
          {notificationsSupported && (
            <TooltipProvider delayDuration={0}>
              <Tooltip open={notificationTooltipOpen}>
                <TooltipTrigger asChild>
                  <div
                    onClick={() => { setNotificationTooltipOpen(!notificationTooltipOpen); }}
                    onTouchStart={() => { setNotificationTooltipOpen(!notificationTooltipOpen); }}
                    className="text-muted-foreground hover:text-primary h-8 w-8 flex items-center justify-center cursor-pointer" // Added flex properties and cursor
                  >
                    {notificationPermission === "granted" ? (
                      <Bell className="h-5 w-5" />
                    ) : (
                      <BellOff className="h-5 w-5" />
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {notificationPermission === "granted"
                    ? "Push notifications are enabled"
                    : notificationPermission === "denied"
                      ? "Notifications blocked (click to retry, may require browser settings change)"
                      : "Click to enable push notifications"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {/* About Dialog Trigger */}
          <Dialog open={isAboutDialogOpen} onOpenChange={setIsAboutDialogOpen}>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-primary h-8 w-8"
              >
                <Info className="h-5 w-5" />
                <span className="sr-only">About CCred Network</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>About CCred Network</DialogTitle>
                <DialogDescription>
                  Secure, end-to-end encrypted messaging.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4 text-sm">
                <p>
                  CCred Network provides a secure way to exchange messages using quantum-safe AES end-to-end encryption to protect your communications.
                </p>
                <h4 className="font-semibold mt-2">Security:</h4>
                <p>
                  Messages between you and a contact are encrypted using a unique secret key shared only between the two of you during the QR code exchange. This key never leaves your respective devices, ensuring that only you and your contact can decrypt the messages.
                </p>
                <h4 className="font-semibold mt-2">How to Use:</h4>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Add contacts by scanning their QR code or generating your own for them to scan.</li>
                  <li>Select a contact to start a conversation.</li>
                  <li>Messages are automatically encrypted and decrypted.</li>
                  <li>Use the trash icon in the chat header to clear the conversation history on your device.</li>
                  <li>Forward messages securely using the forward icon on a message bubble.</li>
                </ul>
                <h4 className="font-semibold mt-2">Understanding Groups:</h4>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Groups in CCred are tags you create to easily send the same message to multiple existing contacts at once.</li>
                  <li>When you send a message "via" a group name to a contact, they receive the message with that group name attached.</li>
                  <li>The recipient can then choose to create their own local group with that name. They can associate messages tagged with this group name to their local group.</li>
                  <li>It's up to each recipient to decide which of their own contacts (if any) to add to their version of the group. Group memberships are not automatically synchronized between users.</li>
                </ul>
                <h4 className="font-semibold mt-2">Enabling Notifications:</h4>
                <ul className="list-disc pl-5 space-y-1">
                  <li>
                    <strong>iOS (Safari):</strong>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Ensure notifications are enabled in your device settings: Go to Settings &gt; Safari &gt; Advanced &gt; Notifications (toggle ON).</li>
                      <li>Install CCred as a Progressive Web App (PWA): Tap the Share icon in Safari, then select "Add to Home Screen".</li>
                      <li>Open the app from your Home Screen and agree to the notification permission prompt when it appears.</li>
                    </ul>
                  </li>
                  <li>
                    <strong>Android (Chrome):</strong>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>When prompted by the app or browser, tap "Allow" to enable notifications.</li>
                      <li>If you initially denied permission, you can change this by going to Chrome Settings &gt; Site Settings &gt; Notifications, find CCred, and allow notifications.</li>
                      <li>You can also install CCred as a PWA by tapping the "Install" button in Chrome's menu or when prompted.</li>
                    </ul>
                  </li>
                  <li>
                    <strong>Desktop (Chrome on Windows/macOS/Linux):</strong>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Click the lock icon in the address bar next to the CCred URL.</li>
                      <li>Find "Notifications" in the dropdown and set it to "Allow".</li>
                      <li>You may need to refresh the page for changes to take effect.</li>
                    </ul>
                  </li>
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Remember: Keep your device secure. Lost access means lost messages.
                </p>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button">Close</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {/* End About Dialog */}
          <span className="text-sm text-muted-foreground">{username}</span>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            {" "}
            {/* Use handleLogout */}
            Logout
          </Button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {(!isMobile || (isMobile && showContacts)) && (
          <div
            className={`${isMobile ? "w-full" : "w-80"} border-r bg-card overflow-y-auto`}
          >
            <ContactsList
              onAddContact={() => setShowAddContact(true)}
              onItemSelect={(item) => {
                // Renamed prop and parameter
                // setActiveItem is now called within ContactsList's handleItemClick
                if (isMobile) {
                  setShowContacts(false);
                }
              }}
            />
          </div>
        )}

        {(!isMobile || (isMobile && !showContacts)) && (
          <div className="flex-1 overflow-hidden">
            <ChatInterface />
          </div>
        )}
      </div>

      <AddContactModal
        isOpen={showAddContact}
        onClose={() => setShowAddContact(false)}
      />
    </div>
  );
};

const Index = () => {
  return (
    <AuthProvider>
      <ContactsProvider>
        <MessagesProvider>
          <IndexContent />
        </MessagesProvider>
      </ContactsProvider>
    </AuthProvider>
  );
};

export default Index;
