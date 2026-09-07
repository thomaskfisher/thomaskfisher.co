/**
 * Does this deal go out, and what is the line?
 *
 * Depth-first with a transposition table, driven by the move ordering
 * `legalMoves` already puts them in: turn a card over, then play the waste,
 * then the stock, and only then start shuffling face-up cards about. That
 * ordering is most of the search — Klondike branches wide but almost every
 * branch that matters begins with exposing something new.
 *
 * **The table is what makes cycling the stock terminate.** Turning the pile
 * over preserves its order, so a full pass through the stock arrives back at a
 * position byte-for-byte identical to the one it left. Without the table the
 * search would spin there forever; with it, a cycle costs one node per card
 * and then stops.
 *
 * Three answers, and the difference between the last two is the whole reason
 * the generator can promise what it promises:
 *
 *   solved      — here is a line, and `generate.ts` replays it to check.
 *   unsolvable  — the space was walked out. There is no line.
 *   unknown     — the budget ran out first. Says nothing either way.
 *
 * A deal is only ever shipped on `solved`, so `unknown` costs a discarded
 * candidate and never a dead end in front of a player.
 */

import { type Klondike, type Move, applyMove, cloneState, isWon, legalMoves, stateKey } from './model';

export type SolveResult =
  | { status: 'solved'; moves: Move[] }
  | { status: 'unsolvable' }
  | { status: 'unknown' };

export interface SolveOptions {
  /** Positions expanded before giving up. */
  budget?: number;
  /**
   * Longest line considered.
   *
   * Measured, not guessed: the calibration run turns up winning lines of close
   * to five hundred moves, because every turn of the stock is a move and a hard
   * deal goes round it many times. A cap near that number quietly rejects the
   * hardest deals in the collection, which are the ones the deep levels are
   * made of. This one is loose enough to be about pathological branches only.
   */
  maxDepth?: number;
}

export const DEFAULT_BUDGET = 260_000;

export function solve(start: Klondike, options: SolveOptions = {}): SolveResult {
  const budget = options.budget ?? DEFAULT_BUDGET;
  const maxDepth = options.maxDepth ?? 1200;

  const seen = new Set<string>();
  const line: Move[] = [];
  let nodes = 0;
  let exhausted = false;

  const walk = (state: Klondike): boolean => {
    if (isWon(state)) return true;
    if (line.length >= maxDepth) return false;

    if (nodes++ >= budget) {
      exhausted = true;
      return false;
    }

    for (const move of legalMoves(state)) {
      const next = cloneState(state);
      if (!applyMove(next, move)) continue;

      const key = stateKey(next);
      if (seen.has(key)) continue;
      seen.add(key);

      line.push(move);
      if (walk(next)) return true;
      line.pop();

      if (exhausted) return false;
    }

    return false;
  };

  const root = cloneState(start);
  seen.add(stateKey(root));

  if (walk(root)) return { status: 'solved', moves: line.slice() };
  return exhausted ? { status: 'unknown' } : { status: 'unsolvable' };
}

/**
 * The next move on a winning line, for the hint button.
 *
 * Callers keep the whole line and follow it. Re-solving after every tap can
 * return a different winning order whose opening move undoes the last one,
 * which is how a hint button ends up ping-ponging between two cards forever.
 */
export function findSolution(state: Klondike, options: SolveOptions = {}): Move[] | null {
  const result = solve(state, options);
  return result.status === 'solved' ? result.moves : null;
}
