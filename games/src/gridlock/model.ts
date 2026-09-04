/**
 * Gridlock — the rules, and nothing else. No DOM, no randomness, no timers.
 *
 * A car park is a 6x6 grid holding vehicles two to four cells long. Each one is
 * locked to its own axis: a horizontal car slides left and right along its row
 * and can never change row, a vertical one slides up and down its column. One
 * vehicle — the target — sits in the exit row, and the level is finished when it
 * reaches the gap in the right-hand wall.
 *
 * **A slide of any distance is one move.** Dragging a car three cells is the
 * same single decision as dragging it one, and counting each cell separately
 * would inflate the number without adding a choice to it. This is also the unit
 * every published rating of this puzzle uses, which matters here because the
 * move count *is* the difficulty score — see `generate.ts`.
 *
 * The one structural thing worth knowing about this game, and the reason it is
 * built differently from the other four in the collection:
 *
 * **It cannot be lost.** Every move is reversible — slide a car from a to b and
 * sliding it back is always legal, because the cells it vacated are still empty.
 * So the state space is an *undirected* graph, there are no dead ends, and the
 * trap-rate signal the other puzzles are calibrated on has nothing to measure.
 * What that buys instead is worth more: the graph is small enough to enumerate
 * completely, so "the shortest solution is 27 moves" is an exact fact about a
 * board rather than an estimate, and generation can pick a starting position
 * *at* the depth it wants rather than dealing and hoping.
 *
 * The layout and the positions are deliberately split. Which vehicles exist,
 * how long they are and which row or column they are locked to never changes
 * within a level; only their offsets along their own axis do. That makes a
 * whole game state a short array of small integers, which is what makes
 * enumerating a few hundred thousand of them cheap.
 */

/** Both dimensions of the car park. The classic board, and it fits a phone. */
export const SIZE = 6;

/** The row the exit is cut into, counting from the top. */
export const EXIT_ROW = 2;

/** The target vehicle is always index 0. Nothing else may occupy that slot. */
export const TARGET = 0;

/** The target is always an ordinary car, so the exit gap is two cells wide. */
export const TARGET_LENGTH = 2;

export type Orientation = 'h' | 'v';

export interface Vehicle {
  readonly orientation: Orientation;
  /** 2 or 3, or 4 for the long ones. Never shorter than 2. */
  readonly length: number;
  /**
   * The coordinate the vehicle can never change: the row for a horizontal
   * vehicle, the column for a vertical one.
   */
  readonly cross: number;
}

/**
 * The unchanging half of a level.
 *
 * `vehicles[TARGET]` is always horizontal, two long, and parked in `EXIT_ROW` —
 * `isWellFormed` is what holds that true, and a good deal of the rest of the
 * game reads it as given.
 */
export interface Board {
  readonly vehicles: readonly Vehicle[];
}

/**
 * The moving half: each vehicle's offset along its own axis, parallel to
 * `board.vehicles`. For a horizontal vehicle this is the column of its left
 * cell; for a vertical one, the row of its top cell.
 */
export type Position = readonly number[];

/** Slide `id` so that its leading cell lands on `to`. */
export interface Move {
  readonly id: number;
  readonly to: number;
}

/** Nothing parked here. Kept off -1 so an occupancy grid can be a Uint8Array. */
export const EMPTY = 255;

/**
 * Which vehicle owns each cell, row-major, `SIZE * SIZE` entries.
 *
 * Reused by the solver on every one of its hundreds of thousands of expansions,
 * so it takes an optional buffer to fill rather than allocating each time.
 */
export function occupancy(board: Board, position: Position, into?: Uint8Array): Uint8Array {
  const grid = into ?? new Uint8Array(SIZE * SIZE);
  grid.fill(EMPTY);

  for (let id = 0; id < board.vehicles.length; id++) {
    const vehicle = board.vehicles[id] as Vehicle;
    const start = position[id] as number;
    for (let step = 0; step < vehicle.length; step++) {
      const row = vehicle.orientation === 'h' ? vehicle.cross : start + step;
      const column = vehicle.orientation === 'h' ? start + step : vehicle.cross;
      grid[row * SIZE + column] = id;
    }
  }

  return grid;
}

/** The cells `id` would cover if its leading cell were at `at`. */
export function cellsOf(board: Board, id: number, at: number): number[] {
  const vehicle = board.vehicles[id] as Vehicle;
  const cells: number[] = [];
  for (let step = 0; step < vehicle.length; step++) {
    const row = vehicle.orientation === 'h' ? vehicle.cross : at + step;
    const column = vehicle.orientation === 'h' ? at + step : vehicle.cross;
    cells.push(row * SIZE + column);
  }
  return cells;
}

/** Furthest offset a vehicle of this length can take without leaving the grid. */
export const maxOffset = (length: number): number => SIZE - length;

/**
 * The span `id` can slide through, inclusive, given everything else on the grid.
 *
 * Both ends are found by walking outwards from where the vehicle already is, so
 * the answer is a contiguous run and a vehicle can never jump another. Includes
 * the vehicle's current offset, which is not a move — `legalMoves` drops it.
 */
export function slideRange(
  board: Board,
  position: Position,
  id: number,
  grid: Uint8Array = occupancy(board, position),
): { from: number; to: number } {
  const vehicle = board.vehicles[id] as Vehicle;
  const at = position[id] as number;
  const step = vehicle.orientation === 'h' ? 1 : SIZE;
  const head = vehicle.orientation === 'h' ? vehicle.cross * SIZE + at : at * SIZE + vehicle.cross;

  let from = at;
  for (let cell = head - step; from > 0 && grid[cell] === EMPTY; cell -= step) from--;

  let to = at;
  const limit = maxOffset(vehicle.length);
  let tail = head + vehicle.length * step;
  for (; to < limit && grid[tail] === EMPTY; tail += step) to++;

  return { from, to };
}

/** Every slide available right now. One entry per reachable offset. */
export function legalMoves(board: Board, position: Position): Move[] {
  const grid = occupancy(board, position);
  const moves: Move[] = [];

  for (let id = 0; id < board.vehicles.length; id++) {
    const { from, to } = slideRange(board, position, id, grid);
    const at = position[id] as number;
    for (let offset = from; offset <= to; offset++) {
      if (offset !== at) moves.push({ id, to: offset });
    }
  }

  return moves;
}

export function isLegalMove(board: Board, position: Position, move: Move): boolean {
  if (move.id < 0 || move.id >= board.vehicles.length) return false;
  if (move.to === position[move.id]) return false;
  const { from, to } = slideRange(board, position, move.id);
  return move.to >= from && move.to <= to;
}

/** A new position with `move` applied. Does not check legality. */
export function applyMove(position: Position, move: Move): number[] {
  const next = position.slice();
  next[move.id] = move.to;
  return next;
}

/**
 * The target has reached the exit.
 *
 * Parking it against the right-hand wall *is* finishing: the last slide is the
 * one that drives it out, and counting a separate "leave" step would add a move
 * nobody gets to decide anything about.
 */
export function isSolved(board: Board, position: Position): boolean {
  // Read off the board rather than assuming TARGET_LENGTH, so a future variant
  // with a longer target car does not silently win one cell early.
  const target = board.vehicles[TARGET] as Vehicle;
  return (position[TARGET] as number) + target.length === SIZE;
}

/**
 * Cells between the target and the exit that something else is sitting in.
 *
 * Not a rule — the renderer uses it to draw the lane out, and the generator to
 * throw away a layout where the way out was never blocked in the first place.
 */
export function blockersAhead(board: Board, position: Position): number[] {
  const grid = occupancy(board, position);
  const blockers: number[] = [];
  const start = (position[TARGET] as number) + TARGET_LENGTH;

  for (let column = start; column < SIZE; column++) {
    const occupant = grid[EXIT_ROW * SIZE + column] as number;
    if (occupant !== EMPTY && !blockers.includes(occupant)) blockers.push(occupant);
  }

  return blockers;
}

/**
 * A compact key for one position, for the solver's visited set.
 *
 * One character per vehicle. Offsets are 0..4, so every code point is well
 * inside the BMP and the string is never a surrogate pair — which matters only
 * in that it keeps these keys cheap to hash.
 */
export function encode(position: Position): string {
  let key = '';
  for (let i = 0; i < position.length; i++) key += String.fromCharCode(position[i] as number);
  return key;
}

export function decode(key: string): number[] {
  const position: number[] = [];
  for (let i = 0; i < key.length; i++) position.push(key.charCodeAt(i));
  return position;
}

/**
 * Structural sanity for the unchanging half of a level.
 *
 * Cheap enough to assert in the generator and in the tests, and it catches the
 * whole class of "the board arrived half-built" bug before it reaches a
 * renderer that would silently draw nothing.
 */
export function isWellFormed(board: Board): boolean {
  const { vehicles } = board;
  if (vehicles.length < 2 || vehicles.length > SIZE * SIZE) return false;

  const target = vehicles[TARGET];
  if (!target) return false;
  if (target.orientation !== 'h' || target.length !== TARGET_LENGTH) return false;
  if (target.cross !== EXIT_ROW) return false;

  return vehicles.every((vehicle) => {
    if (vehicle.length < 2 || vehicle.length > 4) return false;
    if (!Number.isInteger(vehicle.cross)) return false;
    return vehicle.cross >= 0 && vehicle.cross < SIZE;
  });
}

/** Every vehicle on the grid, in bounds, and no two sharing a cell. */
export function isValidPosition(board: Board, position: Position): boolean {
  if (position.length !== board.vehicles.length) return false;

  const seen = new Uint8Array(SIZE * SIZE);
  for (let id = 0; id < board.vehicles.length; id++) {
    const vehicle = board.vehicles[id] as Vehicle;
    const at = position[id] as number;
    if (!Number.isInteger(at) || at < 0 || at > maxOffset(vehicle.length)) return false;
    for (const cell of cellsOf(board, id, at)) {
      if (seen[cell]) return false;
      seen[cell] = 1;
    }
  }

  return true;
}

/**
 * A move as a single small integer, for the save file.
 *
 * Saves store a move list rather than a board — the board replays from
 * (profileSeed, level) — so this is the whole on-disk representation of a level
 * in progress. `id * SIZE + to` fits every legal move in one byte, which keeps
 * a fifty-slide level well inside the budget that makes the paste-a-code backup
 * in Settings practical.
 */
export const packMove = (move: Move): number => move.id * SIZE + move.to;

export const unpackMove = (packed: number): Move => ({
  id: Math.floor(packed / SIZE),
  to: packed % SIZE,
});
