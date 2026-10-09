/**
 * Marble Sort solver.
 *
 * Searches over *settled* positions: a move is "tap this pipe, then wait until
 * nothing more lands". Waiting is always open to a real-time player, so a line
 * found here is a line she can play. The belt keeps turning while she waits, so
 * she taps at some point in its rotation the search did not pick — the
 * generator checks that this never matters (`isTimingProof`), and the hint
 * searches again from wherever the belt actually is.
 *
 * Depth-first with a visited set, children ordered by how many of the tapped
 * colour the open blocks would take straight away. Complete within its budget:
 * running out of positions without a win means there is no winning line of
 * this kind, not that the search gave up. That distinction is what lets the
 * generator promise every level it ships can be won.
 */

import {
  type Geometry,
  type Level,
  type Sim,
  cellAt,
  cloneSim,
  geometryFor,
  settle,
  tap,
  topColor,
} from './model';

export type SearchStatus = 'solved' | 'unsolvable' | 'budget';

export interface SearchResult {
  status: SearchStatus;
  /** Pipe colours to tap, in order, each after the belt has settled. */
  plan: number[] | null;
  nodes: number;
}

export interface SearchOptions {
  nodeBudget?: number;
  /**
   * A pipe to try first at the root. The hint passes the next tap of the line
   * it showed last time, so that searching again from a slightly different
   * rotation keeps to the same line whenever it still wins, rather than
   * flipping to another one whose first tap undoes the last.
   */
  prefer?: number;
}

/** Position identity. The belt is read in slot order, since that is what plays. */
export function positionKey(sim: Sim, geometry: Geometry): string {
  let belt = '';
  for (let s = 0; s < geometry.length; s++) {
    const color = sim.cells[cellAt(sim, s, geometry.length)] as number;
    belt += color < 0 ? '.' : String(color);
  }
  return `${belt}|${sim.remaining.join(',')}|${sim.depth.join(',')}|${sim.fill.join(',')}`;
}

/** Holes open right now for a colour, across every column's top block. */
export function openHoles(level: Level, sim: Sim, color: number): number {
  let holes = 0;
  for (let c = 0; c < level.columns.length; c++) {
    if (topColor(level, sim, c) === color) holes += level.blockSize - (sim.fill[c] as number);
  }
  return holes;
}

/**
 * Pipes worth trying first: those the open blocks would swallow most of, then
 * the fullest pipe. Ordering only affects speed, never the verdict.
 */
function orderedTaps(level: Level, sim: Sim): number[] {
  const colors: number[] = [];
  for (let color = 0; color < level.colors; color++) {
    if ((sim.remaining[color] as number) > 0) colors.push(color);
  }
  const score = (color: number): number =>
    Math.min(openHoles(level, sim, color), level.dropSize) * 1000 + (sim.remaining[color] as number);
  return colors.sort((a, b) => score(b) - score(a));
}

/**
 * Searches from a settled position. `start` is not modified.
 *
 * A start that is still moving is first allowed to settle, which is what the
 * player would see if they waited — so the hint can be asked for at any time.
 */
export function search(level: Level, start: Sim, options: SearchOptions = {}): SearchResult {
  const budget = options.nodeBudget ?? 200_000;
  const geometry = geometryFor(level);
  const root = cloneSim(start);
  const rootStatus = settle(level, root, geometry);
  if (rootStatus === 'won') return { status: 'solved', plan: [], nodes: 0 };
  if (rootStatus === 'lost') return { status: 'unsolvable', plan: null, nodes: 0 };

  const seen = new Set<string>();
  const plan: number[] = [];
  let nodes = 0;
  let outOfBudget = false;

  const visit = (sim: Sim, root = false): boolean => {
    let order = orderedTaps(level, sim);
    const prefer = options.prefer;
    if (root && prefer !== undefined && order.includes(prefer)) {
      order = [prefer, ...order.filter((color) => color !== prefer)];
    }
    for (const color of order) {
      if (nodes >= budget) {
        outOfBudget = true;
        return false;
      }
      nodes++;
      const next = cloneSim(sim);
      tap(level, next, color);
      const status = settle(level, next, geometry);
      if (status === 'lost') continue;
      plan.push(color);
      if (status === 'won') return true;
      const key = positionKey(next, geometry);
      if (!seen.has(key)) {
        seen.add(key);
        if (visit(next)) return true;
        if (outOfBudget) return false;
      }
      plan.pop();
    }
    return false;
  };

  seen.add(positionKey(root, geometry));
  if (visit(root, true)) return { status: 'solved', plan: plan.slice(), nodes };
  return { status: outOfBudget ? 'budget' : 'unsolvable', plan: null, nodes };
}

/** A winning line from this position, or null. */
export function findSolution(level: Level, sim: Sim, prefer?: number): number[] | null {
  return search(level, sim, { nodeBudget: 200_000, prefer }).plan;
}
