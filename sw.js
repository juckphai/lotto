// เปลี่ยนชื่อ Cache ทุกครั้งที่มีการอัปเดตไฟล์
const CACHE_NAME = 'juck-pwa-cache-v12'; // อัปเดตเวอร์ชันเป็น v12

// รายการไฟล์ทั้งหมดที่มีอยู่จริงใน Repository
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './192.png',
  './512.png'
];

// Event: install - ติดตั้ง Service Worker และแคชไฟล์ทั้งหมด
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache and caching all app files');
        return cache.addAll(urlsToCache);
      })
      .catch(error => {
        console.error('Failed to cache files during install:', error);
      })
  );
  self.skipWaiting();
});

// Event: activate - จัดการแคชเก่าที่ไม่ต้องการแล้ว
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        // ค้นหา cache ที่ขึ้นต้นด้วยชื่อที่ถูกต้อง และไม่ใช่เวอร์ชันปัจจุบัน
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

// Event: fetch - จัดการ request ทั้งหมดที่เกิดขึ้นจากแอป (กลยุทธ์ Cache First)
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
