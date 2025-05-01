// Placeholder for your VAPID public key
// Replace this with your actual VAPID public key generated on the server
const VAPID_PUBLIC_KEY = 'YOUR_VAPID_PUBLIC_KEY'; 

const SUBSCRIPTION_STORAGE_KEY = 'pushSubscription';

/**
 * Converts a VAPID public key string to a Uint8Array.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Registers the service worker.
 */
async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    console.warn('Service workers are not supported in this browser.');
    return null;
  }
  try {
    const registration = await navigator.serviceWorker.register('/service-worker.js');
    console.log('Service Worker registered successfully:', registration);
    return registration;
  } catch (error) {
    console.error('Service Worker registration failed:', error);
    return null;
  }
}

/**
 * Stores the push subscription in localStorage.
 */
export function storePushSubscription(subscription: PushSubscription | null): void {
  if (subscription) {
    localStorage.setItem(SUBSCRIPTION_STORAGE_KEY, JSON.stringify(subscription));
    console.log('Push subscription stored.');
  } else {
    localStorage.removeItem(SUBSCRIPTION_STORAGE_KEY);
    console.log('Push subscription removed.');
  }
}

/**
 * Retrieves the push subscription from localStorage.
 */
export function getStoredPushSubscription(): PushSubscription | null {
  const subscriptionJson = localStorage.getItem(SUBSCRIPTION_STORAGE_KEY);
  if (!subscriptionJson) {
    return null;
  }
  try {
    return JSON.parse(subscriptionJson) as PushSubscription;
  } catch (error) {
    console.error('Failed to parse stored push subscription:', error);
    localStorage.removeItem(SUBSCRIPTION_STORAGE_KEY); // Clear invalid data
    return null;
  }
}

/**
 * Requests notification permission and subscribes if granted.
 * Stores the subscription in localStorage.
 */
export async function requestNotificationPermissionAndSubscribe(): Promise<void> {
  if (!('Notification' in window) || !('PushManager' in window) || !('serviceWorker' in navigator)) {
    console.warn('Push notifications or service workers are not supported in this browser.');
    return;
  }

  // 1. Check existing permission
  let permission = Notification.permission;
  console.log('Current notification permission:', permission);

  // 2. If permission is default, request it
  if (permission === 'default') {
    permission = await Notification.requestPermission();
    console.log('Notification permission result:', permission);
  }

  // 3. If permission is denied, do nothing further
  if (permission === 'denied') {
    console.warn('Notification permission was denied.');
    // Maybe inform the user how to enable it later if they change their mind
    return;
  }

  // 4. If permission is granted, proceed with subscription
  if (permission === 'granted') {
    console.log('Notification permission granted. Proceeding with subscription...');

    // Ensure VAPID key is set
    if (VAPID_PUBLIC_KEY === 'YOUR_VAPID_PUBLIC_KEY') {
        console.error("VAPID_PUBLIC_KEY is not set in src/utils/notifications.ts. Please replace the placeholder.");
        // Optionally throw an error or return early
        return; 
    }

    // Check if already subscribed
    const existingSubscription = getStoredPushSubscription();
    if (existingSubscription) {
      console.log('Already subscribed.');
      // Optional: Verify subscription with service worker? Usually not needed unless issues arise.
      return;
    }

    // Register service worker first
    const registration = await registerServiceWorker();
    if (!registration) {
      console.error('Cannot subscribe without service worker registration.');
      return;
    }

    // Wait for the service worker to become active
    await navigator.serviceWorker.ready; 
    console.log('Service worker is active.');


    try {
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true, // Required for push notifications
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      console.log('Successfully subscribed to push notifications:', subscription);
      storePushSubscription(subscription);
    } catch (error) {
      console.error('Failed to subscribe to push notifications:', error);
      // Handle specific errors, e.g., if VAPID key is invalid
      storePushSubscription(null); // Ensure no invalid subscription is stored
    }
  }
}

/**
 * Unsubscribes from push notifications and removes the stored subscription.
 */
export async function unsubscribeFromNotifications(): Promise<void> {
   if (!('serviceWorker' in navigator)) return;

   try {
       const registration = await navigator.serviceWorker.ready;
       const subscription = await registration.pushManager.getSubscription();
       if (subscription) {
           const successful = await subscription.unsubscribe();
           if (successful) {
               console.log('Successfully unsubscribed.');
               storePushSubscription(null);
           } else {
               console.error('Failed to unsubscribe.');
           }
       } else {
           console.log('No active subscription found to unsubscribe.');
           // Still clear local storage just in case
           storePushSubscription(null);
       }
   } catch (error) {
       console.error('Error during unsubscription:', error);
       // Clear local storage as a fallback
       storePushSubscription(null);
   }
}
