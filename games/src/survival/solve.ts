/**
 * Survival's solver.
 *
 * This one is unusual for the collection: it is not a bounded search that gives
 * up, it is an exact dynamic program that always answers. The reason is a
 * property of the rules rather than a clever algorithm — every operation in
 * `model.ts` is monotone non-decreasing in the incoming soldier count, so of two
 * ways to arrive at the same cell, the one carrying more soldiers is at least as
 * good from there on, always. Nothing is ever worth keeping except the maximum.
 *
 * So one number per cell is enough, the sweep is O(rows x lanes), and
 * "unsolvable" means genuinely unsolvable rather than "the budget ran out".
 * That is what lets `generate.ts` guarantee solvability by construction and
 * what makes the hint free in the literal sense — it costs microseconds.
 *
 * If a future modifier breaks monotonicity (a gate that caps you, a barrier you
 * must sneak *under*), this file stops being correct and has to become a real
 * search. The invariant sweep in the tests is what would catch that.
 */

import { type Board, DEAD, type Route, applyNode, evaluate, nodeAt } from './model';

export interface Continuation {
  /** Best soldier count reachable at the top from where the route stands. */
  final: number;
  /** Lanes for the remaining rows, in order. */
  lanes: number[];
}

/**
 * The best possible finish from the end of `route`, and one line that gets
 * there. Null when every continuation dies before the top.
 *
 * A maximum-count line is the right thing to hand a player: because more is
 * never worse, if any continuation wins then this one does.
 */
export function bestContinuation(board: Board, route: Route = []): Continuation | null {
  const { phase, count } = evaluate(board, route);
  if (phase !== 'playing') return null;

  const startRow = route.length;
  const lanes = board.lanes;

  // values[lane] is the count the squad would be carrying while standing in
  // that lane, immediately before stepping into `row`.
  //
  // Before row 0 the squad is off the board and may enter anywhere, which is
  // expressed by seeding every lane: the reach rule then reaches everything.
  // From row 1 on it stands in exactly one lane, and only that lane is seeded.
  let values = new Array<number>(lanes).fill(DEAD);
  if (startRow === 0) values.fill(count);
  else values[route[startRow - 1] as number] = count;

  // parents[r][lane] is the lane occupied at row r-1 on the best line into
  // (r, lane). Indexed from `startRow`.
  const parents: number[][] = [];

  for (let row = startRow; row < board.rows; row++) {
    const next = new Array<number>(lanes).fill(DEAD);
    const parentRow = new Array<number>(lanes).fill(-1);

    for (let lane = 0; lane < lanes; lane++) {
      let bestIncoming = DEAD;
      let bestFrom = -1;

      const lo = Math.max(0, lane - board.reach);
      const hi = Math.min(lanes - 1, lane + board.reach);
      for (let from = lo; from <= hi; from++) {
        const value = values[from] as number;
        if (value > bestIncoming) {
          bestIncoming = value;
          bestFrom = from;
        }
      }

      if (bestIncoming <= DEAD) continue;
      next[lane] = applyNode(nodeAt(board, row, lane), bestIncoming);
      parentRow[lane] = bestFrom;
    }

    parents.push(parentRow);
    values = next;
  }

  let final = DEAD;
  let endLane = -1;
  for (let lane = 0; lane < lanes; lane++) {
    if ((values[lane] as number) > final) {
      final = values[lane] as number;
      endLane = lane;
    }
  }
  if (endLane < 0) return null;

  // Walk the backpointers home. The parent of the first row is the position the
  // squad already occupies, so it is not part of the answer.
  const out = new Array<number>(board.rows - startRow);
  let lane = endLane;
  for (let i = out.length - 1; i >= 0; i--) {
    out[i] = lane;
    lane = (parents[i] as number[])[lane] as number;
  }

  return { final, lanes: out };
}

/** Can this run still be won? Exact — a false here is a proof, not a timeout. */
export function isWinnable(board: Board, route: Route = []): boolean {
  const { phase } = evaluate(board, route);
  if (phase === 'won') return true;
  if (phase === 'lost') return false;

  const best = bestContinuation(board, route);
  return best !== null && best.final > board.horde;
}

/** The largest finish any route on this board can reach. Zero if none survive. */
export function maxFinal(board: Board): number {
  return bestContinuation(board, [])?.final ?? DEAD;
}

/**
 * A full winning route from the current position, or null if there is none.
 * This is what the hint follows.
 */
export function findSolution(board: Board, route: Route = []): number[] | null {
  const best = bestContinuation(board, route);
  if (!best || best.final <= board.horde) return null;
  return best.lanes;
}
