/**
 * Calibration harness for Wordle.
 *
 * Three questions:
 *
 * **1. Does trap rate have any range?** It is the only term that knows anything
 * about the specific word rather than the category it came from, so if it comes
 * back flat the curve is length and rarity alone — and those are both things the
 * player can see coming.
 *
 * **2. Does it find the words it should?** The `-IGHT` family is the standard
 * example of a word that is common, short, and brutal. If trap rate does not
 * rate `LIGHT` above `PIZZA`, it is measuring the wrong thing.
 *
 * **3. The curve, and the cost.**
 */

import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';

import { pressureForLevel } from '../src/shared/difficulty';
import { createRng, hashSeed } from '../src/shared/rng';
import { GAME_ID, generateLevel, lengthForPressure, triesFor } from '../src/wordle/generate';
import { answerPool, greedyGuesses, sameColourFamily, trapRate } from '../src/wordle/solve';

const lines: string[] = [];
const log = (line = ''): void => {
  lines.push(line);
  console.log(line);
};

const fixed = (n: number, places = 2): string => n.toFixed(places);
const SEED = 'curve-seed';

describe('wordle calibration', () => {
  it('measures trap rate across the frequency list', () => {
    log('## 1. Trap rate by length and rarity');
    log();
    log('length  rarity band     trap min  mean  max   greedy guesses');

    for (const length of [5, 6, 7]) {
      const pool = answerPool(length);
      const tries = triesFor(length);

      for (const [from, to] of [
        [0, 200],
        [400, 700],
        [900, 1200],
        [1500, 1900],
      ] as const) {
        let min = 1;
        let max = 0;
        let total = 0;
        let greedy = 0;
        const samples = 40;

        for (let sample = 0; sample < samples; sample++) {
          const rng = createRng(hashSeed('probe', length, from, sample));
          const answer = pool[from + rng.int(to - from)] as string;
          const value = trapRate(rng, answer, length, tries, 16);
          total += value;
          min = Math.min(min, value);
          max = Math.max(max, value);
          greedy += greedyGuesses(answer, length, tries);
        }

        log(
          `${String(length).padStart(6)}  ${`${from}-${to}`.padStart(11)}  ` +
            `${fixed(min).padStart(8)}  ${fixed(total / samples)}  ${fixed(max)}  ` +
            `${fixed(greedy / samples).padStart(14)}`,
        );
      }
    }
    log();
  });

  it('rates the notorious words as hard', () => {
    log('## 2. Words it ought to have opinions about');
    log();
    log('word    trap rate  same-colour family after a neutral opener');

    for (const [word, opener] of [
      ['light', 'crane'],
      ['might', 'crane'],
      ['catch', 'crane'],
      ['pizza', 'crane'],
      ['audio', 'crane'],
      ['jumbo', 'crane'],
      ['stare', 'crane'],
    ] as const) {
      const rng = createRng(hashSeed('notorious', word));
      const value = trapRate(rng, word, 5, 6, 40);
      const family = sameColourFamily(opener, word, 5);
      log(
        `${word.padEnd(6)}  ${fixed(value).padStart(9)}  ` +
          `${String(family.length).padStart(3)}  ${family.slice(0, 10).join(' ')}`,
      );
    }
    log();
  });

  it('prints the curve the generator delivers', () => {
    log('## 3. The curve');
    log();
    log('level  band          difficulty  len  tries  rarity  par  trap  answer   ms');

    for (const level of [1, 2, 3, 5, 8, 12, 16, 20, 25, 30, 40, 50, 65, 80, 120]) {
      const rng = createRng(hashSeed(SEED, GAME_ID, level));
      const { pressure, band } = pressureForLevel(level, rng);

      const started = Date.now();
      const generated = generateLevel(SEED, level);
      const elapsed = Date.now() - started;

      const inBand =
        generated.difficulty >= band[0] && generated.difficulty <= band[1] ? '' : '  <- missed';

      log(
        `${String(level).padStart(5)}  [${fixed(band[0])}, ${fixed(band[1])}]  ` +
          `${fixed(generated.difficulty).padStart(10)}  ` +
          `${String(lengthForPressure(pressure)).padStart(3)}  ` +
          `${String(generated.tries).padStart(5)}  ` +
          `${String(generated.rarity).padStart(6)}  ` +
          `${String(generated.par).padStart(3)}  ` +
          `${fixed(generated.trapRate).padStart(4)}  ` +
          `${generated.answer.padEnd(7)}  ${String(elapsed).padStart(4)}${inBand}`,
      );
    }
    log();
  });

  it('measures generation cost', () => {
    log('## 4. Cost');
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
    writeFileSync('tools/wordle.txt', `${lines.join('\n')}\n`);
  });
});
