/**
 * Calibration harness for Pipes.
 *
 * Run before the difficulty mapping in `generate.ts` was settled. The question
 * that mattered most was the second one, and its answer decided the design:
 *
 * **1. What does forced-share range over?** If a board is always 90%+ deducible
 * then the think term has nothing to say and difficulty is grid size alone.
 *
 * **2. Which way does corridor bias push it?** A windier tree has more corners
 * and looks harder. A corner has four rotations to a straight's two, so more
 * corners means more candidates per tile — which reads like "harder" and is not
 * what makes a pipes board hard. This is the measurement that settles it.
 *
 * **3. The curve, and the cost.**
 */

import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';

import { pressureForLevel } from '../src/shared/difficulty';
import { createRng, hashSeed } from '../src/shared/rng';
import { GAME_ID, generateLevel, lookaheadOf, widthForPressure } from '../src/pipes/generate';
import { isSolved, popcount } from '../src/pipes/model';
import { propagate, solveWithEffort } from '../src/pipes/solve';

const lines: string[] = [];
const log = (line = ''): void => {
  lines.push(line);
  console.log(line);
};

const fixed = (n: number, places = 2): string => n.toFixed(places);
const SEED = 'curve-seed';

describe('pipes calibration', () => {
  it('measures forced-share against size and corridor bias', () => {
    log('## 1 & 2. Lookahead by width and straightness (forced share is always 1)');
    log();
    log('width  straight  look min  mean  max    forced  straights%');

    for (const width of [4, 5, 6, 7, 8]) {
      for (const straightness of [0.05, 0.35, 0.65, 0.9]) {
        let min = Infinity;
        let max = 0;
        let total = 0;
        let straightTiles = 0;
        let crossTiles = 0;
        let tiles = 0;
        const samples = 24;

        for (let sample = 0; sample < samples; sample++) {
          // Rebuilt here rather than called through generateLevel, so the
          // straightness can be swept independently of the band.
          const rng = createRng(hashSeed('probe', width, straightness, sample));
          const level = buildAt(rng, width, straightness);

          const effort = solveWithEffort(level.board, level.start);
          const value = lookaheadOf(effort.examined, effort.steps);
          total += value;
          min = Math.min(min, value);
          max = Math.max(max, value);
          crossTiles += propagate(level.board, level.start).forcedShare;

          for (const mask of level.board.solution) {
            tiles++;
            if (popcount(mask) === 4) continue;
            if (mask === 0b0101 || mask === 0b1010) straightTiles++;
          }
        }

        log(
          `${String(width).padStart(5)}  ${fixed(straightness).padStart(8)}  ` +
            `${fixed(min).padStart(8)}  ${fixed(total / samples)}  ${fixed(max)}  ` +
            `${fixed(crossTiles / samples).padStart(6)}  ${fixed(straightTiles / tiles).padStart(10)}`,
        );
      }
    }
    log();
  });

  it('prints the curve the generator delivers', () => {
    log('## 3. The curve');
    log();
    log('level  grid   band          difficulty  lookahead  turns  ms');

    for (const level of [1, 2, 3, 5, 8, 12, 16, 20, 25, 30, 40, 50, 65, 80, 120]) {
      const rng = createRng(hashSeed(SEED, GAME_ID, level));
      const { pressure, band } = pressureForLevel(level, rng);

      const started = Date.now();
      const generated = generateLevel(SEED, level);
      const elapsed = Date.now() - started;

      const inBand =
        generated.difficulty >= band[0] && generated.difficulty <= band[1] ? '' : '  <- missed';
      const width = widthForPressure(pressure);

      log(
        `${String(level).padStart(5)}  ${`${width}x${width + 2}`.padStart(4)}  ` +
          `[${fixed(band[0])}, ${fixed(band[1])}]  ` +
          `${fixed(generated.difficulty).padStart(10)}  ` +
          `${fixed(generated.lookahead).padStart(9)}  ` +
          `${String(generated.turns).padStart(5)}  ` +
          `${String(elapsed).padStart(3)}${inBand}`,
      );
    }
    log();
  });

  it('measures generation cost, and that nothing opens solved', () => {
    log('## 4. Cost');
    log();
    log('level  mean ms  worst ms');

    for (const level of [1, 20, 50, 100]) {
      const times: number[] = [];
      for (let sample = 0; sample < 5; sample++) {
        const started = Date.now();
        const generated = generateLevel(`cost-${sample}`, level);
        times.push(Date.now() - started);
        if (isSolved(generated.board, generated.start)) {
          log(`  !! level ${level} sample ${sample} opened already solved`);
        }
      }
      const mean = times.reduce((sum, n) => sum + n, 0) / times.length;
      log(
        `${String(level).padStart(5)}  ${fixed(mean, 0).padStart(7)}  ` +
          `${String(Math.max(...times)).padStart(8)}`,
      );
    }

    log();
    writeFileSync('tools/pipes.txt', `${lines.join('\n')}\n`);
  });
});

/** The generator's own build, with straightness exposed. Kept in step by hand. */
function buildAt(rng: ReturnType<typeof createRng>, width: number, straightness: number) {
  // Reaching through generateLevel would bind straightness to the attempt
  // counter, which is the thing being swept. A tiny amount of duplication buys a
  // measurement of the lever on its own.
  const module = generateLevel;
  void module;

  const height = width + 2;
  const source = rng.int(width * height);
  const solution = growTreeForProbe(rng, width, height, source, straightness);
  const board = { width, height, source, solution };
  const start = solution.map((mask) => {
    let out = mask;
    for (let turn = rng.int(4); turn > 0; turn--) out = ((out << 1) | (out >> 3)) & 0b1111;
    return out;
  });
  return { board, start };
}

function growTreeForProbe(
  rng: ReturnType<typeof createRng>,
  width: number,
  height: number,
  root: number,
  straightness: number,
): number[] {
  const steps: [number, number][] = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
  const sides = [1, 2, 4, 8];
  const opposite = (side: number) => ((side << 2) | (side >> 2)) & 0b1111;

  const masks = new Array<number>(width * height).fill(0);
  const seen = new Array<boolean>(width * height).fill(false);
  const stack: { cell: number; from: number }[] = [{ cell: root, from: -1 }];
  seen[root] = true;

  while (stack.length) {
    const top = stack[stack.length - 1] as { cell: number; from: number };
    const { cell } = top;
    const open: number[] = [];

    for (let sideIndex = 0; sideIndex < 4; sideIndex++) {
      const step = steps[sideIndex] as [number, number];
      const x = (cell % width) + step[0];
      const y = Math.floor(cell / width) + step[1];
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      if (seen[y * width + x]) continue;
      open.push(sideIndex);
    }

    if (open.length === 0) {
      stack.pop();
      continue;
    }

    let chosen = open[rng.int(open.length)] as number;
    if (top.from >= 0 && open.includes(top.from) && rng.chance(straightness)) chosen = top.from;

    const step = steps[chosen] as [number, number];
    const next = (Math.floor(cell / width) + step[1]) * width + (cell % width) + step[0];
    const side = sides[chosen] as number;

    masks[cell] = (masks[cell] as number) | side;
    masks[next] = (masks[next] as number) | opposite(side);
    seen[next] = true;
    stack.push({ cell: next, from: chosen });
  }

  return masks;
}
