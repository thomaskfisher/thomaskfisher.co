/**
 * Color Sort search.
 *
 * Two modes, because they answer different questions:
 *
 *  - `first`  — depth-first graph search for *a* solution. Fast, and complete:
 *               if it exhausts the reachable state space within budget without
 *               reaching a solved position, the board is genuinely unsolvable.
 *               This is what guarantees no level is ever a dead end, and what
 *               powers the hint button.
 *
 *  - `optimal` — IDA*, returning the true minimum pour count. Used only where
 *               the exact number matters; it can be expensive on wide boards,
 *               so it always runs under a node budget.
 *
 * `nodes` is reported for both, and is the more useful difficulty signal than
 * solution length: a board a greedy walk strolls through is easy, one that
 * needs heavy backtracking is hard, even at the same solution length.
 */

import {
  type Board,
  type Move,
  type Tube,
  applyMove,
  canonicalKey,
  cloneBoard,
  heuristic,
  isMonochrome,
  isSolved,
  legalMoves,
  pourAmount,
  topRunLength,
  undoMove,
} from './model';

export type SearchStatus = 'solved' | 'unsolvable' | 'budget';

export interface SearchResult {
  status: SearchStatus;
  /** Populated only when status is 'solved'. */
  moves: Move[];
  /** Nodes expanded. The backtracking signal used for difficulty scoring. */
  nodes: number;
}

export interface SearchOptions {
  mode?: 'first' | 'optimal';
  nodeBudget?: number;
  maxDepth?: number;
}

const DEFAULT_BUDGET = 150_000;
const DEFAULT_MAX_DEPTH = 400;

/**
 * Greedy ordering. Finishing a tube or emptying one is nearly always right;
 * spending an empty tube is nearly always a last resort. Good ordering is what
 * keeps `first` mode cheap enough to run inside the generator's reroll loop.
 */
function orderMoves(board: Board, moves: Move[]): Move[] {
  const scored = moves.map((move) => {
    const source = board.tubes[move.from] as Tube;
    const dest = board.tubes[move.to] as Tube;
    const amount = pourAmount(board, move.from, move.to);

    let score = amount;
    const destWillBeComplete =
      dest.length + amount === board.height && (dest.length === 0 || isMonochrome(dest));
    if (destWillBeComplete) score += 100;
    if (amount === source.length) score += 50; // source empties
    if (dest.length === 0) score -= 30; // burning an empty tube
    if (topRunLength(source) > amount) score -= 15; // splitting a run

    return { move, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.move);
}

/** Depth-first graph search for any solution. Complete within budget. */
function searchFirst(start: Board, budget: number, maxDepth: number): SearchResult {
  const board = cloneBoard(start);
  const visited = new Set<string>();
  const path: Move[] = [];
  let nodes = 0;
  let overBudget = false;

  const walk = (depth: number): boolean => {
    if (isSolved(board)) return true;
    if (depth >= maxDepth) return false;
    if (nodes >= budget) {
      overBudget = true;
      return false;
    }
    nodes++;

    for (const move of orderMoves(board, legalMoves(board))) {
      const amount = applyMove(board, move);
      if (amount === 0) continue;

      const key = canonicalKey(board);
      if (!visited.has(key)) {
        visited.add(key);
        path.push(move);
        if (walk(depth + 1)) return true;
        path.pop();
      }

      undoMove(board, move, amount);
      if (overBudget) return false;
    }

    return false;
  };

  visited.add(canonicalKey(board));
  const solved = walk(0);

  if (solved) return { status: 'solved', moves: path.slice(), nodes };
  return { status: overBudget ? 'budget' : 'unsolvable', moves: [], nodes };
}

/** IDA* for the true minimum pour count. */
function searchOptimal(start: Board, budget: number, maxDepth: number): SearchResult {
  const board = cloneBoard(start);
  let nodes = 0;
  let overBudget = false;
  let best: Move[] | null = null;

  let threshold = heuristic(board);

  while (threshold <= maxDepth && !overBudget && !best) {
    // Smallest f value that exceeded the threshold — the next threshold.
    let nextThreshold = Number.POSITIVE_INFINITY;
    const seenAtDepth = new Map<string, number>();
    const path: Move[] = [];

    const walk = (g: number): boolean => {
      const f = g + heuristic(board);
      if (f > threshold) {
        if (f < nextThreshold) nextThreshold = f;
        return false;
      }
      if (isSolved(board)) return true;
      if (nodes >= budget) {
        overBudget = true;
        return false;
      }
      nodes++;

      const key = canonicalKey(board);
      const seen = seenAtDepth.get(key);
      if (seen !== undefined && seen <= g) return false;
      seenAtDepth.set(key, g);

      for (const move of orderMoves(board, legalMoves(board))) {
        const amount = applyMove(board, move);
        if (amount === 0) continue;
        path.push(move);

        if (walk(g + 1)) return true;

        path.pop();
        undoMove(board, move, amount);
        if (overBudget) return false;
      }

      return false;
    };

    if (walk(0)) {
      best = path.slice();
      break;
    }
    if (overBudget) break;
    if (!Number.isFinite(nextThreshold)) {
      return { status: 'unsolvable', moves: [], nodes };
    }
    threshold = nextThreshold;
  }

  if (best) return { status: 'solved', moves: best, nodes };
  return { status: overBudget ? 'budget' : 'unsolvable', moves: [], nodes };
}

export function search(board: Board, options: SearchOptions = {}): SearchResult {
  const {
    mode = 'first',
    nodeBudget = DEFAULT_BUDGET,
    maxDepth = DEFAULT_MAX_DEPTH,
  } = options;

  if (isSolved(board)) return { status: 'solved', moves: [], nodes: 0 };

  return mode === 'optimal'
    ? searchOptimal(board, nodeBudget, maxDepth)
    : searchFirst(board, nodeBudget, maxDepth);
}

/**
 * A complete winning line from the current position, or null when the player
 * has painted themselves into a corner (undo is the way out).
 *
 * Callers should follow the returned plan rather than asking for one move at a
 * time. Two searches from adjacent positions can legitimately return different
 * solutions, and the second one's first move may simply undo the first one's —
 * so re-searching after every move can bounce between two states forever.
 */
export function findSolution(board: Board): Move[] | null {
  const result = search(board, { mode: 'first', nodeBudget: 60_000 });
  return result.status === 'solved' && result.moves.length > 0 ? result.moves : null;
}
