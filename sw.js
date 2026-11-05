/* GG Prompter — çevrimdışı önbellek.
   Uygulama dosyaları: önce ağ (güncellemeler hemen gelsin), ağ yoksa önbellek.
   Fontlar / kütüphaneler / simgeler: önce önbellek. Supabase istekleri önbelleğe alınmaz. */
const VERSION = 'prompter-v3.3.0';
const SHELL = [
  './', 'index.html', 'kontrol.html', 'manifest.webmanifest',
  'css/app.css', 'css/fonts.css',
  'js/app.js', 'js/config.js', 'js/data.js', 'js/engine.js', 'js/forms.js', 'js/input.js', 'js/link.js', 'js/remote.js',
  'js/settings.js', 'js/supa.js', 'js/text.js', 'js/util.js', 'js/voice.js',
  'vendor/supabase.js', 'vendor/qrcode.js', 'vendor/mammoth.browser.min.js',
  'icons/icon-192.png', 'icons/icon-512.png',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('prompter-') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(new URL('./', location).pathname)) return;
  const cacheFirst = /\/(fonts|vendor|icons)\//.test(url.pathname);
  if (cacheFirst) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, {ignoreSearch: true}).then(hit => hit || caches.match('index.html'))));
});
