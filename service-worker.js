// เปลี่ยนชื่อ Cache ทุกครั้งที่มีการอัปเดตไฟล์ใน urlsToCache
const CACHE_NAME = 'juckim-pwa-cache-v11'; // ชื่อเวอร์ชันถูกต้องแล้ว

// รายการไฟล์ทั้งหมดที่ต้องการให้แอปทำงานแบบ Offline ได้
// แก้ไขรายการไฟล์ให้ถูกต้อง
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json', // แก้ไขจาก manifest.json.txt
  './192.png',
  './512.png'
];

// Event: install - ติดตั้ง Service Worker และแคชไฟล์ทั้งหมดที่ระบุไว้
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
  // บังคับให้ Service Worker ใหม่เริ่มทำงานทันที
  self.skipWaiting();
});

// Event: activate - จัดการแคชเก่าที่ไม่ต้องการแล้ว
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(cache => {
          // ค้นหา cache ที่เป็นของแอปนี้ แต่ไม่ใช่เวอร์ชันปัจจุบัน
          return cache.startsWith('juckim-pwa-cache-') && cache !== CACHE_NAME;
        }).map(cache => {
          console.log('Service Worker: Clearing old cache:', cache);
          return caches.delete(cache);
        })
      );
    })
  );
  // ทำให้ Service Worker ที่ active อยู่ควบคุมหน้าเว็บได้ทันที
  return self.clients.claim();
});

// Event: fetch - จัดการ request ทั้งหมดที่เกิดขึ้นจากแอป
self.addEventListener('fetch', event => {
  // เราจะจัดการเฉพาะ GET request เท่านั้น
  if (event.request.method !== 'GET') {
      return;
  }
  
  // กลยุทธ์: Cache First (ค้นหาใน Cache ก่อน ถ้าไม่เจอก็ค่อยไปดึงจาก Network)
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // ถ้าเจอใน Cache ให้ส่งกลับไปเลย, ถ้าไม่เจอ (response เป็น null) ให้ fetch จาก Network
        return response || fetch(event.request);
      })
  );
});
