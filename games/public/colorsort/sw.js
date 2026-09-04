/**
 * Color Sort service worker.
 *
 * Plain JS on purpose — it is copied verbatim by the build rather than bundled,
 * so there are no hashed filenames to keep in step with a precache manifest.
 * Caching happens at runtime instead:
 *
 *   - navigations are network-first, so a deploy is picked up straight away
 *     but the game still opens on a plane;
 *   - hashed build assets are cache-first, because their contents can never
 *     change under a given URL.
 *
 * Bump CACHE_VERSION to evict this game's older builds.
 */

const CACHE_PREFIX = 'colorsort-';
const CACHE_VERSION = `${CACHE_PREFIX}v2`;
const SHELL = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      // A failed shell fetch must not abort the install; runtime caching recovers.
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            // Cache Storage is shared across the whole origin, so an unfiltered
            // sweep here would wipe the other games' offline caches the first
            // time this worker activates.
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * The page reports what it loaded once it is up.
 *
 * On a first visit the hashed JS and CSS are fetched before this worker
 * activates, so it never sees them and cannot cache them — which would leave
 * the game broken offline until the second visit. This closes that gap without
 * needing a build-time precache manifest.
 */
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'precache' || !Array.isArray(data.urls)) return;

  event.waitUntil(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const missing = [];
      for (const url of data.urls) {
        if (!(await cache.match(url))) missing.push(url);
      }
      // One failure must not discard the rest, so cache them individually.
      await Promise.all(missing.map((url) => cache.add(url).catch(() => undefined)));
    }),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = (await cache.match(request)) || (await cache.match('./index.html'));
    if (cached) return cached;
    throw new Error('Offline and nothing cached');
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  // Opaque cross-origin responses are not worth storing.
  if (response && response.ok && response.type === 'basic') {
    cache.put(request, response.clone());
  }
  return response;
}
