/**
 * Launcher service worker.
 *
 * Scope is the origin root, so this controls the game grid at `/`. Each game
 * registers its own worker under `/<game>/`, and the narrower scope wins for
 * those pages, so the two never fight over a game.
 *
 * It deliberately handles nothing but the launcher shell, `/warm.js` and the
 * card icons.
 * A root-scoped worker sees navigations to games that have never registered a
 * worker of their own, and falling those back to the cached shell would answer
 * "open Bus Jam" with the grid again — an offline loop with no way out. Letting
 * them through means an unvisited game fails as the browser's offline page,
 * which at least says what is actually wrong.
 *
 * Plain JS on purpose — it is copied verbatim by the build rather than bundled.
 * The launcher has no JS chunk and its CSS is inline, so the shell below is
 * genuinely everything the page loads.
 *
 * Bump CACHE_VERSION to evict the launcher's older builds.
 */

const CACHE_PREFIX = 'launcher-';
const CACHE_VERSION = `${CACHE_PREFIX}v3`;
const SHELL = [
  './',
  './index.html',
  './warm.js',
  './icons/colorsort-192.png',
  './icons/screwland-192.png',
  './icons/busjam-192.png',
  './icons/survival-192.png',
];

// The shell and the icons are decided by URL alone, and a host that sends
// `Vary` would otherwise make a stored response unmatchable offline.
const MATCH = { ignoreVary: true };

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
            // sweep here would wipe all four games' offline caches.
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Network-first, so a deploy is picked up straight away but the grid still
    // opens on a plane. Anything that is not the grid is left alone.
    if (url.pathname === '/' || url.pathname === '/index.html') {
      event.respondWith(networkFirst(request));
    }
    return;
  }

  // The card icons never change under a given URL, and they are shared with
  // each game's manifest, so they are worth holding cache-first. `/warm.js` is
  // held so the grid loads identically offline, where it correctly does
  // nothing — not because warming can work without a network.
  if (url.pathname.startsWith('/icons/') || url.pathname === '/warm.js') {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached =
      (await cache.match(request, MATCH)) || (await cache.match('./index.html', MATCH));
    if (cached) return cached;
    throw new Error('Offline and nothing cached');
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request, MATCH);
  if (cached) return cached;

  const response = await fetch(request);
  // Opaque cross-origin responses are not worth storing.
  if (response && response.ok && response.type === 'basic') {
    cache.put(request, response.clone());
  }
  return response;
}
