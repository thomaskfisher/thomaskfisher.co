/**
 * Yahtzee rules. Pure: no DOM, no I/O, and no `Math.random()`.
 *
 * This is Yahtzee, and it is the odd one out in this collection. The other four
 * games are puzzles: a level is generated, a solver proves it can be finished,
 * and the player is never handed a dead end. There is nothing here to generate
 * and nothing to prove — the game *is* the randomness, and every round can be
 * finished by definition, because writing a zero in a box is always legal.
 *
 * What replaces "verified solvable" is a different promise, and it is the reason
 * this file looks the way it does: **the dice are fixed before you touch them.**
 * Every face is a pure function of (seed, turn, roll, slot):
 *
 *   - The app cannot be accused of cheating, because nothing it rolls depends
 *     on how well the round is going. `dice.test.ts` checks the distribution.
 *   - A saved round is a seed and a short list of moves, exactly as in the
 *     other games — see `game.ts`.
 *   - A bug report is reproducible: the round number is the round.
 *
 * Indexing by *slot and roll number* rather than by a running counter is the
 * part that matters. Rerolling {die 0} and rerolling {die 0, die 1} both give
 * slot 0 the same face, so what you get out of a roll cannot be changed by
 * choosing differently. That is what makes the dice honest rather than merely
 * seeded, and it is also why this game has no undo: see `game.ts`.
 */

import { createRng, hashSeed } from '../shared/rng';

export const DICE = 5;
export const ROLLS_PER_TURN = 3;
/** Points needed in the six upper boxes to earn the bonus. */
export const UPPER_TARGET = 63;
export const UPPER_BONUS = 35;

export type Section = 'upper' | 'lower';

export interface Category {
  id: string;
  /** As printed on the scorecard. Kept short: the box is half a phone wide. */
  name: string;
  section: Section;
  /** What the box pays, shown under the name while it is still open. */
  note: string;
  /** `counts` is indexed by face, 1-6. `total` is the sum of all five dice. */
  score(counts: readonly number[], total: number): number;
}

const upper = (name: string, face: number): Category => ({
  id: name.toLowerCase(),
  name,
  section: 'upper',
  note: `Sum of ${face}s`,
  score: (counts) => (counts[face] ?? 0) * face,
});

const hasRun = (counts: readonly number[], length: number): boolean => {
  let run = 0;
  for (let face = 1; face <= 6; face++) {
    run = (counts[face] ?? 0) > 0 ? run + 1 : 0;
    if (run >= length) return true;
  }
  return false;
};

/**
 * The thirteen boxes, in the order the scorecard prints them: the six upper
 * boxes down the left column, the seven lower boxes down the right.
 *
 * Two rules from the original are deliberately absent. There is no bonus for a
 * second five-of-a-kind, and there are no joker rules for where one may be
 * written — so a full house means exactly three of one face and two of another,
 * and five alike is not a run. Both are rare, both add a whole dimension to
 * every decision, and neither is missed while the core is being built.
 */
export const CATEGORIES: readonly Category[] = [
  upper('Ones', 1),
  upper('Twos', 2),
  upper('Threes', 3),
  upper('Fours', 4),
  upper('Fives', 5),
  upper('Sixes', 6),
  {
    id: 'three-of-a-kind',
    name: 'Three of a kind',
    section: 'lower',
    note: 'Sum of all five',
    score: (counts, total) => (counts.some((count) => count >= 3) ? total : 0),
  },
  {
    id: 'four-of-a-kind',
    name: 'Four of a kind',
    section: 'lower',
    note: 'Sum of all five',
    score: (counts, total) => (counts.some((count) => count >= 4) ? total : 0),
  },
  {
    id: 'full-house',
    name: 'Full house',
    section: 'lower',
    note: 'Three and a pair · 25',
    score: (counts) =>
      counts.some((count) => count === 3) && counts.some((count) => count === 2) ? 25 : 0,
  },
  {
    id: 'small-straight',
    name: 'Small straight',
    section: 'lower',
    note: 'Four in a row · 30',
    score: (counts) => (hasRun(counts, 4) ? 30 : 0),
  },
  {
    id: 'large-straight',
    name: 'Large straight',
    section: 'lower',
    note: 'Five in a row · 40',
    score: (counts) => (hasRun(counts, 5) ? 40 : 0),
  },
  {
    id: 'five-of-a-kind',
    name: 'Five of a kind',
    section: 'lower',
    note: 'All five the same · 50',
    score: (counts) => (counts.some((count) => count === 5) ? 50 : 0),
  },
  {
    id: 'chance',
    name: 'Chance',
    section: 'lower',
    note: 'Sum of all five',
    score: (_counts, total) => total,
  },
];

export const UPPER_INDEXES = CATEGORIES.reduce<number[]>(
  (list, category, index) => (category.section === 'upper' ? [...list, index] : list),
  [],
);

/** The face value an upper box counts, so 3 for Threes. Its index plus one. */
export const upperFace = (index: number): number => index + 1;

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

/** Faces held, indexed 1-6. Index 0 is always 0, so `counts.some` is safe. */
export function faceCounts(dice: readonly number[]): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const die of dice) counts[die] = (counts[die] ?? 0) + 1;
  return counts;
}

export function scoreFor(category: number, dice: readonly number[]): number {
  const entry = CATEGORIES[category];
  if (!entry) throw new Error(`no category ${category}`);
  const total = dice.reduce((sum, die) => sum + die, 0);
  return entry.score(faceCounts(dice), total);
}

export interface Totals {
  /** The six upper boxes, before the bonus. */
  upper: number;
  bonus: number;
  lower: number;
  grand: number;
}

export function totals(scores: readonly (number | null)[]): Totals {
  let up = 0;
  let low = 0;
  for (const [index, value] of scores.entries()) {
    if (value === null) continue;
    if (CATEGORIES[index]?.section === 'upper') up += value;
    else low += value;
  }
  const bonus = up >= UPPER_TARGET ? UPPER_BONUS : 0;
  return { upper: up, bonus, lower: low, grand: up + bonus + low };
}

/**
 * Whether the upper bonus is still worth chasing.
 *
 * False once it is won and once it is arithmetically gone — five sixes in every
 * remaining upper box would not reach 63. The adviser uses this rather than
 * pricing an unreachable bonus into every decision.
 */
export function bonusReachable(scores: readonly (number | null)[]): boolean {
  const { upper: progress } = totals(scores);
  if (progress >= UPPER_TARGET) return false;

  let ceiling = progress;
  for (const index of UPPER_INDEXES) {
    if (scores[index] === null) ceiling += DICE * upperFace(index);
  }
  return ceiling >= UPPER_TARGET;
}

/* ------------------------------------------------------------------ */
/* The dice                                                            */
/* ------------------------------------------------------------------ */

/**
 * The face a slot shows after a given roll of a given turn.
 *
 * Deliberately independent of everything else the player has done. See the file
 * header: this is what stops a rewind from being a way to shop for dice.
 */
export function dieFace(seed: string, turn: number, roll: number, slot: number): number {
  return createRng(hashSeed(seed, 'fivedice', turn, roll, slot)).int(6) + 1;
}

function rollAll(seed: string, turn: number, roll: number): number[] {
  return Array.from({ length: DICE }, (_, slot) => dieFace(seed, turn, roll, slot));
}

/* ------------------------------------------------------------------ */
/* Round state                                                         */
/* ------------------------------------------------------------------ */

export interface RoundState {
  seed: string;
  /** 0-based. Equal to CATEGORIES.length once the card is full. */
  turn: number;
  /** Rolls taken this turn, 1-3. The turn's opening roll is automatic. */
  rollsUsed: number;
  /** The five faces on the table. */
  dice: number[];
  /** One entry per category. `null` is open; 0 is a box scratched for nothing. */
  scores: (number | null)[];
}

export function startRound(seed: string): RoundState {
  return {
    seed,
    turn: 0,
    rollsUsed: 1,
    dice: rollAll(seed, 0, 0),
    scores: CATEGORIES.map(() => null),
  };
}

export const isFinished = (state: RoundState): boolean => state.turn >= CATEGORIES.length;

export const rollsLeft = (state: RoundState): number =>
  isFinished(state) ? 0 : ROLLS_PER_TURN - state.rollsUsed;

/* ------------------------------------------------------------------ */
/* Moves                                                               */
/* ------------------------------------------------------------------ */

/**
 * A move is one small integer, so a saved round is a handful of digits.
 *
 *   1-31    reroll: a bitmask of the slots being thrown again
 *   32-44   score: 32 + the category index
 *
 * A mask of 0 would be "throw none of them", which is not a move.
 */
export type Move = number;

const SCORE_BASE = 32;

export const rerollMove = (mask: number): Move => mask;
export const scoreMove = (category: number): Move => SCORE_BASE + category;
export const isScoreMove = (move: Move): boolean => move >= SCORE_BASE;
export const movedCategory = (move: Move): number => move - SCORE_BASE;

export function canReroll(state: RoundState, mask: number): boolean {
  if (isFinished(state) || rollsLeft(state) <= 0) return false;
  return Number.isInteger(mask) && mask > 0 && mask < 1 << DICE;
}

export function canScore(state: RoundState, category: number): boolean {
  if (isFinished(state)) return false;
  return category >= 0 && category < CATEGORIES.length && state.scores[category] === null;
}

export function isLegalMove(state: RoundState, move: Move): boolean {
  return isScoreMove(move)
    ? canScore(state, movedCategory(move))
    : canReroll(state, rerollMove(move));
}

/** Throws on an illegal move; callers replaying a save check `isLegalMove` first. */
export function applyMove(state: RoundState, move: Move): RoundState {
  if (!isLegalMove(state, move)) throw new Error(`illegal move ${move}`);

  if (!isScoreMove(move)) {
    const roll = state.rollsUsed;
    return {
      ...state,
      rollsUsed: roll + 1,
      dice: state.dice.map((die, slot) =>
        move & (1 << slot) ? dieFace(state.seed, state.turn, roll, slot) : die,
      ),
    };
  }

  const category = movedCategory(move);
  const scores = [...state.scores];
  scores[category] = scoreFor(category, state.dice);

  const turn = state.turn + 1;
  const done = turn >= CATEGORIES.length;

  return {
    ...state,
    turn,
    scores,
    // The last hand stays on the table when the card fills, so the round can be
    // read where it ended rather than snapping to an empty tray.
    rollsUsed: done ? state.rollsUsed : 1,
    dice: done ? state.dice : rollAll(state.seed, turn, 0),
  };
}

/**
 * Rebuilds a round from its move list.
 *
 * A move that no longer applies ends the replay rather than throwing: a corrupt
 * tail should cost the tail, not the round. `applied` says how many were used,
 * so the caller can trim its own copy of the list to match.
 */
export function replay(
  seed: string,
  moves: readonly Move[],
): { state: RoundState; applied: number } {
  let state = startRound(seed);
  let applied = 0;

  for (const move of moves) {
    if (!isLegalMove(state, move)) break;
    state = applyMove(state, move);
    applied++;
  }

  return { state, applied };
}

/** What every open box would pay for the dice on the table. Null where filled. */
export function previews(state: RoundState): (number | null)[] {
  return CATEGORIES.map((_, index) =>
    state.scores[index] === null && !isFinished(state) ? scoreFor(index, state.dice) : null,
  );
}
