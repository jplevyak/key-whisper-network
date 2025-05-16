import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext"; // Import useAuth
import { useContacts } from "@/contexts/ContactsContext";
import { useToast } from "@/components/ui/use-toast";
import { decryptMessage } from "@/utils/encryption"; // generateStableRequestId no longer needed here
import { getStoredPushSubscription } from "@/utils/notifications"; // Import notification util
import { Message } from "@/contexts/MessagesContext"; // Import only Message type if needed

// Type for the response from /api/get-messages
// --- IMPORTANT: Adjust this interface based on backend changes ---
// Assumes backend now returns request_id (the stable hash)
interface GetMessagesApiResponse {
  results: {
    message_id: string; // This is the encrypted request ID (e.g., encrypted "sending to key generator")
    message: string; // Base64 encoded encrypted message content
    timestamp: string; // ISO timestamp from backend
    group?: string;
  }[];
}

interface UseMessagePollingOptions {
  setMessages: React.Dispatch<React.SetStateAction<Record<string, Message[]>>>;
  activeItemId?: string | null; // ID of the currently active contact or group in ChatInterface
  initialFetchDelay?: number;
  longPollTimeoutMs?: number; // Timeout for a single long poll request
  minPollIntervalMs?: number; // Minimum time between the start of polls
}

const MIN_POLL_INTERVAL_MS = 30000; // Default minimum interval of 30 seconds

export const useMessagePolling = ({
  setMessages,
  activeItemId = null, // Default to null if not provided
  initialFetchDelay = 500, // Delay before the *first* poll starts
  longPollTimeoutMs = 300000, // Timeout for a single long poll request (5 minutes)
  minPollIntervalMs = MIN_POLL_INTERVAL_MS, // Use the defined minimum interval
}: UseMessagePollingOptions) => {
  const { listItems, getContactKey, getGetRequestId } = useContacts(); // Added getGetRequestId
  const { toast } = useToast();
  const { isAuthenticated } = useAuth(); // Get authentication status
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true); // To prevent state updates after unmount

  // Renamed to reflect it's a single long poll request cycle
  const fetchMessagesFromServer = useCallback(
    async (signal: AbortSignal) => {
      const actualContacts = listItems.filter(
        (item) => item.itemType === "contact",
      );

      if (actualContacts.length === 0) {
        return;
      }

      const requestIdsToSend: string[] = [];
      const requestIdToContactIdMap: Map<string, string> = new Map();
      const contactKeysMap: Map<string, CryptoKey> = new Map(); // Keep this for decryption

      try {
        // Prepare data needed for the request and response processing
        for (const contact of actualContacts) {
          // Use actualContacts
          const key = await getContactKey(contact.id);
          if (!key) {
            console.warn(
              `Skipping fetch for contact ${contact.id}: key not found.`,
            );
            continue;
          }
          // Store the key for decryption later, mapped by contact.id
          contactKeysMap.set(contact.id, key);

          // Get the stable request ID using the new context function
          try {
            const requestId = await getGetRequestId(contact.id);
            if (!requestId) {
              console.warn(
                `Could not get request ID for contact ${contact.id}. Skipping.`,
              );
              continue;
            }
            requestIdsToSend.push(requestId);
            // Map the generated stable ID back to the contactId to process the response
            requestIdToContactIdMap.set(requestId, contact.id);
          } catch (error) {
            console.error(
              `Error fetching request ID for contact ${contact.id}:`,
              error,
            );
            continue;
          }
        }

        // Log the populated map
        //console.log('Populated requestIdToContactIdMap:', requestIdToContactIdMap);

        if (requestIdsToSend.length === 0) {
          //console.log('No valid contacts/keys to fetch messages for.');
          return;
        }

        // Get stored push subscription
        const pushSubscription = getStoredPushSubscription();

        // Send the list of stable request IDs (hashes) and timeout to the backend
        const response = await fetch("/api/get-messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message_ids: requestIdsToSend,
            timeout_ms: longPollTimeoutMs, // Send timeout hint
            // Include push subscription if available
            ...(pushSubscription && { push_subscription: pushSubscription }),
          }),
          signal: signal, // Pass the abort signal
        });

        if (!response.ok) {
          // Don't throw AbortError if the request was intentionally aborted
          if (signal.aborted) {
            //console.log('Fetch aborted by client.');
            // Throw a specific error or return null/undefined to signal abortion
            throw new DOMException("Aborted", "AbortError");
          }
          const errorText = await response.text();
          throw new Error(`API error ${response.status}: ${errorText}`);
        }

        const data: GetMessagesApiResponse = await response.json();
        // Log the received data
        // console.log('Received data.results:', data.results);

        if (data.results.length > 0) {
          console.log(`Received ${data.results.length} new messages.`);
          let newMessagesAdded = false;

          const newlyReceivedMessages: Message[] = [];
          const messagesToAck: { message_id: string; timestamp: string }[] = [];

          // Process messages asynchronously first
          for (const receivedMsg of data.results) {
            const contactId = requestIdToContactIdMap.get(
              receivedMsg.message_id,
            );

            if (!contactId) {
              console.warn(
                `Could not find contact for received message_id (request_id): ${receivedMsg.message_id}. Skipping message: ${JSON.stringify(receivedMsg)}`,
              );
              continue;
            }

            let messageForStorage: Partial<Message> = {
              // Use Partial as we build it up
              id: `local-${Date.now()}-${Math.random().toString(36).substring(2, 9)}-received`,
              content: receivedMsg.message,
              timestamp: receivedMsg.timestamp,
              contactId: contactId,
              sent: false,
              read: false,
              forwarded: false,
            };

            let keyForDecryption: CryptoKey | null =
              contactKeysMap.get(contactId);

            if (!keyForDecryption) {
              console.warn(
                `Could not find key for decryption for message associated with contactId ${contactId}. Skipping message: ${JSON.stringify(receivedMsg)}`,
              );
              continue;
            }
            let groupName: String | undefined = undefined;
            let groupId: String | undefined = undefined;
            try {
              const msg = JSON.parse(
                await decryptMessage(receivedMsg.message, keyForDecryption),
              );
              groupName = msg.group;
              groupId = msg.groupId;
            } catch (decryptError) {
              console.error(
                `Failed to decrypt message for contactId ${contactId} (will store anyway):`,
                decryptError,
              );
            }

            if (groupId) {
              const group = listItems.find(
                (item) => item.itemType === "group" && item.id === groupId,
              );

              if (group) {
                // Scenario 1: Group exists, and we know the original sender within that group.
                // Message goes into the group's chat.
                messageForStorage.groupId = group.id;
              } else {
                // Scenario 2: Group does not exist (or serverSenderInGroupId missing), message is from directSenderContactId but with a group context name.
                // Message goes into the direct sender's chat.
                messageForStorage.groupContextName = groupName;
                messageForStorage.groupContextId = groupId;
              }
            }

            newlyReceivedMessages.push(messageForStorage as Message);
            messagesToAck.push({
              message_id: receivedMsg.message_id,
              timestamp: receivedMsg.timestamp,
            });
          }

          // Now update the state synchronously
          if (newlyReceivedMessages.length > 0) {
            setMessages((prevMessages) => {
              const updatedMessages = { ...prevMessages };
              let changed = false;

              for (const newMessage of newlyReceivedMessages) {
                const targetId = newMessage.groupId || newMessage.contactId;
                console.log(
                  `Adding message for contact/group ID: ${targetId}`,
                  newMessage,
                );
                const contactMessages = updatedMessages[targetId] || [];
                // Check for duplicates based on content and timestamp before adding
                const exists = contactMessages.some(
                  (m) =>
                    m.content === newMessage.content &&
                    m.timestamp === newMessage.timestamp,
                );

                if (!exists) {
                  updatedMessages[targetId] = [
                    ...contactMessages,
                    newMessage,
                  ].sort(
                    (a, b) =>
                      new Date(a.timestamp).getTime() -
                      new Date(b.timestamp).getTime(),
                  );
                  changed = true;
                  newMessagesAdded = true; // Track if any messages were actually added
                } else {
                  console.log(
                    `Duplicate message detected for contact ${targetId}:`,
                    newMessage,
                  );
                }
              }
              // Only return a new object if changes were actually made
              return changed ? updatedMessages : prevMessages;
            });
          }

          // --- Send Acknowledgment ---
          if (messagesToAck.length > 0) {
            console.log(`Acknowledging ${messagesToAck.length} messages...`);
            try {
              const ackResponse = await fetch("/api/ack-messages", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ acks: messagesToAck }),
                // Don't use the main abort signal here, ACK should try to complete
              });
              if (!ackResponse.ok) {
                const errorText = await ackResponse.text();
                console.error(
                  `Failed to acknowledge messages: ${ackResponse.status} ${errorText}`,
                );
                // Decide on retry logic? For now, just log the error.
                // Messages are already saved locally, so loss isn't immediate.
              } else {
                console.log("Messages acknowledged successfully.");
              }
            } catch (ackError) {
              console.error("Error sending message acknowledgments:", ackError);
            }
          }
          // --- End Send Acknowledgment ---

          if (newMessagesAdded) {
            // Show toast only if no chat is active, or if the new messages are not for the currently active chat.
            const showToast =
              !activeItemId ||
              !newlyReceivedMessages.some(
                (msg) => msg.contactId === activeItemId,
              );
            if (showToast) {
              toast({
                title: "New Messages",
                description: "You have received new messages.",
              });
            }
          }
        } else {
          // This is expected during long polling timeouts
          //console.log('Long poll timed out or no new messages.');
        }
      } catch (error) {
        // Re-throw errors to be handled by the polling loop, except AbortError
        if (error instanceof DOMException && error.name === "AbortError") {
          //console.log('Fetch aborted during processing.');
          throw error; // Re-throw AbortError specifically
        }
        console.error("Failed during message fetch/processing:", error);
        throw error; // Re-throw other errors
      }
      // No finally block needed here, the loop handles continuation/stopping
    },
    [
      listItems,
      getContactKey,
      getGetRequestId, // Added dependency
      setMessages,
      toast,
      longPollTimeoutMs,
      activeItemId,
    ],
  );

  useEffect(() => {
    isMountedRef.current = true;

    // --- Prevent polling if not authenticated ---
    if (!isAuthenticated) {
      console.log("User not authenticated, skipping message polling setup.");
      // Ensure cleanup runs if the component unmounts while waiting for auth
      return () => {
        isMountedRef.current = false;
      };
    }
    // --- End modification ---

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    let initialTimeoutId: NodeJS.Timeout | null = null;

    const longPoll = async () => {
      let lastPollStartTime = 0; // Track the start time of the last poll

      while (isMountedRef.current) {
        if (signal.aborted) {
          console.log("Abort signal detected, stopping loop.");
          break;
        }

        // --- Enforce minimum interval ---
        const now = performance.now();
        const timeSinceLastStart = now - lastPollStartTime;
        if (lastPollStartTime > 0 && timeSinceLastStart < minPollIntervalMs) {
          const delayNeeded = minPollIntervalMs - timeSinceLastStart;
          console.log(
            `Minimum interval enforced. Waiting ${delayNeeded.toFixed(0)}ms...`,
          );
          try {
            await new Promise((resolve, reject) => {
              const timeoutId = setTimeout(resolve, delayNeeded);
              signal.addEventListener("abort", () => {
                clearTimeout(timeoutId);
                reject(new DOMException("Aborted", "AbortError"));
              });
            });
          } catch (abortError) {
            if ((abortError as DOMException).name === "AbortError") {
              console.log("Minimum interval wait aborted.");
              break; // Exit loop if aborted during wait
            }
          }
          // Check abort signal again after waiting
          if (signal.aborted) {
            console.log("Abort signal detected after minimum interval wait.");
            break;
          }
        }
        // --- End minimum interval enforcement ---

        lastPollStartTime = performance.now(); // Record start time *before* the await

        try {
          // Wait for the fetch to complete (or timeout)
          await fetchMessagesFromServer(signal);
          // If successful (got messages or timed out), loop continues. Delay handled above.
          console.log("Long poll request finished successfully or timed out.");
        } catch (error: any) {
          lastPollStartTime = 0; // Reset start time on error to avoid immediate retry delay issue
          if (error.name === "AbortError") {
            //console.log('Long poll fetch aborted.');
            break; // Exit loop if aborted
          }
          console.error("Long poll fetch error:", error);
          // Wait before retrying on error
          if (isMountedRef.current && !signal.aborted) {
            console.log("Waiting 5s before retrying due to error...");
            try {
              // Use a promise with setTimeout that respects the abort signal
              await new Promise((resolve, reject) => {
                const timeoutId = setTimeout(resolve, 5000); // 5s backoff
                signal.addEventListener("abort", () => {
                  clearTimeout(timeoutId);
                  reject(new DOMException("Aborted", "AbortError"));
                });
              });
            } catch (abortError) {
              if ((abortError as DOMException).name === "AbortError") {
                console.log("Retry wait aborted.");
                break; // Exit loop if aborted during wait
              }
            }
          }
        }
      }
      //console.log('Long polling loop stopped.');
    };

    // Start the first poll after the initial delay ONLY if authenticated
    initialTimeoutId = setTimeout(() => {
      if (isMountedRef.current && !signal.aborted && isAuthenticated) {
        longPoll();
      }
    }, initialFetchDelay);

    // Cleanup function
    return () => {
      //console.log('Cleaning up long polling hook...');
      isMountedRef.current = false;
      if (initialTimeoutId) {
        clearTimeout(initialTimeoutId);
      }
      abortControllerRef.current?.abort();
    };
  }, [
    fetchMessagesFromServer,
    initialFetchDelay,
    isAuthenticated,
    minPollIntervalMs,
  ]);

  // Return a function to manually trigger a fetch if needed (optional)
  // Note: This manual trigger might interfere with the long poll loop if not handled carefully.
  // For now, let's not return a manual trigger as the loop handles fetching.
  // If needed, it would require aborting the current poll and starting a new one.
  // return () => {
  //   abortControllerRef.current?.abort(); // Abort current poll
  //   // Need to restart the loop or manually call fetchMessagesFromServer
  //   // This requires more complex state management.
  // };
};
