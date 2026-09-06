/**
 * Which moves a player is actually allowed to make right now.
 *
 * This is where the rule that catches everybody lives: **you must play both
 * dice if there is any way to play both**, and if only one can be played it has
 * to be the higher one. It cannot be decided a move at a time. A checker move
 * that is legal on its own can be illegal because making it leaves the other
 * die unplayable when some other move would not have, so the only honest answer
 * comes from looking at whole sequences.
 *
 * That makes this the file that stands where the other games keep `solve.ts`,
 * and it makes the same promise: **the search is complete, not budgeted.** A
 * turn is at most four dice deep and the branching factor is the number of
 * points the player actually occupies — a handful — so the whole space is
 * walked every time and "no legal move" means there is genuinely none, never
 * that a budget ran out. That is what lets the game refuse an illegal tap
 * without ever refusing a legal one, and it is why the board can pass a turn
 * for a player automatically without lying to them.
 */

import {
  type Board,
  type Player,
  BAR,
  OFF,
  POINTS,
  applyCheckerMove,
  boardKey,
  canMove,
  countAt,
  destination,
} from './board';

export interface Play {
  /** A point, or BAR. */
  from: number;
  die: number;
  /** A point, or OFF. */
  to: number;
}

/** Every point the player could move a checker off, bar included. */
function sources(board: Board, player: Player): number[] {
  if (board.bar[player] > 0) return [BAR];
  const list: number[] = [];
  for (let point = 0; point < POINTS; point++) {
    if (countAt(board, point, player) > 0) list.push(point);
  }
  return list;
}

/** Every single move available, ignoring what it does to the rest of the turn. */
function candidates(board: Board, player: Player, dice: readonly number[]): Play[] {
  const seen = new Set<number>();
  const plays: Play[] = [];

  for (const die of dice) {
    if (seen.has(die)) continue; // doubles: four dice, one distinct value
    seen.add(die);
    for (const from of sources(board, player)) {
      if (canMove(board, player, from, die)) {
        plays.push({ from, die, to: destination(player, from, die) });
      }
    }
  }

  return plays;
}

/** Removes one instance of a value. Doubles mean the array is a multiset. */
function without(dice: readonly number[], die: number): number[] {
  const rest = [...dice];
  rest.splice(rest.indexOf(die), 1);
  return rest;
}

/**
 * The most dice any sequence of moves can use.
 *
 * Exhaustive within a turn. The memo is keyed on the position and the dice
 * still in hand, which collapses the transpositions that make doubles look
 * expensive — the same four checkers moved in a different order reach the same
 * board — and keeps a four-die search in the low thousands of nodes.
 */
export function maxPlays(board: Board, player: Player, dice: readonly number[]): number {
  return search(board, player, dice, new Map<string, number>());
}

function search(
  board: Board,
  player: Player,
  dice: readonly number[],
  memo: Map<string, number>,
): number {
  if (dice.length === 0) return 0;

  const key = `${boardKey(board)}#${[...dice].sort().join('')}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  let best = 0;
  for (const play of candidates(board, player, dice)) {
    const after = applyCheckerMove(board, player, play.from, play.die).board;
    best = Math.max(best, 1 + search(after, player, without(dice, play.die), memo));
    if (best === dice.length) break; // nothing can beat using every die
  }

  memo.set(key, best);
  return best;
}

/**
 * The moves that may be made now.
 *
 * Every play returned lies on some sequence that uses the maximum number of
 * dice, so a player who only ever taps what this offers cannot underplay a
 * roll — and cannot be told afterwards that their turn was illegal. Called
 * again after each checker is moved, with whatever dice are left, which is what
 * keeps the guarantee true for the rest of the turn as well.
 */
export function legalPlays(board: Board, player: Player, dice: readonly number[]): Play[] {
  const best = maxPlays(board, player, dice);
  if (best === 0) return [];

  const memo = new Map<string, number>();
  let plays = candidates(board, player, dice).filter((play) => {
    const after = applyCheckerMove(board, player, play.from, play.die).board;
    return 1 + search(after, player, without(dice, play.die), memo) === best;
  });

  /*
   * "If only one die can be played, play the higher one."
   *
   * Only ever bites at the start of a turn with two different dice: any later
   * step has a single die left and no choice to make. Note that it is not a
   * tie-break between equally good moves — both dice are individually playable
   * here, and the rule throws the lower one away.
   */
  if (best === 1 && dice.length === 2 && dice[0] !== dice[1]) {
    const higher = Math.max(dice[0] as number, dice[1] as number);
    if (plays.some((play) => play.die === higher)) {
      plays = plays.filter((play) => play.die === higher);
    }
  }

  return plays;
}

/** The distinct destinations reachable from one point, for the highlight. */
export function targetsFrom(plays: readonly Play[], from: number): number[] {
  const seen = new Set<number>();
  for (const play of plays) {
    if (play.from === from) seen.add(play.to);
  }
  return [...seen];
}

/** The distinct points that can be moved from, for the "these can move" mark. */
export function movableSources(plays: readonly Play[]): number[] {
  return [...new Set(plays.map((play) => play.from))];
}

/**
 * The die to use for a tapped destination.
 *
 * Two different dice always land on two different points, so a destination
 * names its die unambiguously — except when the dice match, where either is the
 * same move. Returns null when the tap was not on a legal target.
 */
export function dieForTarget(plays: readonly Play[], from: number, to: number): number | null {
  const match = plays.find((play) => play.from === from && play.to === to);
  return match ? match.die : null;
}

/** Whether bearing off is among the moves available from a point. */
export function canBearOffFrom(plays: readonly Play[], from: number): boolean {
  return plays.some((play) => play.from === from && play.to === OFF);
}
