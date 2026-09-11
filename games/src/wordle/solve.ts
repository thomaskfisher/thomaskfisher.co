/**
 * The hint, and the difficulty signal.
 *
 * **The hint is the commonest word still consistent with the board.** Not the
 * information-theoretic best guess: that is a different game, and it regularly
 * suggests something like `TARES` when the player has three greens and wants
 * the answer. What somebody pressing Hint on their fifth row wants is a word
 * that could *be* it, and the commonest one is both the likeliest to be right
 * and the likeliest to be a word they know.
 *
 * It is a pure function of the board, so two answers to the same question are
 * the same answer and there is no ping-pong for a cache to prevent.
 *
 * **The difficulty signal is trap rate**, the measure the rest of the collection
 * is calibrated on: the share of naive playthroughs that run out of guesses. The
 * naive player picks at random among the handful of commonest consistent words,
 * which is what somebody does when four candidates are left and they have two
 * rows to spend.
 */

import type { Rng } from '../shared/rng';
import { type Row, isConsistent, markGuess, rowsFor } from './model';
import { ANSWERS } from './words';

/** Every word a level's answer could have been, for this length. */
export function answerPool(length: number): string[] {
  const packed = ANSWERS[length] ?? '';
  const out: string[] = [];
  for (let index = 0; index * length < packed.length; index++) {
    out.push(packed.slice(index * length, (index + 1) * length));
  }
  return out;
}

/**
 * The commonest answer still consistent with the board.
 *
 * The pool is already in frequency order, so "commonest" is just "first" — no
 * sort, and the tie-breaking is decided by the word list rather than by
 * whatever order a filter happened to produce.
 */
export function suggest(length: number, rows: readonly Row[]): string | null {
  for (const word of answerPool(length)) {
    if (isConsistent(word, rows)) return word;
  }
  return null;
}

/** How many answers are still possible given the board. */
export function candidateCount(length: number, rows: readonly Row[]): number {
  let count = 0;
  for (const word of answerPool(length)) if (isConsistent(word, rows)) count++;
  return count;
}

/**
 * How many guesses a player who always takes the commonest candidate needs.
 *
 * Returns `tries + 1` when they never get there, so a caller can treat "did not
 * finish" and "finished on the last row" as the same comparison.
 */
export function greedyGuesses(answer: string, length: number, tries: number): number {
  const pool = answerPool(length);
  const rows: Row[] = [];

  for (let attempt = 1; attempt <= tries; attempt++) {
    const guess = pool.find((word) => isConsistent(word, rows));
    if (!guess) return tries + 1;
    if (guess === answer) return attempt;
    rows.push({ word: guess, marks: markGuess(guess, answer) });
  }

  return tries + 1;
}

/**
 * How wide a net the naive player casts.
 *
 * Always taking the commonest candidate makes the simulation deterministic,
 * which gives a trap rate of exactly 0 or 1 and no curve at all. Picking among
 * the commonest few is both the fix and the more honest model: with four words
 * left and two rows to spend, nobody is consulting a frequency table.
 */
const NAIVE_SPREAD = 6;

/** One naive playthrough. True when the word was found in time. */
export function naivePlayer(
  rng: Rng,
  answer: string,
  length: number,
  tries: number,
): boolean {
  const pool = answerPool(length);
  const rows: Row[] = [];

  for (let attempt = 0; attempt < tries; attempt++) {
    const options: string[] = [];
    for (const word of pool) {
      if (isConsistent(word, rows)) options.push(word);
      if (options.length >= NAIVE_SPREAD) break;
    }
    if (options.length === 0) return false;

    const guess = options[rng.int(options.length)] as string;
    if (guess === answer) return true;
    rows.push({ word: guess, marks: markGuess(guess, answer) });
  }

  return false;
}

/**
 * The share of naive playthroughs that run out of rows.
 *
 * The answer is fixed; what varies between rollouts is which of the plausible
 * words the player reaches for, which is the right thing to vary.
 */
export function trapRate(
  rng: Rng,
  answer: string,
  length: number,
  tries: number,
  rollouts = 24,
): number {
  let failures = 0;
  for (let rollout = 0; rollout < rollouts; rollout++) {
    if (!naivePlayer(rng, answer, length, tries)) failures++;
  }
  return failures / rollouts;
}

/**
 * Words that would score identically against `answer` for a given guess.
 *
 * Not used in play — it is what the tests use to show that a level with a large
 * "trap family" really is the harder one. A word sharing its colours with a
 * dozen others is one you can be four rows in and still be guessing at.
 */
export function sameColourFamily(guess: string, answer: string, length: number): string[] {
  const target = markGuess(guess, answer).join('');
  return answerPool(length).filter((word) => markGuess(guess, word).join('') === target);
}

/** Convenience for the tests and the probe: play a list of guesses. */
export { rowsFor };
