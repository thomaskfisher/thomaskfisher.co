/**
 * Bus Jam search.
 *
 * Two constraints interact, and the puzzle lives in the interaction:
 *
 *   physical — someone with no clear path to the exit cannot be tapped, and who
 *              has a path depends on who left before them;
 *   colour   — someone whose colour matches no bus at the stop waits on the
 *              bench, and a full bench loses the level.
 *
 * Boards are built so they always empty physically (see `generate.ts`), so
 * search is entirely about finding a *colour* order that never overfills the
 * bench.
 *
 * As in the other two games, this is complete within its budget: exhausting the
 * reachable state space without a win means the level really is impossible,
 * which is what guarantees no generated level is ever a dead end.
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
  type Board,
  type BoardState,
  type GridIndex,
  type Passenger,
  allBoarded,
  boardKey,
  boardPassenger,
  cellIndex,
  cloneBoardState,
  createBoardState,
  indexBoard,
  isReachable,
  reachableIds,
  restorePassenger,
} from './model';

export interface BusJamLevelSpec {
  board: Board;
  /** Colours of buses waiting to pull in, index 0 next. */
  queue: number[];
  config: SinkConfig;
}

export type SearchStatus = 'solved' | 'unsolvable' | 'budget';

export interface SearchResult {
  status: SearchStatus;
  /** Passenger ids in the order they board. */
  moves: number[];
  nodes: number;
}

const DEFAULT_BUDGET = 120_000;

/**
 * Greedy ordering.
 *
 * Sending someone to a bus that already wants them is nearly always right;
 * parking someone on the bench is the move that loses levels, so it sorts last.
 * Among equals, prefer whoever is hemmed in by the most neighbours — clearing
 * them is what opens the board up and therefore what creates new options.
 */
function orderPassengers(
  board: Board,
  index: GridIndex,
  state: BoardState,
  sinks: SinkState,
  config: SinkConfig,
  ids: number[],
): number[] {
  const wanted = acceptedColors(sinks, config);

  const scored = ids.map((id) => {
    const passenger = board.passengers[id] as Passenger;
    let score = wanted.has(passenger.color) ? 100 : -40;

    const cell = cellIndex(board, passenger.x, passenger.y);
    for (const next of index.neighbors[cell] as number[]) {
      if (state.occupant[next] !== -1) score += 8;
    }

    return { id, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.id);
}

function walkFrom(
  board: Board,
  index: GridIndex,
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
    if (allBoarded(state)) return true;
    if (nodes >= budget) {
      overBudget = true;
      return false;
    }
    nodes++;

    const reachable = reachableIds(board, index, state);
    if (reachable.length === 0) return false; // physically stuck

    for (const id of orderPassengers(board, index, state, sinks, config, reachable)) {
      const passenger = board.passengers[id] as Passenger;
      const result = accept(sinks, config, passenger.color);
      if (result.placed === 'lost') continue; // the bench would overflow

      boardPassenger(board, state, id);
      const key = `${boardKey(state)}#${sinkStateKey(result.state)}`;

      if (!visited.has(key)) {
        visited.add(key);
        path.push(id);
        if (walk(result.state)) return true;
        path.pop();
      }

      restorePassenger(board, state, id);
      if (overBudget) return false;
    }

    return false;
  };

  visited.add(`${boardKey(state)}#${sinkStateKey(startSinks)}`);
  const solved = walk(startSinks);

  if (solved) return { status: 'solved', moves: path.slice(), nodes };
  return { status: overBudget ? 'budget' : 'unsolvable', moves: [], nodes };
}

export function search(spec: BusJamLevelSpec, options: { nodeBudget?: number } = {}): SearchResult {
  const index = indexBoard(spec.board);
  return walkFrom(
    spec.board,
    index,
    createBoardState(spec.board),
    createSinkState(spec.config, spec.queue),
    spec.config,
    options.nodeBudget ?? DEFAULT_BUDGET,
  );
}

/**
 * Search from a partly cleared board.
 *
 * The bench and bus state is replayed from the boarding order rather than
 * passed in, so a caller cannot desynchronise the two halves of the state.
 *
 * The replay checks both halves of every move — that the colour had somewhere
 * to go *and* that the passenger could actually walk out. Checking only the
 * colour would let a corrupted save plan a hint from a position the rules never
 * allowed, and the hint would name someone who cannot move.
 */
export function searchFrom(
  spec: BusJamLevelSpec,
  boardingOrder: readonly number[],
  options: { nodeBudget?: number } = {},
): SearchResult {
  const index = indexBoard(spec.board);
  const state = createBoardState(spec.board);
  let sinks = createSinkState(spec.config, spec.queue);

  for (const id of boardingOrder) {
    const passenger = spec.board.passengers[id];
    if (!passenger || !isReachable(spec.board, index, state, id)) {
      return { status: 'unsolvable', moves: [], nodes: 0 };
    }
    const result = accept(sinks, spec.config, passenger.color);
    if (result.placed === 'lost') return { status: 'unsolvable', moves: [], nodes: 0 };
    sinks = result.state;
    boardPassenger(spec.board, state, id);
  }

  return walkFrom(spec.board, index, state, sinks, spec.config, options.nodeBudget ?? 60_000);
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
  spec: BusJamLevelSpec,
  boardingOrder: readonly number[] = [],
): number[] | null {
  const result = searchFrom(spec, boardingOrder);
  return result.status === 'solved' && result.moves.length > 0 ? result.moves : null;
}
