import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate, CacheFirst, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

// Ensure Workbox logs are enabled in development
// self.__WB_DISABLE_DEV_LOGS = false; // Uncomment for dev logs

console.log('[Service Worker] Custom SW executing');

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
  ({ request }) => request.destination === 'style' ||
                   request.destination === 'script' ||
                   request.destination === 'worker',
  new StaleWhileRevalidate({
    cacheName: 'asset-cache',
    plugins: [
      // Ensure that only requests that result in a 200 status are cached.
      new CacheableResponsePlugin({
        statuses: [200],
      }),
    ],
  })
);

// Cache images with a Cache First strategy with expiration.
registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: 'image-cache',
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
  })
);

registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'api-cache',
    plugins: [
      new CacheableResponsePlugin({
        statuses: [200], // Only cache successful responses
      })
    ]
  }),
  'GET' // Only apply to GET requests
);

// Add other routes as needed (e.g., for fonts, specific origins)

// --- Push Event Handling (Keep your custom logic here) ---

self.addEventListener('push', event => {
  console.log('[Service Worker] Push Received.');
  let data = {};
  if (event.data) {
       try {
           data = event.data.json();
           console.log('[Service Worker] Push data:', data);
       } catch (e) {
           console.log('[Service Worker] Push payload was text:', event.data.text());
           data.body = event.data.text();
       }
   }

  const title = data.title || 'Default Push Title';
  const options = {
      body: data.body || 'Default push message body.',
      icon: data.icon || 'android-chrome-192x192.png',
      badge: data.badge || 'flavicon-32x32.png',
      data: {
          url: data.url || '/',
          ...(data.data || {})
      },
  };

  event.waitUntil(
      self.registration.showNotification(title, options)
          // ... (rest of your push handler)
  );
});

// --- Notification Click Handling (Keep your custom logic here) ---

self.addEventListener('notificationclick', event => {
  console.log('[Service Worker] Notification click Received.');
  const notificationData = event.notification.data;
  const urlToOpen = notificationData?.url || '/';

  event.notification.close();

  console.log('[Service Worker] Clicked notification - attempting to open or focus:', urlToOpen);

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
          for (const client of clientList) {
              const clientUrl = new URL(client.url);
              const targetUrl = new URL(urlToOpen, self.location.origin);
              if (clientUrl.href === targetUrl.href && 'focus' in client) {
                  return client.focus();
              }
          }
          if (clients.openWindow) {
              const absoluteUrl = new URL(urlToOpen, self.location.origin).href;
              return clients.openWindow(absoluteUrl);
          }
      })
      // ... (rest of your notificationclick handler)
  );
});
