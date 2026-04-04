// Cache name derived from ?v= param passed during registration
const VERSION = new URL(self.location).searchParams.get('v') || '0';
const CACHE_NAME = 'biva-v' + VERSION;
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&family=Noto+Serif+SC:wght@600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/marked@15.0.0/marked.min.js',
  'https://cdn.jsdelivr.net/npm/highlight.js@11.11.1/highlight.min.js',
  'https://cdn.jsdelivr.net/npm/highlight.js@11.11.1/styles/github-dark-dimmed.min.css',
  'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js',
  'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Don't cache API calls
  if (url.hostname === 'api.anthropic.com' || url.hostname === 'api.openai.com' || url.pathname.startsWith('/api/')) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => {
      // Cache-first for static assets, network-first for HTML
      if (cached && !e.request.url.endsWith('.html') && !e.request.url.endsWith('/')) {
        return cached;
      }
      return fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          }
          return res;
        })
        .catch(() => cached || new Response('Offline', { status: 503 }));
    })
  );
});
