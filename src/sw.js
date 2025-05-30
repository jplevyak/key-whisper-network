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

// --- Push Badge Counter Logic ---
const PUSH_BADGE_COUNTER_CACHE_NAME = 'push-badge-counter-cache-v1';

async function getPushBadgeCount() {
  try {
    const cache = await caches.open(PUSH_BADGE_COUNTER_CACHE_NAME);
    const response = await cache.match('badge-count');
    if (response) {
      const count = await response.text();
      return parseInt(count, 10) || 0;
    }
  } catch (error) {
    console.error('[Service Worker] Error getting push badge count:', error);
  }
  return 0;
}

async function setPushBadgeCount(count) {
  try {
    const cache = await caches.open(PUSH_BADGE_COUNTER_CACHE_NAME);
    await cache.put('badge-count', new Response(String(count)));
    console.log(`[Service Worker] Push badge count set to ${count}.`);
  } catch (error) {
    console.error('[Service Worker] Error setting push badge count:', error);
  }
}

// --- Message Handling (e.g., for SKIP_WAITING and CLEAR_PUSH_BADGE_COUNT) ---
self.addEventListener('message', async (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[Service Worker] Received SKIP_WAITING message. Activating new SW.');
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_PUSH_BADGE_COUNT') {
    console.log('[Service Worker] Received CLEAR_PUSH_BADGE_COUNT message from client.');
    await setPushBadgeCount(0);
    // The client will set the correct badge, so SW doesn't need to clear it here.
  }
});


// --- Push Event Handling ---
self.addEventListener("push", (event) => {
  console.log("[Service Worker] Push Received.");

  const handlePush = async () => {
    let parsedData = {};
    if (event.data) {
      try {
        parsedData = event.data.json();
      } catch (e) {
        // If parsing as JSON fails, try as text.
        parsedData.body = event.data.text();
        console.log("[Service Worker] Push payload was text or failed to parse as JSON:", parsedData.body);
      }
    }
    console.log("[Service Worker] Parsed push data:", parsedData);


    const notificationTitle = parsedData.title || "New Message";
    const notificationOptions = {
      body: parsedData.body || "You have a new message.",
      icon: parsedData.icon || "android-chrome-192x192.png", // Default icon
      badge: parsedData.badge || "flavicon-32x32.png", // Icon for the notification itself (usually monochrome)
      data: {
        url: parsedData.url || "/", // Default URL to open on click
        ...(parsedData.data || {}),
      },
      tag: parsedData.tag || 'general-notification', // Allows replacing/grouping notifications
    };

    // Determine if app is active FIRST
    const clientsArr = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    let appIsActive = false;
    for (const client of clientsArr) {
      if (client.visibilityState === "visible" && client.focused) {
        appIsActive = true;
        break;
      }
    }

    // Badge API handling
    if ("setAppBadge" in self && "clearAppBadge" in self) {
      if (appIsActive) {
        // App is active. Client is responsible for the badge.
        // Reset SW's push-specific counter.
        await setPushBadgeCount(0);
        console.log("[Service Worker] App is active. SW push badge counter reset. Client manages badge.");
        // Client will call updateAppBadge with its own unread count.
      } else {
        // App is NOT active. SW increments its counter and sets the badge.
        let currentPushBadgeCount = await getPushBadgeCount();
        currentPushBadgeCount++;
        await setPushBadgeCount(currentPushBadgeCount);
        try {
          await self.setAppBadge(currentPushBadgeCount);
          console.log(`[Service Worker] App not active. Badge set to incremented count: ${currentPushBadgeCount}.`);
        } catch (badgeError) {
          console.error("[Service Worker] Error setting app badge with incremented count:", badgeError);
        }
      }
    } else {
      console.log("[Service Worker] Badging API not supported in this Service Worker context.");
    }

    // Show notification only if app is not active
    if (appIsActive) {
      console.log("[Service Worker] App is active and focused. Notification suppressed.");
      // Optionally, send a message to the active client if it needs to react to the push in a special way
      // clientsArr.forEach(client => {
      //   if (client.visibilityState === "visible" && client.focused) {
      //     client.postMessage({ type: 'PUSH_RECEIVED_WHILE_ACTIVE', payload: parsedData });
      //   }
      // });
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
