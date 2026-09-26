/* Trade Journal Analytics — service worker
   Caches the app shell so the app opens (and can be used on already
   loaded data) even offline, after the first successful load.
*/
const CACHE_NAME = 'tj-analytics-v2';
const APP_SHELL = [
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/metrics.js',
  './js/insights.js',
  './js/parser.js',
  './js/db.js',
  './js/calendar.js',
  './js/charts.js',
  './js/app.js',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/vendor/chart.umd.min.js',
  './assets/vendor/chartjs-plugin-datalabels.min.js',
  './assets/vendor/xlsx.full.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Network-first: this app is under active development and a stale
  // cached copy served ahead of a fresh deploy is worse than a slightly
  // slower load. Only fall back to the cache when the network is truly
  // unavailable (offline), which is the one case the cache exists for.
  event.respondWith(
    fetch(req).then((networkRes) => {
      if (networkRes && networkRes.ok) {
        const clone = networkRes.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
      }
      return networkRes;
    }).catch(() => caches.match(req))
  );
});
