/**
 * Anonymous daily counts: how many devices opened the site, and each game.
 *
 * The only thing that ever leaves the device is "+1 to today's number for this
 * game". No cookie, no ID, no fingerprint, no IP kept by us — nothing that could
 * tell one player from another or follow anyone between days. A device is
 * counted at most once per game per day because *this* device remembers, in its
 * own localStorage, which counts it has already added today; the server is never
 * asked who it is. Clearing site data just means counting again.
 *
 * Counts go to the Firebase Realtime Database under `visits/<day>/<key>`, where
 * `key` is a game's slug or `site` for the origin as a whole. The database
 * rules (`database.rules.json` at the repo root) refuse anything but a +1 to a
 * well-formed key. `/stats/` reads them back as a chart.
 *
 * Plain classic JS on purpose, like `/warm.js`: copied verbatim by the build,
 * and loaded by the launcher and every game with the same tag. Offline, the
 * request fails and nothing is marked, so the device is counted on its next
 * online visit that day.
 */

(() => {
  const DB = 'https://thomaskfisher-d6a4e-default-rtdb.firebaseio.com';
  const KEY = 'tf-games:counted';
  // Set from /stats/ so the owner's own devices stay out of the numbers.
  const OPT_OUT = 'tf-games:dont-count';
  const DEV_PORT = '5273';

  if (location.port === DEV_PORT || location.hostname === 'localhost') return;

  let optedOut = false;
  let counted = {};
  try {
    optedOut = localStorage.getItem(OPT_OUT) === '1';
    counted = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    // Storage blocked: count anyway, at worst once per page load.
  }
  if (optedOut) return;

  // The visitor's own calendar day, so "today" means what it means to them.
  const now = new Date();
  const day = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');

  if (counted.day !== day) counted = { day, keys: [] };

  const slug = location.pathname.split('/')[1];
  const keys = ['site'];
  if (slug && /^[a-z0-9]{1,24}$/.test(slug)) keys.push(slug);

  const todo = keys.filter((k) => counted.keys.indexOf(k) === -1);
  if (!todo.length) return;

  const body = {};
  for (const k of todo) body[k] = { '.sv': { increment: 1 } };

  fetch(`${DB}/visits/${day}.json`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    keepalive: true,
  })
    .then((response) => {
      if (!response.ok) return;
      counted.keys.push(...todo);
      try {
        localStorage.setItem(KEY, JSON.stringify(counted));
      } catch {
        // Nothing to do: the next load simply counts again.
      }
    })
    .catch(() => {
      // Offline or blocked. Counting is never worth an error.
    });
})();
