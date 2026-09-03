/**
 * Screw Land search.
 *
 * Two constraints interact, and the puzzle lives in the interaction:
 *
 *   physical — a screw is unreachable until the plates above it fall away;
 *   colour   — a screw whose colour matches no open box goes to the tray, and
 *              an overflowing tray loses the level.
 *
 * Structures are built so they always come apart physically (see `generate.ts`),
 * so search is entirely about finding a *colour* order that never overflows.
 *
 * As in Color Sort, this is complete within its budget: exhausting the reachable
 * state space without a win means the level really is impossible, which is what
 * guarantees no generated level is ever a dead end.
 */

import {
  type SinkConfig,
  type SinkState,
  accept,
  acceptedColors,
  createSinkState,
  sinkStateKey,
} from '../shared/buffer-sink';
import {
  type BoardState,
  type Screw,
  type Structure,
  type StructureIndex,
  accessibleScrewIds,
  allRemoved,
  cloneBoardState,
  createBoardState,
  indexStructure,
  removeScrew,
  restoreScrew,
  structureKey,
} from './model';

export interface ScrewLandLevelSpec {
  structure: Structure;
  /** Colours of boxes waiting to open, index 0 next. */
  queue: number[];
  config: SinkConfig;
}

export type SearchStatus = 'solved' | 'unsolvable' | 'budget';

export interface SearchResult {
  status: SearchStatus;
  /** Screw ids in the order they are taken out. */
  moves: number[];
  nodes: number;
}

const DEFAULT_BUDGET = 120_000;

/**
 * Greedy ordering.
 *
 * Taking a screw a box already wants is nearly always right; parking one in the
 * tray is the move that loses levels, so it sorts last. Dropping a plate earns a
 * nudge because it is what reveals new screws, and therefore new options.
 */
function orderScrews(
  structure: Structure,
  index: StructureIndex,
  state: BoardState,
  sinks: SinkState,
  config: SinkConfig,
  ids: number[],
): number[] {
  const wanted = acceptedColors(sinks, config);

  const scored = ids.map((id) => {
    const screw = structure.screws[id] as Screw;
    let score = wanted.has(screw.color) ? 100 : -40;

    const plateIndex = index.plateIndexById.get(screw.plateId);
    if (plateIndex !== undefined && state.remainingPerPlate[plateIndex] === 1) {
      score += 25; // last screw: the plate falls and uncovers more
    }

    return { id, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.id);
}

function walkFrom(
  structure: Structure,
  index: StructureIndex,
  startState: BoardState,
  startSinks: SinkState,
  config: SinkConfig,
  budget: number,
): SearchResult {
  const state = cloneBoardState(startState);
  const visited = new Set<string>();
  const path: number[] = [];

  let nodes = 0;
  let overBudget = false;

  const walk = (sinks: SinkState): boolean => {
    if (allRemoved(state)) return true;
    if (nodes >= budget) {
      overBudget = true;
      return false;
    }
    nodes++;

    const reachable = accessibleScrewIds(structure, index, state);
    if (reachable.length === 0) return false; // physically stuck

    for (const id of orderScrews(structure, index, state, sinks, config, reachable)) {
      const screw = structure.screws[id] as Screw;
      const result = accept(sinks, config, screw.color);
      if (result.placed === 'lost') continue; // the tray would overflow

      removeScrew(structure, index, state, id);
      const key = `${structureKey(state)}#${sinkStateKey(result.state)}`;

      if (!visited.has(key)) {
        visited.add(key);
        path.push(id);
        if (walk(result.state)) return true;
        path.pop();
      }

      restoreScrew(structure, index, state, id);
      if (overBudget) return false;
    }

    return false;
  };

  visited.add(`${structureKey(state)}#${sinkStateKey(startSinks)}`);
  const solved = walk(startSinks);

  if (solved) return { status: 'solved', moves: path.slice(), nodes };
  return { status: overBudget ? 'budget' : 'unsolvable', moves: [], nodes };
}

export function search(
  spec: ScrewLandLevelSpec,
  options: { nodeBudget?: number } = {},
): SearchResult {
  const index = indexStructure(spec.structure);
  return walkFrom(
    spec.structure,
    index,
    createBoardState(spec.structure, index),
    createSinkState(spec.config, spec.queue),
    spec.config,
    options.nodeBudget ?? DEFAULT_BUDGET,
  );
}

/**
 * Search from a partially disassembled board.
 *
 * The sink state is replayed from the removal order rather than passed in, so a
 * caller cannot desynchronise the two halves of the state.
 */
export function searchFrom(
  spec: ScrewLandLevelSpec,
  removalOrder: readonly number[],
  options: { nodeBudget?: number } = {},
): SearchResult {
  const index = indexStructure(spec.structure);
  const state = createBoardState(spec.structure, index);
  let sinks = createSinkState(spec.config, spec.queue);

  for (const id of removalOrder) {
    const screw = spec.structure.screws[id] as Screw;
    const result = accept(sinks, spec.config, screw.color);
    if (result.placed === 'lost') return { status: 'unsolvable', moves: [], nodes: 0 };
    sinks = result.state;
    removeScrew(spec.structure, index, state, id);
  }

  return walkFrom(spec.structure, index, state, sinks, spec.config, options.nodeBudget ?? 60_000);
}

/**
 * A full winning line from the given position, or null when the player has
 * painted themselves into a corner.
 *
 * Callers follow the whole plan rather than asking move by move. Two searches
 * from adjacent positions can return different winning lines, and the second
 * one's opening move may undo the first's — which in Color Sort made repeated
 * hints ping-pong forever instead of finishing the board.
 */
export function findSolution(
  spec: ScrewLandLevelSpec,
  removalOrder: readonly number[] = [],
): number[] | null {
  const result = searchFrom(spec, removalOrder);
  return result.status === 'solved' && result.moves.length > 0 ? result.moves : null;
}
