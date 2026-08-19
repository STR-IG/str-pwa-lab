const CACHE_NAME = 'str-ig-cache-v30';

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

async function injectPayrollLabPatch(response, requestUrl) {
  const url = new URL(requestUrl);
  if (!url.pathname.endsWith('/revisa-tu-nomina.html')) return response;

  try {
    const html = await response.clone().text();
    if (html.includes('payroll-lab-patch.js')) return response;
    const patched = html.replace(
      '</body>',
      '<script src="payroll-lab-patch.js?v=1"></script>\n</body>'
    );
    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.delete('content-length');
    return new Response(patched, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  } catch {
    return response;
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(async (response) => {
          const patchedResponse = await injectPayrollLabPatch(response, event.request.url);
          const copy = patchedResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return patchedResponse;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          return cached ? injectPayrollLabPatch(cached, event.request.url) : cached;
        })
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
