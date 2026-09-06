/**
 * The hint. This game's `solve.ts`.
 *
 * The other four games solve a board: there is a winning line, the solver finds
 * it, and the hint follows it. There is no winning line here — the future is
 * genuinely unknown — so the hint plays the *probabilities* instead, and it must
 * do so honestly.
 *
 * That last word is load-bearing. Every face in a round is already determined
 * (see `model.ts`), so a hint that looked at the seed could tell you exactly
 * what your next roll will be. Nothing in this file may touch `dieFace`, and
 * nothing does: it reasons about the distribution of a fair die, exactly as a
 * player must. Its advice on a given position is identical whatever seed
 * produced that position, and `advise.test.ts` holds that.
 *
 * How it plays
 * ------------
 * Within the current turn the arithmetic is exact. The value of a hand at the
 * end of a turn is the best box it can be written in, and "best" is worth more
 * than the raw points:
 *
 *   value of writing hand h in box c  =  points  -  what closing c gives up
 *                                                +  credit toward the bonus
 *
 * "What closing c gives up" is the expected score of a whole turn spent chasing
 * c on its own — computed with the same machinery, once, at startup. Without
 * that term the hint writes a 5 in Yahtzee the moment nothing better is
 * on the table, which is how a greedy Yahtzee player loses fifty points.
 *
 * Two rolls of exact lookahead over 252 distinct hands is a few hundred thousand
 * multiply-adds, so a hint costs single-digit milliseconds and needs no worker.
 * The trade is that it does not plan across turns — it prices a box by what a
 * dedicated turn would earn rather than by what the rest of *this* card needs.
 * That makes it a strong player, not a perfect one: `tools/dice.ts` measures it
 * at a mean of 233 a card, against roughly 254 for perfect play. It is honest about what it is: the button says
 * Hint, not Solve.
 */

import {
  CATEGORIES,
  DICE,
  ROLLS_PER_TURN,
  type RoundState,
  UPPER_BONUS,
  UPPER_TARGET,
  applyMove,
  faceCounts,
  isFinished,
  isLegalMove,
  rerollMove,
  rollsLeft,
  scoreFor,
  scoreMove,
  startRound,
  totals,
  upperFace,
} from './model';

const FACES = 6;

export interface Advice {
  /** Throw again, or write the hand down. */
  kind: 'roll' | 'score';
  /** Slots to hold. Only meaningful when `kind` is 'roll'; may be empty. */
  keep: number[];
  /** Box to write in when `kind` is 'score', otherwise -1. */
  category: number;
  /** What that box would pay. 0 for a roll. */
  points: number;
}

/* ------------------------------------------------------------------ */
/* Static tables                                                       */
/* ------------------------------------------------------------------ */

interface Outcome {
  hand: number;
  probability: number;
}

interface Tables {
  /** Every distinct hand of five dice, as sorted faces. 252 of them. */
  hands: number[][];
  handIndex: Map<string, number>;
  /** Every distinct set of dice that can be held, of size 0-5. 462 of them. */
  keeps: number[][];
  /** Per keep, the hands it can become once the rest are thrown. */
  outcomes: Outcome[][];
  /** Per hand, the keeps reachable from it, excluding holding all five. */
  keepsOf: number[][];
  /** The distribution of an opening roll — the keep of size zero. */
  opening: Outcome[];
}

const key = (dice: readonly number[]): string => dice.join('');

let cachedTables: Tables | null = null;

function tables(): Tables {
  if (cachedTables) return cachedTables;

  const hands: number[][] = [];
  const handIndex = new Map<string, number>();
  const keeps: number[][] = [];
  const keepIndex = new Map<string, number>();

  // Sorted multisets of every size up to five, built once. The size-five ones
  // are the hands; the rest are what can be held out of a hand.
  const build = (prefix: number[], from: number): void => {
    const at = keepIndex.size;
    keepIndex.set(key(prefix), at);
    keeps.push([...prefix]);
    if (prefix.length === DICE) {
      handIndex.set(key(prefix), hands.length);
      hands.push([...prefix]);
      return;
    }
    for (let face = from; face <= FACES; face++) build([...prefix, face], face);
  };
  build([], 1);

  const outcomes: Outcome[][] = keeps.map((keep) => {
    const throwing = DICE - keep.length;
    const counts = new Map<number, number>();
    const total = FACES ** throwing;

    // Every ordered outcome of the dice being thrown, folded onto the hand it
    // produces. Twenty-three thousand steps for the whole table.
    const walk = (rolled: number[]): void => {
      if (rolled.length === throwing) {
        const hand = handIndex.get(key([...keep, ...rolled].sort((a, b) => a - b)));
        if (hand !== undefined) counts.set(hand, (counts.get(hand) ?? 0) + 1);
        return;
      }
      for (let face = 1; face <= FACES; face++) walk([...rolled, face]);
    };
    walk([]);

    return [...counts].map(([hand, count]) => ({ hand, probability: count / total }));
  });

  const keepsOf = hands.map((hand) => {
    const found = new Set<number>();
    // Every subset of the five slots, deduplicated by the dice it holds. Holding
    // all five is left out: it is not a legal throw, and "stop and write it
    // down" is already a candidate in its own right.
    for (let mask = 0; mask < (1 << DICE) - 1; mask++) {
      const held: number[] = [];
      for (let slot = 0; slot < DICE; slot++) if (mask & (1 << slot)) held.push(hand[slot] as number);
      const at = keepIndex.get(key(held));
      if (at !== undefined) found.add(at);
    }
    return [...found];
  });

  cachedTables = {
    hands,
    handIndex,
    keeps,
    outcomes,
    keepsOf,
    opening: outcomes[keepIndex.get('') as number] as Outcome[],
  };
  return cachedTables;
}

/**
 * Score for every box against every hand, built once.
 *
 * 252 x 13 lookups replace a scoring call inside the innermost loop, which is
 * the difference between a hint costing milliseconds and costing a frame.
 */
let cachedScores: number[][] | null = null;

function scoreTable(): number[][] {
  if (cachedScores) return cachedScores;
  cachedScores = tables().hands.map((hand) => CATEGORIES.map((_, index) => scoreFor(index, hand)));
  return cachedScores;
}

/* ------------------------------------------------------------------ */
/* What a box is worth on its own                                      */
/* ------------------------------------------------------------------ */

/**
 * The expected score of a turn spent chasing one box and nothing else.
 *
 * This is the price of closing that box, and it is what stops the hint writing
 * a 5 in Yahtzee or an 8 in Sixes. A card has thirteen turns and thirteen
 * boxes, so "one dedicated turn" is a fair estimate of what a box is worth.
 */
let cachedForgone: number[] | null = null;

function forgone(): number[] {
  if (cachedForgone) return cachedForgone;

  const { keepsOf, outcomes, opening } = tables();
  const scores = scoreTable();

  cachedForgone = CATEGORIES.map((_, category) => {
    const value = solveTurn((hand) => scores[hand]?.[category] ?? 0, keepsOf, outcomes);
    const final = value[ROLLS_PER_TURN - 1] as number[];
    return opening.reduce((sum, { hand, probability }) => sum + probability * (final[hand] ?? 0), 0);
  });
  return cachedForgone;
}

/* ------------------------------------------------------------------ */
/* The within-turn search                                              */
/* ------------------------------------------------------------------ */

/**
 * Exact expected value of a turn, by rolls remaining.
 *
 * `value[r][h]` is what a hand `h` is worth with `r` throws still available:
 * either write it down now, or hold some of it and throw the rest. Complete over
 * the whole space of hands and holds — there is no budget and nothing is pruned,
 * because the space is 252 hands wide and fits comfortably.
 */
function solveTurn(
  placement: (hand: number) => number,
  keepsOf: number[][],
  outcomes: Outcome[][],
): number[][] {
  const handCount = keepsOf.length;
  const stop = Array.from({ length: handCount }, (_, hand) => placement(hand));
  const value: number[][] = [stop];

  for (let rolls = 1; rolls < ROLLS_PER_TURN; rolls++) {
    const previous = value[rolls - 1] as number[];
    const level = new Array<number>(handCount);

    for (let hand = 0; hand < handCount; hand++) {
      let best = stop[hand] as number;
      for (const keep of keepsOf[hand] as number[]) {
        let expected = 0;
        for (const { hand: next, probability } of outcomes[keep] as Outcome[]) {
          expected += probability * (previous[next] as number);
        }
        if (expected > best) best = expected;
      }
      level[hand] = best;
    }
    value.push(level);
  }

  return value;
}

/* ------------------------------------------------------------------ */
/* Advice                                                              */
/* ------------------------------------------------------------------ */

interface Placement {
  category: number;
  points: number;
  value: number;
}

/**
 * How much the bonus is worth per upper point still needed.
 *
 * Thirty-five points for sixty-three is a little over half a point each, counted
 * only up to the amount still outstanding and only while the bonus can still be
 * won — pricing an unreachable bonus into every decision is how a hint ends up
 * insisting on Fours in the last two turns of a card it cannot save.
 *
 * The flat rate undersells it, though, because the bonus is a threshold rather
 * than a rate: the point taking you from 62 to 63 is worth thirty-five and the
 * one after it is worth nothing. So `tools/dice.ts` was run across weights on
 * top of the flat rate. 1.0 earned the bonus on 17% of cards for a mean of
 * 230.9; 1.4 on 22% for 232.8; 1.8 also 22% for 232.5; 2.4 fell back to 226.8
 * by chasing it into cards that could never pay. The top is broad, so this is
 * not a knife edge — and it is the only tuned number in the file.
 */
const BONUS_WEIGHT = 1.4;
const BONUS_RATE = (BONUS_WEIGHT * UPPER_BONUS) / UPPER_TARGET;

function placementBuilder(state: RoundState): (hand: number) => Placement {
  const scores = scoreTable();
  const cost = forgone();
  const open = CATEGORIES.map((_, index) => state.scores[index] === null);

  const { upper: progress } = totals(state.scores);
  let outstanding = UPPER_TARGET - progress;
  if (outstanding > 0) {
    // Reachability, in the same terms the model uses: five of the right face in
    // every upper box still open.
    let ceiling = progress;
    for (const [index, category] of CATEGORIES.entries()) {
      if (category.section === 'upper' && open[index]) ceiling += DICE * upperFace(index);
    }
    if (ceiling < UPPER_TARGET) outstanding = 0;
  }

  return (hand: number): Placement => {
    const row = scores[hand] as number[];
    let best: Placement = { category: -1, points: 0, value: -Infinity };

    for (const [index, category] of CATEGORIES.entries()) {
      if (!open[index]) continue;
      const points = row[index] as number;
      const bonus =
        category.section === 'upper' && outstanding > 0
          ? BONUS_RATE * Math.min(points, outstanding)
          : 0;
      const value = points - (cost[index] as number) + bonus;
      if (value > best.value) best = { category: index, points, value };
    }

    return best;
  };
}

/**
 * What to do with the dice on the table.
 *
 * A pure function of (open boxes, dice, rolls left) — it cannot see the seed,
 * and it cannot see the move history. That is also why this game has no hint
 * ping-pong: asking twice from the same position gives the same answer, so
 * there is no cached plan to keep in step and nothing for two answers to
 * disagree about. `game.ts` memoises it only to save the recomputation.
 */
export function advise(state: RoundState): Advice | null {
  if (isFinished(state)) return null;

  const { handIndex, keeps, keepsOf, outcomes } = tables();
  const hand = handIndex.get(key([...state.dice].sort((a, b) => a - b)));
  if (hand === undefined) return null;

  const placementOf = placementBuilder(state);
  const here = placementOf(hand);
  const throwsLeft = rollsLeft(state);

  if (throwsLeft <= 0) {
    return { kind: 'score', keep: [], category: here.category, points: here.points };
  }

  const value = solveTurn((index) => placementOf(index).value, keepsOf, outcomes);
  const next = value[throwsLeft - 1] as number[];

  let bestKeep = -1;
  let bestValue = here.value;
  for (const keep of keepsOf[hand] as number[]) {
    let expected = 0;
    for (const { hand: after, probability } of outcomes[keep] as Outcome[]) {
      expected += probability * (next[after] as number);
    }
    if (expected > bestValue) {
      bestValue = expected;
      bestKeep = keep;
    }
  }

  if (bestKeep < 0) {
    return { kind: 'score', keep: [], category: here.category, points: here.points };
  }

  return {
    kind: 'roll',
    keep: slotsFor(state.dice, keeps[bestKeep] as number[]),
    category: -1,
    points: 0,
  };
}

/**
 * Which physical dice to hold, given the faces to keep.
 *
 * The search works in sorted hands because 252 of them cover every position;
 * the player has five dice in five places. Any slot showing a wanted face will
 * do, so this takes the leftmost each time — which keeps held dice where the
 * player last saw them instead of shuffling the tray.
 */
function slotsFor(dice: readonly number[], keep: readonly number[]): number[] {
  const wanted = faceCounts(keep);
  const slots: number[] = [];
  for (const [slot, die] of dice.entries()) {
    if ((wanted[die] ?? 0) > 0) {
      wanted[die] = (wanted[die] as number) - 1;
      slots.push(slot);
    }
  }
  return slots;
}

/** Diagnostics for `tools/probe.ts`: what each box is priced at. */
export function boxPrices(): { name: string; expected: number }[] {
  return CATEGORIES.map((category, index) => ({
    name: category.name,
    expected: forgone()[index] as number,
  }));
}

/** Hand count, so a test can assert the tables are the size they should be. */
export const handSpaceSize = (): number => tables().hands.length;

/**
 * Plays a whole round by following the hint, and returns the move list.
 *
 * Used by the tests and by `tools/probe.ts`, and it is the same loop the browser
 * harness drives through the Hint button — which is what makes "press Hint,
 * press what it points at, repeat" a check on the real game rather than on a
 * simulation of it.
 */
export function autoPlay(
  seed: string,
  start?: RoundState,
): { moves: number[]; state: RoundState } {
  let state = start ?? startRound(seed);
  const moves: number[] = [];

  // A round is thirteen turns of at most three throws. The bound is a guard
  // against an adviser that stops making progress, not an expected outcome.
  for (let step = 0; step < CATEGORIES.length * ROLLS_PER_TURN + 1; step++) {
    if (isFinished(state)) break;
    const advice = advise(state);
    if (!advice) break;

    const move =
      advice.kind === 'score'
        ? scoreMove(advice.category)
        : rerollMove(
            [...Array(DICE).keys()]
              .filter((slot) => !advice.keep.includes(slot))
              .reduce((mask, slot) => mask | (1 << slot), 0),
          );

    if (!isLegalMove(state, move)) break;
    state = applyMove(state, move);
    moves.push(move);
  }

  return { moves, state };
}
