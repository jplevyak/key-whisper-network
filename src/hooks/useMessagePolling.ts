import { useState, useEffect, useRef, useCallback } from 'react';
import { useContacts } from '@/contexts/ContactsContext';
import { useToast } from '@/components/ui/use-toast';
import { generateStableRequestId, decryptMessage } from '@/utils/encryption';
import { Message } from '@/contexts/MessagesContext'; // Import only Message type if needed

// Type for the response from /api/get-messages
// --- IMPORTANT: Adjust this interface based on backend changes ---
// Assumes backend now returns request_id (the stable hash)
interface GetMessagesApiResponse {
  results: {
    message_id: string; // This is the encrypted request ID (e.g., encrypted "sending to key generator")
    message: string;    // Base64 encoded encrypted message content
    timestamp: string;  // ISO timestamp from backend
  }[];
}

interface UseMessagePollingOptions {
  setMessages: React.Dispatch<React.SetStateAction<Record<string, Message[]>>>;
  initialFetchDelay?: number;
  pollingInterval?: number;
}

export const useMessagePolling = ({
  setMessages,
  initialFetchDelay = 500,
  pollingInterval = 10000,
}: UseMessagePollingOptions) => {
  const { contacts, getContactKey } = useContacts();
  const { toast } = useToast();
  const fetchIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isFetchingRef = useRef(false);

  const fetchMessagesFromServer = useCallback(async () => {
    if (isFetchingRef.current || contacts.length === 0) {
      console.log('Skipping fetch: already fetching or no contacts.');
      return;
    }
    isFetchingRef.current = true;
    console.log('Starting message fetch...');

    const requestIdsToSend: string[] = []; // Will hold the generated stable IDs
    const requestIdToContactIdMap: Map<string, string> = new Map(); // Map stable ID back to contactId
    const contactKeysMap: Map<string, CryptoKey> = new Map(); // Keep this for decryption

    try {
      // Prepare data needed for the request and response processing
      for (const contact of contacts) {
        const key = await getContactKey(contact.id);
        if (!key) {
          console.warn(`Skipping fetch for contact ${contact.id}: key not found.`);
          continue;
        }
        // Store the key for decryption later, mapped by contact.id
        contactKeysMap.set(contact.id, key);

        // Generate the stable request ID using the new function
        try {
          const requestId = await generateStableRequestId(!contact.userGeneratedKey, key);
          requestIdsToSend.push(requestId);
          // Map the generated stable ID back to the contactId to process the response
          requestIdToContactIdMap.set(requestId, contact.id);
        } catch (error) {
          console.error(`Failed to generate request ID for contact ${contact.id}:`, error);
          // Optionally skip this contact or handle the error appropriately
          continue;
        }
      }


      if (requestIdsToSend.length === 0) {
        console.log('No valid contacts/keys to fetch messages for.');
        isFetchingRef.current = false;
        return;
      }

      // Send the list of stable request IDs (hashes) to the backend
      const response = await fetch('/api/get-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_ids: requestIdsToSend }), // Use 'request_ids' or similar field name
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText}`);
      }

      const data: GetMessagesApiResponse = await response.json();

      if (data.results.length > 0) {
       console.log(`Received ${data.results.length} new messages.`);
       let newMessagesAdded = false;

       const newlyReceivedMessages: Message[] = [];

       // Process messages asynchronously first
       for (const receivedMsg of data.results) {
         // --- IMPORTANT: Backend response structure assumption ---
         // Assumes the backend now returns the `request_id` (the stable hash) for each message,
         // allowing us to map it back to the correct contact.
         // Ensure your backend implements this change.

         // Use the request_id from the response to find the corresponding contactId
         const contactId = requestIdToContactIdMap.get(receivedMsg.request_id); // Use request_id from response
         const key = contactId ? contactKeysMap.get(contactId) : null; // Get key using contactId

         if (!contactId || !key) {
           console.warn(`Could not find contact or key for received request_id: ${receivedMsg.request_id}`); // Log uses request_id
           continue;
         }

         try {
           // We could optionally try decrypting here to validate the message early.
           await decryptMessage(receivedMsg.message, key); // Try decrypting to catch errors early
         } catch (decryptError) {
           console.error(`Failed to decrypt message for contact ${contactId} (will store anyway):`, decryptError);
           // Continue processing even if decryption fails here, store the encrypted message
         }

         const newMessage: Message = {
           id: `local-${Date.now()}-${Math.random().toString(36).substring(2, 9)}-received`,
           contactId: contactId,
           content: receivedMsg.message, // Store encrypted content
           timestamp: receivedMsg.timestamp, // Use server timestamp
           sent: false, // Mark as received
           read: false, // Mark as unread initially
           forwarded: false, // Assume not forwarded initially
         };
         newlyReceivedMessages.push(newMessage);
       }

       // Now update the state synchronously
       if (newlyReceivedMessages.length > 0) {
         setMessages(prevMessages => {
           const updatedMessages = { ...prevMessages };
           let changed = false;

           for (const newMessage of newlyReceivedMessages) {
             const contactId = newMessage.contactId;
             const contactMessages = updatedMessages[contactId] || [];
             // Check for duplicates based on content and timestamp before adding
             const exists = contactMessages.some(
               m => m.content === newMessage.content && m.timestamp === newMessage.timestamp
             );

             if (!exists) {
               updatedMessages[contactId] = [...contactMessages, newMessage].sort(
                 (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
               );
               changed = true;
               newMessagesAdded = true; // Track if any messages were actually added
             }
           }
           // Only return a new object if changes were actually made
           return changed ? updatedMessages : prevMessages;
         });
       }

       if (newMessagesAdded) {
         toast({ title: "New Messages", description: "You have received new messages." });
       }
      } else {
        console.log('No new messages received from server.');
      }
    } catch (error) {
      console.error('Failed to fetch messages from server:', error);
    } finally {
      isFetchingRef.current = false;
      console.log('Message fetch finished.');
    }
  }, [contacts, getContactKey, setMessages, toast]); // Include all dependencies

  useEffect(() => {
    // Initial fetch delay
    const initialTimeout = setTimeout(() => fetchMessagesFromServer(), initialFetchDelay);

    const setupPolling = () => {
      if (fetchIntervalRef.current) clearInterval(fetchIntervalRef.current);
      console.log(`Setting up polling interval (${pollingInterval}ms)`);
      fetchIntervalRef.current = setInterval(() => {
        if (document.visibilityState === 'visible') {
          fetchMessagesFromServer();
        } else {
          console.log('Skipping background fetch: tab not visible.');
        }
      }, pollingInterval);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('Tab became visible, triggering fetch.');
        fetchMessagesFromServer();
        setupPolling();
      } else {
        console.log('Tab became hidden, stopping polling.');
        if (fetchIntervalRef.current) {
          clearInterval(fetchIntervalRef.current);
          fetchIntervalRef.current = null;
        }
      }
    };

    setupPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      console.log('Cleaning up message polling hook');
      clearTimeout(initialTimeout);
      if (fetchIntervalRef.current) clearInterval(fetchIntervalRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchMessagesFromServer, initialFetchDelay, pollingInterval]); // Dependencies for setting up/tearing down listeners/intervals

  // Return the manual trigger function
  return fetchMessagesFromServer;
};
