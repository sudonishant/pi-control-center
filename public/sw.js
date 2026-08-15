const CACHE_NAME = 'picontrol-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.min.css',
  'https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.min.js',
  'https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.min.js',
  'https://cdn.jsdelivr.net/npm/lucide/dist/umd/lucide.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch(err => {
        console.warn("Service worker asset pre-cache failed (normal if offline/installing):", err);
      });
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  
  // Direct bypass for non-GET, APIs, or Socket.io connections
  if (
    e.request.method !== 'GET' || 
    url.pathname.startsWith('/api') || 
    url.pathname.startsWith('/socket.io')
  ) {
    return; // let browser handle it normally
  }

  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cached, but fetch update in background (Stale-While-Revalidate)
        fetch(e.request).then(response => {
          if (response.status === 200) {
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, response));
          }
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(e.request);
    })
  );
});
