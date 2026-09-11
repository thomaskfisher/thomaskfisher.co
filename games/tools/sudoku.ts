/**
 * Calibration harness for Sudoku.
 *
 * Written and run *before* the difficulty mapping in `generate.ts` was settled,
 * for the reason the other games here learned the hard way: a band aimed at a
 * range the format cannot reach makes every attempt miss.
 *
 * Three sections.
 *
 * **1. Reachable range.** What a full dig actually produces — how deep the
 * technique ladder goes on a maximally dug grid, and where `score` lands. If
 * the top of that is 0.4, no amount of asking for 0.9 will produce it.
 *
 * **2. The curve.** What the finished generator delivers level by level: the
 * band asked for, the difficulty delivered, the hardest technique, and the clue
 * count. The clue count is the guard against the thing the score cannot see —
 * a grid can be technically hard and visually hopeless.
 *
 * **3. Cost.** Generation happens on a worker with about one level's play to
 * finish in. Sudoku's uniqueness check runs after every dug hole, which is the
 * expensive shape, so this is not a formality.
 */

import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';

import { pressureForLevel } from '../src/shared/difficulty';
import { createRng, hashSeed } from '../src/shared/rng';
import { CELLS } from '../src/sudoku/model';
import { GAME_ID, effort, generateLevel, score } from '../src/sudoku/generate';
import { countSolutions, fillGrid, logicalSolve } from '../src/sudoku/solve';

const lines: string[] = [];
const log = (line = ''): void => {
  lines.push(line);
  console.log(line);
};

const fixed = (n: number, places = 2): string => n.toFixed(places);

/** One seed for the whole curve, so the band printed is the band asked for. */
const SEED = 'curve-seed';

describe('sudoku calibration', () => {
  it('measures the reachable difficulty range', () => {
    log('## 1. What a full dig reaches');
    log();
    log('grid  clues  hardest  effort  score  solvable-by-logic');

    let maxScore = 0;
    let minScore = 1;

    for (let sample = 0; sample < 12; sample++) {
      const rng = createRng(hashSeed('probe', sample));
      const solution = fillGrid((max) => rng.int(max));
      const grid = solution.slice();

      // Dig freely and to exhaustion — the deepest a unique grid goes.
      for (const cell of rng.shuffle(Array.from({ length: CELLS }, (_, i) => i))) {
        const saved = grid[cell] as number;
        grid[cell] = 0;
        if (countSolutions(grid, 2) !== 1) grid[cell] = saved;
      }

      const result = logicalSolve(grid);
      const value = score(result.counts);
      const clues = grid.filter((digit) => digit !== 0).length;

      maxScore = Math.max(maxScore, value);
      minScore = Math.min(minScore, value);

      log(
        `${String(sample).padStart(4)}  ${String(clues).padStart(5)}  ` +
          `${String(result.hardest).padStart(7)}  ${String(effort(result.counts)).padStart(6)}  ` +
          `${fixed(value)}  ${result.solved}`,
      );
    }

    log();
    log(`Full-dig score range: ${fixed(minScore)} .. ${fixed(maxScore)}`);
    log();
  });

  it('prints the curve the generator delivers', () => {
    log('## 2. The curve');
    log();
    log('level  band          difficulty  hardest  clues  ms');

    for (const level of [1, 2, 3, 5, 8, 12, 16, 20, 25, 30, 40, 50, 65, 80, 120]) {
      // The same rng draw generateLevel makes, so the band printed is the band
      // that was actually asked for rather than a differently-jittered one.
      const rng = createRng(hashSeed(SEED, GAME_ID, level));
      const { band } = pressureForLevel(level, rng);

      const started = Date.now();
      const generated = generateLevel(SEED, level);
      const elapsed = Date.now() - started;

      const inBand =
        generated.difficulty >= band[0] && generated.difficulty <= band[1] ? '' : '  <- missed';

      log(
        `${String(level).padStart(5)}  ` +
          `[${fixed(band[0])}, ${fixed(band[1])}]  ` +
          `${fixed(generated.difficulty).padStart(10)}  ` +
          `${String(generated.hardest).padStart(7)}  ` +
          `${String(generated.clues).padStart(5)}  ` +
          `${String(elapsed).padStart(4)}${inBand}`,
      );
    }
    log();
  });

  it('measures generation cost', () => {
    log('## 3. Cost');
    log();
    log('level  mean ms  worst ms');

    for (const level of [1, 20, 50, 100]) {
      const times: number[] = [];
      for (let sample = 0; sample < 5; sample++) {
        const started = Date.now();
        generateLevel(`cost-${sample}`, level);
        times.push(Date.now() - started);
      }
      const mean = times.reduce((sum, n) => sum + n, 0) / times.length;
      log(
        `${String(level).padStart(5)}  ${fixed(mean, 0).padStart(7)}  ` +
          `${String(Math.max(...times)).padStart(8)}`,
      );
    }

    log();
    writeFileSync('tools/sudoku.txt', `${lines.join('\n')}\n`);
  });
});
