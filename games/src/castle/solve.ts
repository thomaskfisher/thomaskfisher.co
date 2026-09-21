/**
 * Castle search.
 *
 * A level is a placement: some towers, some plots, and a wave that is a pure
 * function of where they stand. The space is small — ten plots and five towers
 * of three kinds is 7,560 layouts at the very top of the curve, and most levels
 * are a few hundred — so the search is simply **every layout, best-looking
 * first**. Nothing is pruned on a guess, which is what makes it complete:
 * running out of layouts without a win means no layout wins, not that the
 * search gave up.
 *
 * It always places every tower it has. A tower never makes a wave harder to
 * hold on its own — it adds shots or slows enemies down — so if a layout with a
 * tower left in the tray wins, the same layout plus that tower almost always
 * does too. Where that fails the level is merely discarded as unsolvable by the
 * generator, which is the safe direction to be wrong in.
 */

import {
  type Layout,
  type Level,
  EMPTY,
  TOWER_KINDS,
  reachOf,
  remaining,
  simulate,
} from './model';

export type SearchStatus = 'solved' | 'unsolvable' | 'budget';

export interface SearchResult {
  status: SearchStatus;
  /** The winning layout, one entry per plot. Empty unless solved. */
  layout: Layout;
  /** Waves simulated. */
  nodes: number;
}

const DEFAULT_BUDGET = 20_000;

/**
 * Plots in the order worth trying, strongest first.
 *
 * Ranked by how much road the best tower could reach from there. Every layout
 * is still visited — this only decides which ones come first, and the first
 * winner ends the search, so a good order is the difference between tens of
 * waves and thousands.
 */
function plotOrder(level: Level, free: readonly number[]): number[] {
  const score = (plot: number): number => {
    let best = 0;
    for (let kind = 0; kind < TOWER_KINDS; kind++) best = Math.max(best, reachOf(level, plot, kind));
    return best;
  };
  return free.slice().sort((a, b) => score(b) - score(a) || a - b);
}

/**
 * Visits every way to place the towers still in the tray onto the free plots,
 * calling `visit` with each complete layout until it returns true.
 *
 * Identical towers are interchangeable, so a layout is enumerated once rather
 * than once per ordering of its arrows — which is the difference between 7,560
 * and 30,240 at the top of the curve.
 */
export function forEachCompletion(
  level: Level,
  start: readonly number[],
  visit: (layout: Layout) => boolean,
): boolean {
  const layout = start.slice();
  const left = remaining(level, layout);
  if (left.some((n) => n < 0)) return false;

  const free = plotOrder(
    level,
    layout.map((kind, plot) => (kind === EMPTY ? plot : -1)).filter((plot) => plot !== -1),
  );
  let toPlace = left.reduce((a, b) => a + b, 0);

  const walk = (index: number): boolean => {
    if (toPlace === 0) return visit(layout);
    if (free.length - index < toPlace) return false;

    const plot = free[index] as number;
    // Best kind for this plot first: the one that reaches the most road.
    const kinds = [0, 1, 2].sort(
      (a, b) => reachOf(level, plot, b) - reachOf(level, plot, a) || a - b,
    );
    for (const kind of kinds) {
      if ((left[kind] as number) <= 0) continue;
      left[kind] = (left[kind] as number) - 1;
      toPlace--;
      layout[plot] = kind;
      const done = walk(index + 1);
      layout[plot] = EMPTY;
      toPlace++;
      left[kind] = (left[kind] as number) + 1;
      if (done) return true;
    }
    return walk(index + 1);
  };

  return walk(0);
}

/**
 * The first winning completion of `start`, searching every one if need be.
 *
 * `start` is the player's layout so far; the towers already on the map stay
 * where they are. From an empty map this is the generator's proof that a level
 * can be won.
 */
export function search(
  level: Level,
  start: readonly number[] = level.plots.map(() => EMPTY),
  options: { nodeBudget?: number } = {},
): SearchResult {
  const budget = options.nodeBudget ?? DEFAULT_BUDGET;
  let nodes = 0;
  let found: Layout | null = null;
  let overBudget = false;

  forEachCompletion(level, start, (layout) => {
    if (nodes >= budget) {
      overBudget = true;
      return true;
    }
    nodes++;
    if (simulate(level, layout).won) {
      found = layout.slice();
      return true;
    }
    return false;
  });

  if (found) return { status: 'solved', layout: found, nodes };
  return { status: overBudget ? 'budget' : 'unsolvable', layout: [], nodes };
}

/**
 * Every winning layout and every layout, for the probe and the tests.
 *
 * The exact share of the placement space that wins — the purest statement of
 * how hard a level is, and too slow to compute for every candidate the
 * generator considers, which is why generation measures trap rate instead.
 */
export function countWinners(level: Level): { wins: number; total: number } {
  let wins = 0;
  let total = 0;
  forEachCompletion(level, level.plots.map(() => EMPTY), (layout) => {
    total++;
    if (simulate(level, layout).won) wins++;
    return false;
  });
  return { wins, total };
}

/**
 * The winning layout that keeps the most of `layout` standing.
 *
 * For a hint from a map that cannot be completed into a win: rather than
 * telling the player to start over, it finds the win that asks them to move
 * the fewest towers. Every layout is visited, so this is exact — and it is
 * only ever called after `search` has already proved that no completion of the
 * current map wins, which is the rare case.
 */
export function closestWinner(level: Level, layout: readonly number[]): Layout | null {
  let best: Layout | null = null;
  let bestKept = -1;
  const placed = layout.filter((kind) => kind !== EMPTY).length;

  forEachCompletion(level, level.plots.map(() => EMPTY), (candidate) => {
    let kept = 0;
    for (let plot = 0; plot < layout.length; plot++) {
      if (layout[plot] !== EMPTY && candidate[plot] === layout[plot]) kept++;
    }
    if (kept <= bestKept) return false;
    if (!simulate(level, candidate).won) return false;
    best = candidate.slice();
    bestKept = kept;
    // Nothing can keep more than everything.
    return kept === placed;
  });

  return best;
}
