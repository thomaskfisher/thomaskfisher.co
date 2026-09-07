/**
 * Calibration harness for Solitaire.
 *
 * Written and run *before* anything in `generate.ts` was calibrated, which is
 * the order that matters: a band aimed at a range the format cannot reach makes
 * every attempt miss, which is what flattened Color Sort's curve.
 *
 * Three sections.
 *
 * **1. What the signal can reach.** The trap rate of a few hundred random
 * deals, as a histogram. This is the only difficulty lever Solitaire has — the
 * rules never change — so if the spread here were narrow the design would have
 * to change rather than the constants.
 *
 * **2. What a search costs.** Status and milliseconds over the same deals.
 * Klondike's search is the most expensive thing in this project and the
 * generator's whole shape (score first, verify second) depends on the ratio.
 *
 * **3. The curve.** What the finished generator delivers level by level:
 * difficulty asked for, difficulty delivered, attempts spent, milliseconds.
 *
 * ```bash
 * npx vitest run --config tools/vitest.solitaire.config.ts --root .
 * ```
 */

import { describe, it } from 'vitest';

import { orderedDeck } from '../src/shared/cards';
import { createRng, hashSeed } from '../src/shared/rng';
import { pressureForLevel } from '../src/shared/difficulty';
import { deal } from '../src/solitaire/model';
import { solve } from '../src/solitaire/solve';
import { generateLevel, trapRate } from '../src/solitaire/generate';

const DEALS = 300;

function histogram(values: number[], buckets = 10): string {
  const counts = new Array<number>(buckets).fill(0);
  for (const value of values) {
    const index = Math.min(buckets - 1, Math.floor(value * buckets));
    counts[index] = (counts[index] as number) + 1;
  }
  return counts
    .map((count, i) => {
      const label = `${(i / buckets).toFixed(1)}-${((i + 1) / buckets).toFixed(1)}`;
      const bar = '#'.repeat(Math.round((count / values.length) * 120));
      return `  ${label}  ${String(count).padStart(4)}  ${bar}`;
    })
    .join('\n');
}

const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

describe('solitaire calibration', () => {
  it('1. how far the trap rate spreads over random deals', () => {
    const rates: number[] = [];
    for (let i = 0; i < DEALS; i++) {
      const rng = createRng(hashSeed('probe', i));
      const start = deal(rng.shuffle(orderedDeck()));
      rates.push(trapRate(start, rng));
    }
    rates.sort((a, b) => a - b);
    console.log(`\ntrap rate over ${DEALS} deals`);
    console.log(histogram(rates));
    console.log(
      `  mean ${mean(rates).toFixed(3)}  p10 ${(rates[Math.floor(DEALS * 0.1)] as number).toFixed(2)}` +
        `  median ${(rates[Math.floor(DEALS * 0.5)] as number).toFixed(2)}` +
        `  p90 ${(rates[Math.floor(DEALS * 0.9)] as number).toFixed(2)}` +
        `  min ${(rates[0] as number).toFixed(2)}  max ${(rates[DEALS - 1] as number).toFixed(2)}`,
    );
  });

  it('2. what a verification search costs', () => {
    // Three budgets rather than one. The question is not "can this deal be
    // solved" but "what does the cheapest budget that still finds it cost",
    // because the generator pays the failures far more often than the wins.
    for (const budget of [12_000, 30_000, 80_000]) {
      const counts = { solved: 0, unsolvable: 0, unknown: 0 };
      const times: number[] = [];
      const failTimes: number[] = [];
      const byTrap = new Map<number, { solved: number; total: number }>();

      for (let i = 0; i < 90; i++) {
        const rng = createRng(hashSeed('probe', i));
        const start = deal(rng.shuffle(orderedDeck()));
        const trap = trapRate(start, rng);

        const began = performance.now();
        const result = solve(start, { budget });
        const took = performance.now() - began;

        times.push(took);
        counts[result.status]++;
        if (result.status !== 'solved') failTimes.push(took);

        const bucket = Math.min(4, Math.floor(trap * 5));
        const entry = byTrap.get(bucket) ?? { solved: 0, total: 0 };
        entry.total++;
        if (result.status === 'solved') entry.solved++;
        byTrap.set(bucket, entry);
      }

      const buckets = [...byTrap.keys()]
        .sort((a, b) => a - b)
        .map((bucket) => {
          const entry = byTrap.get(bucket) as { solved: number; total: number };
          return `${(bucket / 5).toFixed(1)}:${entry.solved}/${entry.total}`;
        })
        .join('  ');

      console.log(
        `\nbudget ${budget}  ${JSON.stringify(counts)}  mean ${mean(times).toFixed(0)}ms  ` +
          `mean when it fails ${failTimes.length ? mean(failTimes).toFixed(0) : '-'}ms`,
      );
      console.log(`  by trap rate  ${buckets}`);
    }
  });

  it('3. what the generator delivers level by level', () => {
    console.log('\nlevel  target        got    attempts   ms   moves');
    for (const level of [1, 2, 5, 10, 20, 30, 40, 50, 80, 120, 200, 350]) {
      const pressure = pressureForLevel(level, createRng(hashSeed('curve', 'pressure', level)));
      const began = performance.now();
      const generated = generateLevel('curve', level);
      const took = performance.now() - began;
      const [lo, hi] = pressure.band;
      const hit = generated.difficulty >= lo && generated.difficulty <= hi ? ' ' : '*';
      console.log(
        `${String(level).padStart(5)}  ${lo.toFixed(2)}-${hi.toFixed(2)}  ` +
          `${generated.difficulty.toFixed(2)}${hit}  ${String(generated.attempts).padStart(6)}  ` +
          `${took.toFixed(0).padStart(6)}  ${String(generated.moves).padStart(5)}`,
      );
    }
  });
});
