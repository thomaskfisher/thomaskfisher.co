/**
 * Service worker registration.
 *
 * The worker itself lives in `public/<game>/sw.js` as plain JS: it is copied
 * verbatim rather than bundled, so it has no hashed filenames to keep in sync
 * and caches at runtime instead of from a build manifest.
 *
 * Registration only succeeds over HTTPS or on localhost. Testing over a LAN
 * address will silently register nothing — use a Firebase preview channel to
 * check offline behaviour on a real phone.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return; // stale caches make dev genuinely confusing

  window.addEventListener('load', () => {
    const scope = new URL('./', window.location.href).pathname;
    navigator.serviceWorker
      .register(`${scope}sw.js`, { scope })
      .then(() => navigator.serviceWorker.ready)
      .then(precacheLoadedAssets)
      .catch(() => {
        // Offline play is a bonus, not a requirement. Never block the game on it.
      });
  });
}

/**
 * Tells the worker which files this page actually loaded, so it can cache them.
 *
 * Without this, the very first visit leaves the hashed JS and CSS uncached:
 * they were fetched before the worker activated, so it never saw them, and the
 * game would fail offline until the second visit. Reporting them after load
 * avoids needing a build-time precache manifest and the hashed filenames that
 * come with it.
 */
function precacheLoadedAssets(registration: ServiceWorkerRegistration): void {
  const worker = registration.active;
  if (!worker) return;

  const scope = new URL('./', window.location.href).href;
  const urls = performance
    .getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((url) => url.startsWith(scope) || url.startsWith(new URL('/assets/', scope).href));

  worker.postMessage({ type: 'precache', urls });
}
