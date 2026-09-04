/**
 * Bus Jam service worker.
 *
 * The body lives in `/game-sw.js`, shared with the other games. All this stub
 * binds is the cache namespace: the slug this worker owns, and the version to
 * bump when Bus Jam's cached contents go stale. Imported scripts count towards
 * the update byte-check, so a change to the shared body still lands here.
 */

importScripts('/game-sw.js');

initGameWorker('busjam', 'v3');
