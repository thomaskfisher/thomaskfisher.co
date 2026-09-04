/**
 * Downloads every game from whatever page is open.
 *
 * Loaded by the launcher and by each game. Without it, a game is only cached
 * once it has been opened, so flying with all four meant deliberately visiting
 * all four first — and any one that was forgotten failed on the plane. One
 * visit to any page on the origin now arms the lot.
 *
 * The game list comes from the launcher's own cards, so a new game is picked up
 * by adding its card to `games/index.html` — a step that is already required
 * for anyone to reach it. There is no second list to keep in step.
 *
 * Plain classic JS on purpose: it is copied verbatim by the build rather than
 * bundled, so its URL is unhashed and every worker can name it in a fixed shell
 * list. The launcher keeps emitting no JS chunk of its own.
 */

(() => {
  // The Vite dev server (see server.port in vite.config.ts), where a warmed
  // cache makes local edits look like they never applied.
  const DEV_PORT = '5273';

  /** A worker that never activates must not stall the games behind it. */
  const ACTIVATION_TIMEOUT = 10000;

  if (!('serviceWorker' in navigator)) return;
  if (location.port === DEV_PORT) return;

  schedule(() => {
    warmAll().catch(() => {
      // Offline play is a bonus, not a requirement. Never block a page on it.
    });
  });

  /**
   * Warming four games must never compete with the one being played, so it
   * waits for the first idle moment after load rather than for the network.
   */
  function schedule(run) {
    const start = () => {
      if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 5000 });
      else setTimeout(run, 2000);
    };

    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start);
  }

  async function warmAll() {
    if (navigator.onLine === false) return;

    const launcher = await launcherDocument();
    if (!launcher) return;

    // One at a time: the point is to finish in the background unnoticed, not to
    // put four games' worth of requests up against the current page's own.
    for (const slug of gameSlugs(launcher)) {
      await warmGame(slug).catch(() => undefined);
    }
  }

  /** The launcher is the source of truth for which games exist. */
  function launcherDocument() {
    if (location.pathname === '/' || location.pathname === '/index.html') {
      return Promise.resolve(document);
    }

    return fetch('/index.html', { cache: 'no-cache' })
      .then((response) => (response.ok ? response.text() : null))
      .then((html) => (html ? new DOMParser().parseFromString(html, 'text/html') : null))
      .catch(() => null);
  }

  function gameSlugs(launcher) {
    const slugs = [];
    // `li.soon` is the placeholder card for a game that is not built yet.
    for (const link of launcher.querySelectorAll('li:not(.soon) a.card[href]')) {
      const match = /^\.\/([a-z0-9-]+)\/$/.exec(link.getAttribute('href') || '');
      if (match) slugs.push(match[1]);
    }
    return slugs;
  }

  /**
   * Registering another game's worker from this page is allowed — the scope has
   * to sit under the worker script's own path, not under the page's — and it is
   * what lets a game fill its cache without ever being opened. The page stays
   * controlled by its own worker, which has the narrower scope.
   */
  async function warmGame(slug) {
    const scope = `/${slug}/`;
    const registration = await navigator.serviceWorker.register(`${scope}sw.js`, { scope });
    const worker = await activated(registration);
    if (worker) worker.postMessage({ type: 'warm' });
  }

  /**
   * A worker can only be messaged once it is running, and on a first visit to
   * the origin the other games' workers are still installing.
   */
  function activated(registration) {
    if (registration.active) return Promise.resolve(registration.active);

    const worker = registration.installing || registration.waiting;
    if (!worker) return Promise.resolve(null);

    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), ACTIVATION_TIMEOUT);
      const settle = (result) => {
        clearTimeout(timer);
        resolve(result);
      };

      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated') settle(worker);
        else if (worker.state === 'redundant') settle(null);
      });
    });
  }
})();
