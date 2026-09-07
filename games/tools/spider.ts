/**
 * Calibration harness for Spider.
 *
 * Run *before* `ONE_SUIT_CEILING` and `VERIFY_BUDGET` were set, which is the
 * order that matters: a band aimed at a range the format cannot reach makes
 * every attempt miss.
 *
 * Three sections.
 *
 * **1. What each suit count can reach.** Trap rate over a few hundred deals at
 * one suit and at two. Spider's ladder is the suit count, and this is the
 * question of where on the curve one suit stops being able to answer.
 *
 * **2. What a search costs.** Status and milliseconds at three budgets, split
 * by suit count. Spider branches far harder than Klondike and this is where the
 * generator's whole cost lives.
 *
 * **3. The curve.** What the finished generator delivers level by level.
 *
 * ```bash
 * npx vitest run --config tools/vitest.spider.config.ts --root .
 * ```
 */

import { describe, it } from 'vitest';

import { createRng, hashSeed } from '../src/shared/rng';
import { pressureForLevel } from '../src/shared/difficulty';
import { deal } from '../src/spider/model';
import { solve } from '../src/spider/solve';
import { generateLevel, packFor, shortfall } from '../src/spider/generate';

const DEALS = 200;

function histogram(values: number[], buckets = 10): string {
  const counts = new Array<number>(buckets).fill(0);
  for (const value of values) {
    const index = Math.min(buckets - 1, Math.floor(value * buckets));
    counts[index] = (counts[index] as number) + 1;
  }
  return counts
    .map((count, i) => {
      const label = `${(i / buckets).toFixed(1)}-${((i + 1) / buckets).toFixed(1)}`;
      return `  ${label}  ${String(count).padStart(4)}  ${'#'.repeat(Math.round((count / values.length) * 110))}`;
    })
    .join('\n');
}

const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

describe('spider calibration', () => {
  it('1. how far the signal spreads, one suit and two', () => {
    for (const suits of [1, 2]) {
      const ordered = packFor(suits);
      const rates: number[] = [];
      for (let i = 0; i < DEALS; i++) {
        const rng = createRng(hashSeed('probe', suits, i));
        rates.push(shortfall(deal(rng.shuffle(ordered.slice())), rng));
      }
      rates.sort((a, b) => a - b);
      console.log(`\n${suits} suit(s), ${DEALS} deals`);
      console.log(histogram(rates));
      console.log(
        `  mean ${mean(rates).toFixed(3)}  p10 ${(rates[Math.floor(DEALS * 0.1)] as number).toFixed(2)}` +
          `  median ${(rates[Math.floor(DEALS * 0.5)] as number).toFixed(2)}` +
          `  p90 ${(rates[Math.floor(DEALS * 0.9)] as number).toFixed(2)}` +
          `  max ${(rates[DEALS - 1] as number).toFixed(2)}`,
      );
    }
  });

  it('2. what a verification search costs', () => {
    for (const suits of [1, 2]) {
      for (const budget of [20_000, 60_000]) {
        const counts = { solved: 0, unsolvable: 0, unknown: 0 };
        const times: number[] = [];
        const failTimes: number[] = [];
        const ordered = packFor(suits);

        for (let i = 0; i < 40; i++) {
          const rng = createRng(hashSeed('probe', suits, i));
          const start = deal(rng.shuffle(ordered.slice()));
          const began = performance.now();
          const result = solve(start, { budget });
          const took = performance.now() - began;
          times.push(took);
          counts[result.status]++;
          if (result.status !== 'solved') failTimes.push(took);
        }

        console.log(
          `\n${suits} suit(s), budget ${budget}  ${JSON.stringify(counts)}  ` +
            `mean ${mean(times).toFixed(0)}ms  worst ${Math.max(...times).toFixed(0)}ms  ` +
            `mean when it fails ${failTimes.length ? mean(failTimes).toFixed(0) : '-'}ms`,
        );
      }
    }
  });

  it('3. what the generator delivers level by level', () => {
    console.log('\nlevel  target       got   suits  attempts    ms  moves');
    for (const level of [1, 2, 5, 10, 14, 20, 30, 50, 90, 200]) {
      const pressure = pressureForLevel(level, createRng(hashSeed('curve', 'pressure', level)));
      const began = performance.now();
      const generated = generateLevel('curve', level);
      const took = performance.now() - began;
      const [lo, hi] = pressure.band;
      const hit = generated.difficulty >= lo && generated.difficulty <= hi ? ' ' : '*';
      console.log(
        `${String(level).padStart(5)}  ${lo.toFixed(2)}-${hi.toFixed(2)} ${generated.difficulty.toFixed(2)}${hit}` +
          `  ${String(generated.suits).padStart(5)}  ${String(generated.attempts).padStart(8)}` +
          `  ${took.toFixed(0).padStart(6)}  ${String(generated.moves).padStart(5)}`,
      );
    }
  });
});
