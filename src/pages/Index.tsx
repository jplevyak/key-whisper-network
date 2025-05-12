import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { ContactsProvider } from '@/contexts/ContactsContext';
import { MessagesProvider } from '@/contexts/MessagesContext';
import { useContacts } from '@/contexts/ContactsContext';
import LoginForm from '@/components/auth/LoginForm';
import ContactsList from '@/components/contacts/ContactsList';
import ChatInterface from '@/components/messages/ChatInterface';
import AddContactModal from '@/components/contacts/AddContactModal';
import { Button } from '@/components/ui/button';
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
import { Fingerprint, Info, Bell, BellOff } from 'lucide-react'; // Import Bell icons
import { useIsMobile } from '@/hooks/use-mobile';
import { requestNotificationPermissionAndSubscribe, unsubscribeFromNotifications } from '@/utils/notifications';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"; // Import Tooltip components

const IndexContent = () => {
  const appContainerRef = React.useRef<HTMLDivElement>(null);
  const { isAuthenticated, isLoading, logout, username } = useAuth();
  const { activeItem: activeContact, setActiveItem } = useContacts(); // Correctly destructure and get setActiveItem
  const [showAddContact, setShowAddContact] = useState(false);
  const [isAboutDialogOpen, setIsAboutDialogOpen] = useState(false);
  const isMobile = useIsMobile();
  const [showContacts, setShowContacts] = useState(true);
  const [notificationsSupported, setNotificationsSupported] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');

  // Check notification support and initial permission on mount
  useEffect(() => {
    const isSupported = 'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator;
    setNotificationsSupported(isSupported);
    if (isSupported) {
      // Set the initial permission state based on the browser's current value
      console.log('isSupported', Notification.permission);
      setNotificationPermission(Notification.permission);
    }

    // Set the header height variable for mobile layout calculations
    if (isMobile) {
      const headerHeight = '4rem'; // Matches the header height
      document.documentElement.style.setProperty('--header-height', headerHeight);
      document.documentElement.style.setProperty('--input-height', '4rem'); // Set input height var
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
      if (isAuthenticated && notificationsSupported && notificationPermission === 'default') {
        console.log("User authenticated, permission is default, requesting notification permission...");
        const currentPermission = await requestNotificationPermissionAndSubscribe();
        setNotificationPermission(currentPermission); // Update state with the result
      } else if (isAuthenticated && notificationsSupported && notificationPermission !== Notification.permission) {
        // If authenticated and supported, but the state doesn't match the browser's current permission
        // (e.g., user changed it in settings), update the state.
        console.log("Notification permission mismatch detected, updating state.");
        setNotificationPermission(Notification.permission);
      }
    };
    requestPermission();
    // We don't need a cleanup here to unsubscribe on logout,
    // as the subscription should persist. We'll handle unsubscription
    // explicitly in the logout function if needed.
  }, [isAuthenticated, notificationsSupported, notificationPermission]); // Run when auth status, support, or permission state changes

  // Effect to manage app height, especially for mobile visual viewport
  useEffect(() => {
    console.log(`Height effect RUNNING. isMobile: ${isMobile}, isLoading: ${isLoading}, isAuthenticated: ${isAuthenticated}`);

    // If still loading or not authenticated, the ref's element might not exist yet.
    // The effect will run again when these states change.
    if (isLoading || !isAuthenticated) {
      console.log("Height effect: Still loading or not authenticated. Ref might not be available. Aborting listener setup for now.");
      return;
    }

    const appElement = appContainerRef.current; // Capture ref value

    if (!appElement) {
      // This case should ideally not be hit if isLoading is false and isAuthenticated is true,
      // as the div with the ref should be rendered.
      console.error("Height effect: appContainerRef.current is NULL even though component is loaded and authenticated. Listeners NOT added.");
      return; 
    }
    console.log("Height effect: appContainerRef.current is FOUND. Proceeding to define handler and add listeners.");

    const updateAppHeight = () => {
      console.log('updateAppHeight triggered'); 
      // Access current ref value inside handler, as appElement might be stale if the effect re-runs
      // and re-defines updateAppHeight, but an old listener is somehow still active.
      // However, with proper cleanup, appContainerRef.current should be equivalent to appElement here.
      const currentAppElement = appContainerRef.current; 
      if (currentAppElement) {
        if (isMobile && window.visualViewport) {
          currentAppElement.style.height = `${window.visualViewport.height}px`;
          console.log("Updated app height to visualViewport height:", window.visualViewport.height, "isMobile:", isMobile);
        } else {
          // Fallback for desktop or mobile without visualViewport support
          currentAppElement.style.height = `${window.innerHeight}px`;
          console.log("Updated app height to window.innerHeight:", window.innerHeight, "isMobile:", isMobile);
        }
      } else {
        console.log('updateAppHeight triggered, but appContainerRef.current is now null.');
      }
    };

    updateAppHeight(); // Set initial height

    console.log("Height effect: Adding 'resize' listener to window.");
    window.addEventListener('resize', updateAppHeight);
    console.log("Height effect: Adding 'orientationchange' listener to window.");
    window.addEventListener('orientationchange', updateAppHeight);

    let visualViewportListenerActuallyAttached = false;
    if (isMobile && window.visualViewport) {
      console.log("Height effect: Adding 'resize' listener to visualViewport.");
      window.visualViewport.addEventListener('resize', updateAppHeight);
      visualViewportListenerActuallyAttached = true;
    }

    // Cleanup function
    return () => {
      console.log(`Height effect CLEANUP. isMobile: ${isMobile}, isLoading: ${isLoading}, isAuthenticated: ${isAuthenticated} (values at time of cleanup setup)`);
      console.log("Height effect: Removing 'resize' listener from window.");
      window.removeEventListener('resize', updateAppHeight);
      console.log("Height effect: Removing 'orientationchange' listener from window.");
      window.removeEventListener('orientationchange', updateAppHeight);
      if (visualViewportListenerActuallyAttached && window.visualViewport) {
        console.log("Height effect: Removing 'resize' listener from visualViewport.");
        window.visualViewport?.removeEventListener('resize', updateAppHeight);
      } else if (visualViewportListenerActuallyAttached) {
        console.log("Height effect: visualViewport listener was attached, but visualViewport is now null during cleanup.");
      }
    };
  }, [isMobile, isLoading, isAuthenticated]); // Dependencies: re-run if isMobile, isLoading, or isAuthenticated changes

  const handleLogout = () => {
    // Optional: Unsubscribe from push notifications on logout
    // unsubscribeFromNotifications(); // Uncomment if you want to remove subscription on logout
    logout();
  };

  const handleNotificationIconClick = async () => {
    if (!notificationsSupported) return;

    console.log("Notification icon clicked, requesting permission...");
    const currentPermission = await requestNotificationPermissionAndSubscribe();
    setNotificationPermission(currentPermission);
    // Optionally show a toast message based on the result
    if (currentPermission === 'granted') {
        // toast({ title: "Notifications Enabled", description: "Push notifications are now active." });
    } else if (currentPermission === 'denied') {
        // toast({ title: "Notifications Blocked", description: "Please enable notifications in browser settings.", variant: "destructive" });
    }
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
      className="bg-background flex flex-col overflow-hidden"
      style={{ height: '100dvh' }} // Default height, JS will override dynamically
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

        <div className="flex items-center space-x-1 sm:space-x-2"> {/* Adjusted spacing for smaller screens */}
          {/* Notification Status/Toggle Button */}
          {notificationsSupported && (
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-primary h-8 w-8"
                    onClick={handleNotificationIconClick}
                    aria-label={
                      notificationPermission === 'granted'
                        ? 'Notifications enabled'
                        : 'Enable notifications'
                    }
                  >
                    {notificationPermission === 'granted' ? (
                      <Bell className="h-5 w-5" />
                    ) : (
                      <BellOff className="h-5 w-5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {notificationPermission === 'granted'
                    ? 'Push notifications are enabled'
                    : notificationPermission === 'denied'
                    ? 'Notifications blocked (click to retry, may require browser settings change)'
                    : 'Click to enable push notifications'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* About Dialog Trigger */}
          <Dialog open={isAboutDialogOpen} onOpenChange={setIsAboutDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-primary h-8 w-8">
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
                  CCred Network provides a secure way to exchange messages using end-to-end encryption.
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
          <Button variant="outline" size="sm" onClick={handleLogout}> {/* Use handleLogout */}
            Logout
          </Button>
        </div>
      </header>
      
      <div className="flex-1 flex overflow-hidden">
        {(!isMobile || (isMobile && showContacts)) && (
          <div className={`${isMobile ? 'w-full' : 'w-80'} border-r bg-card overflow-y-auto`}>
            <ContactsList 
              onAddContact={() => setShowAddContact(true)} 
              onItemSelect={(item) => { // Renamed prop and parameter
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
