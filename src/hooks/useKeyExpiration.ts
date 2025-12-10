import { useEffect, useRef } from 'react';
import { useMessages, Message } from '@/contexts/MessagesContext';
import { useToast } from '@/components/ui/use-toast';

export const useKeyExpiration = () => {
    const { messages, stripAttachedKey, getDecryptedContent } = useMessages();
    const { toast } = useToast();
    const processingRef = useRef(false);

    useEffect(() => {
        const checkExpiration = async () => {
            if (processingRef.current) return;
            processingRef.current = true;

            const EXPIRATION_TIME_MS = 24 * 60 * 60 * 1000; // 24 hours
            const now = Date.now();
            let expiredCount = 0;

            // Iterate through all messages in all contacts
            for (const contactId in messages) {
                const contactMessages = messages[contactId];
                for (const msg of contactMessages) {
                    if (msg.hasAttachedKey) {
                        const msgTime = new Date(msg.timestamp).getTime();
                        if (now - msgTime > EXPIRATION_TIME_MS) {
                            console.log(`Expiring attached key for message ${msg.id}`);
                            // Strip the key
                            await stripAttachedKey(msg.id, contactId);
                            expiredCount++;
                        }
                    }
                }
            }

            if (expiredCount > 0) {
                toast({
                    title: "Expired Keys Cleaned",
                    description: `Removed ${expiredCount} expired attached keys for security.`,
                    variant: "default",
                });
            }

            processingRef.current = false;
        };

        // Run check initially and then every hour
        checkExpiration();
        const intervalId = setInterval(checkExpiration, 60 * 60 * 1000);

        return () => clearInterval(intervalId);
    }, [messages, stripAttachedKey, toast]); // Dependency on messages means it checks on every message update. 
    // This is fine for now as it ensures immediate expiration if a very old message is loaded.
    // Ideally we might Debounce this.
};
