import React, { useEffect, useRef, useCallback, useState } from 'react'; // Added useState
import { useAuth } from '@/contexts/AuthContext';
import { useContacts } from '@/contexts/ContactsContext';
import { useToast } from '@/components/ui/use-toast';
import { generateStableRequestId, decryptMessage } from '@/utils/encryption';
import { Message } from '@/contexts/MessagesContext';

// Type for the data received in an SSE 'message' event
// Based on the Rust SSE handler sending a JSON array of FoundMessage
// Note: The 'data' field of an SSE message event is a string. We parse it as JSON.
type SseMessageData = {
  message_id: string; // This is the stable request ID hash
  message: string;    // Base64 encoded encrypted message content
  timestamp: string;  // ISO timestamp from backend
}[]; // Expecting an array

interface UseMessageEventsOptions { // Renamed options
  setMessages: React.Dispatch<React.SetStateAction<Record<string, Message[]>>>;
}

export const useMessagePolling = ({
  setMessages,
}: UseMessageEventsOptions) => {
  const { contacts, getContactKey } = useContacts();
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();
  const eventSourceRef = useRef<EventSource | null>(null);
  const isMountedRef = useRef(true);
  // Store contact keys and the request ID map in refs or state
  // to make them accessible within event handlers without causing dependency loops.
  // Using state ensures the effect re-runs if these derived values change.
  const [derivedContactData, setDerivedContactData] = useState<{
      requestIds: string[];
      requestIdToContactIdMap: Map<string, string>;
      contactKeysMap: Map<string, CryptoKey>;
  } | null>(null);

  // --- Effect to prepare contact data for SSE connection ---
  useEffect(() => {
    let isStillMounted = true;
    const prepareData = async () => {
      if (!isAuthenticated || contacts.length === 0) {
          if (isStillMounted) setDerivedContactData(null); // Clear data if not authenticated or no contacts
          return;
      }

      console.log('Preparing contact data for SSE connection...');
      const requestIdsToSend: string[] = [];
      const requestIdToContactIdMap = new Map<string, string>();
      const contactKeysMap = new Map<string, CryptoKey>();

      try {
        for (const contact of contacts) {
          const key = await getContactKey(contact.id);
          if (!key) {
            console.warn(`Skipping contact ${contact.id} for SSE: key not found.`);
            continue;
          }
          contactKeysMap.set(contact.id, key); // Store key for decryption

          try {
            const requestId = await generateStableRequestId(!contact.userGeneratedKey, key);
            requestIdsToSend.push(requestId);
            requestIdToContactIdMap.set(requestId, contact.id); // Map request ID to contact ID
          } catch (error) {
            console.error(`Failed to generate request ID for contact ${contact.id}:`, error);
            continue;
          }
        }

        if (isStillMounted) {
            if (requestIdsToSend.length > 0) {
                 console.log('SSE Contact Data Prepared:', { count: requestIdsToSend.length, map: requestIdToContactIdMap });
                 setDerivedContactData({
                    requestIds: requestIdsToSend,
                    requestIdToContactIdMap,
                    contactKeysMap,
                 });
            } else {
                console.log('No valid contacts/keys to establish SSE connection for.');
                setDerivedContactData(null); // Clear data if no valid contacts
            }
        }

      } catch (error) {
        console.error("Error preparing contact data for SSE:", error);
         if (isStillMounted) setDerivedContactData(null);
      }
    };

    prepareData();

    return () => {
        isStillMounted = false;
    }
  }, [contacts, getContactKey, isAuthenticated]); // Re-prepare when contacts or auth status change

  // --- Effect to manage the EventSource connection ---
  useEffect(() => {
    isMountedRef.current = true; // Track mount status for async operations

    // Don't connect if not authenticated, no contacts, or data preparation failed
    if (!isAuthenticated || !derivedContactData || derivedContactData.requestIds.length === 0) {
      console.log('Skipping SSE connection: Not authenticated or no valid contacts/keys.');
      // Ensure any existing connection is closed if auth/contacts change results in invalid state
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      return () => { // Cleanup function for this effect instance
         isMountedRef.current = false;
      };
    }

    // Close existing connection if derived data changes requiring a new URL
    if (eventSourceRef.current) {
        console.log("Derived contact data changed, closing existing SSE connection.");
        eventSourceRef.current.close();
        eventSourceRef.current = null;
    }

    const { requestIds, requestIdToContactIdMap, contactKeysMap } = derivedContactData;

    // Construct the URL with message_ids query parameter
    const messageIdsParam = encodeURIComponent(requestIds.join(','));
    const url = `/api/get-messages-sse?message_ids=${messageIdsParam}`;
    console.log('Establishing SSE connection to:', url);

    // Create EventSource instance
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource; // Store ref

    eventSource.onopen = () => {
      console.log('SSE connection opened.');
    };

    // Handle incoming messages (server pushes data)
    // *** Corrected: Marked the function as async ***
    eventSource.onmessage = async (event) => { // <<< Added async here
      console.log('SSE message received:', event.data);
      if (!isMountedRef.current) return; // Prevent updates if unmounted

      try {
        // The Rust server sends a JSON array string in the 'data' field
        const receivedMessages: SseMessageData = JSON.parse(event.data);

        if (receivedMessages.length > 0) {
          console.log(`Processing ${receivedMessages.length} new messages from SSE.`);
          let newMessagesAdded = false;
          const newlyProcessedMessages: Message[] = [];
          const messagesToAck: { message_id: string; timestamp: string }[] = [];

          // Process messages (similar logic to long poll, using derivedContactData)
          // *** This loop now runs correctly within an async function ***
          for (const receivedMsg of receivedMessages) {
             const contactId = requestIdToContactIdMap.get(receivedMsg.message_id);
             const key = contactId ? contactKeysMap.get(contactId) : null;

            if (!contactId || !key) {
              console.warn(`Could not find contact or key for received SSE message_id: ${JSON.stringify(receivedMsg)}`);
              continue;
            }

             // Try decrypting here to validate, but store anyway for later retry if needed
            try {
                 // *** await is now valid here ***
                await decryptMessage(receivedMsg.message, key);
            } catch (decryptError) {
                console.error(`(SSE) Failed initial decrypt for contact ${contactId} (storing encrypted):`, decryptError);
            }

            const newMessage: Message = {
              id: `local-${Date.now()}-${Math.random().toString(36).substring(2, 9)}-received-sse`,
              contactId: contactId,
              content: receivedMsg.message, // Store encrypted content
              timestamp: receivedMsg.timestamp, // Use server timestamp
              sent: false,
              read: false,
              forwarded: false,
            };
            newlyProcessedMessages.push(newMessage);
            messagesToAck.push({
              message_id: receivedMsg.message_id,
              timestamp: receivedMsg.timestamp,
            });
          } // End processing loop

          // Update state if messages were processed
          if (newlyProcessedMessages.length > 0) {
            setMessages(prevMessages => {
              // ... (state update logic remains the same)
              const updatedMessages = { ...prevMessages };
              let changed = false;
              for (const newMessage of newlyProcessedMessages) {
                const contactId = newMessage.contactId;
                const contactMessages = updatedMessages[contactId] || [];
                const exists = contactMessages.some(
                  m => m.content === newMessage.content && m.timestamp === newMessage.timestamp
                );
                if (!exists) {
                  updatedMessages[contactId] = [...contactMessages, newMessage].sort(
                    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
                  );
                  changed = true;
                  newMessagesAdded = true;
                }
              }
              return changed ? updatedMessages : prevMessages;
            });
          }

          // Send Acknowledgment (same as before, but triggered by SSE message)
          if (messagesToAck.length > 0) {
            console.log(`(SSE) Acknowledging ${messagesToAck.length} messages...`);
            // *** Note: This fetch call is async but doesn't need to be awaited
            // unless subsequent logic depends on its completion immediately. ***
            fetch('/api/ack-messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ acks: messagesToAck }),
            })
            .then(async ackResponse => { // Using .then for ack response handling
              if (!ackResponse.ok) {
                const errorText = await ackResponse.text(); // await is ok in this async .then callback
                console.error(`(SSE) Failed to acknowledge messages: ${ackResponse.status} ${errorText}`);
              } else {
                console.log('(SSE) Messages acknowledged successfully.');
              }
            })
            .catch(ackError => {
              console.error('(SSE) Error sending message acknowledgments:', ackError);
            });
          } // End ACK

          if (newMessagesAdded) {
            toast({ title: "New Messages", description: "You have received new messages." });
          }
        } // End if receivedMessages.length > 0

      } catch (error) {
        console.error('Error processing SSE message data:', error);
        // Handle JSON parsing error, etc.
      }
    }; // End onmessage handler

    // Handle errors (connection closed, etc.)
    eventSource.onerror = (error) => {
      console.error('SSE connection error:', error);
      // EventSource attempts reconnection automatically based on browser/server retry logic.
      // You might want custom logic here if automatic reconnection fails persistently.
      // Close the connection formally if the error is terminal or if unmounted.
      if (!isMountedRef.current) {
          eventSource.close();
          eventSourceRef.current = null;
          console.log("SSE connection closed due to error while unmounted.");
      } else {
          // Optional: Add logic for handling persistent errors while mounted,
          // e.g., show a toast after several failed reconnect attempts.
          // The browser's default backoff usually handles temporary network issues.
          // If the server returns a non-2xx status on connect, onerror is triggered,
          // and it usually won't reconnect automatically in that case.
           if (eventSource.readyState === EventSource.CLOSED) {
               console.warn("SSE connection closed permanently by error. Check server logs or network.");
                // Consider notifying the user or attempting a manual reconnect later.
                eventSourceRef.current = null; // Clear ref as connection is closed
           }
      }
    }; // End onerror handler

    // Cleanup function: Close the connection when component unmounts or dependencies change
    return () => {
      console.log('Cleaning up SSE connection...');
      isMountedRef.current = false;
      eventSource.close();
      eventSourceRef.current = null;
    };
  // Re-run effect if authentication status changes OR if the prepared contact data changes
  }, [isAuthenticated, derivedContactData, setMessages, toast]);

  // The hook doesn't need to return anything unless you want to expose manual controls (uncommon for SSE)
};
