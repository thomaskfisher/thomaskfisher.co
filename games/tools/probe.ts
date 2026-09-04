/**
 * Solvability probe for the two buffer-sink games.
 *
 * Colour count, open sinks and buffer size are not independent levers — they
 * draw on one budget, and past a point the combination is simply unsolvable and
 * the generator burns every attempt. This finds that edge empirically instead
 * of reasoning about it.
 *
 *   npx vitest run --config tools/vitest.probe.config.ts --root .
 */

import { appendFileSync, writeFileSync } from 'node:fs';

import { test } from 'vitest';

import { createRng, hashSeed } from '../src/shared/rng';
import { buildCandidate } from '../src/screwland/generate';

const OUT = 'tools/probe.txt';
const log = (line: string): void => appendFileSync(OUT, `${line}\n`);

test('probe', () => {
  writeFileSync(OUT, '');
  log('screwland: share of seeds that produce a solvable board');
  log('boxes  cap  tray  colors  ok/20');

  for (const openBoxes of [2, 3]) {
    for (const boxCapacity of [3, 4, 5]) {
      for (const trayCapacity of [3, 4, 5, 6]) {
        for (const colors of [4, 5, 6, 7, 8]) {
          let ok = 0;
          for (let seed = 0; seed < 20; seed++) {
            const rng = createRng(hashSeed('probe', openBoxes, boxCapacity, trayCapacity, colors, seed));
            const shape = {
              gridWidth: 8,
              gridHeight: 9,
              plateCount: 14,
              screwCount: 8 * boxCapacity,
              colors,
              openBoxes,
              boxCapacity,
              trayCapacity,
              previewCount: 3,
            };
            const rollRng = createRng(hashSeed('probe-roll', seed));
            if (buildCandidate(shape, rng, rollRng)) ok++;
          }
          log(
            `${String(openBoxes).padStart(5)}${String(boxCapacity).padStart(5)}` +
              `${String(trayCapacity).padStart(6)}${String(colors).padStart(8)}` +
              `${String(ok).padStart(7)}`,
          );
        }
      }
    }
  }
}, 900_000);
