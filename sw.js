const CACHE = 'AQMS Pro Suite-v2';
const ASSETS = ['./', './index.html'];

self.addEventListener('install', function(e) {
  e.waitUntil(caches.open(CACHE).then(function(c) { return c.addAll(ASSETS); }));
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  e.respondWith(
    fetch(e.request).then(function(res) {
      const resClone = res.clone();
      caches.open(CACHE).then(function(c) { c.put(e.request, resClone); });
      return res;
    }).catch(function() {
      return caches.match(e.request);
    })
  );
});
