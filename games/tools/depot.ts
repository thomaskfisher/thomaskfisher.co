/**
 * Calibration harness for Depot, and the evidence behind every constant in
 * `shapeFor` and `scoreDifficulty`.
 *
 * Written and run **before** the band was trusted, which is the order that
 * matters: measure the range the signal can actually reach, then set the band
 * to it. A band pitched at a range the format cannot produce makes every
 * attempt miss, burns solver runs, and leaves difficulty noisy rather than
 * high.
 *
 * Three sections. Only the first runs by default, because it is the one worth
 * re-running after a change; the other two are the surveys the design came from
 * and take a couple of minutes each. Un-skip them when a lever moves.
 *
 * **1. The curve.** What the finished generator produces level by level: the
 * band asked for, the score delivered, how many attempts it cost, and the shape
 * behind it.
 *
 * **2. The levers on their own.** Raw trap rate at fixed settings, because the
 * blended score cannot say whether the *signal* has range or the structural
 * half is carrying it. It has range: 0.17 at four bays and three colours, 0.96
 * at two bays. Two other things fell out of this and changed the design — the
 * build rate is ~100% even at six colours across two bays, so the colour cap
 * the other games need is cargo cult here; and two bays *saturates*, reading
 * 0.84-0.96 whatever else is set, which makes it a ceiling rather than a dial.
 *
 * **3. Board size and hidden buses.** Six buses trap 0.19 of naive runs and
 * eighteen trap 0.91 — so bus count is a difficulty term with a *positive*
 * sign, and the "fewer drivable buses is harder" term the first version carried
 * was not weak but backwards. Hidden buses are worth +0.11 trap rate at one in
 * ten and +0.18 at one in five, which is more than colours and bays together
 * and is why the cap is low and late.
 *
 *   npx vitest run --config tools/vitest.depot.config.ts --root .
 */

import { writeFileSync } from 'node:fs';

import { describe, it } from 'vitest';

import { pressureForLevel } from '../src/shared/difficulty';
import { createRng, hashSeed } from '../src/shared/rng';
import { generateLevel, shapeFor } from '../src/depot/generate';
import { probeShape } from '../src/depot/generate';
import { drivableIds, createState, boardWaiting } from '../src/depot/model';

const SEED = 'probe-depot';

const pct = (n: number, places = 2): string => n.toFixed(places);

describe('depot probe', () => {
  it('sweeps the curve', () => {
    const rows: string[] = [];
    rows.push(
      ['lvl', 'press', 'band', 'diff', 'try', 'ms', 'grid', 'bus', 'col', 'bay', 'q', 'open'].join(
        '\t',
      ),
    );

    for (const level of [1, 2, 3, 5, 8, 12, 16, 20, 26, 32, 40, 50, 65, 80, 110, 150, 220]) {
      const started = Date.now();
      const generated = generateLevel(SEED, level);
      const ms = Date.now() - started;

      const pressure = pressureForLevel(level, createRng(hashSeed(SEED, 'depot', 'pressure', level)));
      const shape = shapeFor(pressure);

      const state = createState(generated.board);
      boardWaiting({ board: generated.board, queue: generated.queue }, state);
      const open = drivableIds(generated.board, state).length;

      rows.push(
        [
          level,
          pct(pressure.pressure),
          `${pct(pressure.band[0])}-${pct(pressure.band[1])}`,
          pct(generated.difficulty),
          generated.attempts,
          ms,
          `${shape.gridWidth}x${shape.gridHeight}`,
          generated.board.buses.length,
          shape.colors,
          shape.bays,
          generated.queue.length,
          open,
        ].join('\t'),
      );
    }

    writeFileSync('tools/depot.txt', `${rows.join('\n')}\n`);
    console.log(`\n${rows.join('\n')}\n`);
  });
});


/**
 * Section 2: the levers on their own.
 *
 * `scoreDifficulty` blends the trap rate with structure, so the sweep above
 * cannot say whether the *signal* has range or the structural half is carrying
 * it. This measures the raw trap rate at fixed lever settings, which is the
 * number the band has to be reachable in.
 */
describe.skip('depot levers', () => {
  it('measures raw trap rate per setting', () => {
    const rows: string[] = [];
    rows.push(['bays', 'cols', 'block', 'pull', 'run', 'trap', 'open', 'built', 'ms'].join('\t'));

    for (const bays of [4, 3, 2]) {
      for (const colors of [3, 4, 5, 6]) {
        for (const blockBias of [0.3, 0.9]) {
          for (const pullBias of [0.35, 0.7]) {
            const started = Date.now();
            const result = probeShape(
              { bays, colors, blockBias, pullBias },
              40,
            );
            rows.push(
              [
                bays,
                colors,
                blockBias,
                pullBias,
                3,
                result.trap.toFixed(2),
                result.open.toFixed(1),
                `${result.built}/40`,
                Date.now() - started,
              ].join('\t'),
            );
          }
        }
      }
    }

    writeFileSync('tools/depot-levers.txt', `${rows.join('\n')}\n`);
    console.log(`\n${rows.join('\n')}\n`);
  });
});


/**
 * Section 3: does the *lot* carry any difficulty, and what do hidden buses cost?
 *
 * Section 2 says the colour levers have range. This asks whether board size and
 * bus count do anything on their own — because if they do not, growing the lot
 * with pressure is just more to look at, and the collection's own rule is that
 * difficulty comes from constrained choice rather than from more stuff.
 */
describe.skip('depot board size and hidden buses', () => {
  it('measures size, count and unknown rate', () => {
    const rows: string[] = [];
    rows.push(['bays', 'cols', 'grid', 'target', 'unk', 'trap', 'buses', 'open', 'built'].join('\t'));

    const sizes: [number, number][] = [[5, 5], [5, 6], [6, 6], [6, 7], [7, 7], [7, 8]];

    for (const [bays, colors] of [[4, 4], [3, 5]] as [number, number][]) {
      for (const [gridWidth, gridHeight] of sizes) {
        for (const fill of [0.55, 0.72]) {
          const busTarget = Math.round((gridWidth * gridHeight * fill) / 2.3);
          const result = probeShape({ bays, colors, gridWidth, gridHeight, busTarget }, 40);
          rows.push(
            [bays, colors, `${gridWidth}x${gridHeight}`, busTarget, 0,
              result.trap.toFixed(2), result.buses.toFixed(1), result.open.toFixed(1),
              `${result.built}/40`].join('\t'),
          );
        }
      }
    }

    for (const unknownRate of [0, 0.1, 0.2, 0.3]) {
      const result = probeShape({ bays: 3, colors: 5, unknownRate }, 40);
      rows.push(
        [3, 5, '6x7', 14, unknownRate, result.trap.toFixed(2), result.buses.toFixed(1),
          result.open.toFixed(1), `${result.built}/40`].join('\t'),
      );
    }

    writeFileSync('tools/depot-size.txt', `${rows.join('\n')}\n`);
    console.log(`\n${rows.join('\n')}\n`);
  });
});
