/**
 * The backgammon board, the dice, and the legality of a single checker move.
 *
 * Pure: no DOM, no I/O, and no `Math.random()`. Everything that needs to search
 * across a whole turn lives in `legal.ts`, and the state machine that strings
 * turns together lives in `model.ts`. Splitting it this way is not tidiness —
 * the turn search calls back into these primitives thousands of times, and a
 * cycle between the two modules would be a real one.
 *
 * **Points are absolute, 0-23, and White walks down them.** Each player numbers
 * the board from their own home, so point 6 means two different places
 * depending on who is speaking. One numbering is kept here and the two players'
 * views are a rendering concern: absolute `i` is White's point `i + 1` and
 * Red's point `24 - i`. White moves towards 0 and bears off past it; Red moves
 * towards 23 and bears off past that. So White's home board is 0-5 and Red's is
 * 18-23, and the starting position is symmetric under `i -> 23 - i`.
 *
 * **The dice are fixed before either player touches them.** Every face is a
 * pure function of (seed, turn, die), exactly as in Five Dice and for the same
 * reasons: a saved game is a short list of moves rather than a board, a bug
 * report is reproducible from its game number, and neither player can be
 * accused of a roll that depended on how the game was going. `dice.test.ts`
 * holds the distribution to it.
 */

import { createRng, hashSeed } from '../shared/rng';

export type Player = 'white' | 'red';

export const POINTS = 24;
export const CHECKERS = 15;
/** Pseudo-point: a checker sitting on the bar, waiting to re-enter. */
export const BAR = 24;
/** Pseudo-destination: a checker borne off. */
export const OFF = -1;
/** What a checker on the bar counts for in a pip count. */
export const BAR_PIPS = 25;

export const OPPONENT: Record<Player, Player> = { white: 'red', red: 'white' };

/** White walks down the numbering; Red walks up it. */
export const direction = (player: Player): number => (player === 'white' ? -1 : 1);

export interface Board {
  /** 24 entries. Positive is that many White checkers, negative that many Red. */
  points: number[];
  bar: Record<Player, number>;
  off: Record<Player, number>;
}

/**
 * The opening position, as absolute points.
 *
 * Read as White's board: two on 24, five on 13, three on 8, five on 6. Red's
 * half is the same position mirrored, which is the check worth remembering —
 * `startingBoard()` is symmetric under `i -> 23 - i` with the sign flipped, and
 * `board.test.ts` asserts exactly that rather than the eight literals.
 */
const OPENING: readonly (readonly [number, number])[] = [
  [0, -2],
  [5, 5],
  [7, 3],
  [11, -5],
  [12, 5],
  [16, -3],
  [18, -5],
  [23, 2],
];

export function startingBoard(): Board {
  const points = new Array<number>(POINTS).fill(0);
  for (const [point, count] of OPENING) points[point] = count;
  return { points, bar: { white: 0, red: 0 }, off: { white: 0, red: 0 } };
}

export function cloneBoard(board: Board): Board {
  return {
    points: [...board.points],
    bar: { ...board.bar },
    off: { ...board.off },
  };
}

/**
 * A key that captures everything legality depends on.
 *
 * Borne-off checkers are deliberately absent: whether a move is legal turns on
 * what is still on the board and on the bar, never on how many have already
 * gone. Leaving them out makes the turn search's memo hit far more often.
 */
export function boardKey(board: Board): string {
  return `${board.points.join(',')}|${board.bar.white},${board.bar.red}`;
}

/* ------------------------------------------------------------------ */
/* Reading the board                                                   */
/* ------------------------------------------------------------------ */

/** How many of `player`'s checkers sit on a point. */
export function countAt(board: Board, point: number, player: Player): number {
  const value = board.points[point] ?? 0;
  return Math.max(0, player === 'white' ? value : -value);
}

/** Who holds a point, or null if it is empty. */
export function ownerAt(board: Board, point: number): Player | null {
  const value = board.points[point] ?? 0;
  if (value === 0) return null;
  return value > 0 ? 'white' : 'red';
}

/** A point held by exactly one enemy checker: takeable, and it goes to the bar. */
export function isBlot(board: Board, point: number, player: Player): boolean {
  return countAt(board, point, OPPONENT[player]) === 1;
}

/** Two or more enemy checkers. Nothing may land there. */
export function isBlocked(board: Board, point: number, player: Player): boolean {
  return countAt(board, point, OPPONENT[player]) >= 2;
}

/** How far a checker on this point still has to travel to come off. */
export function distanceToOff(player: Player, point: number): number {
  return player === 'white' ? point + 1 : POINTS - point;
}

/** The six points a player bears off from. */
export function isHomePoint(player: Player, point: number): boolean {
  return distanceToOff(player, point) <= 6;
}

/** Where a checker entering from the bar lands. Die 1 is deepest in enemy home. */
export function entryPoint(player: Player, die: number): number {
  return player === 'white' ? POINTS - die : die - 1;
}

/** Where a move ends up, or OFF when it runs past the edge of the board. */
export function destination(player: Player, from: number, die: number): number {
  if (from === BAR) return entryPoint(player, die);
  const to = from + direction(player) * die;
  return to < 0 || to >= POINTS ? OFF : to;
}

/** Every checker home and none on the bar: the condition for bearing off. */
export function allHome(board: Board, player: Player): boolean {
  if (board.bar[player] > 0) return false;
  for (let point = 0; point < POINTS; point++) {
    if (countAt(board, point, player) > 0 && !isHomePoint(player, point)) return false;
  }
  return true;
}

/** The furthest checker from home, as a distance. 0 when there are none left. */
export function highestPoint(board: Board, player: Player): number {
  let best = 0;
  for (let point = 0; point < POINTS; point++) {
    if (countAt(board, point, player) > 0) {
      best = Math.max(best, distanceToOff(player, point));
    }
  }
  return best;
}

/** Pips left to travel. The standard measure of who is ahead. */
export function pipCount(board: Board, player: Player): number {
  let pips = board.bar[player] * BAR_PIPS;
  for (let point = 0; point < POINTS; point++) {
    pips += countAt(board, point, player) * distanceToOff(player, point);
  }
  return pips;
}

/* ------------------------------------------------------------------ */
/* One checker, one die                                                */
/* ------------------------------------------------------------------ */

/**
 * Whether this one checker may be moved by this one die.
 *
 * Deliberately says nothing about the other die. "Both dice must be played if
 * they can be" is a property of the whole turn and is enforced in `legal.ts`;
 * mixing the two here would make this function impossible to reason about and
 * impossible to reuse from the search that needs it.
 */
export function canMove(board: Board, player: Player, from: number, die: number): boolean {
  if (die < 1 || die > 6) return false;

  // A checker on the bar is the only one you may touch until the bar is clear.
  if (board.bar[player] > 0 && from !== BAR) return false;
  if (from === BAR) {
    if (board.bar[player] === 0) return false;
  } else if (from < 0 || from >= POINTS || countAt(board, from, player) === 0) {
    return false;
  }

  const to = destination(player, from, die);
  if (to !== OFF) return !isBlocked(board, to, player);

  // Bearing off. An exact die always works; a die larger than the checker needs
  // only works when nothing is further from home than it is.
  if (!allHome(board, player)) return false;
  const distance = distanceToOff(player, from);
  return die === distance || (die > distance && highestPoint(board, player) === distance);
}

export interface Applied {
  board: Board;
  /** Where the checker ended up, or OFF. */
  to: number;
  /** An enemy blot was sent to the bar. */
  hit: boolean;
}

/**
 * Plays one checker. The caller checks `canMove` first — this trusts it.
 *
 * Returns a new board rather than mutating, because the turn search walks
 * thousands of hypothetical positions and a shared board would have to be
 * unwound after every one of them.
 */
export function applyCheckerMove(
  board: Board,
  player: Player,
  from: number,
  die: number,
): Applied {
  const next = cloneBoard(board);
  const sign = player === 'white' ? 1 : -1;

  if (from === BAR) next.bar[player] -= 1;
  else next.points[from] = (next.points[from] ?? 0) - sign;

  const to = destination(player, from, die);
  if (to === OFF) {
    next.off[player] += 1;
    return { board: next, to, hit: false };
  }

  const hit = isBlot(board, to, player);
  // A hit clears the point outright rather than adding to it: the lone enemy
  // checker is what was there, and it is on its way to the bar.
  next.points[to] = hit ? sign : (next.points[to] ?? 0) + sign;
  if (hit) next.bar[OPPONENT[player]] += 1;

  return { board: next, to, hit };
}

/* ------------------------------------------------------------------ */
/* Winning                                                             */
/* ------------------------------------------------------------------ */

export function winnerOf(board: Board): Player | null {
  if (board.off.white >= CHECKERS) return 'white';
  if (board.off.red >= CHECKERS) return 'red';
  return null;
}

export type WinKind = 'single' | 'gammon' | 'backgammon';

/**
 * How big the win was.
 *
 * Nothing is scored on it — the doubling cube and the 2x/3x multipliers are cut
 * from v1 — but a gammon is the thing the two people at the table will notice,
 * so the result sheet names it. It costs one word and no rules.
 */
export function winKind(board: Board, winner: Player): WinKind {
  const loser = OPPONENT[winner];
  if (board.off[loser] > 0) return 'single';

  if (board.bar[loser] > 0) return 'backgammon';
  for (let point = 0; point < POINTS; point++) {
    if (countAt(board, point, loser) > 0 && isHomePoint(winner, point)) return 'backgammon';
  }
  return 'gammon';
}

/* ------------------------------------------------------------------ */
/* The dice                                                            */
/* ------------------------------------------------------------------ */

/**
 * The face a die shows on a given turn.
 *
 * Independent of everything either player has done, which is what stops the
 * undo button from being a way to shop for a roll — see the header of
 * `game.ts`.
 */
export function dieFace(seed: string, turn: number, die: number): number {
  return createRng(hashSeed(seed, 'backgammon', turn, die)).int(6) + 1;
}

function openingDie(seed: string, attempt: number, index: number): number {
  return createRng(hashSeed(seed, 'backgammon-open', attempt, index)).int(6) + 1;
}

export interface Opening {
  /** White's die first, then Red's. This pair is also the first turn's roll. */
  dice: [number, number];
  first: Player;
  /** Ties re-rolled before this one. Kept so the test can prove they happen. */
  ties: number;
}

/**
 * The roll that decides who starts.
 *
 * Each player throws one die, the higher starts — and plays that pair as their
 * first roll, which is the real rule and the reason turn 0's dice are not drawn
 * from `dieFace`. A tie is thrown again, so an opening roll is never doubles
 * and a game never opens with four moves.
 */
export function openingRoll(seed: string): Opening {
  for (let attempt = 0; attempt < 64; attempt++) {
    const white = openingDie(seed, attempt, 0);
    const red = openingDie(seed, attempt, 1);
    if (white !== red) {
      return { dice: [white, red], first: white > red ? 'white' : 'red', ties: attempt };
    }
  }
  // Unreachable in practice: 64 ties in a row is a 1-in-6^64 event. Bailing out
  // with a fixed pair is still better than looping forever on a hash that has
  // somehow gone constant.
  return { dice: [2, 1], first: 'white', ties: 64 };
}

/** The pair showing on a turn. Turn 0 is the opening roll; see above. */
export function turnRoll(seed: string, turn: number): [number, number] {
  if (turn === 0) return openingRoll(seed).dice;
  return [dieFace(seed, turn, 0), dieFace(seed, turn, 1)];
}

/** What a roll is worth in moves: two, or four when the dice match. */
export function pipsFor(dice: readonly [number, number]): number[] {
  const [a, b] = dice;
  return a === b ? [a, a, a, a] : [a, b];
}
