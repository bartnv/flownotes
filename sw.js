let version = 'v4.3.0';

self.addEventListener('install', evt => {
  console.log('Service worker ' + version + ' is being installed');
  evt.waitUntil(preload());
});
self.addEventListener('activate', evt => {
  console.log('Service worker ' + version + ' is being activated');
  evt.waitUntil(
    caches.keys().then(keylist => {
      return Promise.all(keylist.map(key => {
        if (key.startsWith('flownotes-') && (key != 'flownotes-' + version)) return caches.delete(key);
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
  else if (evt.request.cache && ((evt.request.cache == 'no-cache') || (evt.request.cache == 'reload'))) {
    evt.respondWith(
      tryNetwork(evt.request, 60000, { cache: 'reload' }).catch(() => tryCache(evt.request))
    );
  }
  else {
    evt.respondWith(
      tryCache(evt.request).catch(() => tryNetwork(evt.request, 60000))
    );
  }
});
self.addEventListener('message', evt => {
  if (evt.data.action == 'skipWaiting') {
    self.skipWaiting();
  }
  else if (evt.data.action == 'refresh') {
    preload().then(evt.source.postMessage({ action: 'reload' }));
  }
});

async function preload() {
  return caches.open('flownotes-' + version).then(cache => {
    let files = [
      './',
      './script.js',
      './style.css',
      './share.html',
      './popout.html'
    ];
    return cache.addAll(files.map((file) => new Request(file, { cache: 'reload' })));
  });
}
function tryNetwork(request, timeout, options = {}) {
  return new Promise((fulfill, reject) => {
    let id = setTimeout(reject, timeout);
    fetch(request, options).then(response => {
      clearTimeout(id);
      fulfill(response.clone());
      if (response.status == 200) {
        if (request.method == 'GET') caches.open('flownotes-' + version).then(cache => cache.put(request, response));
      }
      else console.log(`Request for ${request.url} failed with status ${response.status} (${response.statusText})`);
    }, reject);
  });
}
function tryCache(request, options = {}) {
  return caches.open('flownotes-' + version).then(
    cache => cache.match(request, options).then(
      matching => matching || Promise.reject('no-match')
    )
  );
}
