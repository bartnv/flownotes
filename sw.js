let version = 'v3.1';

self.addEventListener('install', evt => {
  console.log('Service worker ' + version + ' is being installed');
});
self.addEventListener('activate', evt => {
  console.log('Service worker ' + version + ' is being activated');
  evt.waitUntil(
    caches.keys().then(keylist => {
      return Promise.all(keylist.map(key => {
        if (key != version) return caches.delete(key);
      }));
    })
  );
});

self.addEventListener('fetch', evt => {
  if (evt.request.url.match(/\/data.php(\?.*)?$/)) return;
  evt.respondWith(
    tryNetwork(evt.request, 500).catch(() => tryCache(evt.request))
  );
});

function tryNetwork(request, timeout) {
  return new Promise((fulfill, reject) => {
    let id = setTimeout(reject, timeout);
    fetch(request).then(response => {
      clearTimeout(id);
      fulfill(response.clone());
      if (response.status == 200) {
        console.log('Caching ' + request.url);
        caches.open(version).then(cache => cache.put(request, response));
      }
    }, reject);
  });
}
function tryCache(request) {
  console.log('Service worker ' + version + ' checking cache for request ' + request.url);
  return caches.open(version).then(
    cache => cache.match(request).then(
      matching => matching || Promise.reject('no-match')
    )
  );
}
