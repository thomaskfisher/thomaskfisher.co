/**
 * Two players, for two different jobs — the same split as every puzzle here.
 *
 * **`bestMove` is the strong one, and it is both the verifier and the hint.**
 * Because spawns are a pure function of the move number, this game is fully
 * deterministic: there is no expectation to take, and a lookahead search is
 * plain minimax with one player. A level is accepted only if this player
 * actually reaches the target from the opening position, so "solvable" here is
 * a witness rather than a hope — it is the same promise the other games make,
 * arrived at differently.
 *
 * **`naivePlayer` is the weak one, and it is the difficulty signal.** Trap rate
 * — the share of naive playthroughs that get stuck before reaching the target —
 * is the measure this collection has found works, and it is the right one here
 * for the reason it is right everywhere else: it models the person on the sofa
 * rather than the search. See `tools/twenty48.ts`.
 *
 * The hint has no ping-pong to guard against. `bestMove` is a pure function of
 * the position, so two answers to the same question are the same answer, and
 * every hint the player takes moves the game forward rather than back.
 */

import { type Rng } from '../shared/rng';
import {
  DIRECTIONS,
  type Dir,
  type Grid,
  type Position,
  emptyCells,
  hasReached,
  highestTile,
  isStuck,
  legalMoves,
  openingPosition,
  slide,
  step,
} from './model';

/* ------------------------------------------------------------------ */
/* Judging a board                                                     */
/* ------------------------------------------------------------------ */

/**
 * How promising a board looks.
 *
 * The four terms are the ones every decent 2048 heuristic converges on, and
 * they are weighted in the order they matter:
 *
 *  - **Room.** Empty cells are the resource the game is really about; running
 *    out of them is the only way to lose.
 *  - **Order.** A row or column that climbs steadily can be merged down; one
 *    that zigzags cannot, and it is what strands a big tile in the middle.
 *  - **A corner.** Keeping the biggest tile pinned in one corner is the whole
 *    of basic strategy, because a big tile adrift blocks everything around it.
 *  - **Smoothness.** Neighbours of similar size can eventually merge; a 2 next
 *    to a 512 is a cell that will not clear for a long time.
 */
export function evaluate(grid: Grid, size: number): number {
  const open = emptyCells(grid).length;

  let order = 0;
  let smooth = 0;

  for (let line = 0; line < size; line++) {
    /*
     * Monotonicity, as the *cheaper* of running the line up or down.
     *
     * A row that climbs left to right is exactly as useful as one that climbs
     * right to left — what costs is the turn in the middle — so the penalty is
     * the smaller of the two totals rather than either one of them.
     */
    let rowUp = 0;
    let rowDown = 0;
    let colUp = 0;
    let colDown = 0;

    for (let index = 0; index + 1 < size; index++) {
      const a = grid[line * size + index] as number;
      const b = grid[line * size + index + 1] as number;
      if (a > b) rowDown += a - b;
      else rowUp += b - a;
      smooth -= Math.abs(a - b);

      const c = grid[index * size + line] as number;
      const d = grid[(index + 1) * size + line] as number;
      if (c > d) colDown += c - d;
      else colUp += d - c;
      smooth -= Math.abs(c - d);
    }

    order -= Math.min(rowUp, rowDown) + Math.min(colUp, colDown);
  }

  const highest = highestTile(grid);
  const corners = [0, size - 1, size * (size - 1), size * size - 1];
  const inCorner = corners.some((cell) => grid[cell] === highest);

  return open * 12 + order * 2.2 + smooth * 0.7 + (inCorner ? highest * 6 : 0);
}

/* ------------------------------------------------------------------ */
/* The strong player                                                   */
/* ------------------------------------------------------------------ */

/**
 * The best direction from here, by a depth-limited search.
 *
 * Deterministic spawns are what make this cheap: there is no chance node to
 * average over, so a depth of five is a few hundred boards rather than a few
 * hundred thousand.
 */
export function bestMove(
  position: Position,
  size: number,
  seed: string,
  level: number,
  depth = 5,
): Dir | null {
  let best: Dir | null = null;
  let bestScore = -Infinity;

  for (const direction of DIRECTIONS) {
    const next = step(position, size, direction, seed, level);
    if (!next) continue;

    const value = search(next, size, seed, level, depth - 1);
    if (value > bestScore) {
      bestScore = value;
      best = direction;
    }
  }

  return best;
}

function search(position: Position, size: number, seed: string, level: number, depth: number): number {
  if (depth <= 0) return evaluate(position.grid, size);
  if (isStuck(position.grid, size)) return -1e9;

  let best = -Infinity;
  for (const direction of DIRECTIONS) {
    const next = step(position, size, direction, seed, level);
    if (!next) continue;
    best = Math.max(best, search(next, size, seed, level, depth - 1));
  }

  return best === -Infinity ? evaluate(position.grid, size) : best;
}

export interface PlayResult {
  reached: boolean;
  /** Moves taken. */
  moves: number;
  position: Position;
}

/**
 * Plays a level from the opening with the strong player.
 *
 * This is the verifier: a level is only shipped if this returns `reached`, so
 * every board handed to the player has a line through it that was actually
 * walked rather than assumed.
 */
export function playOut(
  seed: string,
  level: number,
  size: number,
  seeds: number,
  target: number,
  options: { depth?: number; maxMoves?: number } = {},
): PlayResult {
  const { depth = 5, maxMoves = 2200 } = options;
  let position = openingPosition(seed, level, size, seeds);

  for (let move = 0; move < maxMoves; move++) {
    if (hasReached(position.grid, target)) {
      return { reached: true, moves: move, position };
    }
    const direction = bestMove(position, size, seed, level, depth);
    if (direction === null) break;
    const next = step(position, size, direction, seed, level);
    if (!next) break;
    position = next;
  }

  return { reached: hasReached(position.grid, target), moves: position.moveIndex, position };
}

/* ------------------------------------------------------------------ */
/* The weak player — the difficulty signal                             */
/* ------------------------------------------------------------------ */

/**
 * The order a casual player reaches for when nothing is obviously merging.
 *
 * Down-then-left is the habit almost everybody falls into within a few games:
 * it piles the board into one corner without any deliberate plan behind it.
 */
const HABIT: readonly Dir[] = [3 /* Left */, 2 /* Down */, 1 /* Right */, 0 /* Up */];

/** How often the naive player ignores its own habit and just picks something. */
const SLIP = 0.15;

/**
 * One naive playthrough: take the biggest merge, fall back on the habit, and
 * slip a quarter of the time.
 *
 * **The first version of this had no habit and it made the measurement
 * useless.** A player picking at random between non-merging moves fails to
 * reach 512 essentially always — trap rate came back 0.97, 1.00, 1.00 for 512,
 * 1024 and 2048, so the whole top half of the game measured as one difficulty
 * and the curve had a step in it. The fix is not a *better* player, it is a more
 * *honest* one: somebody who has played 2048 twice knows to push into a corner,
 * and modelling someone who does not is modelling nobody.
 *
 * It is still deliberately not good. It has no lookahead, no notion of keeping
 * the corner tile locked, and it slips often enough to get itself into trouble.
 */
export function naivePlayer(
  rng: Rng,
  seed: string,
  level: number,
  size: number,
  seeds: number,
  target: number,
  maxMoves = 2200,
): boolean {
  let position = openingPosition(seed, level, size, seeds);

  for (let move = 0; move < maxMoves; move++) {
    if (hasReached(position.grid, target)) return true;

    const options = legalMoves(position.grid, size);
    if (options.length === 0) return false;

    let choice = options[rng.int(options.length)] as Dir;

    if (!rng.chance(SLIP)) {
      /*
       * The habit, in order: the first of left-then-down that merges anything,
       * and failing that the first that is legal at all.
       *
       * **Ranking by merge size and using the habit only to break ties was the
       * first attempt, and it did nothing** — in 2048 almost every direction
       * merges something, so the ties it was meant to break barely occur and
       * the player went on picking whatever happened to merge most. Up is the
       * move that wrecks a corner, and what actually matters is that it comes
       * last, not that it loses a tie.
       */
      let picked: Dir | null = null;

      for (const direction of HABIT) {
        if (!options.includes(direction)) continue;
        if (slide(position.grid, size, direction).merges.length > 0) {
          picked = direction;
          break;
        }
      }

      if (picked === null) {
        for (const direction of HABIT) {
          if (options.includes(direction)) {
            picked = direction;
            break;
          }
        }
      }

      if (picked !== null) choice = picked;
    }

    const next = step(position, size, choice, seed, level);
    if (!next) return false;
    position = next;
  }

  return hasReached(position.grid, target);
}

/**
 * The share of naive playthroughs that fail to reach the target.
 *
 * The spawn sequence is fixed by the seed, so what varies between rollouts is
 * only the naive player's own choices — which is the right thing to vary. Two
 * players handed the same tiles is exactly the comparison being made.
 */
export function trapRate(
  rng: Rng,
  seed: string,
  level: number,
  size: number,
  seeds: number,
  target: number,
  rollouts = 12,
): number {
  let failures = 0;
  for (let rollout = 0; rollout < rollouts; rollout++) {
    if (!naivePlayer(rng, seed, level, size, seeds, target)) failures++;
  }
  return failures / rollouts;
}
