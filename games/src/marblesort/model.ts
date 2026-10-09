/**
 * Marble Sort rules. Pure: no DOM, no randomness, no clock.
 *
 * Pipes at the top hold marbles of one colour each. A tap drops a handful into
 * a funnel, which feeds a looping belt one marble at a time whenever the slot
 * under its spout is empty. The belt carries them across the top of some
 * columns of blocks; a block takes marbles of its colour until it is full, then
 * clears and the one under it rises. Only the top block of a column is open.
 *
 * **It runs in real time, and it is still a pure function of its inputs.** The
 * belt advances one slot per tick, and a tick is integer arithmetic on a few
 * small arrays — no physics, no floats, no wall-clock time. A level plus a list
 * of (tick, pipe) taps therefore reproduces the board exactly, which is what
 * keeps every house rule that depends on replay: the save is a move list, undo
 * rewinds to the tick before the last tap, and a bug report is a level number
 * and a list of numbers. The renderer interpolates between ticks with CSS; it
 * decides nothing.
 *
 * **The belt never stops, but it does settle.** Once the funnel is empty and no
 * marble on the belt matches an open block, ticks only carry the same marbles
 * round — nothing lands, nothing enters. That is a *settled* position, and it
 * is what lets the solver treat the game as turns: "tap a pipe and wait until
 * it settles" is always open to the player. The belt carries on turning while
 * she decides, so she taps at whatever point in its rotation she happens to,
 * and the generator checks that this never changes the outcome — see
 * `isTimingProof` in `generate.ts`.
 *
 * Belt slots run counter-clockwise on screen, the way the original's chevrons
 * point:
 *
 *        B+K+B-1  …  B+K        <- top straight, right to left
 *   left curve                 right curve
 *          0  1  …  B-1         <- bottom straight, over the columns
 *
 * A marble on cell `j` of `cells` sits at slot `(j + offset) % length`. The
 * whole belt advances by bumping `offset`, so a marble keeps its cell for as
 * long as it rides — which is also how the renderer keeps one element per
 * marble and lets a transition carry it from slot to slot.
 */

/** Slots in each of the belt's two end curves. Fixed; the straights vary. */
export const CURVE_SLOTS = 4;

export interface Level {
  colors: number;
  /** Block colours per column, index 0 at the top. */
  columns: number[][];
  /** Marbles one block takes before it clears. */
  blockSize: number;
  /** Marbles a tap drops, or what is left in the pipe if fewer. */
  dropSize: number;
  /** Slots along each straight of the belt. Its capacity is `2B + 2K`. */
  straightSlots: number;
  /**
   * Rows of blocks shown in colour, counting the top one. Deeper blocks show as
   * `?`. Presentation only — the rules and the solver see every colour.
   */
  visibleRows: number;
}

export interface Geometry {
  /** Total slots; also the most marbles the belt can carry. */
  length: number;
  /** The slot under the funnel's spout. */
  entry: number;
  /** The slot over each column, where its marbles drop in. */
  drops: number[];
}

export function geometryFor(level: Level): Geometry {
  const straight = level.straightSlots;
  const length = 2 * straight + 2 * CURVE_SLOTS;
  const columns = level.columns.length;
  const drops = level.columns.map((_, c) => Math.floor(((c + 0.5) * straight) / columns));
  // The spout sits over the left third of the top straight, so a marble rides a
  // short way left, rounds the curve and reaches the first column quickly. The
  // top straight is numbered right to left, so x position `ex` is slot
  // `B + K + (B - 1 - ex)`.
  const ex = Math.floor(straight * 0.3);
  const entry = straight + CURVE_SLOTS + (straight - 1 - ex);
  return { length, entry, drops };
}

/** Marbles of each colour the level holds — what the pipes start with. */
export function pipeCounts(level: Level): number[] {
  const counts = new Array<number>(level.colors).fill(0);
  for (const column of level.columns) {
    for (const color of column) counts[color] = (counts[color] as number) + level.blockSize;
  }
  return counts;
}

export interface Sim {
  tick: number;
  offset: number;
  /** Colour on each belt cell, -1 where empty. See the file comment. */
  cells: number[];
  /** Marbles on the belt, per colour. Kept so "can anything land" is cheap. */
  onBelt: number[];
  beltCount: number;
  /** Colours waiting in the funnel, next to drop first. */
  funnel: number[];
  /** Marbles left in each pipe. */
  remaining: number[];
  /** Per column, the index of its top block — `length` once it has cleared. */
  depth: number[];
  /** Per column, marbles already in the top block. */
  fill: number[];
}

/**
 * 'moving': something will still land or enter. 'settled': the belt is only
 * carrying marbles round; it keeps turning, but nothing changes until a tap.
 */
export type Status = 'moving' | 'settled' | 'won' | 'lost';

export const isOver = (status: Status): boolean => status === 'won' || status === 'lost';

export function createSim(level: Level): Sim {
  const { length } = geometryFor(level);
  return {
    tick: 0,
    offset: 0,
    cells: new Array<number>(length).fill(-1),
    onBelt: new Array<number>(level.colors).fill(0),
    beltCount: 0,
    funnel: [],
    remaining: pipeCounts(level),
    depth: level.columns.map(() => 0),
    fill: level.columns.map(() => 0),
  };
}

export function cloneSim(sim: Sim): Sim {
  return {
    tick: sim.tick,
    offset: sim.offset,
    cells: sim.cells.slice(),
    onBelt: sim.onBelt.slice(),
    beltCount: sim.beltCount,
    funnel: sim.funnel.slice(),
    remaining: sim.remaining.slice(),
    depth: sim.depth.slice(),
    fill: sim.fill.slice(),
  };
}

/** The cell currently under `slot`. */
export function cellAt(sim: Sim, slot: number, length: number): number {
  return (((slot - sim.offset) % length) + length) % length;
}

/** The slot cell `cell` is currently at. */
export function slotOf(sim: Sim, cell: number, length: number): number {
  return (cell + sim.offset) % length;
}

/** Colour of a column's open block, or -1 once the column has cleared. */
export function topColor(level: Level, sim: Sim, column: number): number {
  const blocks = level.columns[column] as number[];
  const depth = sim.depth[column] as number;
  return depth < blocks.length ? (blocks[depth] as number) : -1;
}

/** True if some marble on the belt matches some open block. */
export function anythingCanLand(level: Level, sim: Sim): boolean {
  for (let c = 0; c < level.columns.length; c++) {
    const color = topColor(level, sim, c);
    if (color >= 0 && (sim.onBelt[color] as number) > 0) return true;
  }
  return false;
}

export function statusOf(level: Level, sim: Sim, geometry: Geometry): Status {
  const canLand = anythingCanLand(level, sim);
  if (sim.beltCount >= geometry.length && !canLand) return 'lost';
  if (sim.funnel.length > 0 || canLand) return 'moving';
  if (sim.beltCount === 0 && sim.remaining.every((n) => n === 0)) return 'won';
  return 'settled';
}

/** Can this pipe be tapped? Allowed while the belt moves, as in the original. */
export function canTap(sim: Sim, color: number): boolean {
  return (sim.remaining[color] ?? 0) > 0;
}

/** Drops a handful from a pipe into the funnel. Returns how many fell. */
export function tap(level: Level, sim: Sim, color: number): number {
  const left = sim.remaining[color] ?? 0;
  const count = Math.min(level.dropSize, left);
  if (count <= 0) return 0;
  sim.remaining[color] = left - count;
  for (let i = 0; i < count; i++) sim.funnel.push(color);
  return count;
}

/** Something that happened in a tick, for the renderer to animate. */
export interface Landing {
  cell: number;
  column: number;
  /** Index of the block it went into. */
  block: number;
  /** Which of that block's holes it filled, 0-based. */
  hole: number;
  color: number;
}

export interface TickEvents {
  landed: Landing[];
  /** Columns whose top block filled and cleared this tick. */
  cleared: number[];
  /** The cell a marble from the funnel dropped onto, or -1. */
  entered: number;
}

/**
 * One tick, in place: the belt advances a slot, every column takes the marble
 * over it if it matches, then the funnel drops one onto the spout slot if that
 * slot is free. Mutates `sim` — callers that need the old state clone first.
 */
export function step(level: Level, sim: Sim, geometry: Geometry, events?: TickEvents): void {
  const { length, drops, entry } = geometry;
  sim.tick++;
  sim.offset = (sim.offset + 1) % length;

  for (let c = 0; c < drops.length; c++) {
    const cell = cellAt(sim, drops[c] as number, length);
    const color = sim.cells[cell] as number;
    if (color < 0 || color !== topColor(level, sim, c)) continue;

    sim.cells[cell] = -1;
    sim.onBelt[color] = (sim.onBelt[color] as number) - 1;
    sim.beltCount--;
    const hole = sim.fill[c] as number;
    events?.landed.push({ cell, column: c, block: sim.depth[c] as number, hole, color });

    if (hole + 1 >= level.blockSize) {
      sim.depth[c] = (sim.depth[c] as number) + 1;
      sim.fill[c] = 0;
      events?.cleared.push(c);
    } else {
      sim.fill[c] = hole + 1;
    }
  }

  if (sim.funnel.length > 0) {
    const cell = cellAt(sim, entry, length);
    if (sim.cells[cell] === -1) {
      const color = sim.funnel.shift() as number;
      sim.cells[cell] = color;
      sim.onBelt[color] = (sim.onBelt[color] as number) + 1;
      sim.beltCount++;
      if (events) events.entered = cell;
    }
  }
}

export function emptyEvents(): TickEvents {
  return { landed: [], cleared: [], entered: -1 };
}

/**
 * Hard ceiling on ticks for one settle. Every tick that changes anything either
 * lands a marble or feeds one, and a marble that can land does so within one
 * lap — so a settle is bounded by laps times marbles. This only exists so a
 * logic bug shows up as a thrown error rather than a frozen worker.
 */
function settleLimit(level: Level, sim: Sim, geometry: Geometry): number {
  const marbles = sim.beltCount + sim.funnel.length + 1;
  return (marbles + level.columns.length) * (geometry.length + 1) * 2;
}

/** Runs ticks until the belt settles, the level is won, or it is lost. */
export function settle(level: Level, sim: Sim, geometry: Geometry): Status {
  const limit = settleLimit(level, sim, geometry);
  for (let i = 0; i < limit; i++) {
    const status = statusOf(level, sim, geometry);
    if (status !== 'moving') return status;
    step(level, sim, geometry);
  }
  throw new Error('Marble Sort belt failed to settle');
}

/* ------------------------------------------------------------------ moves */

/**
 * A move is a tap at a tick, packed into one integer so the save stays a plain
 * `number[]` like every other game's. Pipes are at most eight.
 */
export const encodeMove = (tick: number, color: number): number => tick * 8 + color;
export const moveTick = (move: number): number => Math.floor(move / 8);
export const moveColor = (move: number): number => move % 8;

/**
 * Replays a move list from the start. Stops at the first move that does not
 * apply — a tick earlier than the one before it, a tick after the level ended,
 * an empty pipe — and reports how
 * many did, so a corrupt tail costs the tail and not the level.
 */
export function replay(
  level: Level,
  moves: readonly number[],
  geometry: Geometry = geometryFor(level),
): { sim: Sim; applied: number } {
  const sim = createSim(level);
  let applied = 0;
  for (const move of moves) {
    const tick = moveTick(move);
    const color = moveColor(move);
    // A day of continuous play is under a million ticks. Anything past that is
    // a corrupt save, and stepping to it would hang the page.
    if (tick - sim.tick > MAX_IDLE_TICKS) break;
    while (sim.tick < tick && !isOver(statusOf(level, sim, geometry))) {
      step(level, sim, geometry);
    }
    if (sim.tick !== tick || !canTap(sim, color)) break;
    if (isOver(statusOf(level, sim, geometry))) break;
    tap(level, sim, color);
    applied++;
  }
  return { sim, applied };
}

const MAX_IDLE_TICKS = 1_000_000;

/** Marbles still to be placed: in pipes, in the funnel, or on the belt. */
export function marblesLeft(sim: Sim): number {
  return sim.remaining.reduce((a, b) => a + b, 0) + sim.funnel.length + sim.beltCount;
}

/** Every block has a colour in range and every colour is a whole number of blocks. */
export function isWellFormed(level: Level): boolean {
  if (level.columns.length === 0 || level.blockSize < 1 || level.dropSize < 1) return false;
  if (level.colors < 1 || level.colors > 8) return false;
  if (level.straightSlots < level.columns.length) return false;
  for (const column of level.columns) {
    if (column.length === 0) return false;
    for (const color of column) if (color < 0 || color >= level.colors) return false;
  }
  return pipeCounts(level).every((n) => n > 0);
}
