/**
 * The game as a state machine: turns, rolls, and the move list a save is made
 * of.
 *
 * Pure, like `board.ts` and `legal.ts` under it. A whole game is a seed and a
 * list of small integers, which is what keeps a save under a kilobyte, makes
 * undo a truncation rather than a stack of snapshots, and makes any position
 * reproducible from the game number in a bug report.
 *
 * **Three kinds of move, so the list captures the whole turn.** A roll is
 * recorded even though the faces are already determined by the turn number,
 * because "has this player picked the phone up yet" is real state and the house
 * rule is that closing the app mid-game costs nothing. And a turn ends on an
 * explicit move rather than automatically when the dice run out, because that
 * tap is the handover — it is what lets the player take a checker back right up
 * to the moment they pass the board across, and no further.
 */

import {
  type Board,
  type Player,
  BAR,
  OPPONENT,
  POINTS,
  applyCheckerMove,
  pipsFor,
  openingRoll,
  startingBoard,
  turnRoll,
  winnerOf,
} from './board';
import { type Play, legalPlays } from './legal';

export interface GameState {
  seed: string;
  board: Board;
  /** 0-based. The dice are a pure function of (seed, turn). */
  turn: number;
  player: Player;
  /** Who won the opening roll. Players alternate strictly from there. */
  first: Player;
  /** The pair for this turn. Not shown to anyone until `rolled`. */
  dice: [number, number];
  rolled: boolean;
  /** Every pip this turn is worth: two, or four on doubles. */
  pips: number[];
  /** Pips not yet spent. */
  remaining: number[];
  /** Checker moves made this turn, oldest first. What undo takes back. */
  played: PlayedMove[];
  winner: Player | null;
}

export interface PlayedMove extends Play {
  hit: boolean;
}

/* ------------------------------------------------------------------ */
/* Moves                                                               */
/* ------------------------------------------------------------------ */

/**
 * A move is one small integer, so a saved game is a few hundred digits.
 *
 *   0        end the turn (or pass it, when there was nothing to play)
 *   1        roll
 *   2-152    move a checker: 2 + from * 6 + (die - 1), with from 0-23 or BAR
 */
export type Move = number;

export const END_TURN: Move = 0;
export const ROLL: Move = 1;
const CHECKER_BASE = 2;

export const checkerMove = (from: number, die: number): Move =>
  CHECKER_BASE + from * 6 + (die - 1);
export const isCheckerMove = (move: Move): boolean => move >= CHECKER_BASE;
export const moveFrom = (move: Move): number => Math.floor((move - CHECKER_BASE) / 6);
export const moveDie = (move: Move): number => ((move - CHECKER_BASE) % 6) + 1;

/* ------------------------------------------------------------------ */
/* The state machine                                                   */
/* ------------------------------------------------------------------ */

export function startGame(seed: string): GameState {
  const opening = openingRoll(seed);
  return {
    seed,
    board: startingBoard(),
    turn: 0,
    player: opening.first,
    first: opening.first,
    dice: opening.dice,
    rolled: false,
    pips: [],
    remaining: [],
    played: [],
    winner: null,
  };
}

/** The moves available right now. Empty before the roll and after a win. */
export function legalNow(state: GameState): Play[] {
  if (state.winner || !state.rolled) return [];
  return legalPlays(state.board, state.player, state.remaining);
}

export function isLegalMove(state: GameState, move: Move): boolean {
  if (state.winner) return false;

  if (move === ROLL) return !state.rolled;
  if (move === END_TURN) return state.rolled && legalNow(state).length === 0;

  if (!state.rolled) return false;
  const from = moveFrom(move);
  const die = moveDie(move);
  if (from < 0 || from > BAR) return false;
  return legalNow(state).some((play) => play.from === from && play.die === die);
}

/** Throws on an illegal move. Callers replaying a save check first. */
export function applyMove(state: GameState, move: Move): GameState {
  if (!isLegalMove(state, move)) throw new Error(`illegal move ${move}`);

  if (move === ROLL) {
    const pips = pipsFor(state.dice);
    return { ...state, rolled: true, pips, remaining: [...pips], played: [] };
  }

  if (move === END_TURN) return startTurn(state, state.turn + 1);

  const from = moveFrom(move);
  const die = moveDie(move);
  const applied = applyCheckerMove(state.board, state.player, from, die);

  const remaining = [...state.remaining];
  remaining.splice(remaining.indexOf(die), 1);

  return {
    ...state,
    board: applied.board,
    remaining,
    played: [...state.played, { from, die, to: applied.to, hit: applied.hit }],
    winner: winnerOf(applied.board),
  };
}

/** Hands the board to the other player, with their roll waiting to be revealed. */
function startTurn(state: GameState, turn: number): GameState {
  return {
    ...state,
    turn,
    player: turn % 2 === 0 ? state.first : OPPONENT[state.first],
    dice: turnRoll(state.seed, turn),
    rolled: false,
    pips: [],
    remaining: [],
    played: [],
  };
}

/**
 * Rebuilds a game from its move list.
 *
 * A move that no longer applies ends the replay rather than throwing: a corrupt
 * tail should cost the tail, not the game. `applied` says how many were used so
 * the caller can trim its own copy to match.
 */
export function replay(
  seed: string,
  moves: readonly Move[],
): { state: GameState; applied: number } {
  let state = startGame(seed);
  let applied = 0;

  for (const move of moves) {
    if (!isLegalMove(state, move)) break;
    state = applyMove(state, move);
    applied++;
  }

  return { state, applied };
}

/* ------------------------------------------------------------------ */
/* Reading a turn                                                      */
/* ------------------------------------------------------------------ */

/**
 * Which of the turn's dice have been spent, in the order they are drawn.
 *
 * The renderer shows one die per pip and dims the used ones, so the count of
 * moves left is on the board rather than in a sentence. Doubles therefore show
 * as four dice, which is also the clearest possible statement of what a double
 * is worth to someone who has forgotten.
 */
export function spentPips(state: GameState): boolean[] {
  const left = [...state.remaining];
  return state.pips.map((pip) => {
    const index = left.indexOf(pip);
    if (index === -1) return true;
    left.splice(index, 1);
    return false;
  });
}

/** How many checkers a player still has to bring home, for the status line. */
export function checkersLeft(state: GameState, player: Player): number {
  let count = state.board.bar[player];
  for (let point = 0; point < POINTS; point++) {
    const value = state.board.points[point] ?? 0;
    count += Math.max(0, player === 'white' ? value : -value);
  }
  return count;
}
