// Takus Service Worker
// Bump this version on every deploy that should invalidate cached assets.
const CACHE_NAME = 'takus-cache-v22';

const PRECACHE_URLS = [
  './',
  './index.html',
  './config.js',
  './404.html',
  './favicon.svg',
  './manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[SW] Precache failed:', err))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// Network-first for navigations, cache-first for static assets, never touch APIs.
// Auth, identity, and AI endpoints must never be served from cache because we
// must always reach the live IdP / API for token refresh and request signing.
const BYPASS_HOSTS = [
  'googleapis.com',
  'google.com',
  'gstatic.com',
  'accounts.google.com',
  'apis.google.com',
  'login.microsoftonline.com',
  'login.live.com',
  'graph.microsoft.com',
  'msauth.net',
  'alcdn.msauth.net',
  'unpkg.com',
  'jsdelivr.net',
  'cdn.jsdelivr.net',
  'openai.com',
  'api.openai.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'hooks.slack.com',
  'api.github.com',
  'api.linear.app',
  'atlassian.net',      // Jira Cloud (Phase 13)
  'api.notion.com',     // Notion API (Phase 13)
  'generativelanguage.googleapis.com', // Gemini API
];

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  // Only intercept http(s); ignore chrome-extension://, blob:, data:, etc.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (BYPASS_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith('.' + host))) return;
  // Never cache Netlify Function API calls (Phase 13)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          return resp;
        })
        .catch(() => caches.match(req)
          .then((m) => m || caches.match('./404.html'))
          .then((m) => m || new Response('Offline', { status: 503, statusText: 'Service Unavailable' }))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((resp) => {
          if (resp.ok && resp.type === 'basic') {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          }
          return resp;
        })
        .catch(() => cached || new Response('Offline', { status: 503, statusText: 'Service Unavailable' }));
    })
  );
});
