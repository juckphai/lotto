const CACHE_NAME = 'pos-cache-v117';
const urlsToCache = [
  './',
  './index.html',
  './styles.css',
  './script.js',
  './manifest.json',
  './192.png' // ถ้ามีรูปไอคอน
];

// 1. ติดตั้ง Service Worker และเก็บไฟล์ลงเครื่อง (Install)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// 2. ดึงข้อมูลจากเครื่องหรือเน็ต (Fetch)
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // --- จุดสำคัญ: ถ้าเป็นลิงก์ของ Firebase/Google ให้ปล่อยผ่านไปเลย (ห้าม Cache) ---
  if (requestUrl.origin.includes('googleapis.com') || 
      requestUrl.origin.includes('firebase') ||
      requestUrl.pathname.includes('firestore')) {
    return; // ปล่อยให้โหลดจากเน็ตปกติ ไม่ต้องยุ่ง
  }

  // นอกนั้นให้พยายามใช้ Cache ก่อน เพื่อให้ทำงานออฟไลน์ได้
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) {
          return response; // เจอใน cache เอามาใช้เลย
        }
        return fetch(event.request); // ไม่เจอ ให้ไปโหลดจากเน็ต
      })
  );
});

// 3. อัปเดต Cache เมื่อมีเวอร์ชันใหม่ (Activate)
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
