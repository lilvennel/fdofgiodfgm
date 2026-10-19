// Service worker mínimo: permite instalar la app y abrir la interfaz sin conexión.
// Ojo: marcar asistencia SIEMPRE necesita internet (se valida en el servidor). La API nunca se guarda en caché.
const CACHE = 'asistok-shell-v63';
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/css/app.css', '/js/app.js', '/favicon.svg'])));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  // las URLs con parámetros (?reset=, ?verify=) traen tokens de un solo uso: nunca se guardan en caché
  const cacheable = !u.search;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok && cacheable) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request).then((m) => m || caches.match('/'))));
});
