/**
 * Screw Land 3D difficulty probe. Prints what the generator actually produces
 * across a level sweep, so the band is calibrated against a measured range.
 *
 *   npx vitest run --config tools/vitest.screwland3d.config.ts --root .
 */

import { writeFileSync } from 'node:fs';

import { test } from 'vitest';

import { pressureForLevel } from '../src/shared/difficulty';
import { createRng, hashSeed } from '../src/shared/rng';
import {
  buildCandidate,
  generateLevel,
  hiddenScrewShare,
  naiveRollout,
  shapeFor,
  templateForLevel,
} from '../src/screwland3d/generate';

const OUT = 'tools/screwland3d.txt';

test('probe', () => {
  const lines: string[] = [];
  const log = (line: string): void => {
    lines.push(line);
  };

  log('level  template  p     screws pieces hidden trap  diff  band          tries  ms');
  const seeds = ['a1b2c3d4e5f60718', '0f1e2d3c4b5a6978'];
  for (const seed of seeds) {
    for (const level of [1, 2, 3, 4, 5, 6, 8, 10, 13, 15, 20, 25, 30, 40, 50, 60, 80, 100, 150, 200]) {
      const started = performance.now();
      const g = generateLevel(seed, level);
      const ms = performance.now() - started;
      const pressure = pressureForLevel(level, createRng(hashSeed(seed, 'screwland3d', 'pressure', level)));
      let lost = 0;
      const rng = createRng(hashSeed('probe', level));
      for (let r = 0; r < 60; r++) if (naiveRollout(g.structure, g.queue, g.config, rng)) lost++;
      log(
        [
          String(level).padStart(5),
          g.shape.template.padEnd(8),
          pressure.pressure.toFixed(2),
          String(g.structure.screws.length).padStart(6),
          String(g.structure.pieces.length).padStart(6),
          hiddenScrewShare(g.structure).toFixed(2).padStart(6),
          (lost / 60).toFixed(2),
          g.difficulty.toFixed(2),
          `[${pressure.band[0].toFixed(2)},${pressure.band[1].toFixed(2)}]`,
          String(g.attempts).padStart(5),
          ms.toFixed(0).padStart(5),
        ].join('  '),
      );
    }
  }

  // Which candidates fail, per template, at full pressure.
  log('');
  log('template  built/40 at p=1');
  const peak = pressureForLevel(60, createRng(1));
  for (const level of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const template = templateForLevel('a1b2c3d4e5f60718', level);
    const shape = shapeFor({ ...peak, pressure: 1 }, template);
    let ok = 0;
    for (let i = 0; i < 40; i++) {
      if (buildCandidate(shape, createRng(hashSeed('t', template, i)), createRng(i))) ok++;
    }
    log(`${template.padEnd(8)}  ${ok}/40`);
  }

  writeFileSync(OUT, `${lines.join('\n')}\n`);
});
