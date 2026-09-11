/**
 * 2048 generation.
 *
 * There is less to generate here than in the other puzzles and more to verify.
 * A level is a target tile, a board size, and a seed — the tiles themselves
 * arrive during play — so what this file really does is *check* that the level
 * it is about to hand over can be finished, and measure how hard finishing it
 * is.
 *
 * Two promises hold for every level this returns:
 *
 *  - **It can be reached.** The strong player in `solve.ts` plays the level
 *    through from the opening and has to actually get there. Deterministic
 *    spawns are what make that meaningful: the tiles it was given are the tiles
 *    the player will be given.
 *  - **Difficulty is measured, not assumed.** Trap rate over naive
 *    playthroughs, which is the signal the rest of the collection is calibrated
 *    on.
 */

import { pressureForLevel } from '../shared/difficulty';
import { createRng, hashSeed } from '../shared/rng';
import { faceOf } from './model';
import { playOut, trapRate } from './solve';

export const GAME_ID = 'twenty48';

export interface GeneratedLevel {
  level: number;
  /** Cells along one side. Four, always — this is the board she knows. */
  size: number;
  /** Tiles the board opens with. */
  seeds: number;
  /** The exponent to reach: 7 is 128, 11 is 2048. */
  target: number;
  /** 0..1, measured. See `score`. */
  difficulty: number;
  /** Share of naive playthroughs that got stuck short of the target. */
  trapRate: number;
  /** Moves the strong player needed. A par, not a limit. */
  par: number;
}

/** Classic 2048. The size is not a difficulty lever — see the note on `TARGETS`. */
export const SIZE = 4;
export const OPENING_TILES = 2;

/**
 * The ladder of targets.
 *
 * **It stops at 1024 rather than 2048, and that is a deliberate cut.** Reaching
 * 2048 on a four-by-four takes somewhere around nine hundred moves — half an
 * hour, in one sitting, with no natural stopping point. Every level past 50
 * would be that. This collection is for somebody playing a puzzle on the sofa,
 * and a level nobody finishes in one go is a level that quietly becomes the
 * last one played.
 *
 * The board stays four by four for the same kind of reason: a five-wide grid is
 * *easier* — more room, more time to fix a mistake — and it is not the game
 * anybody means when they say 2048.
 */
const TARGETS = [6, 7, 8, 9, 10] as const;

/**
 * Trap rate for each target, measured once in `tools/twenty48.ts`.
 *
 * **These saturate, and that is a fact about the game rather than a flaw in the
 * measurement.** A player with no lookahead essentially never reaches 512,
 * whatever habits they have: giving the naive player a corner habit moved 512
 * from 0.97 to 0.97 and 1024 from 1.00 to 1.00. So trap rate separates the
 * bottom of the ladder and nothing else, and the target has to carry the top.
 */
const NOMINAL_TRAP = [0.03, 0.25, 0.75, 0.97, 1.0] as const;

/**
 * The target whose difficulty lands nearest the middle of the band.
 *
 * **Derived from the band rather than from the pressure, which is the opposite
 * of every other game here.** The reason is that there are only five targets:
 * difficulty cannot be tuned continuously, so mapping pressure onto the ladder
 * linearly — the obvious thing, and the first thing tried — put level 12 on a
 * 512 whose difficulty is 0.86 against a band topping out at 0.76, and missed
 * four levels in fifteen. Choosing the rung nearest the target difficulty
 * instead misses none.
 */
export function targetForBand(band: readonly [number, number]): number {
  const centre = (band[0] + band[1]) / 2;

  let best = TARGETS[0] as number;
  let bestMiss = Infinity;

  for (let index = 0; index < TARGETS.length; index++) {
    const target = TARGETS[index] as number;
    const miss = Math.abs(score(target, NOMINAL_TRAP[index] as number) - centre);
    if (miss < bestMiss) {
      bestMiss = miss;
      best = target;
    }
  }

  return best;
}

/** The number on the tile the level is asking for. */
export function targetFace(target: number): number {
  return faceOf(target);
}

/**
 * Difficulty, from the target and from how often a naive player falls short.
 *
 * **The target carries three quarters of it, which is the opposite of how this
 * started.** Trap rate is the signal the rest of the collection is calibrated
 * on and it was weighted accordingly at first — but here it runs out of range
 * early: 0.03 at 64, 0.75 at 256, and then 0.97 and 1.00, so above a 256 it has
 * nothing left to say. Leaning on it heavily squashed the top three rungs of the
 * ladder into a fifth of the curve. It keeps a quarter of the weight because it
 * is what separates the bottom rungs, where the target alone cannot.
 */
export function score(target: number, trapped: number): number {
  const first = TARGETS[0] as number;
  const last = TARGETS[TARGETS.length - 1] as number;
  const targetPart = (target - first) / (last - first);
  return Math.min(1, Math.max(0, 0.75 * targetPart + 0.25 * trapped));
}

/**
 * How hard the verifier looks ahead.
 *
 * Five is comfortably enough to reach a 1024 and costs about a thousand board
 * evaluations a move; the cost section of `tools/twenty48.ts` is what this
 * number was set from rather than guessed at.
 */
const VERIFY_DEPTH = 5;

/** Naive playthroughs behind each trap-rate figure. */
const ROLLOUTS = 10;

export function generateLevel(seed: string, level: number): GeneratedLevel {
  const rng = createRng(hashSeed(seed, GAME_ID, level));
  const { band } = pressureForLevel(level, rng);
  const target = targetForBand(band);

  const verified = playOut(seed, level, SIZE, OPENING_TILES, target, { depth: VERIFY_DEPTH });

  /*
   * A target the strong player could not reach is stepped down rather than
   * rejected.
   *
   * Rejecting would mean re-seeding, and the seed is not ours to change — it is
   * the player's profile, and the level number is what picks the board. Stepping
   * the target down keeps the level playable and keeps it a pure function of
   * `(seed, level)`, at the cost of one level being easier than the curve asked.
   * It has not come up in the sweep; it exists so that it cannot ever be a
   * level that simply cannot be finished.
   */
  let finalTarget = target;
  let par = verified.moves;

  if (!verified.reached) {
    for (let stepped = target - 1; stepped >= (TARGETS[0] as number); stepped--) {
      const retry = playOut(seed, level, SIZE, OPENING_TILES, stepped, { depth: VERIFY_DEPTH });
      if (retry.reached) {
        finalTarget = stepped;
        par = retry.moves;
        break;
      }
    }
  }

  const trapped = trapRate(rng, seed, level, SIZE, OPENING_TILES, finalTarget, ROLLOUTS);

  return {
    level,
    size: SIZE,
    seeds: OPENING_TILES,
    target: finalTarget,
    difficulty: score(finalTarget, trapped),
    trapRate: trapped,
    par,
  };
}
