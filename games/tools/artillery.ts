/**
 * Measurement harness for Artillery.
 *
 * There is no difficulty curve here — the opponent is the person holding the
 * other end of the phone — so the three numbers worth having are the three that
 * decide whether a battlefield is a game at all. All three were guesses before
 * this file existed, and the skill file is emphatic about what guessing a band
 * costs, so they are measured before anything is calibrated against them.
 *
 * **1. What generation costs.** Every candidate battlefield is fired at from
 * both sides before it ships, and a reachability check that rejects most
 * candidates would put seconds between tapping New match and seeing one. The
 * question is how many attempts a match actually takes.
 *
 * **2. How findable a hit is.** Over the whole (angle, power) grid, how many
 * settings put a plain shell on the other tank? This is the one that decides
 * whether the game is a puzzle or a lottery. A battlefield with four winning
 * settings out of two thousand is arithmetically solvable and, in the hand, a
 * raffle — the same failure Survival's horde had before it was made a
 * percentile.
 *
 * **3. How long a match runs.** Played out by a policy that ranges in the way a
 * person does: search coarsely, fire, then correct off the miss. If matches
 * take forty volleys the damage numbers are too small, and if they take three
 * the draft never gets used.
 *
 * Run with:
 *   npx vitest run --config tools/vitest.artillery.config.ts
 */

import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';

import { createRng, hashSeed } from '../src/shared/rng';
import { columnCentre, type Terrain } from '../src/artillery/terrain';
import { fly, muzzleOf, TURRET_Y } from '../src/artillery/physics';
import { PLAIN_SHELL, weaponById } from '../src/artillery/weapons';
import {
  ANGLE_MAX,
  ANGLE_MIN,
  type MatchState,
  MOVE_BUDGET,
  POOL_IDS,
  POWER_MAX,
  POWER_MIN,
  arsenalsFrom,
  available,
  chooseWeapon,
  draftComplete,
  draftPick,
  firstPickerFor,
  isOver,
  openingDraft,
  openingState,
  resolveShot,
  setAngle,
  setPower,
  winnerOf,
} from '../src/artillery/model';
import { canReach, generateOpening, hasLineOfSight } from '../src/artillery/generate';

const SEED = 'probe-artillery';

const lines: string[] = [];
const log = (text = ''): void => {
  lines.push(text);
  console.log(text);
};

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[index] as number;
}

/* ------------------------------------------------------------------ */

/** How many (angle, power) settings put a plain shell on the other tank. */
function hitWindow(
  terrain: Terrain,
  from: number,
  to: number,
  angleStep: number,
  powerStep: number,
): { hits: number; total: number; minPower: number | null } {
  const ground = terrain[from] as number;
  const targetX = columnCentre(to);
  const targetY = (terrain[to] as number) + TURRET_Y;
  const radius = PLAIN_SHELL.radius;

  let hits = 0;
  let total = 0;
  let minPower: number | null = null;

  for (let angle = ANGLE_MIN + 2; angle <= ANGLE_MAX - 2; angle += angleStep) {
    const muzzle = muzzleOf(columnCentre(from), ground, angle);
    for (let power = POWER_MIN; power <= POWER_MAX; power += powerStep) {
      total++;
      const flight = fly(terrain, muzzle, angle, power, []);
      if (!flight.impact) continue;
      const dx = flight.impact.x - targetX;
      const dy = flight.impact.y - targetY;
      if (dx * dx + dy * dy > radius * radius) continue;
      hits++;
      if (minPower === null || power < minPower) minPower = power;
    }
  }

  return { hits, total, minPower };
}

/* ------------------------------------------------------------------ */

/**
 * A player who ranges in rather than one who solves.
 *
 * Searches a coarse grid for a setting that lands near the enemy, then spoils
 * it: the aim it actually dials is a couple of degrees and a few points of
 * power off what it found. That models the thing being built for — somebody
 * reading an arc off the screen and correcting — rather than a search, which is
 * the mistake Color Sort's first difficulty signal made.
 */
function aimOf(state: MatchState, jitter: (spread: number) => number): { angle: number; power: number } {
  const seat = state.turn;
  const me = state.tanks[seat];
  const them = state.tanks[seat === 0 ? 1 : 0];
  const ground = state.terrain[me.col] as number;
  const targetX = columnCentre(them.col);
  const targetY = (state.terrain[them.col] as number) + TURRET_Y;

  let best = { angle: me.angle, power: me.power, distance: Infinity };
  for (let angle = 10; angle <= 170; angle += 5) {
    const muzzle = muzzleOf(columnCentre(me.col), ground, angle);
    for (let power = 20; power <= 100; power += 5) {
      const flight = fly(state.terrain, muzzle, angle, power, []);
      if (!flight.impact) continue;
      const distance = Math.hypot(flight.impact.x - targetX, flight.impact.y - targetY);
      if (distance < best.distance) best = { angle, power, distance };
    }
  }

  return {
    angle: Math.max(ANGLE_MIN, Math.min(ANGLE_MAX, best.angle + jitter(3))),
    power: Math.max(POWER_MIN, Math.min(POWER_MAX, best.power + jitter(4))),
  };
}

/** Plays a whole match out. Returns the volleys it took, or null if it stalled. */
function playMatch(match: number, seed: number): { volleys: number; winner: number | null } | null {
  const rng = createRng(seed);
  const jitter = (spread: number): number => rng.range(-spread, spread);

  const opening = generateOpening(SEED, match);
  const firstFirer = ((match - 1) % 2) as 0 | 1;

  let draft = openingDraft(opening.pool, firstPickerFor(firstFirer));
  while (!draftComplete(draft)) {
    // Greedy: take the most damaging thing left, which is roughly how anybody
    // drafts the first time they see the shop.
    const open = draft.taken
      .map((seat, index) => ({ seat, index }))
      .filter((entry) => entry.seat === null);
    const best = open.reduce((pick, entry) => {
      const here = weaponById(draft.pool[entry.index] as string).damage;
      const there = weaponById(draft.pool[pick.index] as string).damage;
      return here > there ? entry : pick;
    });
    draft = draftPick(draft, best.index) as typeof draft;
  }

  let state = openingState(opening, arsenalsFrom(draft), firstFirer);

  for (let turn = 0; turn < 120; turn++) {
    if (isOver(state)) return { volleys: state.volley, winner: winnerOf(state) };

    const seat = state.turn;
    const arsenal = available(state, seat);
    const pick = arsenal.reduce((best, weapon) =>
      weapon.damage * weapon.shots > best.damage * best.shots ? weapon : best,
    );

    const aim = aimOf(state, jitter);
    let next = chooseWeapon(state, pick.id);
    next = setPower(setAngle(next, aim.angle), aim.power);
    state = resolveShot(next).next;
  }

  return null;
}

/* ------------------------------------------------------------------ */

describe('artillery', () => {
  it(
    'measures generation, the hit window, and how long a match runs',
    () => {
      log('# Artillery calibration');
      log();
      log('Generated by `tools/artillery.ts`. See its header.');
      log();

      /* ------------------------------------------------ 1. generation */

      log('## 1. What a battlefield costs to generate');
      log();

      const MATCHES = 200;
      let covered = 0;
      let reachable = 0;
      const ranges: number[] = [];
      const gaps: number[] = [];

      const started = Date.now();
      const openings = [];
      for (let match = 1; match <= MATCHES; match++) {
        const opening = generateOpening(SEED, match);
        openings.push(opening);
        if (!hasLineOfSight(opening.terrain, opening.columns)) covered++;
        if (
          canReach(opening.terrain, opening.columns[0], opening.columns[1]) &&
          canReach(opening.terrain, opening.columns[1], opening.columns[0])
        ) {
          reachable++;
        }
        ranges.push(Math.max(...opening.terrain) - Math.min(...opening.terrain));
        gaps.push(
          Math.abs(
            (opening.terrain[opening.columns[0]] as number) -
              (opening.terrain[opening.columns[1]] as number),
          ),
        );
      }
      const elapsed = Date.now() - started;

      log(`${MATCHES} matches generated in ${elapsed}ms — ${(elapsed / MATCHES).toFixed(1)}ms each`);
      log(`both sides can reach the other: ${reachable}/${MATCHES}`);
      log(`line of sight blocked:          ${covered}/${MATCHES} (${((covered / MATCHES) * 100).toFixed(0)}%)`);
      log(`height range across the field:  mean ${mean(ranges).toFixed(1)}, p10 ${percentile(ranges, 0.1)}, p90 ${percentile(ranges, 0.9)}`);
      log(`start height difference:        mean ${mean(gaps).toFixed(1)}, p90 ${percentile(gaps, 0.9)}`);
      log();

      /* ------------------------------------------------ 2. hit window */

      log('## 2. How findable a hit is');
      log();
      log('Plain shell only, swept over the dial the player actually turns. A');
      log('window of a handful of settings is a raffle; a window of hundreds is');
      log('a battlefield with nothing to work out.');
      log();

      const WINDOW_MATCHES = 40;
      const windows: number[] = [];
      const shares: number[] = [];
      const powers: number[] = [];

      for (let match = 1; match <= WINDOW_MATCHES; match++) {
        const opening = openings[match - 1];
        if (!opening) continue;
        for (const [from, to] of [
          [opening.columns[0], opening.columns[1]],
          [opening.columns[1], opening.columns[0]],
        ] as const) {
          const window = hitWindow(opening.terrain, from, to, 3, 3);
          windows.push(window.hits);
          shares.push(window.hits / window.total);
          if (window.minPower !== null) powers.push(window.minPower);
        }
      }

      log(`settings that connect (of ${(((ANGLE_MAX - 4) / 3) | 0) + 1} angles x ${(((POWER_MAX - POWER_MIN) / 3) | 0) + 1} powers):`);
      log(`  mean ${mean(windows).toFixed(1)}   p10 ${percentile(windows, 0.1)}   median ${percentile(windows, 0.5)}   p90 ${percentile(windows, 0.9)}`);
      log(`  as a share of the grid: mean ${(mean(shares) * 100).toFixed(1)}%`);
      log(`  sides with no connecting setting at all: ${windows.filter((count) => count === 0).length}/${windows.length}`);
      log(`lowest power that connects: mean ${mean(powers).toFixed(0)}, p10 ${percentile(powers, 0.1)}, p90 ${percentile(powers, 0.9)}`);
      log();

      /* ------------------------------------------------ 3. match length */

      log('## 3. How long a match runs');
      log();
      log('Both sides played by the ranging policy in this file: search a coarse');
      log('grid, then dial in something a few degrees off it. Weapons are spent');
      log('most-damaging-first, which is what nobody does after their third match.');
      log();

      const PLAYED = 60;
      const volleys: number[] = [];
      let stalled = 0;
      const wins = [0, 0];

      for (let i = 0; i < PLAYED; i++) {
        const result = playMatch((i % 40) + 1, hashSeed(SEED, 'play', i));
        if (!result) {
          stalled++;
          continue;
        }
        volleys.push(result.volleys);
        if (result.winner !== null) wins[result.winner] = (wins[result.winner] as number) + 1;
      }

      log(`volleys to a decision: mean ${mean(volleys).toFixed(1)}, p10 ${percentile(volleys, 0.1)}, median ${percentile(volleys, 0.5)}, p90 ${percentile(volleys, 0.9)}`);
      log(`matches that never finished in 120 turns: ${stalled}/${PLAYED}`);
      log(`wins by seat: left ${wins[0]}, right ${wins[1]} (the right seat fires first on odd matches)`);
      log(`move budget ${MOVE_BUDGET} columns, pool of ${POOL_IDS.length}`);
      log();

      writeFileSync('tools/artillery.txt', `${lines.join('\n')}\n`);
    },
    900_000,
  );
});
