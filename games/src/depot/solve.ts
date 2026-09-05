/**
 * Depot search.
 *
 * The geometry is not the hard part and does not have to be searched. Levels
 * are built so the lot always empties — see the header of `model.ts` — so at
 * least one bus is drivable while any bus remains, and no ordering of pulls can
 * strand the lot. What search is actually for is the **colour** order: which
 * bus to commit a bay to, given a queue that has to be drained from the front.
 *
 * As in the rest of the collection this is complete within its node budget.
 * Exhausting the reachable positions without a win means the level genuinely
 * cannot be finished, which is the claim the generator rests on: no board here
 * is ever a dead end.
 */

import {
  type GameStateCore,
  type Level,
  boardWaiting,
  cloneState,
  createState,
  drivableIds,
  isWon,
  pull,
  stateKey,
} from './model';

export type SearchStatus = 'solved' | 'unsolvable' | 'budget';

export interface SearchResult {
  status: SearchStatus;
  /** Bus ids in the order they are pulled out. */
  moves: number[];
  nodes: number;
}

const DEFAULT_BUDGET = 150_000;

/**
 * Best-first ordering, measured rather than guessed.
 *
 * Every candidate is actually played for one ply and scored on how many people
 * it gets onto a bus. That is more work per node than a heuristic on colours,
 * and it is worth it: the drivable list is only ever a handful of buses, while
 * a wrong first guess here costs an entire subtree.
 *
 * The tie-break is how many *other* buses the pull unblocks. Two moves that
 * board the same number of people are not equal if one of them opens the lot up
 * and the other seals it.
 */
function order(level: Level, state: GameStateCore, ids: readonly number[]): number[] {
  const blockedBefore = countBlocked(level, state);

  const scored = ids.map((id) => {
    const next = cloneState(state);
    pull(level, next, id);
    const boarded = next.boarded - state.boarded;
    const freed = blockedBefore - countBlocked(level, next);
    return { id, score: boarded * 10 + freed };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.id);
}

/** Buses still parked whose way out is blocked. Cheap, and only used to sort. */
function countBlocked(level: Level, state: GameStateCore): number {
  let parked = 0;
  for (const isParked of state.parked) if (isParked) parked++;
  // `drivableIds` returns nothing at all when the kerb is full, which would
  // read as "everything is blocked". Count the lot on its own terms.
  const openKerb: GameStateCore = { ...state, bays: state.bays.map(() => null) };
  return parked - drivableIds(level.board, openKerb).length;
}

function walkFrom(level: Level, start: GameStateCore, budget: number): SearchResult {
  const visited = new Set<string>();
  const path: number[] = [];

  let nodes = 0;
  let overBudget = false;

  const walk = (state: GameStateCore): boolean => {
    if (isWon(level, state)) return true;
    if (nodes >= budget) {
      overBudget = true;
      return false;
    }
    nodes++;

    const drivable = drivableIds(level.board, state);
    if (drivable.length === 0) return false; // the kerb is jammed

    for (const id of order(level, state, drivable)) {
      const next = cloneState(state);
      if (pull(level, next, id) !== 'ok') continue;

      const key = stateKey(next);
      if (visited.has(key)) continue;
      visited.add(key);

      path.push(id);
      if (walk(next)) return true;
      path.pop();

      if (overBudget) return false;
    }

    return false;
  };

  visited.add(stateKey(start));
  const solved = walk(start);

  if (solved) return { status: 'solved', moves: path.slice(), nodes };
  return { status: overBudget ? 'budget' : 'unsolvable', moves: [], nodes };
}

export function search(level: Level, options: { nodeBudget?: number } = {}): SearchResult {
  const state = createState(level.board);
  // A queue can start boarding before anything is pulled only if a bay begins
  // occupied, which it never does — but running the loop here keeps every
  // position in the search reachable by the same code path.
  boardWaiting(level, state);
  return walkFrom(level, state, options.nodeBudget ?? DEFAULT_BUDGET);
}

/**
 * Search from a partly played level.
 *
 * The position is replayed from the pull order rather than passed in, so a
 * caller cannot hand the search a kerb and a lot that disagree with each other.
 * A pull the rules would have refused ends the replay as unsolvable instead of
 * being skipped: planning a hint from a position the game never allowed would
 * name a bus the player cannot tap.
 */
export function searchFrom(
  level: Level,
  pullOrder: readonly number[],
  options: { nodeBudget?: number } = {},
): SearchResult {
  const state = createState(level.board);
  boardWaiting(level, state);

  for (const id of pullOrder) {
    if (pull(level, state, id) !== 'ok') {
      return { status: 'unsolvable', moves: [], nodes: 0 };
    }
  }

  return walkFrom(level, state, options.nodeBudget ?? 80_000);
}

/**
 * A whole winning line from here, or null when the player has painted
 * themselves into a corner.
 *
 * Callers follow the plan rather than asking again after every tap. Two
 * searches from adjacent positions can return different winning lines, and the
 * second one's opening move may undo the first's — which is how a hint button
 * ends up ping-ponging between two buses forever instead of finishing a level.
 */
export function findSolution(level: Level, pullOrder: readonly number[] = []): number[] | null {
  const result = searchFrom(level, pullOrder);
  return result.status === 'solved' && result.moves.length > 0 ? result.moves : null;
}
