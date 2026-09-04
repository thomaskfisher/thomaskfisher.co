/**
 * Calibration harness for Gridlock.
 *
 * Gridlock's difficulty signal is the exact length of a shortest solution, and
 * this file is the evidence behind every constant that maps that number onto
 * the shared curve. It was written and run **before** `EASIEST_MOVES` and
 * `HARDEST_MOVES` were set, which is the order that matters: a band calibrated
 * to a range the format cannot reach makes every attempt miss, which is what
 * flattened Color Sort's curve and cost two days of wondering why level 100
 * felt like level 20.
 *
 * Three sections, in the order they were needed.
 *
 * **1. Reachable depth.** How deep a random park's component actually goes.
 * The answer was brutal and changed the design: a median of two or three
 * slides, with anything past eighteen turning up about once in a hundred
 * layouts. Dealing parks and keeping the hard ones was never going to work. It
 * also handed over the fact the generator is built on — deep layouts have
 * *small* components, three to seven thousand positions, so a park with a
 * hundred thousand reachable positions is a wide-open one and can be thrown
 * away cheaply. That is where `STATE_CAP` comes from.
 *
 * **2. The curve.** What the finished generator produces level by level: the
 * depth asked for, the depth delivered, whether it landed in the band, and the
 * mean number of slides available along the solution. That last column is the
 * guard against the failure mode a move count alone cannot see — a thirty-move
 * solution in which every position has one legal move is thirty moves of no
 * decisions. It runs between five and twelve, so these are choices.
 *
 * **3. Cost.** The background worker has about one level's play to finish in,
 * so a second or two is free; the main-thread fallback and the level jump in
 * Settings have no such cover. For scale, Screw Land's deepest levels already
 * cost three and a half seconds in `tools/timing.txt`.
 *
 *   npx vitest run --config tools/vitest.gridlock.config.ts --root .
 */

import { appendFileSync, writeFileSync } from 'node:fs';

import { test } from 'vitest';

import { pressureForLevel } from '../src/shared/difficulty';
import { createRng, hashSeed } from '../src/shared/rng';
import { buildSolvedLayout, generateLevel, movesForScore } from '../src/gridlock/generate';
import { applyMove, legalMoves } from '../src/gridlock/model';
import { analyse, findSolution } from '../src/gridlock/solve';

const OUT = 'tools/gridlock.txt';
const log = (line: string): void => appendFileSync(OUT, `${line}\n`);
const pad = (v: unknown, w: number) => String(v).padStart(w);

const quantile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
};

test('reachable depth of a random park', () => {
  writeFileSync(OUT, '');
  log('=== 1. reachable depth by vehicle count (200 layouts each) ===');
  log('How many slides the hardest position in a random park is from the exit.');
  log('This is the ceiling of the difficulty scale, and it is low.');
  log('');
  log('  cars  trucks   depth p50  p90  max    >=10   >=14   >=18    states p50    p90');

  for (const vehicles of [8, 9, 10, 11, 12, 13, 14]) {
    for (const truckShare of [0.2, 0.45]) {
      const depths: number[] = [];
      const sizes: number[] = [];

      for (let seed = 0; seed < 200; seed++) {
        const rng = createRng(hashSeed('probe', vehicles, truckShare, seed));
        const layout = buildSolvedLayout({ vehicles, gates: 2, truckShare, busShare: 0.08 }, rng);
        if (!layout) continue;
        const result = analyse(layout.board, layout.solved, 40_000);
        if (!result) continue;
        depths.push(result.depth);
        sizes.push(result.size);
      }

      const share = (n: number) =>
        `${((depths.filter((d) => d >= n).length / 200) * 100).toFixed(1)}%`;

      log(
        `  ${pad(vehicles, 4)}  ${pad(truckShare, 6)}       ${pad(quantile(depths, 0.5), 4)} ` +
          `${pad(quantile(depths, 0.9), 4)} ${pad(quantile(depths, 1), 4)}   ${pad(share(10), 6)} ` +
          `${pad(share(14), 6)} ${pad(share(18), 6)}    ${pad(quantile(sizes, 0.5), 9)} ` +
          `${pad(quantile(sizes, 0.9), 6)}`,
      );
    }
  }
}, 900_000);

test('the curve the generator produces', () => {
  log('');
  log('=== 2. generated levels across the curve ===');
  log('want is the depth the band asked for; moves is what came out.');
  log('branch is the mean number of slides on offer along the solution — a');
  log('forced corridor would show up here as a number near 1.');
  log('');
  log('  level  press  band          want  moves  diff   in?  sweeps  states    ms  cars  branch');

  let inBand = 0;
  let total = 0;

  for (const level of [
    1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 20, 24, 25, 30, 35, 40, 45, 50, 60, 75, 100, 150, 220,
  ]) {
    const started = Date.now();
    const generated = generateLevel('curve-seed', level);
    const ms = Date.now() - started;

    const pressure = pressureForLevel(
      level,
      createRng(hashSeed('curve-seed', 'gridlock', 'pressure', level)),
    );
    const want = Math.round(movesForScore((pressure.band[0] + pressure.band[1]) / 2));
    const ok = generated.difficulty >= pressure.band[0] && generated.difficulty <= pressure.band[1];
    if (ok) inBand++;
    total++;

    const line = findSolution(generated.board, generated.start) ?? [];
    let at: readonly number[] = generated.start;
    const branches: number[] = [];
    for (const move of line) {
      branches.push(legalMoves(generated.board, at).length);
      at = applyMove(at, move);
    }
    const branch = branches.reduce((a, b) => a + b, 0) / Math.max(1, branches.length);

    log(
      `  ${pad(level, 5)}  ${pressure.pressure.toFixed(2)}  ` +
        `[${pressure.band[0].toFixed(2)},${pressure.band[1].toFixed(2)}]  ${pad(want, 4)}  ` +
        `${pad(generated.moves, 5)}  ${generated.difficulty.toFixed(2)}   ${ok ? ' y ' : ' N '}  ` +
        `${pad(generated.attempts, 6)}  ${pad(generated.states, 6)}  ${pad(ms, 4)}  ` +
        `${pad(generated.board.vehicles.length, 4)}  ${pad(branch.toFixed(1), 6)}`,
    );
  }

  log('');
  log(`in band: ${inBand}/${total}`);
}, 900_000);

test('what a level costs to generate', () => {
  log('');
  log('=== 3. generation cost ===');
  log('');

  for (const [label, levels] of [
    ['opening (1-12)', Array.from({ length: 12 }, (_, i) => i + 1)],
    ['mid (20-34)', Array.from({ length: 15 }, (_, i) => i + 20)],
    ['ceiling (48-77)', Array.from({ length: 30 }, (_, i) => i + 48)],
  ] as [string, number[]][]) {
    const times: number[] = [];
    for (const level of levels) {
      const started = Date.now();
      generateLevel('timing-seed', level);
      times.push(Date.now() - started);
    }

    log(
      `${label.padEnd(18)} p50 ${pad(quantile(times, 0.5), 5)}ms   ` +
        `p90 ${pad(quantile(times, 0.9), 5)}ms   max ${pad(quantile(times, 1), 5)}ms   ` +
        `mean ${pad(Math.round(times.reduce((a, b) => a + b, 0) / times.length), 5)}ms`,
    );
  }
}, 900_000);
