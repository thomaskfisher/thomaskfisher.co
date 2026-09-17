/**
 * Simon's rules. Pure: no DOM, no timers, no `Math.random()`.
 *
 * **A memory game, not a puzzle, and it bends the house rules the way Yahtzee
 * does.** There is no board to verify and nothing for a solver to prove: the
 * whole game is a sequence of pads that grows by one each round, and difficulty
 * is its length. What stays is everything that matters — a game is a pure
 * function of `(profileSeed, game)`, so it is reproducible by number and a save
 * is a handful of integers.
 *
 * **The sequence is a stream, not a deal.** Round `n` shows the first `n` pads
 * of one seeded stream, so every round is the previous round plus one — which
 * is the game — and reading the sequence at any length never changes the pads
 * before it.
 *
 * **The number of pads is a parameter from the start.** Four is the original
 * and the only size shipped, but "more colours" is the obvious harder mode, and
 * a model that assumes four would have to be unpicked to get there.
 */

import { createRng, hashSeed } from '../shared/rng';

/** Pads on the classic board. */
export const DEFAULT_PADS = 4;

/**
 * The first `length` pads of game `game`'s sequence.
 *
 * Generated from the start every call rather than cached: a run of fifty is
 * fifty draws, which is cheaper than the bookkeeping, and there is then no way
 * for a cached sequence to belong to the wrong game.
 */
export function sequenceFor(
  profileSeed: string,
  game: number,
  length: number,
  pads = DEFAULT_PADS,
): number[] {
  const rng = createRng(hashSeed(profileSeed, 'simon', pads, game));
  const out: number[] = [];
  for (let i = 0; i < length; i++) out.push(rng.int(pads));
  return out;
}

/** Where a game is. */
export interface Run {
  /** Length of the sequence being played this round. Starts at 1. */
  round: number;
  /** Pads of this round already repeated correctly. */
  entered: number;
  /** A wrong pad has been pressed. */
  over: boolean;
}

export const newRun = (): Run => ({ round: 1, entered: 0, over: false });

/** Rounds finished — the score. A game lost on round 5 scores 4. */
export const scoreOf = (run: Run): number => run.round - 1;

export type PressResult =
  /** Right pad, more to come this round. */
  | 'ok'
  /** Right pad, and it was the last one: the next round is one longer. */
  | 'round'
  /** Wrong pad. The game is over. */
  | 'wrong';

/**
 * One tap against the sequence.
 *
 * `sequence` must be at least `run.round` long. A finished run ignores taps
 * rather than throwing, because a tap landing on the frame the game ends is a
 * thing fingers do.
 */
export function press(
  run: Run,
  sequence: readonly number[],
  pad: number,
): { run: Run; result: PressResult | null } {
  if (run.over) return { run, result: null };

  const expected = sequence[run.entered];
  if (expected === undefined) throw new Error(`Sequence too short for round ${run.round}`);

  if (pad !== expected) return { run: { ...run, over: true }, result: 'wrong' };

  const entered = run.entered + 1;
  if (entered < run.round) return { run: { ...run, entered }, result: 'ok' };
  return { run: { round: run.round + 1, entered: 0, over: false }, result: 'round' };
}

/**
 * Rebuilds a run from a save.
 *
 * The save holds the sequence as far as the player has repeated it — the pads
 * of the last round they finished — rather than a round number, so a save that
 * no longer matches its game (an imported code from another profile, a change
 * to the generator) is caught here instead of dropping someone into a round of
 * a different sequence. Only the prefix that still agrees is kept.
 */
export function resume(sequence: readonly number[], saved: readonly number[]): Run {
  let agreed = 0;
  while (agreed < saved.length && saved[agreed] === sequence[agreed]) agreed++;
  return { round: agreed + 1, entered: 0, over: false };
}

/**
 * How long each pad stays lit while the sequence is shown, in ms.
 *
 * The original speeds up at the fifth, thirteenth and twenty-first steps, and
 * that is kept: length is the difficulty, but reading twenty pads at a
 * first-round pace is a test of patience rather than of memory. The floor is
 * where a flash is still unmistakable on a phone held at arm's length.
 */
export function flashMs(round: number): number {
  if (round <= 5) return 460;
  if (round <= 13) return 380;
  if (round <= 21) return 310;
  return 260;
}

/** The dark beat between two flashes. Without it the same pad twice reads as once. */
export function gapMs(round: number): number {
  return Math.round(flashMs(round) * 0.3);
}
