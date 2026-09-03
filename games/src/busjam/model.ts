/**
 * Bus Jam rules. Pure — no DOM, no storage, no randomness.
 *
 * A crowd stands on a walkable grid. Tapping someone walks them off the top
 * edge to the bench, and from there onto a bus of their colour. The physical
 * half of the puzzle is that people block each other: you can only tap someone
 * who has a clear path of empty cells to the top edge, so the order you empty
 * a column in decides which colours you can still reach.
 *
 * Coordinates are grid cells, row-major, origin top-left. Row 0 is the row
 * adjacent to the bench, and is therefore the exit.
 *
 * Reachability is monotone: boarding someone only ever frees a cell, and can
 * never make another passenger unreachable. That is what makes reverse-play
 * generation sound (see `generate.ts`) and what lets `isClearable` settle the
 * question with a greedy sweep rather than a search.
 */

export interface Passenger {
  id: number;
  color: number;
  x: number;
  y: number;
}

export interface Board {
  width: number;
  height: number;
  /** Walkable mask, row-major. A closed cell is a wall — nobody stands or walks there. */
  open: boolean[];
  passengers: Passenger[];
  colors: number;
}

/**
 * Derived lookup tables plus the pathfinder's scratch space.
 *
 * The solver asks "who can reach the exit" tens of thousands of times, so the
 * neighbour lists are built once, and the visited set is a stamped array rather
 * than a fresh allocation per query.
 */
export interface GridIndex {
  /** cell -> open neighbouring cells. */
  neighbors: number[][];
  /** Open cells on row 0, the ones a passenger can step off the board from. */
  exits: number[];
  /** Stamped visited marks. Internal to the pathfinder. */
  visited: Int32Array;
  /** Bumped per query so `visited` never needs clearing. */
  stamp: number;
  /** BFS parent links, valid only for the most recent `pathToExit`. */
  parent: Int32Array;
}

/** Mutable play state. `occupant` is what makes a path query a plain BFS. */
export interface BoardState {
  boarded: boolean[];
  /** cell -> passenger id standing there, or -1. */
  occupant: number[];
}

export const cellIndex = (board: Board, x: number, y: number): number => y * board.width + x;

export const cellX = (board: Board, cell: number): number => cell % board.width;

export const cellY = (board: Board, cell: number): number => Math.floor(cell / board.width);

export function isOpen(board: Board, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= board.width || y >= board.height) return false;
  return board.open[cellIndex(board, x, y)] === true;
}

export function indexBoard(board: Board): GridIndex {
  const size = board.width * board.height;
  const neighbors: number[][] = new Array(size);
  const exits: number[] = [];

  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      const cell = cellIndex(board, x, y);
      if (!isOpen(board, x, y)) {
        neighbors[cell] = [];
        continue;
      }
      if (y === 0) exits.push(cell);

      const list: number[] = [];
      if (isOpen(board, x, y - 1)) list.push(cellIndex(board, x, y - 1));
      if (isOpen(board, x, y + 1)) list.push(cellIndex(board, x, y + 1));
      if (isOpen(board, x - 1, y)) list.push(cellIndex(board, x - 1, y));
      if (isOpen(board, x + 1, y)) list.push(cellIndex(board, x + 1, y));
      neighbors[cell] = list;
    }
  }

  return {
    neighbors,
    exits,
    visited: new Int32Array(size),
    stamp: 0,
    parent: new Int32Array(size).fill(-1),
  };
}

export function createBoardState(board: Board): BoardState {
  const occupant = new Array<number>(board.width * board.height).fill(-1);
  for (const passenger of board.passengers) {
    occupant[cellIndex(board, passenger.x, passenger.y)] = passenger.id;
  }
  return { boarded: new Array<boolean>(board.passengers.length).fill(false), occupant };
}

export function cloneBoardState(state: BoardState): BoardState {
  return { boarded: state.boarded.slice(), occupant: state.occupant.slice() };
}

/**
 * Can this passenger walk out?
 *
 * True when they stand on the exit row, or when some sequence of empty cells
 * leads from where they stand to it. Their own cell is the start, so the fact
 * that it is occupied by them does not block the search.
 */
export function isReachable(
  board: Board,
  index: GridIndex,
  state: BoardState,
  passengerId: number,
): boolean {
  if (state.boarded[passengerId]) return false;
  const passenger = board.passengers[passengerId] as Passenger;
  if (passenger.y === 0) return true;

  const start = cellIndex(board, passenger.x, passenger.y);
  const stamp = ++index.stamp;
  const queue = [start];
  index.visited[start] = stamp;

  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head] as number;
    for (const next of index.neighbors[cell] as number[]) {
      if (index.visited[next] === stamp) continue;
      if (state.occupant[next] !== -1) continue; // somebody is in the way
      if (cellY(board, next) === 0) return true;
      index.visited[next] = stamp;
      queue.push(next);
    }
  }

  return false;
}

/**
 * The cells a passenger walks through on their way out, their own cell first
 * and an exit-row cell last. Null when they are blocked.
 *
 * Breadth-first, so the route drawn is the shortest one — which is what a
 * player expects to see and keeps the walk animation short.
 */
export function pathToExit(
  board: Board,
  index: GridIndex,
  state: BoardState,
  passengerId: number,
): number[] | null {
  if (state.boarded[passengerId]) return null;
  const passenger = board.passengers[passengerId] as Passenger;
  const start = cellIndex(board, passenger.x, passenger.y);
  if (passenger.y === 0) return [start];

  const stamp = ++index.stamp;
  const queue = [start];
  index.visited[start] = stamp;
  index.parent[start] = -1;

  let goal = -1;
  outer: for (let head = 0; head < queue.length; head++) {
    const cell = queue[head] as number;
    for (const next of index.neighbors[cell] as number[]) {
      if (index.visited[next] === stamp) continue;
      if (state.occupant[next] !== -1) continue;
      index.visited[next] = stamp;
      index.parent[next] = cell;
      if (cellY(board, next) === 0) {
        goal = next;
        break outer;
      }
      queue.push(next);
    }
  }

  if (goal === -1) return null;

  const path: number[] = [];
  for (let cell = goal; cell !== -1; cell = index.parent[cell] as number) path.push(cell);
  return path.reverse();
}

/**
 * Everyone who can walk out right now.
 *
 * One flood fill from the exits rather than one search per passenger: a
 * passenger can leave exactly when they stand on the exit row, or when one of
 * their neighbouring cells is empty and connected to it. The solver evaluates
 * this at every node, and the per-passenger version costs O(people x cells)
 * where this costs O(cells + people).
 */
export function reachableIds(board: Board, index: GridIndex, state: BoardState): number[] {
  const stamp = ++index.stamp;
  const queue: number[] = [];

  for (const exit of index.exits) {
    if (state.occupant[exit] !== -1) continue;
    index.visited[exit] = stamp;
    queue.push(exit);
  }

  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head] as number;
    for (const next of index.neighbors[cell] as number[]) {
      if (index.visited[next] === stamp) continue;
      if (state.occupant[next] !== -1) continue;
      index.visited[next] = stamp;
      queue.push(next);
    }
  }

  const ids: number[] = [];
  for (let id = 0; id < board.passengers.length; id++) {
    if (state.boarded[id]) continue;
    const passenger = board.passengers[id] as Passenger;
    if (passenger.y === 0) {
      ids.push(id);
      continue;
    }
    const cell = cellIndex(board, passenger.x, passenger.y);
    for (const next of index.neighbors[cell] as number[]) {
      if (index.visited[next] === stamp) {
        ids.push(id);
        break;
      }
    }
  }

  return ids;
}

/**
 * Walking distance from the exit for every free cell, or -1 where unreachable.
 *
 * Generation fills the board from the back forwards, and this is how it knows
 * which cells are "the back". Doing it as one sweep rather than one BFS per
 * candidate cell is what keeps generation cheap.
 */
export function exitDistances(board: Board, index: GridIndex, state: BoardState): number[] {
  const distance = new Array<number>(board.width * board.height).fill(-1);
  const queue: number[] = [];

  for (const exit of index.exits) {
    if (state.occupant[exit] !== -1) continue;
    distance[exit] = 0;
    queue.push(exit);
  }

  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head] as number;
    const next = (distance[cell] as number) + 1;
    for (const neighbor of index.neighbors[cell] as number[]) {
      if (distance[neighbor] !== -1) continue;
      if (state.occupant[neighbor] !== -1) continue;
      distance[neighbor] = next;
      queue.push(neighbor);
    }
  }

  return distance;
}

export function boardPassenger(board: Board, state: BoardState, passengerId: number): void {
  if (state.boarded[passengerId]) return;
  const passenger = board.passengers[passengerId] as Passenger;
  state.boarded[passengerId] = true;
  state.occupant[cellIndex(board, passenger.x, passenger.y)] = -1;
}

export function restorePassenger(board: Board, state: BoardState, passengerId: number): void {
  if (!state.boarded[passengerId]) return;
  const passenger = board.passengers[passengerId] as Passenger;
  state.boarded[passengerId] = false;
  state.occupant[cellIndex(board, passenger.x, passenger.y)] = passengerId;
}

export function allBoarded(state: BoardState): boolean {
  return state.boarded.every(Boolean);
}

export function remainingCount(state: BoardState): number {
  let n = 0;
  for (let i = 0; i < state.boarded.length; i++) if (!state.boarded[i]) n++;
  return n;
}

/** Identity for memoising search: who is still standing determines the rest. */
export function boardKey(state: BoardState): string {
  let key = '';
  for (let i = 0; i < state.boarded.length; i++) key += state.boarded[i] ? '1' : '0';
  return key;
}

/**
 * Sanity invariants a generated board must satisfy. A malformed board fails
 * confusingly and late — as an unsolvable level rather than as an error.
 */
export function isWellFormed(board: Board): boolean {
  if (board.width <= 0 || board.height <= 0) return false;
  if (board.open.length !== board.width * board.height) return false;
  if (board.passengers.length === 0) return false;

  // Without an open cell on row 0 nobody can ever leave.
  let hasExit = false;
  for (let x = 0; x < board.width; x++) {
    if (isOpen(board, x, 0)) hasExit = true;
  }
  if (!hasExit) return false;

  const taken = new Set<number>();
  for (let i = 0; i < board.passengers.length; i++) {
    const passenger = board.passengers[i] as Passenger;
    if (passenger.id !== i) return false; // ids must index the array
    if (!isOpen(board, passenger.x, passenger.y)) return false;
    if (passenger.color < 0 || passenger.color >= board.colors) return false;

    const cell = cellIndex(board, passenger.x, passenger.y);
    if (taken.has(cell)) return false; // two people in one cell
    taken.add(cell);
  }

  return true;
}

/**
 * Every board must empty when colour is ignored: repeatedly walking out
 * everyone who can reach the exit must clear the grid.
 *
 * Because boarding only frees cells, the greedy sweep is not an approximation —
 * if it stalls, no order works either. Generation builds boards so this holds
 * by construction; this proves it.
 */
export function isClearable(board: Board): boolean {
  const index = indexBoard(board);
  const state = createBoardState(board);
  let remaining = board.passengers.length;

  while (remaining > 0) {
    const next = reachableIds(board, index, state);
    if (next.length === 0) return false;
    for (const id of next) {
      boardPassenger(board, state, id);
      remaining--;
    }
  }

  return true;
}
