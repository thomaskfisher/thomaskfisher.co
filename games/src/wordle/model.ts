/**
 * Wordle rules. Pure — no DOM, no randomness, no solver.
 *
 * Almost all of this file is one function, `markGuess`, and it is the only part
 * of the game anybody ever gets wrong. Repeated letters are the whole
 * difficulty: guessing `ALLOT` against `TIDAL` must colour **one** of the two
 * Ls, not both, because the answer only has one to give.
 *
 * The fix is to score in two passes — greens first, then yellows out of what
 * greens did not consume — and it has to be that way round. A single pass that
 * decides each position as it reaches it will happily spend the answer's only L
 * on the first one and then have nothing left for a later green.
 */

import { GUESSES } from './words';

export const enum Mark {
  /** Not in the word at all — or a repeat the answer cannot cover. */
  Absent = 0,
  /** In the word, elsewhere. */
  Present = 1,
  /** Right letter, right place. */
  Correct = 2,
}

export const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

/**
 * Colours a guess against an answer.
 *
 * Two passes, and the order matters. Greens are taken first and each one uses
 * up one of the answer's copies of that letter; yellows are then handed out
 * from whatever copies are left, left to right. That is what makes `ALLOT`
 * against `TIDAL` come back with one yellow L rather than two, and it is the
 * single most common bug in a reimplementation of this game.
 */
export function markGuess(guess: string, answer: string): Mark[] {
  const marks = new Array<Mark>(guess.length).fill(Mark.Absent);

  /** Letters of the answer not yet claimed by a green. */
  const spare = new Map<string, number>();

  for (let i = 0; i < guess.length; i++) {
    const letter = answer[i] as string;
    if (guess[i] === letter) {
      marks[i] = Mark.Correct;
    } else {
      spare.set(letter, (spare.get(letter) ?? 0) + 1);
    }
  }

  for (let i = 0; i < guess.length; i++) {
    if (marks[i] === Mark.Correct) continue;
    const letter = guess[i] as string;
    const left = spare.get(letter) ?? 0;
    if (left > 0) {
      marks[i] = Mark.Present;
      spare.set(letter, left - 1);
    }
  }

  return marks;
}

/** True when every letter landed green. */
export function isWin(marks: readonly Mark[]): boolean {
  return marks.every((mark) => mark === Mark.Correct);
}

/* ------------------------------------------------------------------ */
/* The word lists                                                      */
/* ------------------------------------------------------------------ */

/**
 * The packed lists index in constant time and are searched without unpacking.
 *
 * A `Set` built at start-up would be simpler to read and would spend a few
 * hundred kilobytes and a noticeable pause building eighteen thousand strings
 * the game will mostly never look at.
 */
export function wordAt(packed: string, length: number, index: number): string {
  return packed.slice(index * length, (index + 1) * length);
}

export function countOf(packed: string, length: number): number {
  return packed.length / length;
}

/** Binary search over the sorted, packed guess list. */
export function isAllowedGuess(word: string): boolean {
  const length = word.length;
  const packed = GUESSES[length];
  if (!packed) return false;

  let low = 0;
  let high = countOf(packed, length) - 1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const candidate = wordAt(packed, length, middle);
    if (candidate === word) return true;
    if (candidate < word) low = middle + 1;
    else high = middle - 1;
  }

  return false;
}

/* ------------------------------------------------------------------ */
/* Play                                                                */
/* ------------------------------------------------------------------ */

/** A move is the word that was guessed. Small enough to store as it stands. */
export type Move = string;

export interface Row {
  word: string;
  marks: Mark[];
}

/** Replays a list of guesses against an answer. */
export function rowsFor(guesses: readonly string[], answer: string): Row[] {
  return guesses.map((word) => ({ word, marks: markGuess(word, answer) }));
}

/**
 * The best thing known about each letter, for the keyboard.
 *
 * `Correct` beats `Present` beats `Absent`, so a letter that came back green
 * once stays green even if a later guess put it somewhere wrong. Downgrading it
 * would throw away the one thing the player had already earned.
 */
export function keyboardMarks(rows: readonly Row[]): Map<string, Mark> {
  const best = new Map<string, Mark>();

  for (const row of rows) {
    for (let i = 0; i < row.word.length; i++) {
      const letter = row.word[i] as string;
      const mark = row.marks[i] as Mark;
      const known = best.get(letter);
      if (known === undefined || mark > known) best.set(letter, mark);
    }
  }

  return best;
}

/**
 * Does this word agree with everything the board has shown?
 *
 * The test is simply that the candidate, scored against the same guesses, would
 * have produced the same colours. That is exactly what "consistent" means, it
 * needs no rules about which letters are ruled in or out, and it gets repeated
 * letters right for free because `markGuess` already does.
 */
export function isConsistent(candidate: string, rows: readonly Row[]): boolean {
  for (const row of rows) {
    const marks = markGuess(row.word, candidate);
    for (let i = 0; i < marks.length; i++) {
      if (marks[i] !== row.marks[i]) return false;
    }
  }
  return true;
}

/** How many answers are still possible. Shown nowhere; used to measure. */
export function narrowCandidates(candidates: readonly string[], rows: readonly Row[]): string[] {
  return candidates.filter((word) => isConsistent(word, rows));
}

/** Letters in the word, which is what the level is really asking of you. */
export function lettersKnown(rows: readonly Row[], length: number): number {
  const known = new Array<boolean>(length).fill(false);
  for (const row of rows) {
    for (let i = 0; i < length; i++) {
      if (row.marks[i] === Mark.Correct) known[i] = true;
    }
  }
  return known.filter(Boolean).length;
}
