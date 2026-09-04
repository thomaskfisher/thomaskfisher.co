/**
 * Wall-clock cost of generating a level.
 *
 * Generation runs on a worker one level ahead of play, so it has roughly the
 * length of a level to finish in and a slow level is invisible. That budget is
 * not unlimited though: a level generated in eight seconds would still be
 * pending when a fast player taps "Next", and the fallback is a main-thread
 * generate that would freeze the board.
 */

import { writeFileSync } from 'node:fs';
import { test } from 'vitest';

import { generateLevel as colorsort } from '../src/colorsort/generate';
import { generateLevel as screwland } from '../src/screwland/generate';
import { generateLevel as busjam } from '../src/busjam/generate';
import { generateLevel as survival } from '../src/survival/generate';

const games = { colorsort, screwland, busjam, survival };

test('timing', () => {
  const lines = ['game        level   ms   attempts'];
  for (const [name, generate] of Object.entries(games)) {
    for (const level of [1, 8, 20, 50, 100]) {
      let worst = 0;
      let attempts = 0;
      for (const seed of ['t-a', 't-b', 't-c']) {
        const started = performance.now();
        attempts = Math.max(attempts, generate(seed, level).attempts);
        worst = Math.max(worst, performance.now() - started);
      }
      lines.push(
        `${name.padEnd(11)}${String(level).padStart(5)}${String(Math.round(worst)).padStart(6)}` +
          `${String(attempts).padStart(10)}`,
      );
    }
  }
  writeFileSync('tools/timing.txt', lines.join('\n') + '\n');
}, 900_000);
