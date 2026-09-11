/**
 * Sudoku rules. Pure — no DOM, no randomness, no solver.
 *
 * A grid is 81 digits in row-major order, 0 for empty. That is deliberately the
 * dullest representation available: it packs into a save, compares with a plain
 * loop, and is what both the exact solver and the logical one already want.
 *
 * The one piece of structure worth keeping alongside it is a **candidate set
 * per cell as a bitmask** — bit `d - 1` set means digit `d` is still possible.
 * Every technique in `solve.ts` is a statement about those masks, and doing the
 * peer arithmetic with integers rather than Sets is the difference between a
 * generator that takes a second and one that takes a minute.
 */

/** Cells along one side. Nine, forever — this is not a size-varying game. */
export const SIZE = 9;
export const BOX = 3;
export const CELLS = SIZE * SIZE;

/** All nine digits, as a candidate mask. */
export const ALL = 0b111111111;

export type Grid = number[];

/**
 * A move is one keypad press, packed into a single integer for the save.
 *
 * Both kinds of entry live in the same list because both have to be undoable in
 * the order they were made: a player who pencils four notes, writes a digit and
 * then changes their mind expects each tap to come back off in turn.
 */
export interface Move {
  cell: number;
  /** 1-9, or 0 to clear the cell (never valid for a pencil mark). */
  value: number;
  /** A note rather than an answer. Toggles rather than replaces. */
  pencil: boolean;
}

export function packMove(move: Move): number {
  return (move.cell << 5) | (move.value << 1) | (move.pencil ? 1 : 0);
}

export function unpackMove(packed: number): Move {
  return {
    cell: (packed >> 5) & 0x7f,
    value: (packed >> 1) & 0xf,
    pencil: (packed & 1) === 1,
  };
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

export const rowOf = (cell: number): number => Math.floor(cell / SIZE);
export const colOf = (cell: number): number => cell % SIZE;
export const boxOf = (cell: number): number =>
  Math.floor(rowOf(cell) / BOX) * BOX + Math.floor(colOf(cell) / BOX);

/**
 * The twenty cells that can never share a digit with this one.
 *
 * Built once at module load. Peer lookup is the innermost operation in both
 * solvers — a generator run does it a few hundred thousand times — and
 * recomputing the arithmetic there was measurably the slowest thing in the file.
 */
export const PEERS: readonly (readonly number[])[] = buildPeers();

/** The 27 units: nine rows, nine columns, nine boxes, in that order. */
export const UNITS: readonly (readonly number[])[] = buildUnits();

/** Which of the 27 units each cell belongs to. Always three. */
export const UNITS_OF: readonly (readonly number[])[] = buildUnitsOf();

function buildUnits(): number[][] {
  const units: number[][] = [];
  for (let row = 0; row < SIZE; row++) {
    units.push(Array.from({ length: SIZE }, (_, col) => row * SIZE + col));
  }
  for (let col = 0; col < SIZE; col++) {
    units.push(Array.from({ length: SIZE }, (_, row) => row * SIZE + col));
  }
  for (let box = 0; box < SIZE; box++) {
    const top = Math.floor(box / BOX) * BOX;
    const left = (box % BOX) * BOX;
    const cells: number[] = [];
    for (let r = 0; r < BOX; r++) {
      for (let c = 0; c < BOX; c++) cells.push((top + r) * SIZE + left + c);
    }
    units.push(cells);
  }
  return units;
}

function buildPeers(): number[][] {
  const units = buildUnits();
  return Array.from({ length: CELLS }, (_, cell) => {
    const peers = new Set<number>();
    for (const unit of units) {
      if (!unit.includes(cell)) continue;
      for (const other of unit) if (other !== cell) peers.add(other);
    }
    return [...peers];
  });
}

function buildUnitsOf(): number[][] {
  const units = buildUnits();
  return Array.from({ length: CELLS }, (_, cell) =>
    units.map((_unit, index) => index).filter((index) => (units[index] as number[]).includes(cell)),
  );
}

/* ------------------------------------------------------------------ */
/* Candidates                                                          */
/* ------------------------------------------------------------------ */

export const bit = (digit: number): number => 1 << (digit - 1);

/** How many digits a mask allows. */
export function popcount(mask: number): number {
  let count = 0;
  let bits = mask;
  while (bits) {
    bits &= bits - 1;
    count++;
  }
  return count;
}

/** The digits a mask allows, ascending. */
export function digitsOf(mask: number): number[] {
  const digits: number[] = [];
  for (let digit = 1; digit <= SIZE; digit++) if (mask & bit(digit)) digits.push(digit);
  return digits;
}

/** The single digit a one-bit mask allows, or 0. */
export function loneDigit(mask: number): number {
  if (mask === 0 || (mask & (mask - 1)) !== 0) return 0;
  return Math.log2(mask) + 1;
}

/**
 * Candidate masks for every cell of a grid.
 *
 * A filled cell gets mask 0 — it has no candidates left, it has an answer. Every
 * technique therefore reads "mask is non-zero" as "still open", with no second
 * check against the grid.
 */
export function candidates(grid: Grid): number[] {
  const masks = new Array<number>(CELLS).fill(0);
  for (let cell = 0; cell < CELLS; cell++) {
    if (grid[cell]) continue;
    let mask = ALL;
    for (const peer of PEERS[cell] as readonly number[]) {
      const value = grid[peer] as number;
      if (value) mask &= ~bit(value);
    }
    masks[cell] = mask;
  }
  return masks;
}

/* ------------------------------------------------------------------ */
/* Validity                                                            */
/* ------------------------------------------------------------------ */

/** True if placing `digit` in `cell` breaks no rule. Ignores what is there now. */
export function isPlaceable(grid: Grid, cell: number, digit: number): boolean {
  for (const peer of PEERS[cell] as readonly number[]) {
    if (grid[peer] === digit) return false;
  }
  return true;
}

/**
 * Every cell holding a digit that repeats inside one of its units.
 *
 * Shown in red on the board. Not an error the game refuses — a wrong digit is
 * information, and refusing it would turn the board into a lie detector — but
 * one it marks, because a contradiction noticed twenty moves later costs the
 * whole grid.
 */
export function conflicts(grid: Grid): Set<number> {
  const bad = new Set<number>();
  for (const unit of UNITS) {
    const seen = new Map<number, number[]>();
    for (const cell of unit) {
      const value = grid[cell] as number;
      if (!value) continue;
      const existing = seen.get(value);
      if (existing) existing.push(cell);
      else seen.set(value, [cell]);
    }
    for (const [, cells] of seen) {
      if (cells.length > 1) for (const cell of cells) bad.add(cell);
    }
  }
  return bad;
}

export function isComplete(grid: Grid): boolean {
  for (let cell = 0; cell < CELLS; cell++) if (!grid[cell]) return false;
  return true;
}

export function isSolved(grid: Grid): boolean {
  return isComplete(grid) && conflicts(grid).size === 0;
}

/* ------------------------------------------------------------------ */
/* Applying moves                                                      */
/* ------------------------------------------------------------------ */

/** One player's working state: what they have written, and what they have noted. */
export interface Sheet {
  /** The givens plus everything entered. Index 0-80, value 0-9. */
  grid: Grid;
  /** Pencil-mark masks per cell. Empty on a filled or given cell. */
  notes: number[];
}

export function emptySheet(givens: Grid): Sheet {
  return { grid: givens.slice(), notes: new Array<number>(CELLS).fill(0) };
}

/**
 * Applies one keypad press. Returns a new sheet; never mutates the old one.
 *
 * Two behaviours here are rules rather than conveniences, and both exist because
 * of how this is actually played on a phone:
 *
 *  - **Writing a digit clears that digit's notes from every peer.** Doing it by
 *    hand is the tedious half of pencil marks, and a player who has to do it by
 *    hand stops using them.
 *  - **Writing a digit clears the cell's own notes.** They described a cell that
 *    is now answered; leaving them means an undo has to restore something the
 *    player cannot see.
 */
export function applyMove(sheet: Sheet, givens: Grid, move: Move): Sheet {
  const { cell, value, pencil } = move;
  if (givens[cell]) return sheet;

  const grid = sheet.grid.slice();
  const notes = sheet.notes.slice();

  if (pencil) {
    // A note on a cell that already holds an answer is meaningless, so the
    // answer goes first — which is what a player tapping a note there means.
    if (grid[cell]) grid[cell] = 0;
    notes[cell] = (notes[cell] as number) ^ bit(value);
    return { grid, notes };
  }

  if (value === 0) {
    grid[cell] = 0;
    notes[cell] = 0;
    return { grid, notes };
  }

  // Tapping the digit already in the cell takes it out again. On a phone this
  // is the only erase gesture anyone discovers on their own.
  if (grid[cell] === value) {
    grid[cell] = 0;
    return { grid, notes };
  }

  grid[cell] = value;
  notes[cell] = 0;
  for (const peer of PEERS[cell] as readonly number[]) {
    notes[peer] = (notes[peer] as number) & ~bit(value);
  }
  return { grid, notes };
}

/** Replays a move list from the givens. Used by undo and by save restore. */
export function replay(givens: Grid, moves: readonly Move[]): Sheet {
  let sheet = emptySheet(givens);
  for (const move of moves) sheet = applyMove(sheet, givens, move);
  return sheet;
}

/** How many non-given cells hold the right digit. The clock pays out on this. */
export function correctCount(grid: Grid, solution: Grid, givens: Grid): number {
  let count = 0;
  for (let cell = 0; cell < CELLS; cell++) {
    if (givens[cell]) continue;
    if (grid[cell] && grid[cell] === solution[cell]) count++;
  }
  return count;
}
