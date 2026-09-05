/**
 * Depot — the rules, and nothing else. No DOM, no randomness, no timers.
 *
 * Two halves, and the puzzle lives where they meet:
 *
 *   the lot   — buses are parked bumper to bumper, each one facing one way.
 *               Tapping a bus drives it straight out along its arrow, so it can
 *               only leave when every cell between its nose and the edge of the
 *               lot is empty. Which buses can leave depends on which have left.
 *   the kerb  — a bus that leaves pulls into one of the loading bays, and bays
 *               are the scarce thing. Passengers arrive in a fixed queue and
 *               board from the front; a passenger boards only a bus of their
 *               own colour. Fill a bus and it drives off, freeing its bay.
 *
 * You lose when every bay is full and the person at the front of the queue
 * matches none of the buses in them. Nothing can move, and nothing will.
 *
 * **This is Bus Jam turned inside out.** There the crowd was the board and the
 * buses arrived on a fixed queue; here the buses are the board and the crowd
 * arrives on a fixed queue. The scarce holding area moved with it: a bench that
 * held people, a kerb that holds buses.
 *
 * ## The lot can never deadlock, and that is by construction
 *
 * `generate.ts` builds the lot by parking buses one at a time, each into a spot
 * that still has a clear drive-out in the grid as it stands. So if placement
 * order was p1..pn, then pn can always leave, then p(n-1), and so on.
 *
 * That property survives the player pulling buses out in any order at all.
 * Taking a bus off the grid never blocks another one, so for any set R of buses
 * still parked, the latest-placed member of R had a clear path against a
 * superset of what is now in its way — and therefore still has one. **At least
 * one bus is always drivable while any bus remains.**
 *
 * Which is why losing here is only ever a colour problem: `isLost` reduces to
 * "no bay is free and nobody at the front of the queue can board". The solver
 * gets to ignore the geometry entirely, exactly as Bus Jam's does.
 */

/** Nothing parked here. Kept off -1 so the occupancy grid can be a Uint8Array. */
export const EMPTY = 255;

/** Which way a bus drives when it is tapped. Always along its own long axis. */
export type Facing = 'up' | 'down' | 'left' | 'right';

export const isVertical = (facing: Facing): boolean => facing === 'up' || facing === 'down';

export interface Bus {
  /** Column of the bus's left-most cell. */
  readonly x: number;
  /** Row of the bus's top-most cell. */
  readonly y: number;
  /** Cells along its own axis. Two or three. */
  readonly length: number;
  readonly facing: Facing;
  readonly color: number;
  /** Passengers it takes before it is full and drives off. */
  readonly capacity: number;
  /**
   * The colour is not shown until the bus is out of the lot.
   *
   * The model still knows it — hiding it from the *solver* would make the
   * level unverifiable — so this flag is read by exactly two places: the
   * renderer, which draws a `?`, and the difficulty rollouts, which have to
   * model a player who cannot see it. See `generate.ts`.
   */
  readonly unknown: boolean;
}

export interface Board {
  readonly width: number;
  readonly height: number;
  readonly buses: readonly Bus[];
  /** Colours in play, so the renderer and the tests need not scan for them. */
  readonly colors: number;
  /** Loading bays on the kerb. The scarce resource, and the whole difficulty. */
  readonly bays: number;
}

export interface Level {
  readonly board: Board;
  /** Passenger colours, index 0 at the front of the line. */
  readonly queue: readonly number[];
}

/** A bus that has pulled into a bay and is taking passengers. */
export interface Loading {
  readonly id: number;
  readonly color: number;
  readonly capacity: number;
  readonly loaded: number;
}

export interface GameStateCore {
  /** Which buses are still parked in the lot, by id. */
  parked: boolean[];
  /** One slot per bay; null is free. */
  bays: (Loading | null)[];
  /** How far down the queue boarding has reached. */
  boarded: number;
  /** Buses that filled up and drove off. */
  departed: number;
}

/* ------------------------------------------------------------------ cells */

export const cellIndex = (board: Board, x: number, y: number): number => y * board.width + x;

/** The cells a bus covers. */
export function cellsOf(board: Board, bus: Bus): number[] {
  const cells: number[] = [];
  const vertical = isVertical(bus.facing);
  for (let step = 0; step < bus.length; step++) {
    const x = vertical ? bus.x : bus.x + step;
    const y = vertical ? bus.y + step : bus.y;
    cells.push(cellIndex(board, x, y));
  }
  return cells;
}

/**
 * Which bus owns each cell, row-major.
 *
 * The solver walks hundreds of thousands of these, so it takes an optional
 * buffer to refill rather than allocating one per expansion.
 */
export function occupancy(
  board: Board,
  parked: readonly boolean[],
  into?: Uint8Array,
): Uint8Array {
  const grid = into ?? new Uint8Array(board.width * board.height);
  grid.fill(EMPTY);
  for (let id = 0; id < board.buses.length; id++) {
    if (!parked[id]) continue;
    for (const cell of cellsOf(board, board.buses[id] as Bus)) grid[cell] = id;
  }
  return grid;
}

/**
 * The lane a bus would drive through on its way out, nose cell first.
 *
 * Everything in it has to be empty for the bus to go. Used by the rules, by the
 * generator when it parks a bus, and by the renderer to draw the way out.
 */
export function exitLane(board: Board, bus: Bus): number[] {
  const lane: number[] = [];
  const stepX = bus.facing === 'left' ? -1 : bus.facing === 'right' ? 1 : 0;
  const stepY = bus.facing === 'up' ? -1 : bus.facing === 'down' ? 1 : 0;

  // The nose: the cell just beyond the bus's leading end.
  let x = bus.x + (bus.facing === 'right' ? bus.length : 0) + (stepX < 0 ? -1 : 0);
  let y = bus.y + (bus.facing === 'down' ? bus.length : 0) + (stepY < 0 ? -1 : 0);

  while (x >= 0 && y >= 0 && x < board.width && y < board.height) {
    lane.push(cellIndex(board, x, y));
    x += stepX;
    y += stepY;
  }
  return lane;
}

/** True when nothing stands between this bus and the edge of the lot. */
export function laneIsClear(board: Board, grid: Uint8Array, bus: Bus): boolean {
  for (const cell of exitLane(board, bus)) {
    if (grid[cell] !== EMPTY) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ state */

export function createState(board: Board): GameStateCore {
  return {
    parked: board.buses.map(() => true),
    bays: new Array<Loading | null>(board.bays).fill(null),
    boarded: 0,
    departed: 0,
  };
}

export function cloneState(state: GameStateCore): GameStateCore {
  return {
    parked: state.parked.slice(),
    bays: state.bays.map((bay) => (bay ? { ...bay } : null)),
    boarded: state.boarded,
    departed: state.departed,
  };
}

/**
 * Which bay a passenger of this colour walks to.
 *
 * **Smallest remaining need first**, because that is never the wrong answer.
 * Every passenger of a colour must eventually board a bus of that colour — the
 * generator makes the two totals equal — so the only thing this choice changes
 * is *when* a bay frees up, and sooner is always at least as good. Handing the
 * decision to the player would therefore be a tap with no thought behind it.
 *
 * It also has to be canonical: the solver's transposition key treats two bays
 * holding the same (colour, capacity, loaded) as interchangeable, which is only
 * true if nothing downstream can tell them apart by bay number.
 */
function bayFor(bays: readonly (Loading | null)[], color: number): number {
  let best = -1;
  let bestNeed = Number.POSITIVE_INFINITY;
  for (let i = 0; i < bays.length; i++) {
    const bay = bays[i];
    if (!bay || bay.color !== color) continue;
    const need = bay.capacity - bay.loaded;
    if (need > 0 && need < bestNeed) {
      bestNeed = need;
      best = i;
    }
  }
  return best;
}

/**
 * Walks the front of the queue onto whatever is waiting, until it cannot.
 *
 * Mutates `state`. Runs to exhaustion after every pull, so a position handed to
 * the player, the solver or the renderer never has a passenger standing in
 * front of a bus that would take them.
 */
export function boardWaiting(level: Level, state: GameStateCore): number {
  let boarded = 0;

  for (;;) {
    if (state.boarded >= level.queue.length) return boarded;
    const color = level.queue[state.boarded] as number;
    const index = bayFor(state.bays, color);
    if (index === -1) return boarded;

    const bay = state.bays[index] as Loading;
    const loaded = bay.loaded + 1;
    state.boarded++;
    boarded++;

    if (loaded >= bay.capacity) {
      state.bays[index] = null;
      state.departed++;
    } else {
      state.bays[index] = { ...bay, loaded };
    }
  }
}

export const freeBay = (state: GameStateCore): number => state.bays.indexOf(null);

/** Buses that could be tapped right now: drivable, with a bay to pull into. */
export function drivableIds(board: Board, state: GameStateCore): number[] {
  if (freeBay(state) === -1) return [];
  const grid = occupancy(board, state.parked);
  const ids: number[] = [];
  for (let id = 0; id < board.buses.length; id++) {
    if (state.parked[id] && laneIsClear(board, grid, board.buses[id] as Bus)) ids.push(id);
  }
  return ids;
}

/** True when this bus's lane is clear, ignoring whether a bay is free. */
export function canDriveOut(board: Board, state: GameStateCore, id: number): boolean {
  if (!state.parked[id]) return false;
  const grid = occupancy(board, state.parked);
  return laneIsClear(board, grid, board.buses[id] as Bus);
}

export type PullResult = 'ok' | 'blocked' | 'no-bay' | 'gone';

/**
 * Drives a bus out of the lot and into a bay, then loads whoever can board.
 *
 * Mutates `state`, and only when the answer is 'ok' — a refused tap must leave
 * the position exactly as it found it, because the renderer buzzes and redraws
 * from that same state.
 */
export function pull(level: Level, state: GameStateCore, id: number): PullResult {
  const { board } = level;
  const bus = board.buses[id];
  if (!bus || !state.parked[id]) return 'gone';

  const slot = freeBay(state);
  if (slot === -1) return 'no-bay';

  const grid = occupancy(board, state.parked);
  if (!laneIsClear(board, grid, bus)) return 'blocked';

  state.parked[id] = false;
  state.bays[slot] = { id, color: bus.color, capacity: bus.capacity, loaded: 0 };
  boardWaiting(level, state);
  return 'ok';
}

/**
 * The whole queue has boarded.
 *
 * Because total capacity equals total passengers (see `isWellFormed`), this
 * also means every bus has driven off and the lot is empty — there is no
 * separate condition to check, and no way to win with a bus left behind.
 */
export const isWon = (level: Level, state: GameStateCore): boolean =>
  state.boarded >= level.queue.length;

/**
 * Nothing can move and the queue is not finished.
 *
 * The lot half cannot cause this — see the header — so in practice it always
 * means the bays are full of colours the front of the queue does not want.
 */
export function isLost(level: Level, state: GameStateCore): boolean {
  if (isWon(level, state)) return false;
  return drivableIds(level.board, state).length === 0;
}

/* ------------------------------------------------------------ well-formed */

/** Every bus on the grid, in bounds, no two sharing a cell. */
export function busesFit(board: Board): boolean {
  const seen = new Uint8Array(board.width * board.height);
  for (const bus of board.buses) {
    if (bus.length < 2 || bus.length > 3) return false;
    if (bus.capacity < 1) return false;
    if (bus.color < 0 || bus.color >= board.colors) return false;

    const vertical = isVertical(bus.facing);
    const right = bus.x + (vertical ? 1 : bus.length);
    const bottom = bus.y + (vertical ? bus.length : 1);
    if (bus.x < 0 || bus.y < 0 || right > board.width || bottom > board.height) return false;

    for (const cell of cellsOf(board, bus)) {
      if (seen[cell]) return false;
      seen[cell] = 1;
    }
  }
  return true;
}

/**
 * Structural sanity for a whole level.
 *
 * The load-bearing clause is the last one: **every colour's seats must exactly
 * equal that colour's passengers.** Too few seats and the queue can never
 * drain; too many and a bus sits in a bay forever waiting for a passenger who
 * does not exist, which quietly costs a bay for the rest of the level. Both
 * failures look like a bug in the solver rather than a bug in the deal, so it
 * is asserted here and swept over in the tests.
 */
export function isWellFormed(level: Level): boolean {
  const { board, queue } = level;
  if (board.width < 2 || board.height < 2) return false;
  if (board.bays < 1 || board.buses.length === 0) return false;
  if (queue.length === 0) return false;
  if (!busesFit(board)) return false;

  const seats = new Array<number>(board.colors).fill(0);
  for (const bus of board.buses) seats[bus.color] = (seats[bus.color] as number) + bus.capacity;

  const people = new Array<number>(board.colors).fill(0);
  for (const color of queue) {
    if (color < 0 || color >= board.colors) return false;
    people[color] = (people[color] as number) + 1;
  }

  return seats.every((count, color) => count === people[color]);
}

/* -------------------------------------------------------------- save file */

/**
 * A move is just the bus that was tapped, so the packed form is the id itself.
 *
 * Saves store this list rather than a board: the lot replays from
 * (profileSeed, level), so the two can never drift apart, and a level in
 * progress costs one small integer per tap.
 */
export const packMove = (id: number): number => id;
export const unpackMove = (packed: number): number => packed;

/**
 * Compact identity of a position, for the solver's visited set.
 *
 * Bays are sorted rather than listed in slot order: `bayFor` cannot tell two
 * bays holding the same (colour, capacity, loaded) apart, so neither can
 * anything downstream of it, and treating them as distinct would double the
 * search for nothing. `boarded` follows from the rest and is left out.
 */
export function stateKey(state: GameStateCore): string {
  let parked = '';
  for (let i = 0; i < state.parked.length; i++) parked += state.parked[i] ? '1' : '0';
  const bays = state.bays
    .map((bay) => (bay ? `${bay.color}.${bay.capacity}.${bay.loaded}` : '-'))
    .sort()
    .join(',');
  return `${parked}|${bays}`;
}
