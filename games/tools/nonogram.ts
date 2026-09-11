/**
 * Calibration harness for Nonogram.
 *
 * Run before the difficulty mapping in `generate.ts` was settled. Three
 * questions, in the order they mattered:
 *
 * **1. What does lookahead actually range over, and does size or fill rate
 * predict it?** If a 15x15 is always deep and a 6x6 always shallow, then the
 * two halves of the score are the same number counted twice and one of them
 * should go.
 *
 * **2. How often is a grown picture line-solvable at all?** That is the
 * rejection rate, and it decides whether ninety attempts is generous or barely
 * enough.
 *
 * **3. The curve, and the cost.** What the finished generator delivers level by
 * level, and whether a worker can build it while one level is being played.
 */

import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';

import { pressureForLevel } from '../src/shared/difficulty';
import { createRng, hashSeed } from '../src/shared/rng';
import { cluesFor, paintedCount } from '../src/nonogram/model';
import { GAME_ID, generateLevel, lookaheadOf, sizeForPressure } from '../src/nonogram/generate';
import { solveByLines } from '../src/nonogram/solve';

const lines: string[] = [];
const log = (line = ''): void => {
  lines.push(line);
  console.log(line);
};

const fixed = (n: number, places = 2): string => n.toFixed(places);
const SEED = 'curve-seed';

/** The same growth the generator uses, copied so the probe can vary it freely. */
function grow(rng: ReturnType<typeof createRng>, size: number, density: number): boolean[] {
  let cells = Array.from({ length: size * size }, () => rng.chance(density));
  for (let round = 0; round < 2; round++) {
    const next = cells.slice();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let neighbours = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
            if (cells[ny * size + nx]) neighbours++;
          }
        }
        next[y * size + x] = neighbours >= 5;
      }
    }
    cells = next;
  }
  return cells;
}

describe('nonogram calibration', () => {
  it('measures the reachable lookahead range', () => {
    log('## 1. Lookahead by size and density');
    log();
    log('size  density  solvable/40  lookahead min  mean  max   painted%');

    for (const size of [5, 7, 9, 11, 13, 15]) {
      for (const density of [0.36, 0.44, 0.52]) {
        let solvable = 0;
        let min = Infinity;
        let max = 0;
        let total = 0;
        let paintedShare = 0;

        for (let sample = 0; sample < 40; sample++) {
          const rng = createRng(hashSeed('probe', size, density, sample));
          const picture = grow(rng, size, density);
          const painted = paintedCount(picture);
          if (painted < size || painted > size * size - size) continue;

          const result = solveByLines(cluesFor(picture, size, size));
          if (!result.solved) continue;

          const value = lookaheadOf(result.examined, result.steps);
          solvable++;
          total += value;
          paintedShare += painted / (size * size);
          min = Math.min(min, value);
          max = Math.max(max, value);
        }

        log(
          `${String(size).padStart(4)}  ${fixed(density).padStart(7)}  ` +
            `${String(solvable).padStart(11)}  ` +
            `${(solvable ? fixed(min) : '—').padStart(13)}  ` +
            `${(solvable ? fixed(total / solvable) : '—').padStart(4)}  ` +
            `${(solvable ? fixed(max) : '—').padStart(4)}  ` +
            `${(solvable ? fixed(paintedShare / solvable) : '—').padStart(8)}`,
        );
      }
    }
    log();
  });

  it('prints the curve the generator delivers', () => {
    log('## 2. The curve');
    log();
    log('level  size  band          difficulty  lookahead  painted  ms');

    for (const level of [1, 2, 3, 5, 8, 12, 16, 20, 25, 30, 40, 50, 65, 80, 120]) {
      const rng = createRng(hashSeed(SEED, GAME_ID, level));
      const { pressure, band } = pressureForLevel(level, rng);

      const started = Date.now();
      const generated = generateLevel(SEED, level);
      const elapsed = Date.now() - started;

      const inBand =
        generated.difficulty >= band[0] && generated.difficulty <= band[1] ? '' : '  <- missed';

      log(
        `${String(level).padStart(5)}  ` +
          `${String(sizeForPressure(pressure)).padStart(4)}  ` +
          `[${fixed(band[0])}, ${fixed(band[1])}]  ` +
          `${fixed(generated.difficulty).padStart(10)}  ` +
          `${fixed(generated.lookahead).padStart(9)}  ` +
          `${String(generated.painted).padStart(7)}  ` +
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
      for (let sample = 0; sample < 4; sample++) {
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
    writeFileSync('tools/nonogram.txt', `${lines.join('\n')}\n`);
  });
});
