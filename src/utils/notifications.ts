import { base64ToArrayBuffer } from "./encryption";

const VAPID_PUBLIC_KEY =
  "BBCfu1zbkYN8zMkWErBfuTfDzLZJ1-gd1hSgwydeCC3851L_7CiTy71oQtuAtx3aV3wDVk7FZVEgUMkT3ZY8RUk=";
const SUBSCRIPTION_STORAGE_KEY = "pushSubscription";

/**
 * Stores the push subscription in localStorage.
 */
export function storePushSubscription(
  subscription: PushSubscription | null,
): void {
  if (subscription) {
    localStorage.setItem(
      SUBSCRIPTION_STORAGE_KEY,
      JSON.stringify(subscription),
    );
    console.log("Push subscription stored.");
  } else {
    localStorage.removeItem(SUBSCRIPTION_STORAGE_KEY);
    console.log("Push subscription removed.");
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
    console.error("Failed to parse stored push subscription:", error);
    localStorage.removeItem(SUBSCRIPTION_STORAGE_KEY); // Clear invalid data
    return null;
  }
}

/**
 * Requests notification permission and subscribes if granted.
 * Stores the subscription in localStorage.
 * @returns {Promise<NotificationPermission>} The final notification permission status.
 */
export async function requestNotificationPermissionAndSubscribe(): Promise<NotificationPermission> {
  if (
    !("Notification" in window) ||
    !("PushManager" in window) ||
    !("serviceWorker" in navigator)
  ) {
    console.warn(
      "Push notifications or service workers are not supported in this browser.",
    );
    // Return 'denied' or a specific status if not supported? Let's stick to browser standard.
    // If 'Notification' isn't in window, Notification.permission is likely undefined.
    // Return 'default' as a fallback status indicating it's not enabled.
    return "default";
  }

  // 1. Check existing permission
  let permission = Notification.permission;
  console.log("Current notification permission:", permission);

  // 2. If permission is default, request it
  if (permission === "default") {
    permission = await Notification.requestPermission();
    console.log("Notification permission result:", permission);
  }

  // 3. If permission is denied, return the status
  if (permission === "denied") {
    console.warn("Notification permission was denied.");
    return permission; // Return 'denied'
  }

  // 4. If permission is granted, proceed with subscription
  if (permission === "granted") {
    console.log(
      "Notification permission granted. Proceeding with subscription...",
    );

    // Check if already subscribed
    const existingSubscription = getStoredPushSubscription();
    if (existingSubscription) {
      console.log("Already subscribed.");
      // Optional: Verify subscription with service worker? Usually not needed unless issues arise.
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    try {
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true, // Required for push notifications
        applicationServerKey: base64ToArrayBuffer(VAPID_PUBLIC_KEY),
      });
      console.log(
        "Successfully subscribed to push notifications:",
        subscription,
      );
      storePushSubscription(subscription);
    } catch (error) {
      console.error("Failed to subscribe to push notifications:", error);
      // Handle specific errors, e.g., if VAPID key is invalid
      storePushSubscription(null); // Ensure no invalid subscription is stored
    }
  }

  // Return the final permission status
  return permission;
}

/**
 * Unsubscribes from push notifications and removes the stored subscription.
 */
export async function unsubscribeFromNotifications(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const successful = await subscription.unsubscribe();
      if (successful) {
        console.log("Successfully unsubscribed.");
        storePushSubscription(null);
      } else {
        console.error("Failed to unsubscribe.");
      }
    } else {
      console.log("No active subscription found to unsubscribe.");
      // Still clear local storage just in case
      storePushSubscription(null);
    }
  } catch (error) {
    console.error("Error during unsubscription:", error);
    // Clear local storage as a fallback
    storePushSubscription(null);
  }
}
