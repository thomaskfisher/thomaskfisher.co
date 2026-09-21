/**
 * Measurement harness for Tetris, and the evidence behind every constant in
 * `src/tetris/bag.ts`.
 *
 * Tetris has no generator and no solver — it is real-time, so there is no board
 * dealt in advance to verify — but it does have a difficulty lever, and the
 * lesson this project has paid for twice is that a lever's measured effect and
 * its intended effect are different numbers until somebody checks.
 *
 * **It was written before the lever was trusted, and the first design failed
 * it.** That version biased the bag by swapping *one* piece with a probability
 * that rose with the level, capping at 0.75. Section 1 measured it at 136.6
 * pieces of naive survival at level 1 against 120.7 at the cap — twelve
 * percent, non-monotonic (level 4 measured *higher* than level 1, level 12
 * higher than level 6), and identical from level 13 onwards because the
 * probability had saturated. Gravity floors at level 11. So the game stopped
 * getting harder at level 13 in both of its levers at once, and the bias read
 * as deliberate while doing almost nothing.
 *
 * **What fixed it was swapping more of the bag rather than swapping more
 * often.** Section 2 swept substitution depth directly: 138 pieces at none, 108
 * at one, 104 at two, 87 at three, 73 at four. So the lever had range all
 * along; the first design was only ever using the first notch of it. The depth
 * is now a fraction that ramps to the whole donor pool by level 22, and the
 * measured curve runs 135 down to 70 — a little over two to one, monotonic, and
 * still falling for eleven levels after the speed ramp has stopped.
 *
 * Three sections. Only the first and last run by default; section 2 is the
 * survey the design came out of and takes a couple of minutes.
 *
 * **The bot is the measurement, so read `src/tetris/bot.ts` before believing any
 * of this.** It places without hold, without tucks and without lookahead, which
 * is a deliberately worse player than the one holding the phone. These numbers
 * are a floor on survival rather than a prediction of it, and only the
 * differences between rows mean anything.
 *
 * Run with:
 *   npx vitest run --config tools/vitest.tetris.config.ts --root .
 */

import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';

import { rollout, runAtLevel } from '../src/tetris/bot';
import { MAX_SUBSTITUTIONS, biasDepth } from '../src/tetris/bag';
import { gravityMs, levelOf } from '../src/tetris/model';
import { startRun } from '../src/tetris/run';

/** Runs per data point. Enough that a ten-piece difference is not noise. */
const RUNS = 40;

/** The careless player being modelled. See `BotOptions.sloppiness`. */
const SLOPPINESS = 0.1;

/** Long enough that a clean stream ends on its own rather than on the cap. */
const CAP = 400;

const lines: string[] = [];
const say = (text = ''): void => {
  lines.push(text);
  console.log(text);
};

const mean = (values: number[]): number =>
  values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length);

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const at = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[at] ?? 0;
}

/** Pieces placed over `RUNS` runs, all at one pinned level. */
function survivalAt(level: number): number[] {
  const out: number[] = [];
  for (let game = 0; game < RUNS; game++) {
    out.push(rollout(runAtLevel(`c-${game}`, game, level), {
      sloppiness: SLOPPINESS,
      maxPieces: CAP,
    }).placed);
  }
  return out;
}

const row = (label: string, placed: number[]): string =>
  `${label.padEnd(20)} mean ${mean(placed).toFixed(1).padStart(7)}` +
  `   p10 ${String(percentile(placed, 0.1)).padStart(5)}` +
  `   median ${String(percentile(placed, 0.5)).padStart(5)}` +
  `   p90 ${String(percentile(placed, 0.9)).padStart(5)}`;

describe('Tetris calibration', () => {
  /*
   * Section 1. The curve the shipped bag produces.
   *
   * The level is pinned, so gravity is out of the picture entirely and the only
   * thing changing between rows is the composition of the bag. Two things to
   * look for. First, that it falls at all — a flat column here means the bag is
   * decoration and the difficulty is all speed, which is the failure this file
   * was written to catch. Second, that it is *still falling after level 11*,
   * where gravity stops. If it is not, the game stops getting harder there, and
   * the answer is to widen the ramp in `biasDepth` rather than to lower the
   * gravity floor onto thumbs that cannot keep up with it.
   */
  it('section 1: the curve', () => {
    say('=== 1. Pieces placed before topping out, level by level ===');
    say(`${RUNS} runs a row, sloppiness ${SLOPPINESS}, capped at ${CAP} pieces.`);
    say('Level is pinned, so gravity is held out and only the bag differs.');
    say();
    say(
      `${'level'.padEnd(6)} ${'lines'.padEnd(6)} ${'gravity'.padEnd(8)} ` +
        `${'depth'.padEnd(6)} ${'S+Z/bag'.padEnd(8)} survival`,
    );

    for (const level of [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 26]) {
      const depth = biasDepth(level);
      const placed = survivalAt(level);
      say(
        `${String(level).padEnd(6)} ${String((level - 1) * 10).padEnd(6)} ` +
          `${`${gravityMs(level)}ms`.padEnd(8)} ${depth.toFixed(2).padEnd(6)} ` +
          `${(2 + depth).toFixed(2).padEnd(8)} ` +
          `mean ${mean(placed).toFixed(1).padStart(7)}  median ${String(percentile(placed, 0.5)).padStart(5)}`,
      );
    }

    say();
  }, 1_800_000);

  /*
   * Section 2. The lever on its own, by whole notches.
   *
   * This is the survey that replaced the first design, and it is the one to
   * re-run if the donor pool ever changes. The blended curve above cannot say
   * whether a notch is worth having; this can. What it found the first time was
   * that each notch is worth roughly fifteen pieces, which is an order of
   * magnitude more than the whole of the original lever.
   *
   * Skipped by default: the design is settled and this takes a couple of
   * minutes. Un-skip it when a donor moves.
   */
  it.skip('section 2: substitution depth on its own', () => {
    say('=== 2. Survival by whole substitutions per bag ===');
    say('Donors are O, J, L and T. The I is never one, so every bag has a bar.');
    say();

    // biasDepth is (level - 3) * 0.22 capped at the pool size, so these levels
    // are the whole depths 0 through 4.
    const levels = [3, 3 + Math.round(1 / 0.22), 3 + Math.round(2 / 0.22), 3 + Math.round(3 / 0.22), 40];
    for (const level of levels) {
      const depth = biasDepth(level);
      say(row(`${depth.toFixed(2)} swaps (L${level})`, survivalAt(level)));
    }

    say();
    say(`The pool is ${MAX_SUBSTITUTIONS} deep, so the last row is one I and six of S and Z.`);
    say();
  }, 1_800_000);

  /*
   * Section 3. An ordinary run, with the level floating as it does in play.
   *
   * A sanity check rather than a measurement: the pinned levels above are the
   * one place this harness could be lying about the real game, and a run whose
   * level climbs as its lines do is the thing they are standing in for.
   */
  it('section 3: unpinned runs', () => {
    say('=== 3. Runs with the level floating, as in play ===');
    const placed: number[] = [];
    const reached: number[] = [];
    for (let game = 0; game < RUNS; game++) {
      const result = rollout(startRun(`live-${game}`, game), {
        sloppiness: SLOPPINESS,
        maxPieces: CAP,
      });
      placed.push(result.placed);
      reached.push(levelOf(result.lines));
    }
    say(row('pieces placed', placed));
    say(row('level reached', reached));
    say();

    writeFileSync('tools/tetris.txt', `${lines.join('\n')}\n`);
  }, 1_800_000);
});
