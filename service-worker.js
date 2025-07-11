// --- จุดที่แก้ไข (สำคัญมาก) ---
// 1. เปลี่ยนชื่อ Cache เป็นเวอร์ชันใหม่ (เช่น v2) เพื่อบังคับให้ Service Worker อัปเดตไฟล์ใหม่ทั้งหมด
const staticCacheName = 'site-static-v2';

// 2. แก้ไข path ทั้งหมดใน assets ให้เป็นแบบ Relative (ใช้ './' นำหน้า)
//    เพื่อให้ Service Worker หาไฟล์เจอเมื่อรันบน GitHub Pages
const assets = [
  './',
  './index.html',
  './css/style.css',
  './js/main.js',
  './img/lotto-192.png',
  './img/lotto-512.png',
  './img/screenshot.png'
];

// install service worker
self.addEventListener('install', evt => {
  evt.waitUntil(
    caches.open(staticCacheName).then(cache => {
      console.log('caching shell assets');
      cache.addAll(assets);
    })
  );
});

// activate event
self.addEventListener('activate', evt => {
  evt.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(keys
        .filter(key => key !== staticCacheName) // ลบ Cache เวอร์ชันเก่าที่ไม่ตรงกับชื่อใหม่
        .map(key => caches.delete(key))
      )
    })
  );
});

// fetch event
self.addEventListener('fetch', evt => {
  evt.respondWith(
    caches.match(evt.request).then(cacheRes => {
      return cacheRes || fetch(evt.request);
    })
  );
});
