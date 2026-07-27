// sw.js — OPTIONAL production offline fallback for the same-origin web build.
//
// This is opt-in: main.js only registers it on a production HTTPS web origin
// (never on localhost/LAN dev, never inside the Capacitor native shell — the
// packaged app already ships every asset natively and must work WITHOUT a
// service worker). Registered from /client/sw.js, so its scope is /client/.
//
// It NEVER touches Socket.IO or cross-origin traffic (the authoritative Render
// service is cross-origin), so online play and the configurable server URL are
// unaffected. CACHE_VERSION starts with the app version and may add an asset
// revision when web files change without rebuilding the native packages.

const CACHE_VERSION = '1.11.0';
const CACHE_PREFIX = 'aetherglyph-shell-v';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

// Core app shell precached on install (best-effort; a miss never fails install).
// Relative to the /client/ scope. The rest of the ES-module graph is cached at
// runtime on first load.
const SHELL = [
  './index.html',
  './styles/style.css?v=1.11.0',
  './src/app/main.js?v=1.11.0',
  './src/game/menuDuel.js',
  './audio/music/wanderlust-menu.mp3',
  './audio/music/spell-duel.mp3',
  './vendor/three.module.js',
  './vendor/socket.io.esm.min.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(SHELL.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

function isSocketIo(url) {
  return url.pathname.startsWith('/socket.io/');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Only ever handle our own origin. Cross-origin (the Render service, any CDN)
  // and Socket.IO transport go straight to the network, untouched.
  if (url.origin !== self.location.origin) return;
  if (isSocketIo(url)) return;

  // Navigations: network-first so deploys are picked up, cache as offline fallback.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(req);
        return cached || caches.match('./index.html');
      }
    })());
    return;
  }

  // Executable assets are network-first with the browser HTTP cache bypassed.
  // This prevents a reinstalled PWA from reviving stale ES modules whose import
  // URLs did not change. Cached copies remain the offline fallback.
  if (/\.(?:js|mjs|html|webmanifest)$/i.test(url.pathname)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        if (fresh && fresh.ok && fresh.type === 'basic') {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch {
        return (await caches.match(req)) || new Response('', { status: 504, statusText: 'Offline' });
      }
    })());
    return;
  }

  // Media and images remain cache-first with a no-store background refresh.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req, { cache: 'no-store' }).then((res) => {
      if (res && res.ok && res.type === 'basic') {
        caches.open(CACHE_NAME).then((cache) => cache.put(req, res.clone()));
      }
      return res;
    }).catch(() => null);
    return cached || (await network) || new Response('', { status: 504, statusText: 'Offline' });
  })());
});
