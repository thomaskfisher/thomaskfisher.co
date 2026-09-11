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
import { answerPool, greedyGuesses, trapRate } from './solve';

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
  /** Rows a player who always takes the commonest candidate needs. */
  par: number;
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
 * already knows; six and seven arrive later.
 *
 * **Length is variety here, not difficulty, and that is the opposite of what it
 * was built to be.** The probe settled it: a sensible player needs 2.77 to 4.15
 * guesses for a five-letter word and only 2.40 to 3.25 for a seven-letter one.
 * Longer words are *easier* — every guess carries more letters, so each one
 * tells you more — and the first version of `score` gave length thirty percent
 * of the weight in the wrong direction. It now contributes nothing, and the
 * ladder grows the word because a different-shaped board is worth having, not
 * because it is harder.
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
 * against. Seven for the longer ones — not because they are harder, which they
 * are not, but because a longer grid wants a longer board under it and the
 * extra row costs nothing a player notices.
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
 * The range `par` actually covers, measured in `tools/wordle.ts`.
 *
 * A word nobody has to think about goes in two; one that needs the whole board
 * goes in five or more. Those ends are the measured ones, not the theoretical
 * 1-and-7.
 */
const PAR_FLOOR = 2;
const PAR_CEILING = 4.5;

/**
 * Difficulty, from how much work the word actually is.
 *
 * **`par` carries most of it**, where `par` is the number of rows a player who
 * always takes the commonest remaining candidate needs. It is the one term that
 * is continuous, that rises monotonically with rarity, and that knows about
 * *this word* rather than the category it came from.
 *
 * **Trap rate keeps a quarter of the weight even though it is usually zero.**
 * The probe found it near-flat across the whole frequency list — a mean of 0.02
 * — which killed it as the primary signal. But where it is not zero it is the
 * only thing that sees the real cliff in this game: `LIGHT` scores 1.00 because
 * it sits in a family with `MIGHT`, `FIGHT`, `NIGHT`, `RIGHT` and `SIGHT` that a
 * board cannot separate, and `PIZZA` scores 0.00. Rarity cannot see that and
 * `par` only half can.
 *
 * **Length contributes nothing**, because the measurement says it runs the wrong
 * way. See `lengthForPressure`.
 */
export function score(par: number, trapped: number): number {
  const parPart = Math.min(
    1,
    Math.max(0, (par - PAR_FLOOR) / (PAR_CEILING - PAR_FLOOR)),
  );
  return Math.min(1, Math.max(0, 0.85 * parPart + 0.15 * trapped));
}

/** Words to try inside the rarity window before settling for the closest miss. */
const ATTEMPTS = 26;

/** Naive playthroughs behind each trap-rate figure. */
const ROLLOUTS = 16;

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

    const par = greedyGuesses(answer, length, tries);

    /*
     * Trap rate is measured only when it could change the answer.
     *
     * `score` is monotone in it, so if the word lands inside the band with no
     * trap rate *and* would still land inside it with the maximum, there is
     * nothing to find out — and sixteen playthroughs is most of what generating
     * a level costs. Levels past 50 came down from about 1.1 seconds to under a
     * tenth of that.
     */
    const floor = score(par, 0);
    const ceiling = score(par, 1);
    const settled = floor >= band[0] && ceiling <= band[1];

    const trapped = settled ? 0 : trapRate(rng, answer, length, tries, ROLLOUTS);
    const difficulty = settled ? floor : score(par, trapped);

    const candidate: GeneratedLevel = {
      level,
      answer,
      length,
      tries,
      difficulty,
      trapRate: trapped,
      par,
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
    par: 1,
    rarity: 0,
  };
}
