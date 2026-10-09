/**
 * Calibration harness for Marble Sort, and the evidence behind `shapeFor`.
 *
 * What the lever survey found, before any curve was set:
 *
 *  - **Drop size against belt length is the only lever with range.** At a
 *    handful a quarter the size of the belt, careless play almost never loses
 *    and the solver never backtracks. At half, most careless runs lose; past
 *    about 0.7 some deals cannot be won at all. Colours, columns, block size and
 *    stack depth all moved trap rate by a few points at most on their own. So
 *    drop size is set as a *share* of the belt, not a count.
 *  - **Mixing the block order barely moves trap rate**, but it is what produces
 *    boards the obvious strategy loses.
 *  - **Trap rate saturates by the middle of the curve.** Past that, nearly
 *    every careless run loses yet the rule "tap what the open blocks want most"
 *    still wins most boards. Greedy loss — how often that rule fails — is what
 *    separates the top of the curve, and the difficulty score carries both.
 *  - A column one slot wide is legal and unreadable: three holes do not fit.
 *    Two slots per column is the floor, which lengthens the belt at six columns
 *    and is absorbed by drop size being a share of it.
 *
 * Prints shape, both signals, the band and the attempts per level.
 */
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { generateLevel } from '../src/marblesort/generate';
import { pressureForLevel } from '../src/shared/difficulty';
import { createRng, hashSeed } from '../src/shared/rng';

describe('marblesort calibrate', () => {
  it('sweeps the curve', () => {
    const out: string[] = [];
    for (const level of [1, 2, 3, 4, 5, 8, 10, 13, 15, 20, 25, 30, 40, 50, 60, 80]) {
      for (const seed of ['a', 'b', 'c']) {
        const t0 = performance.now();
        const g = generateLevel(seed, level);
        const ms = performance.now() - t0;
        const band = pressureForLevel(level, createRng(hashSeed(seed, 'marblesort', 'pressure', level))).band;
        const s = g.shape;
        const inBand = g.difficulty >= band[0] && g.difficulty <= band[1];
        out.push(
          `L${level} ${seed}`.padEnd(8) +
            `c${s.colors} n${s.columns} r${s.rows} d${s.dropSize} belt${2 * s.straightSlots + 8} mix${s.mix.toFixed(2)} vis${s.visibleRows}`.padEnd(46) +
            `trap ${g.trap.toFixed(2)} greedy ${g.greedyLoss.toFixed(2)} diff ${g.difficulty.toFixed(2)} band ${band[0].toFixed(2)}-${band[1].toFixed(2)} ${inBand ? 'ok ' : 'MISS'} att ${g.attempts} ${ms.toFixed(0)}ms`,
        );
      }
    }
    writeFileSync('tools/marblesort.txt', out.join('\n') + '\n');
  });
});
