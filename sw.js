// เปลี่ยนชื่อ Cache ทุกครั้งที่มีการอัปเดตไฟล์
const CACHE_NAME = 'juck-pwa-cache-v22'; // อัปเดตเวอร์ชันเป็น v14

// รายการไฟล์ทั้งหมดที่มีอยู่จริงใน Repository
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './192.png',
  './512.png'
];

// Event: install
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache and caching all app files');
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting();
});

// Event: activate
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(cache => {
          return cache.startsWith('juck-pwa-cache-') && cache !== CACHE_NAME;
        }).map(cache => {
          console.log('Service Worker: Clearing old cache:', cache);
          return caches.delete(cache);
        })
      );
    })
  );
  return self.clients.claim();
});

// Event: fetch
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') {
      return;
  }
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        return response || fetch(event.request);
      })
  );
});
