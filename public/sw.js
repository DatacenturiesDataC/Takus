// Takus Service Worker
// Bump this version on every deploy that should invalidate cached assets.
const CACHE_NAME = 'takus-cache-v51';
const WASM_CACHE = 'takus-wasm-v1';

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
        names.filter((n) => n !== CACHE_NAME && n !== WASM_CACHE).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Cache eviction ────────────────────────────────────────────────────────────
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    // Delete oldest entries (first in = first out)
    const toDelete = keys.slice(0, keys.length - maxItems);
    await Promise.all(toDelete.map(k => cache.delete(k)));
  }
}

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

/**
 * Check if a URL is a WASM or FFmpeg asset that should be cached aggressively.
 * These are large, immutable binaries that benefit from cache-first strategy.
 */
function isWasmOrFfmpeg(url) {
  const path = url.pathname.toLowerCase();
  return path.endsWith('.wasm') || path.includes('ffmpeg');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  // Only intercept http(s); ignore chrome-extension://, blob:, data:, etc.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  // Cache-first for WASM/FFmpeg binaries from CDNs (unpkg, jsdelivr, etc.)
  if (isWasmOrFfmpeg(url)) {
    event.respondWith(
      caches.open(WASM_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req).then((resp) => {
            if (resp.ok) cache.put(req, resp.clone());
            return resp;
          });
        })
      )
    );
    return;
  }
  if (BYPASS_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith('.' + host))) return;
  // Never cache Netlify Function API calls (Phase 13)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).then(() => trimCache(CACHE_NAME, 150)).catch(() => {});
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
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).then(() => trimCache(CACHE_NAME, 150)).catch(() => {});
          }
          return resp;
        })
        .catch(() => cached || new Response('Offline', { status: 503, statusText: 'Service Unavailable' }));
    })
  );
});
