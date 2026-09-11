/**
 * Wordle generation.
 *
 * A level is a word, a length, and a number of rows. Nothing is built — the
 * words already exist — so this file is entirely about *choosing*, and the
 * choice has three levers:
 *
 *  - **length**, 5 to 7, which changes the shape of the game;
 *  - **rarity**, how far down the frequency list the answer is drawn from;
 *  - **trap rate**, measured, which is the part neither of the others predicts.
 *
 * The third is the one that earns its keep. Two equally common five-letter
 * words are not equally hard: `LIGHT` sits in a family of a dozen words that
 * look identical for four rows (`MIGHT`, `NIGHT`, `RIGHT`, `SIGHT`, `TIGHT`,
 * `FIGHT`), and `PIZZA` does not. Rarity cannot see that and trap rate can.
 */

import { pressureForLevel } from '../shared/difficulty';
import { createRng, hashSeed } from '../shared/rng';
import { answerPool, trapRate } from './solve';

export const GAME_ID = 'wordle';

export interface GeneratedLevel {
  level: number;
  /** The answer. Never shown until the level is over. */
  answer: string;
  length: number;
  /** Rows the player gets. */
  tries: number;
  /** 0..1, measured. See `score`. */
  difficulty: number;
  /** Share of naive playthroughs that ran out of rows. */
  trapRate: number;
  /** Where the answer sits in the frequency list. 0 is the commonest. */
  rarity: number;
}

/* ------------------------------------------------------------------ */
/* Shape                                                               */
/* ------------------------------------------------------------------ */

/**
 * Word length, from the curve.
 *
 * Five letters for the first third of the ladder, which is the game everybody
 * already knows; six and seven arrive later. Growing the word rather than
 * shrinking the rows is deliberate — taking guesses away is a punishment, and
 * a longer word is a bigger puzzle.
 */
export function lengthForPressure(pressure: number): number {
  if (pressure < 0.45) return 5;
  if (pressure < 0.75) return 6;
  return 7;
}

/**
 * Rows, from the length.
 *
 * Six for a five-letter word, which is the ratio everybody has calibrated
 * against. Seven for the longer ones: a six- or seven-letter word has more
 * places for a letter to hide, and holding the row count fixed while the word
 * grows makes the late game a scramble rather than a deduction.
 */
export function triesFor(length: number): number {
  return length === 5 ? 6 : 7;
}

/**
 * The slice of the frequency list a level draws from.
 *
 * Level 1 pulls from the first few hundred words; the top of the curve pulls
 * from the whole list. The window slides rather than widens — a late level that
 * could still hand out `ABOUT` would read as the curve having given up.
 */
export function rarityWindow(pressure: number, poolSize: number): [number, number] {
  const span = 0.34;
  const from = Math.floor(pressure * (1 - span) * poolSize);
  const to = Math.min(poolSize, Math.max(from + 40, Math.floor(from + span * poolSize)));
  return [from, to];
}

/* ------------------------------------------------------------------ */
/* Difficulty                                                          */
/* ------------------------------------------------------------------ */

/**
 * Difficulty, from the shape of the level and how often it beats a naive player.
 *
 * Trap rate carries the most weight because it is the only term that knows
 * anything about *this word* rather than about the category it came from.
 */
export function score(length: number, rarity: number, poolSize: number, trapped: number): number {
  const lengthPart = (length - 5) / 2;
  const rarityPart = Math.min(1, rarity / Math.max(1, poolSize - 1));
  return Math.min(1, Math.max(0, 0.3 * lengthPart + 0.24 * rarityPart + 0.46 * trapped));
}

/** Words to try inside the rarity window before settling for the closest miss. */
const ATTEMPTS = 26;

/** Naive playthroughs behind each trap-rate figure. */
const ROLLOUTS = 24;

export function generateLevel(seed: string, level: number): GeneratedLevel {
  const rng = createRng(hashSeed(seed, GAME_ID, level));
  const { pressure, band } = pressureForLevel(level, rng);

  const length = lengthForPressure(pressure);
  const tries = triesFor(length);
  const pool = answerPool(length);
  const [from, to] = rarityWindow(pressure, pool.length);

  let best: GeneratedLevel | null = null;
  let bestMiss = Infinity;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const rarity = rng.range(from, Math.max(from, to - 1));
    const answer = pool[rarity];
    if (!answer) continue;

    const trapped = trapRate(rng, answer, length, tries, ROLLOUTS);
    const difficulty = score(length, rarity, pool.length, trapped);

    const candidate: GeneratedLevel = {
      level,
      answer,
      length,
      tries,
      difficulty,
      trapRate: trapped,
      rarity,
    };

    const miss =
      difficulty < band[0] ? band[0] - difficulty : Math.max(0, difficulty - band[1]);

    if (miss === 0) return candidate;
    if (miss < bestMiss) {
      bestMiss = miss;
      best = candidate;
    }
  }

  if (best) return best;

  // Unreachable: the window always holds at least forty words. Falling back to
  // the commonest word of this length keeps the promise that a level exists.
  const answer = pool[0] as string;
  return {
    level,
    answer,
    length,
    tries,
    difficulty: 0,
    trapRate: 0,
    rarity: 0,
  };
}
