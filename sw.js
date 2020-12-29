let version = 'v3.3';

self.addEventListener('install', evt => {
  console.log('Service worker ' + version + ' is being installed');
  evt.waitUntil(
    caches.open(version).then(cache => {
      return cache.addAll([
        './script.js?' + version,
        './style.css?' + version,
        './share.html?' + version
      ]);
    })
  );
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
  if (evt.request.url.match(/\/share.html/)) {
    evt.respondWith(
      tryCache(evt.request, { ignoreSearch: true }).catch(() => tryNetwork(evt.request, 60000))
    );
  }
  else if (evt.request.url.match(/\/(script.js|style.css|favicon.ico|cdnjs.cloudflare.com)/)) {
    evt.respondWith(
      tryCache(evt.request).catch(() => tryNetwork(evt.request, 60000))
    );
  }
  else {
    evt.respondWith(
      tryNetwork(evt.request, 500).catch(() => tryCache(evt.request))
    );
  }
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
      else console.log(`Request for ${request.url} failed with status ${response.status} (${response.statusText})`);
    }, reject);
  });
}
function tryCache(request, options = {}) {
  console.log('Service worker ' + version + ' checking cache for request ' + request.url);
  return caches.open(version).then(
    cache => cache.match(request, options).then(
      matching => matching || Promise.reject('no-match')
    )
  );
}
