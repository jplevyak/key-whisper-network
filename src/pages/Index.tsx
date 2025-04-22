
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
import { Fingerprint } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

const IndexContent = () => {
  const { isAuthenticated, isLoading, logout, username } = useAuth();
  const { activeContact } = useContacts();
  const [showAddContact, setShowAddContact] = useState(false);
  const isMobile = useIsMobile();
  const [showContacts, setShowContacts] = useState(true);

  // Set the header height variable for mobile layout calculations
  useEffect(() => {
    if (isMobile) {
      const headerHeight = '4rem'; // Matches the header height
      document.documentElement.style.setProperty('--header-height', headerHeight);
      document.documentElement.style.setProperty('--input-height', '4rem'); // Set input height var
    }
  }, [isMobile]);

  // Show contacts list when active contact is cleared on mobile
  useEffect(() => {
    if (isMobile && !activeContact) {
      setShowContacts(true);
    }
  }, [isMobile, activeContact]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
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
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
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
    <div className="min-h-screen bg-background flex flex-col h-screen overflow-hidden">
      {/* Fixed Header */}
      <header className="bg-card p-4 border-b flex justify-between items-center shrink-0">
        <div 
          className="flex items-center space-x-2 cursor-pointer" 
          onClick={handleLogoClick}
        >
          <Fingerprint className="h-6 w-6 text-primary" />
          <h1 className="font-bold text-xl">CCred</h1>
        </div>
        
        <div className="flex items-center space-x-2">
          <span className="text-sm text-muted-foreground">{username}</span>
          <Button variant="outline" size="sm" onClick={logout}>
            Logout
          </Button>
        </div>
      </header>
      
      {/* Main content - with contacts sidebar and chat interface */}
      <div className="flex-1 flex overflow-hidden">
        {/* Contacts sidebar - hidden on mobile when chat is active */}
        {(!isMobile || (isMobile && showContacts)) && (
          <div className={`${isMobile ? 'w-full' : 'w-80'} border-r bg-card overflow-y-auto`}>
            <ContactsList 
              onAddContact={() => setShowAddContact(true)} 
              onContactSelect={() => isMobile && setShowContacts(false)}
            />
          </div>
        )}
        
        {/* Chat area - full width on mobile when active */}
        {(!isMobile || (isMobile && !showContacts)) && (
          <div className="flex-1 overflow-hidden">
            <ChatInterface />
          </div>
        )}
      </div>
      
      {/* Add contact modal */}
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
