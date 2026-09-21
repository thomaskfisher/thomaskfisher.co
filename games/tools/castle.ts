/**
 * Calibration harness for Castle, run before the band was trusted.
 *
 * **The lever survey** (LEVERS=1) builds boards at fixed settings and climbs
 * each one's wave strength to the point where no winner survives, reporting the
 * naive trap rate at five points along the way. It is the evidence that the
 * signal has range: 0.00 at the bottom of every climb, 0.6-0.9 at the top, and
 * smooth in between. It is also why spare plots and tower count are not the
 * main dial — the climb re-levels every board to its own ceiling, so they
 * change *which* layouts win rather than how often a naive one does.
 *
 * **The curve** is what the finished generator ships level by level, with the
 * exact share of all layouts that win, which is the number to watch: roughly
 * half at level 1, a few per cent at the top.
 *
 *   npx vitest run --config tools/vitest.castle.config.ts --root .
 */

import { appendFileSync, writeFileSync } from 'node:fs';

import { describe, it } from 'vitest';

import { pressureForLevel } from '../src/shared/difficulty';
import { createRng, hashSeed } from '../src/shared/rng';
import { generateLevel, probeShape } from '../src/castle/generate';
import { countWinners } from '../src/castle/solve';

const SEED = 'probe-castle';

const OUT = 'tools/castle.txt';
const log = (text: string): void => appendFileSync(OUT, `${text}\n\n`);
writeFileSync(OUT, '');

describe('castle probe', () => {
  it.skipIf(!process.env.LEVERS)('surveys the levers', () => {
    const rows: string[] = ['setting\tbuilt\tceil\ttrap@ceil\tstr@ceil\tlayouts\ttrap along climb (0..4)'];
    const cases: [string, Parameters<typeof probeShape>[0]][] = [
      ['base 2/1/1 spare3', {}],
      ['towers 2/1/0 spare2', { towers: [2, 1, 0], spare: 2, mix: [1, 0, 0] }],
      ['towers 2/1/0 spare4', { towers: [2, 1, 0], spare: 4, mix: [1, 0, 0] }],
      ['spare 2', { spare: 2 }],
      ['spare 5', { spare: 5 }],
      ['towers 2/2/1 spare4', { towers: [2, 2, 1], spare: 4 }],
      ['grunts only', { mix: [1, 0, 0] }],
      ['knight heavy', { mix: [1, 0.3, 1.2] }],
      ['runner heavy', { mix: [1, 1.2, 0.2] }],
    ];
    for (const [name, overrides] of cases) {
      const t = Date.now();
      const r = probeShape(overrides, 10);
      rows.push(
        [name, r.built, r.ceiling.toFixed(2), r.trapAtCeiling.toFixed(2), r.strengthAtCeiling.toFixed(0), r.layouts.toFixed(0), r.steps, `${Date.now() - t}ms`].join('\t'),
      );
    }
    log(rows.join('\n'));
  });

  it('sweeps the curve', () => {
    const rows: string[] = [['lvl', 'press', 'band', 'diff', 'trap', 'str', 'try', 'ms', 'tow', 'plots', 'foes', 'path', 'win%'].join('\t')];
    for (const level of [1, 2, 3, 5, 8, 12, 16, 20, 26, 32, 40, 50, 65, 80, 110, 150]) {
      const t = Date.now();
      const g = generateLevel(SEED, level);
      const ms = Date.now() - t;
      const p = pressureForLevel(level, createRng(hashSeed(SEED, 'castle', 'pressure', level)));
      const w = countWinners(g);
      rows.push(
        [
          level,
          p.pressure.toFixed(2),
          `${p.band[0].toFixed(2)}-${p.band[1].toFixed(2)}`,
          g.difficulty.toFixed(2),
          g.trap.toFixed(2),
          g.strength,
          g.attempts,
          ms,
          g.towers.join('/'),
          g.plots.length,
          g.wave.length,
          g.path.length,
          `${((w.wins / w.total) * 100).toFixed(1)} (${w.wins}/${w.total})`,
        ].join('\t'),
      );
    }
    log(rows.join('\n'));
  });
});
