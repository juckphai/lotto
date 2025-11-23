// service-worker.js - ปรับปรุงเงื่อนไข Fetch สำหรับ CDN
// --- 1. เปลี่ยนชื่อ Cache เป็นสองเวอร์ชัน ---
const staticCacheName = 'site-static-v459'; 
const dynamicCacheName = 'site-dynamic-v459'; 

// 2. ไฟล์ที่ต้องการ cache (Assets)
const assets = [
  './',
  './index.html',
  './styles.css',
  './script.js',
  './manifest.json',
  './192.png',
  './512.png'
];

// install service worker
self.addEventListener('install', evt => {
  console.log('Service Worker: Installing');
  evt.waitUntil(
    caches.open(staticCacheName).then(cache => {
      console.log('caching shell assets');
      cache.addAll(assets).catch(err => {
         console.error('Error caching some assets:', err);
      });
    })
  );
  self.skipWaiting();
});

// activate event
self.addEventListener('activate', evt => {
  console.log('Service Worker: Activated');
  evt.waitUntil(
    caches.keys().then(keys => {
      // ลบ Cache เวอร์ชันเก่าที่ไม่ตรงกับ Static และ Dynamic Cache เวอร์ชันปัจจุบัน
      return Promise.all(keys
        .filter(key => key !== staticCacheName && key !== dynamicCacheName)
        .map(key => caches.delete(key))
      )
    })
  );
  self.clients.claim();
});

// fetch event - ใช้กลยุทธ์ Cache, then Network, with Dynamic Caching และ Fallback
self.addEventListener('fetch', evt => {
  // ข้ามการแคชสำหรับ non-GET requests
  if (evt.request.method !== 'GET') {
    return fetch(evt.request);
  }

  // **** จุดที่ปรับปรุง: เพิ่มเงื่อนไขยกเว้น External CDN ****
  const url = evt.request.url;
  if (url.includes('cdnjs.cloudflare.com') || url.includes('cdn.jsdelivr.net')) {
    return fetch(evt.request);
  }
  // ********************************************************
  
  evt.respondWith(
    caches.match(evt.request)
      .then(cacheRes => {
        // 1. ถ้าเจอใน cache (Static หรือ Dynamic) ให้ส่งกลับ
        if (cacheRes) {
          return cacheRes;
        }
        
        // 2. ถ้าไม่เจอ ให้โหลดจาก network
        return fetch(evt.request)
          .then(fetchRes => {
            // ตรวจสอบว่า response ถูกต้องและไม่เป็น External/CORS
            if (!fetchRes || fetchRes.status !== 200 || fetchRes.type !== 'basic') {
              return fetchRes;
            }

            // 3. เก็บใน dynamic cache สำหรับครั้งต่อไป
            return caches.open(dynamicCacheName)
              .then(cache => {
                // ใช้ .clone() เพราะ Response stream ใช้ได้ครั้งเดียว
                cache.put(evt.request.url, fetchRes.clone());
                return fetchRes;
              });
          })
          .catch(() => {
            // 4. Fallback สำหรับกรณีที่โหลดจาก Network ไม่ได้ (ออฟไลน์)
            // Fallback สำหรับหน้า HTML (document)
            if (evt.request.destination === 'document') {
              return caches.match('./index.html');
            }
            // Fallback สำหรับรูปภาพ (image)
            if (evt.request.destination === 'image') {
              return caches.match('./192.png');
            }
          });
      })
  );
});