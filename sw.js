const CACHE_NAME = 'fluxi-cache-v1.10.0';

// Archivos locales de la app (subir la versión arriba cada vez que publiques cambios)
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // add() individual: si un archivo falta (ej. icon.svg) no se cae toda la instalación
      .then((cache) => Promise.all(
        ASSETS_TO_CACHE.map((url) => cache.add(url).catch((e) => console.warn('SW: no se cacheó', url, e)))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Solo GET de nuestro propio origen. Google Apps Script y los CDNs van directo a la red.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Stale-while-revalidate: responde rápido desde caché y actualiza en segundo plano
  event.respondWith(
    caches.match(req).then((cached) => {
      const red = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copia = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copia));
          }
          return res;
        })
        .catch(() => cached);
      return cached || red;
    })
  );
});
