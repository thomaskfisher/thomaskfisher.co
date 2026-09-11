/**
 * Calibration harness for 2048.
 *
 * Three questions, and the third one is the one that decides whether the game
 * is shippable at all:
 *
 * **1. Trap rate by target.** The signal the rest of the collection is
 * calibrated on. If a naive player reaches 512 as often as it reaches 64, trap
 * rate has nothing to say here and the target ladder is the whole curve.
 *
 * **2. How long a level takes.** Not difficulty — *length*. A target nobody
 * finishes in one sitting is a target that quietly ends the game, and this is
 * the measurement the 1024 ceiling comes from.
 *
 * **3. Generation cost.** The verifier plays a whole level with a depth-five
 * search before the level is shown. That is by far the most expensive thing any
 * generator in this collection does, and the worker has about one level's play
 * to do it in.
 */

import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';

import { pressureForLevel } from '../src/shared/difficulty';
import { createRng, hashSeed } from '../src/shared/rng';
import { GAME_ID, OPENING_TILES, SIZE, generateLevel, targetForBand } from '../src/twenty48/generate';
import { faceOf } from '../src/twenty48/model';
import { playOut, trapRate } from '../src/twenty48/solve';

const lines: string[] = [];
const log = (line = ''): void => {
  lines.push(line);
  console.log(line);
};

const fixed = (n: number, places = 2): string => n.toFixed(places);
const SEED = 'curve-seed';

describe('2048 calibration', () => {
  it('measures trap rate and length against the target', () => {
    log('## 1 & 2. Trap rate and length by target');
    log();
    log('target  trap rate  strong player reached  moves');

    for (const target of [6, 7, 8, 9, 10, 11]) {
      let trapped = 0;
      let reached = 0;
      let moves = 0;
      const samples = 5;

      for (let sample = 0; sample < samples; sample++) {
        const rng = createRng(hashSeed('probe', target, sample));
        trapped += trapRate(rng, `probe-${sample}`, 1, SIZE, OPENING_TILES, target, 8);

        const played = playOut(`probe-${sample}`, 1, SIZE, OPENING_TILES, target, { depth: 5 });
        if (played.reached) reached++;
        moves += played.moves;
      }

      log(
        `${String(faceOf(target)).padStart(6)}  ${fixed(trapped / samples).padStart(9)}  ` +
          `${`${reached}/${samples}`.padStart(21)}  ${String(Math.round(moves / samples)).padStart(5)}`,
      );
    }
    log();
  });

  it('prints the curve the generator delivers', () => {
    log('## 3. The curve');
    log();
    log('level  target  band          difficulty  trap  par   ms');

    for (const level of [1, 2, 3, 5, 8, 12, 16, 20, 25, 30, 40, 50, 65, 80, 120]) {
      const rng = createRng(hashSeed(SEED, GAME_ID, level));
      const { band } = pressureForLevel(level, rng);

      const started = Date.now();
      const generated = generateLevel(SEED, level);
      const elapsed = Date.now() - started;

      const inBand =
        generated.difficulty >= band[0] && generated.difficulty <= band[1] ? '' : '  <- missed';

      log(
        `${String(level).padStart(5)}  ${String(faceOf(targetForBand(band))).padStart(6)}  ` +
          `[${fixed(band[0])}, ${fixed(band[1])}]  ` +
          `${fixed(generated.difficulty).padStart(10)}  ` +
          `${fixed(generated.trapRate).padStart(4)}  ` +
          `${String(generated.par).padStart(4)}  ` +
          `${String(elapsed).padStart(4)}${inBand}`,
      );
    }
    log();
  });

  it('measures generation cost', () => {
    log('## 4. Cost — the worker has about one level of play to do this in');
    log();
    log('level  mean ms  worst ms');

    for (const level of [1, 20, 50, 100]) {
      const times: number[] = [];
      for (let sample = 0; sample < 3; sample++) {
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
    writeFileSync('tools/twenty48.txt', `${lines.join('\n')}\n`);
  });
});
