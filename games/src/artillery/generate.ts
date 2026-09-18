/**
 * Battlefield generation, and the check that stands where the solver stands in
 * every other game here.
 *
 * There is no level to solve — the opponent is the person holding the other end
 * of the phone — but there is still a promise to keep, and it is the same
 * promise: **nothing is shown that cannot be played.** A heightmap dealt from
 * noise can be a fortress. Put one tank in a bowl behind a forty-unit wall and
 * there is no angle and no power that reaches the other side; both players then
 * spend the match discovering that the battlefield was the problem. So every
 * candidate is fired at before it ships:
 *
 *  - **Both sides can reach the other.** For each tank, a coarse sweep of
 *    angle and power looks for a plain shell that lands close enough to do
 *    damage. The plain shell is the right weapon to test with because it is the
 *    only one both players are guaranteed to hold all match.
 *  - **Usually, neither can see the other.** A straight line between the two
 *    turrets has to pass through the ground. That is the whole game — if you
 *    can point at your opponent, there is nothing to work out — and it is
 *    checked exactly rather than hoped for. One battlefield in four is left
 *    open on purpose, because a flat duel plays differently and the variety is
 *    worth more than the rule.
 *
 * Both checks are cheap: a trial shot is a few hundred multiply-adds, and a
 * reachable battlefield is usually found on the first or second attempt. Which
 * is why this runs on the main thread with no worker — unlike the puzzles,
 * where a generator can spend seconds in a solver.
 */

import { createRng, hashSeed, type Rng } from '../shared/rng';
import {
  COLUMNS,
  type Terrain,
  clampHeight,
  columnCentre,
  createTerrain,
  flatten,
  GROUND_MAX,
  GROUND_MIN,
  heightAt,
} from './terrain';
import { fly, muzzleOf, TURRET_Y } from './physics';
import { PLAIN_SHELL } from './weapons';
import { type Opening, POOL_IDS } from './model';

/** Where each tank may start. Inset from the edge, so both have room to move. */
const LEFT_START: [number, number] = [4, 14];
const RIGHT_START: [number, number] = [81, 91];

/** Candidates tried before the search gives up and flattens the field. */
const MAX_ATTEMPTS = 40;

/** One battlefield in this many is an open field rather than a covered one. */
const OPEN_FIELD_IN = 4;

/**
 * Connecting settings a side must have before the battlefield ships.
 *
 * One is not enough, and the probe is what said so: `tools/artillery.ts` swept
 * a finer grid than this check uses and found a side where a single coarse
 * setting connected and the finer sweep found none at all. A lone hit on a
 * coarse grid is a needle — the aim that finds it is luck rather than ranging —
 * so a battlefield has to offer a band of them.
 */
const MIN_REACH_SETTINGS = 3;

/**
 * The battlefield for a match.
 *
 * A pure function of the profile seed and the match number, so a match is
 * reproducible from its number, two devices with the same save code get the
 * same ground, and a bug report is one integer.
 */
export function generateOpening(seed: string, match: number): Opening {
  const wantsCover = hashSeed(seed, 'artillery-cover', match) % OPEN_FIELD_IN !== 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rng = createRng(hashSeed(seed, 'artillery', match, attempt));
    const candidate = shape(rng, wantsCover);
    if (!wellFormed(candidate)) continue;
    // Both ways round: a covered battlefield must block the line, and an open
    // one must not. Requiring cover and merely hoping for the opposite gave 99%
    // cover in 200 matches, because a battlefield with a feature in the middle
    // of it blocks the line whether or not anybody asked.
    if (hasLineOfSight(candidate.terrain, candidate.columns) === wantsCover) continue;
    if (!bothCanReach(candidate.terrain, candidate.columns)) continue;
    return { ...candidate, pool: [...POOL_IDS] };
  }

  return { ...fallback(wantsCover), pool: [...POOL_IDS] };
}

interface Candidate {
  terrain: Terrain;
  columns: [number, number];
}

/**
 * Rolling ground, then one feature in the middle of it.
 *
 * The rolling part is three sine waves rather than value noise, for a reason
 * that showed up on screen: independent per-column noise gives a ragged edge
 * that looks like static at this resolution, and smoothing it back costs a pass
 * that the waves do not need. The feature is what the match is actually about,
 * so it is chosen explicitly rather than left to the noise to produce by luck.
 */
function shape(rng: Rng, wantsCover: boolean): Candidate {
  const terrain = createTerrain();
  const mid = rng.range(40, 58);

  // An open battlefield is built to be open rather than searched for. Asking
  // for one and dealing the same candidates found the fallback instead: with a
  // hill, a plateau or twin peaks in the middle and waves up to ten units on
  // top, forty attempts in a row all blocked the line, and the request was
  // quietly answered with a covered field. Flatter waves and a dip in the
  // middle is what an open field actually is.
  const swell = wantsCover ? 10 : 4;

  const waves = [0, 1, 2].map(() => ({
    length: rng.range(24, 96),
    amplitude: rng.range(2, swell),
    phase: rng.next() * Math.PI * 2,
  }));

  const feature = featureFor(rng, wantsCover);

  for (let c = 0; c < COLUMNS; c++) {
    let height = mid;
    for (const wave of waves) {
      height += Math.sin((c / wave.length) * Math.PI * 2 + wave.phase) * wave.amplitude;
    }
    height += feature(c);
    terrain[c] = clampHeight(height);
  }

  const columns: [number, number] = [
    rng.range(LEFT_START[0], LEFT_START[1]),
    rng.range(RIGHT_START[0], RIGHT_START[1]),
  ];
  flatten(terrain, columns[0]);
  flatten(terrain, columns[1]);

  return { terrain, columns };
}

/**
 * A bump, a dip, a plateau or two peaks, as a height offset per column.
 *
 * An open battlefield gets the dip and nothing else — it is the only one of the
 * four that leaves two tanks on the rim able to see each other, and a valley
 * between them is still a real feature: it is where a digger drops somebody out
 * of the duel entirely.
 */
function featureFor(rng: Rng, wantsCover: boolean): (column: number) => number {
  const centre = COLUMNS / 2 + rng.range(-9, 9);
  const kind = wantsCover ? rng.int(4) : 1;

  if (kind === 0) {
    const amplitude = rng.range(26, 52);
    const width = rng.range(9, 20);
    return (c) => amplitude * Math.exp(-(((c - centre) / width) ** 2));
  }

  if (kind === 1) {
    const depth = rng.range(16, 32);
    const width = rng.range(11, 24);
    return (c) => -depth * Math.exp(-(((c - centre) / width) ** 2));
  }

  if (kind === 2) {
    // A plateau: a flat top with shoulders steep enough to matter. `tanh` gives
    // the shoulders without a corner for the climb check to argue about.
    const amplitude = rng.range(22, 40);
    const halfWidth = rng.range(10, 20);
    const edge = rng.range(3, 7);
    return (c) =>
      (amplitude *
        (Math.tanh((c - (centre - halfWidth)) / edge) - Math.tanh((c - (centre + halfWidth)) / edge))) /
      2;
  }

  const amplitude = rng.range(22, 42);
  const width = rng.range(6, 11);
  const gap = rng.range(12, 20);
  return (c) =>
    amplitude * Math.exp(-(((c - centre + gap) / width) ** 2)) +
    amplitude * Math.exp(-(((c - centre - gap) / width) ** 2));

}

/**
 * The cheap checks, run before the expensive one.
 *
 * A tank standing on the floor or the ceiling of the field is not a playable
 * start — at the floor there is nothing left to dig, and at the ceiling a dirt
 * weapon has nowhere to put anything. The gap between the two starting heights
 * is capped as well: a match that opens with one tank fifty units above the
 * other is decided by the terrain rather than by either player.
 */
function wellFormed(candidate: Candidate): boolean {
  const [left, right] = candidate.columns;
  const heights = [candidate.terrain[left] as number, candidate.terrain[right] as number];
  if (heights.some((height) => height <= GROUND_MIN + 6 || height >= GROUND_MAX - 24)) return false;
  return Math.abs((heights[0] as number) - (heights[1] as number)) <= 26;
}

/** Does the straight line between the two turrets clear the ground? */
export function hasLineOfSight(terrain: Terrain, columns: [number, number]): boolean {
  const ax = columnCentre(columns[0]);
  const ay = (terrain[columns[0]] as number) + TURRET_Y;
  const bx = columnCentre(columns[1]);
  const by = (terrain[columns[1]] as number) + TURRET_Y;

  const steps = 240;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    if (y <= heightAt(terrain, x)) return false;
  }
  return true;
}

/**
 * Is there a plain shell from `from` that would damage a tank at `to`?
 *
 * The sweep is coarse — four degrees and five points of power — which is
 * deliberately coarser than the controls. A battlefield where the only shot
 * that connects is a single degree of a single power setting is one nobody
 * finds, so passing on a coarse grid is the right question to ask. `radius` is
 * the plain shell's blast, so "reaches" means "does damage", not "lands
 * somewhere in the region".
 */
export function canReach(terrain: Terrain, from: number, to: number): boolean {
  return reachCount(terrain, from, to, MIN_REACH_SETTINGS) >= MIN_REACH_SETTINGS;
}

/** Connecting settings found, stopping once `enough` of them have turned up. */
export function reachCount(terrain: Terrain, from: number, to: number, enough = Infinity): number {
  const ground = terrain[from] as number;
  const targetX = columnCentre(to);
  const targetY = (terrain[to] as number) + TURRET_Y;
  const radius = PLAIN_SHELL.radius;

  let found = 0;
  for (let angle = 10; angle <= 170; angle += 4) {
    const muzzle = muzzleOf(columnCentre(from), ground, angle);
    for (let power = 20; power <= 100; power += 5) {
      const flight = fly(terrain, muzzle, angle, power, []);
      if (!flight.impact) continue;
      const dx = flight.impact.x - targetX;
      const dy = flight.impact.y - targetY;
      if (dx * dx + dy * dy <= radius * radius && ++found >= enough) return found;
    }
  }
  return found;
}

function bothCanReach(terrain: Terrain, columns: [number, number]): boolean {
  return (
    canReach(terrain, columns[0], columns[1]) && canReach(terrain, columns[1], columns[0])
  );
}

/**
 * The battlefield of last resort, and it comes in both kinds.
 *
 * One fallback was a bug rather than a shortcut: it was a hill, so a match that
 * asked for an open field and ran out of attempts got a covered one, and the
 * only sign of it was a battlefield that did not match its own seed. The two
 * shapes are the cheapest possible examples of each — a hill nobody can see
 * over, and a dip everybody can see across — and both are trivially reachable
 * from both sides, so this is a playable match rather than an error state.
 */
function fallback(wantsCover: boolean): Candidate {
  const terrain = createTerrain(44);
  const centre = COLUMNS / 2;
  const amplitude = wantsCover ? 28 : -24;
  const width = wantsCover ? 12 : 18;
  for (let c = 0; c < COLUMNS; c++) {
    terrain[c] = clampHeight(44 + amplitude * Math.exp(-(((c - centre) / width) ** 2)));
  }
  const columns: [number, number] = [9, 86];
  flatten(terrain, columns[0]);
  flatten(terrain, columns[1]);
  return { terrain, columns };
}
