/**
 * Gridlock's solver.
 *
 * This one is *exhaustive*, not bounded-and-hopeful, and the reason is a
 * property of the rules rather than a clever algorithm. Every slide is
 * reversible — the cells a vehicle vacates stay empty, so sliding it back is
 * always legal — which makes the state space an undirected graph with no dead
 * ends and no one-way doors. A breadth-first sweep from any position therefore
 * reaches its entire connected component, and once the component is in hand
 * every question about the board has an exact answer:
 *
 *  - is it solvable?           does the component contain a position with the
 *                              target at the exit
 *  - how hard is it?           the true distance from here to the nearest such
 *                              position, in slides
 *  - what is the next move?    the first step of a shortest path
 *
 * None of those is a heuristic. "This board needs 27 moves" means no sequence
 * of 26 exists, which is a far stronger promise than the other four games can
 * make about their difficulty, and it is what `generate.ts` builds on.
 *
 * The node budget below is a guard against a pathological layout eating the
 * worker, not a correctness compromise: a search that hits it returns null and
 * the candidate board is thrown away rather than shipped unverified. In
 * practice nothing comes close — a 6x6 park of a dozen vehicles moves through
 * a few tens of thousands of positions.
 */

import {
  type Board,
  type Move,
  type Position,
  SIZE,
  encode,
  decode,
  isSolved,
  occupancy,
  slideRange,
} from './model';

/**
 * Ceiling on positions visited in one sweep.
 *
 * Sized well above anything a generated layout produces, so hitting it means a
 * board that should not exist rather than a board that is merely hard.
 */
export const MAX_STATES = 400_000;

/** Neighbour expansion, sharing one occupancy buffer across the whole sweep. */
function expand(board: Board, position: readonly number[], grid: Uint8Array): number[][] {
  occupancy(board, position, grid);
  const out: number[][] = [];

  for (let id = 0; id < board.vehicles.length; id++) {
    const { from, to } = slideRange(board, position, id, grid);
    const at = position[id] as number;
    for (let offset = from; offset <= to; offset++) {
      if (offset === at) continue;
      const next = position.slice();
      next[id] = offset;
      out.push(next);
    }
  }

  return out;
}

export interface Analysis {
  /** Shortest slides-to-win for every position in the component. */
  distance: Map<string, number>;
  /** Component positions grouped by that distance; the index *is* the distance. */
  byDistance: string[][];
  /** Positions in the component, win included. */
  size: number;
  /** The deepest any position in this component sits from a win. */
  depth: number;
}

/**
 * Everything there is to know about the component containing `start`.
 *
 * Two sweeps, and both are needed. The first finds the component and, with it,
 * *every* winning position in it — which the second then treats as one combined
 * source. Measuring from a single win instead would overstate the distance of
 * anything that happens to be closer to a different one, and the whole point of
 * this file is that the number it reports is exact.
 *
 * Returns null if the component contains no win at all, or if it runs past the
 * node budget.
 */
export function analyse(board: Board, start: Position, budget = MAX_STATES): Analysis | null {
  const grid = new Uint8Array(SIZE * SIZE);

  /* --- sweep one: the component, and the wins inside it --------------- */

  const seen = new Set<string>([encode(start)]);
  let frontier: number[][] = [start.slice()];
  const wins: string[] = [];
  if (isSolved(board, start)) wins.push(encode(start));

  while (frontier.length > 0) {
    const next: number[][] = [];
    for (const position of frontier) {
      for (const candidate of expand(board, position, grid)) {
        const key = encode(candidate);
        if (seen.has(key)) continue;
        if (seen.size >= budget) return null;
        seen.add(key);
        if (isSolved(board, candidate)) wins.push(key);
        next.push(candidate);
      }
    }
    frontier = next;
  }

  if (wins.length === 0) return null;

  /* --- sweep two: distance to the nearest win ------------------------- */

  const distance = new Map<string, number>();
  const byDistance: string[][] = [wins.slice()];
  for (const key of wins) distance.set(key, 0);

  let layer = wins.map(decode);
  let depth = 0;

  while (layer.length > 0) {
    const next: number[][] = [];
    const keys: string[] = [];

    for (const position of layer) {
      for (const candidate of expand(board, position, grid)) {
        const key = encode(candidate);
        if (distance.has(key)) continue;
        distance.set(key, depth + 1);
        keys.push(key);
        next.push(candidate);
      }
    }

    if (keys.length > 0) {
      depth++;
      byDistance.push(keys);
    }
    layer = next;
  }

  return { distance, byDistance, size: distance.size, depth };
}

/**
 * A shortest solution from `position`, as the moves to play. Null if there is
 * none, or if the search ran past its budget.
 *
 * Kept as its own sweep rather than read out of an `Analysis`, because this is
 * what the hint calls mid-level and it only needs one line, not the map. It
 * cannot exceed the budget on a generated board: the position is inside a
 * component the generator has already enumerated, and play never leaves it.
 */
export function findSolution(
  board: Board,
  position: Position,
  budget = MAX_STATES,
): Move[] | null {
  if (isSolved(board, position)) return [];

  const grid = new Uint8Array(SIZE * SIZE);
  const start = encode(position);

  /** key -> the position it was reached from, and the move that did it. */
  const cameFrom = new Map<string, { key: string; move: Move }>();
  const seen = new Set<string>([start]);
  let frontier: number[][] = [position.slice()];

  while (frontier.length > 0) {
    const next: number[][] = [];

    for (const from of frontier) {
      const fromKey = encode(from);
      occupancy(board, from, grid);

      for (let id = 0; id < board.vehicles.length; id++) {
        const { from: lo, to: hi } = slideRange(board, from, id, grid);
        const at = from[id] as number;

        for (let offset = lo; offset <= hi; offset++) {
          if (offset === at) continue;
          const candidate = from.slice();
          candidate[id] = offset;
          const key = encode(candidate);
          if (seen.has(key)) continue;
          if (seen.size >= budget) return null;
          seen.add(key);
          cameFrom.set(key, { key: fromKey, move: { id, to: offset } });

          if (isSolved(board, candidate)) return trace(cameFrom, key, start);
          next.push(candidate);
        }
      }
    }

    frontier = next;
  }

  return null;
}

function trace(
  cameFrom: Map<string, { key: string; move: Move }>,
  end: string,
  start: string,
): Move[] {
  const moves: Move[] = [];
  let key = end;
  while (key !== start) {
    const step = cameFrom.get(key);
    if (!step) break;
    moves.push(step.move);
    key = step.key;
  }
  return moves.reverse();
}

/**
 * The exact number of slides in a shortest solution, or null if unsolvable.
 * The difficulty score in `generate.ts` is a function of nothing else.
 */
export function minMoves(board: Board, position: Position, budget = MAX_STATES): number | null {
  return findSolution(board, position, budget)?.length ?? null;
}

/** Exact. A false here is a proof, not a timeout. */
export function isSolvable(board: Board, position: Position, budget = MAX_STATES): boolean {
  return findSolution(board, position, budget) !== null;
}
