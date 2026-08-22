const CACHE_NAME = 'str-ig-cache-v53';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) return caches.delete(cacheName);
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

async function withLabPatches(response, request) {
  const url = new URL(request.url);
  if (!url.pathname.endsWith('/revisa-tu-nomina.html')) return response;
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;

  const html = await response.text();
  const scripts = [
    '<script src="payroll-lab-patch.js?v=45"></script>',
    '<script src="timesheet-crop-guard-lab.js?v=45"></script>',
    '<script src="timesheet-vision-lab.js?v=45"></script>',
    '<script src="payroll-vision-lab.js?v=45"></script>',
    '<script src="history-lab-patch.js?v=45"></script>'
  ].join('');
  const patched = html.includes('history-lab-patch.js')
    ? html
    : html.replace('</body>', `${scripts}</body>`);

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store');
  return new Response(patched, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(async (response) => {
          const patched = await withLabPatches(response, event.request);
          const copy = patched.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return patched;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          return cached ? withLabPatches(cached, event.request) : cached;
        })
    );
    return;
  }

  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
