// Network-first for the app shell (this code changes often — always want the latest when
// online), falling back to cache only when offline. CDN deps (Preact/htm, fonts) are
// cache-first/stale-while-revalidate since they rarely change and benefit from speed.
// Supabase API/realtime calls are intentionally left untouched — this is a live shared app,
// not one designed to accept offline writes.
//
// Bump CACHE_VERSION on any meaningful change to force a clean cache.
const CACHE_VERSION = 'sonario-v18';
const SHELL_URLS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/lib.js',
  './js/store.js',
  './js/supabaseClient.js',
  './js/config.js',
  './js/auth.js',
  './js/shell.js',
  './js/approvals.js',
  './js/home.js',
  './js/events.js',
  './js/checkin.js',
  './js/icons.js',
  './js/admin.js',
  './js/calendar.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/favicon-32.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

const RUNTIME_CACHE_HOSTS = ['esm.sh', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never intercept Supabase calls (auth/data/realtime need to hit the network live).
  if (url.hostname.endsWith('.supabase.co')) return;

  const sameOrigin = url.origin === self.location.origin;
  const cacheableCDN = RUNTIME_CACHE_HOSTS.some((h) => url.hostname.endsWith(h));
  if (!sameOrigin && !cacheableCDN) return;

  if (sameOrigin) {
    // Network-first with cache: 'no-store' forces an actual round trip to the server every
    // time, so the app shell is guaranteed fresh online. Cache is purely the offline fallback.
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => {
          if (res && res.status === 200) caches.open(CACHE_VERSION).then((cache) => cache.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.open(CACHE_VERSION).then((cache) => cache.match(req)))
    );
    return;
  }

  // Stale-while-revalidate for CDN deps: fine for these to lag a request behind.
  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => { if (res && res.status === 200) cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      return cached || network;
    })
  );
});
