/**
 * Five Dice service worker.
 *
 * The body lives in `/game-sw.js`, shared with the other games. All this stub
 * binds is the cache namespace: the slug this worker owns, and the version to
 * bump when Five Dice's cached contents go stale. Imported scripts count towards
 * the update byte-check, so a change to the shared body still lands here.
 *
 * This is the one game with no level generator, so the crawl in the shared body
 * finds only the entry chunk and the stylesheet. That is not a problem — it
 * follows whatever `index.html` names — but it is why there is no
 * `generate.worker.ts` alongside the others.
 */

importScripts('/game-sw.js');

initGameWorker('fivedice', 'v1');
