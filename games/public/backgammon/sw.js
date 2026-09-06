/**
 * Backgammon service worker.
 *
 * The body lives in `/game-sw.js`, shared with the other games. All this stub
 * binds is the cache namespace: the slug this worker owns, and the version to
 * bump when Backgammon's cached contents go stale. Imported scripts count
 * towards the update byte-check, so a change to the shared body still lands
 * here.
 *
 * Like Five Dice, this game has no level generator, so the crawl in the shared
 * body finds only the entry chunk and the stylesheet — there is nothing to
 * generate, only a board and two people.
 */

importScripts('/game-sw.js');

initGameWorker('backgammon', 'v1');
