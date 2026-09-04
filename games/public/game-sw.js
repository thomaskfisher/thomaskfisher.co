/**
 * Shared service worker body for every game.
 *
 * Each game's `public/<game>/sw.js` is a two-line stub that imports this and
 * calls `initGameWorker`. Imported scripts are part of the update byte-check,
 * so editing this file updates all four workers; the stubs exist only to bind a
 * slug and a cache version, and to keep each game evicting only its own caches.
 *
 * Plain JS on purpose — copied verbatim by the build rather than bundled, so
 * there are no hashed filenames to keep in step with a precache manifest.
 * Caching happens at runtime instead:
 *
 *   - navigations are network-first, so a deploy is picked up straight away
 *     but the game still opens on a plane;
 *   - hashed build assets are cache-first, because their contents can never
 *     change under a given URL.
 *
 * Two things fill the cache. `precache` is sent by the game's own page with the
 * URLs it actually loaded. `warm` is sent by `/warm.js` from any page on the
 * origin, including the other games, and works the assets out from this game's
 * own `index.html` — that is what lets one visit anywhere arm all four.
 */

/** Matches the build's asset and icon URLs in markup or in a JS chunk. */
const ASSET_PATTERN = /(?:\.\.\/|\/)(?:assets|icons)\/[A-Za-z0-9._-]+/g;

function initGameWorker(slug, version) {
  const CACHE_PREFIX = `${slug}-`;
  const CACHE_VERSION = `${CACHE_PREFIX}${version}`;
  // `/warm.js` is unhashed and shared with every other page, but each game
  // needs its own copy: offline, this worker is the only thing serving it.
  const SHELL = ['./', './index.html', './manifest.webmanifest', '/warm.js'];

  /**
   * Every URL here is either hashed or the shell, so the URL alone decides what
   * the response should be. Honouring `Vary` would not make a lookup safer, and
   * it silently breaks them: a host that sends `Vary: Origin` makes a stored
   * response unmatchable by the very requests that need it, because Vite tags
   * its module and stylesheet links `crossorigin` and the worker's own fetch
   * carried no `Origin`. That failure only shows up offline, on a cold start,
   * with the cache full and apparently correct.
   */
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
              // sweep here would wipe the other games' offline caches the first
              // time this worker activates.
              .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION)
              .map((key) => caches.delete(key)),
          ),
        )
        .then(() => self.clients.claim()),
    );
  });

  self.addEventListener('message', (event) => {
    const data = event.data;
    if (!data) return;

    if (data.type === 'precache' && Array.isArray(data.urls)) {
      event.waitUntil(precache(data.urls));
    } else if (data.type === 'warm') {
      event.waitUntil(warm());
    }
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

  /**
   * Caches the URLs a live page reports it loaded.
   *
   * On a first visit the hashed JS and CSS are fetched before this worker
   * activates, so it never sees them and cannot cache them — which would leave
   * the game broken offline until the second visit. This closes that gap
   * exactly, where `warm` below closes it by inference.
   */
  async function precache(urls) {
    const cache = await caches.open(CACHE_VERSION);
    const missing = [];
    for (const url of urls) {
      if (!(await cache.match(url, MATCH))) missing.push(url);
    }
    // One failure must not discard the rest, so cache them individually.
    await Promise.all(missing.map((url) => cache.add(url).catch(() => undefined)));
  }

  /**
   * Fills the cache without this game's page ever having been opened.
   *
   * `index.html` is the one URL here that is not hashed, so it is enough to
   * start from: it names the entry chunk and the stylesheets, and the entry
   * chunk in turn names the level generator worker as a bare string, which no
   * tag in the markup ever mentions. Crawling what is fetched — rather than
   * reading a build manifest — is what keeps these workers unbundled.
   */
  async function warm() {
    const cache = await caches.open(CACHE_VERSION);

    // Ahead of the shell, so the revalidated copy is the one in the cache and
    // `precache` finds nothing left to fetch for it. Warming runs on every page
    // load, so anything already held has to cost no request at all.
    const index = await refresh(cache, './index.html');
    if (!index) return;

    await precache(SHELL);

    const seen = new Set();
    let frontier = assetUrls(await index.text());

    while (frontier.length) {
      const next = [];
      for (const url of frontier) {
        if (seen.has(url)) continue;
        seen.add(url);

        const response = await fetchInto(cache, url);
        // Only a JS chunk can name another chunk; nothing else is worth reading.
        if (response && url.endsWith('.js')) next.push(...assetUrls(await response.text()));
      }
      frontier = next;
    }
  }

  /**
   * Network-first for the one unhashed URL the crawl starts from.
   *
   * A game that is only ever warmed and never opened would otherwise sit on
   * whatever markup it first saw, naming assets from that build for as long as
   * the cache version held. Everything it names is hashed, so when the markup
   * has not changed the rest of the crawl is served from cache and costs
   * nothing beyond this one request.
   */
  async function refresh(cache, url) {
    try {
      const response = await fetch(url, { cache: 'no-cache' });
      if (response && response.ok && response.type === 'basic') {
        await cache.put(url, response.clone());
        return response;
      }
    } catch {
      // Offline: the cached copy still describes what was already downloaded.
    }
    return cache.match(url, MATCH);
  }

  /** Resolved against this worker, so `../icons/x.png` lands on `/icons/x.png`. */
  function assetUrls(text) {
    const urls = [];
    for (const match of text.matchAll(ASSET_PATTERN)) {
      urls.push(new URL(match[0], self.location.href).pathname);
    }
    return urls;
  }

  /** Returns a readable response, from the cache if it is already there. */
  async function fetchInto(cache, url) {
    const cached = await cache.match(url, MATCH);
    if (cached) return cached;

    try {
      const response = await fetch(url);
      // Opaque cross-origin responses are not worth storing.
      if (!response || !response.ok || response.type !== 'basic') return null;
      await cache.put(url, response.clone());
      return response;
    } catch {
      // A miss during warming is not a failure: the game still caches itself
      // the ordinary way when it is opened.
      return null;
    }
  }

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
    if (response && response.ok && response.type === 'basic') {
      cache.put(request, response.clone());
    }
    return response;
  }
}
