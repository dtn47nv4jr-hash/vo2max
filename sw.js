// Offline-Cache. Bei jeder Änderung an den App-Dateien CACHE hochzählen, sonst sieht das iPhone die neue Fassung nicht.
const CACHE = 'vo2max-v14';
const FILES = [
  './',
  'index.html',
  'app.css',
  'plan.js',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', e => {
  // cache: 'reload' – Dateien frisch aus dem Netz, nicht aus dem HTTP-Zwischenspeicher (GitHub Pages: 10 min);
  // sonst kann ein schnelles Folge-Update die alte Fassung einlagern (passiert am 08.11.2026 bei 1.9 → 1.9.1).
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
