import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import {
  StaleWhileRevalidate,
  CacheFirst,
  NetworkFirst,
} from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";

// Ensure Workbox logs are enabled in development
// self.__WB_DISABLE_DEV_LOGS = false; // Uncomment for dev logs

console.log("[Service Worker] Custom SW executing");

// 1. Precache Manifest (Injected by vite-plugin-pwa)
// This line automatically handles precaching assets listed by the build process.
precacheAndRoute(self.__WB_MANIFEST || []);

// 2. Cleanup outdated caches from previous versions
cleanupOutdatedCaches();

// 3. Optional: Basic lifecycle - often handled by Workbox, but can add custom logic
//self.addEventListener('install', (event) => {
//  console.log('[Service Worker] Install (Workbox will handle precaching)');
// Don't usually need skipWaiting here if registerType: 'autoUpdate' is used
// self.skipWaiting();
//});

//self.addEventListener('activate', (event) => {
//  console.log('[Service Worker] Activate (Workbox will handle cache cleanup & claiming clients)');
// Don't usually need clients.claim() here if registerType: 'autoUpdate' is used
// event.waitUntil(self.clients.claim());
//});

// --- Message Handling (e.g., for SKIP_WAITING) ---
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[Service Worker] Received SKIP_WAITING message. Activating new SW.');
    self.skipWaiting();
  }
});

// --- Routing & Caching Strategies (using Workbox) ---

// Cache CSS, JS, and Web Workers with a Stale While Revalidate strategy.
registerRoute(
  ({ request }) =>
    request.destination === "style" ||
    request.destination === "script" ||
    request.destination === "worker",
  new StaleWhileRevalidate({
    cacheName: "asset-cache",
    plugins: [
      // Ensure that only requests that result in a 200 status are cached.
      new CacheableResponsePlugin({
        statuses: [200],
      }),
    ],
  }),
);

// Cache images with a Cache First strategy with expiration.
registerRoute(
  ({ request }) => request.destination === "image",
  new CacheFirst({
    cacheName: "image-cache",
    plugins: [
      new CacheableResponsePlugin({
        statuses: [200],
      }),
      // Cache for a maximum of 30 days.
      new ExpirationPlugin({
        maxEntries: 60,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 Days
        purgeOnQuotaError: true, // Automatically clean up if quota is exceeded.
      }),
    ],
  }),
);

registerRoute(
  ({ url }) => url.pathname.startsWith("/api/"),
  new NetworkFirst({
    cacheName: "api-cache",
    plugins: [
      new CacheableResponsePlugin({
        statuses: [200], // Only cache successful responses
      }),
    ],
  }),
  "GET", // Only apply to GET requests
);

// Add other routes as needed (e.g., for fonts, specific origins)

// --- Push Event Handling (Keep your custom logic here) ---

self.addEventListener("push", (event) => {
  console.log("[Service Worker] Push Received.");
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
      console.log("[Service Worker] Push data:", data);
    } catch (e) {
      console.log("[Service Worker] Push payload was text:", event.data.text());
      data.body = event.data.text();
    }
  }

  const title = data.title || "Default Push Title";
  const options = {
    body: data.body || "Default push message body.",
    icon: data.icon || "android-chrome-192x192.png",
    badge: data.badge || "flavicon-32x32.png",
    data: {
      url: data.url || "/",
      ...(data.data || {}),
    },
  };

  // --- Badge Handling & Conditional Notification Logic ---
  const handlePush = async () => {
    let parsedData = {};
    if (event.data) {
      try {
        parsedData = event.data.json();
        console.log("[Service Worker] Push data:", parsedData);
      } catch (e) {
        console.log("[Service Worker] Push payload was text:", event.data.text());
        parsedData.body = event.data.text(); // Fallback if not JSON
      }
    }

    const notificationTitle = parsedData.title || "New Message";
    const notificationOptions = {
      body: parsedData.body || "You have a new message.",
      icon: parsedData.icon || "android-chrome-192x192.png",
      badge: parsedData.badge || "flavicon-32x32.png", // Icon for the notification itself
      data: {
        url: parsedData.url || "/",
        ...(parsedData.data || {}),
      },
      // Consider adding a tag to allow replacement of notifications
      // tag: parsedData.tag || 'general-notification',
    };

    // Update app badge
    if ("setAppBadge" in self && "clearAppBadge" in self) {
      const badgeCount = parsedData.badgeCount; // Expecting this in the payload
      if (typeof badgeCount === "number") {
        if (badgeCount > 0) {
          try {
            await self.setAppBadge(badgeCount);
            console.log(`[Service Worker] App badge set to ${badgeCount}.`);
          } catch (badgeError) {
            console.error("[Service Worker] Error setting app badge:", badgeError);
          }
        } else { // badgeCount is 0 or negative
          try {
            await self.clearAppBadge();
            console.log("[Service Worker] App badge cleared.");
          } catch (badgeError) {
            console.error("[Service Worker] Error clearing app badge:", badgeError);
          }
        }
      } else {
        console.log("[Service Worker] No badgeCount in push data, or not a number. Badge not updated by push.");
      }
    } else {
      console.log("[Service Worker] Badging API not supported in this Service Worker context.");
    }

    // Check if app is active
    const clientsArr = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });

    let appIsActive = false;
    for (const client of clientsArr) {
      // Check if the client is visible and focused.
      // You might want to also check client.url to ensure it's your app.
      if (client.visibilityState === "visible" && client.focused) {
        appIsActive = true;
        // Optional: Send a message to the active client if it needs to react to the push
        // client.postMessage({ type: 'PUSH_RECEIVED_WHILE_ACTIVE', payload: parsedData });
        break;
      }
    }

    if (appIsActive) {
      console.log("[Service Worker] App is active and focused. Notification suppressed.");
      // The badge has been updated above. The app should update its UI via polling or other means.
    } else {
      console.log("[Service Worker] App not active or not focused. Showing notification.");
      await self.registration.showNotification(notificationTitle, notificationOptions);
    }
  };

  event.waitUntil(handlePush());
});

// --- Notification Click Handling (Keep your custom logic here) ---

self.addEventListener("notificationclick", (event) => {
  console.log("[Service Worker] Notification click Received.");
  const notificationData = event.notification.data;
  const urlToOpen = notificationData?.url || "/";

  event.notification.close();

  console.log(
    "[Service Worker] Clicked notification - attempting to open or focus:",
    urlToOpen,
  );

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          const clientUrl = new URL(client.url);
          const targetUrl = new URL(urlToOpen, self.location.origin);
          if (clientUrl.href === targetUrl.href && "focus" in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          const absoluteUrl = new URL(urlToOpen, self.location.origin).href;
          return clients.openWindow(absoluteUrl);
        }
      }),
    // ... (rest of your notificationclick handler)
  );
});
