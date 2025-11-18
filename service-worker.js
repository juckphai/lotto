// --- จุดที่แก้ไข (สำคัญมาก) ---
// 1. เปลี่ยนชื่อ Cache เป็นเวอร์ชันใหม่ (เช่น v113) เพื่อบังคับให้ Service Worker อัปเดตไฟล์ใหม่ทั้งหมด
const staticCacheName = 'site-static-v113';

// 2. แก้ไข path ทั้งหมดใน assets ให้เป็นแบบ Relative (ใช้ './' นำหน้า)
//    เพื่อให้ Service Worker หาไฟล์เจอเมื่อรันบน GitHub Pages หรือ Subdirectory
const assets = [
  './',
  './index.html',
  './styles.css', // แก้ไขชื่อไฟล์เป็น styles.css
  './script.js',  // แก้ไขชื่อไฟล์เป็น script.js
  './manifest.json', // เพิ่ม manifest.json
  './192.png', // สมมติชื่อไฟล์ไอคอนตาม index.html
  './512.png'  // สมมติชื่อไฟล์ไอคอนตาม manifest.json
  // 'assets/img/screenshot.png' (นำออกเนื่องจากไม่พบในโครงสร้างไฟล์ที่ให้มา)
];

// install service worker
self.addEventListener('install', evt => {
  evt.waitUntil(
    caches.open(staticCacheName).then(cache => {
      console.log('caching shell assets');
      // เพิ่ม try-catch เพื่อจัดการข้อผิดพลาดหากไม่สามารถแคชไฟล์ใดไฟล์หนึ่งได้
      cache.addAll(assets).catch(err => {
         console.error('Error caching some assets:', err);
      });
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