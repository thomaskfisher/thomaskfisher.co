/**
 * Tetris's rules. Pure: no DOM, no timers, no `Math.random()`.
 *
 * **A real-time game, and the first one here.** Every other game in this
 * collection is turn-based, which is what lets them offer unlimited undo, a
 * hint, and a solver that proves the board in front of you can be finished.
 * None of those survive a falling piece: undo is a rewind of the clock, a hint
 * is the answer to a question the clock is asking, and there is no board to
 * verify because the board is whatever the player has built so far. What
 * replaces them is set out in `game.ts` — in short, Simon's bargain, where
 * nothing is lost *by* losing.
 *
 * What is kept, and what this file exists to guarantee:
 *
 *  - **Nothing is random.** The piece stream is a pure function of
 *    `(profileSeed, game)`, so a run is reproducible by number and a save is a
 *    position rather than a history.
 *  - **Everything is integers.** No floating point anywhere in the rules, so a
 *    saved game reopens byte-identical. See `snapshot.ts`.
 *  - **The rules are here and the clock is elsewhere.** This file says what a
 *    gravity step does, never when one happens. `clock.ts` owns the when.
 *
 * Rotation is SRS — the Super Rotation System every modern Tetris uses,
 * including the phone one this replaces. It is worth the kick tables: without
 * them a piece cannot be twisted into a gap it plainly fits, and the game feels
 * broken to anybody who has played the original.
 */

export const WELL_W = 10;
export const WELL_H = 20;

/**
 * Hidden rows above the well, where a piece spawns.
 *
 * Two, because SRS spawns a piece lying flat in the row above the playfield and
 * a kick can push it one higher. A piece that cannot spawn here is the loss
 * condition, and having the rows be real cells rather than a special case means
 * `canPlace` answers that question the same way it answers every other.
 */
export const SPAWN_H = 2;

/** Rows in the cell array: the well plus its spawn buffer. */
export const ROWS = WELL_H + SPAWN_H;

/** Piece types, in the order the bag deals them. */
export const I = 0;
export const O = 1;
export const T = 2;
export const S = 3;
export const Z = 4;
export const J = 5;
export const L = 6;
export const PIECE_COUNT = 7;

export const PIECE_NAMES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const;

/** An empty cell. Filled cells hold the piece type that locked there. */
export const EMPTY = -1;

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

/**
 * Each piece's spawn orientation, as cells in its own square bounding box.
 *
 * The box size is what makes plain 90-degree rotation agree with SRS: I turns
 * inside a 4x4, O inside a 2x2 (so it never moves at all), and the other five
 * inside a 3x3. Get the box wrong and the piece orbits its own centre, which
 * looks like a kick-table bug and is not one.
 */
interface Shape {
  box: number;
  cells: readonly (readonly [number, number])[];
  /** Column the box spawns at, so the piece arrives centred. */
  spawnX: number;
}

const SHAPES: readonly Shape[] = [
  { box: 4, spawnX: 3, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] }, // I
  { box: 2, spawnX: 4, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] }, // O
  { box: 3, spawnX: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] }, // T
  { box: 3, spawnX: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] }, // S
  { box: 3, spawnX: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] }, // Z
  { box: 3, spawnX: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] }, // J
  { box: 3, spawnX: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] }, // L
];

/**
 * Every piece in every orientation, precomputed.
 *
 * `CELLS[type][rot]` is four `[x, y]` offsets from the bounding box's top-left,
 * with y pointing down the screen. Rotation clockwise in an n-box is
 * `(x, y) -> (n - 1 - y, x)`, applied repeatedly.
 */
/** One orientation: four offsets from the bounding box's top-left. */
export type Cells = readonly (readonly [number, number])[];

export const CELLS: readonly (readonly Cells[])[] = SHAPES.map(
  (shape) => {
    const states: (readonly [number, number])[][] = [shape.cells.map((c) => [...c] as [number, number])];
    for (let rot = 1; rot < 4; rot++) {
      const previous = states[rot - 1]!;
      states.push(previous.map(([x, y]) => [shape.box - 1 - y, x] as [number, number]));
    }
    return states;
  },
);

export const spawnXOf = (type: number): number => SHAPES[type]!.spawnX;

/* ------------------------------------------------------------------ */
/* Kicks                                                               */
/* ------------------------------------------------------------------ */

/**
 * SRS wall kicks, keyed `from * 4 + to`.
 *
 * Published tables use y-up; these are stored as written and negated at the
 * point of use, so they can be checked against any reference without having to
 * hold a sign flip in your head. O has no table because O never moves.
 */
type Kick = readonly [number, number];

const KICKS_JLSTZ: Record<number, readonly Kick[]> = {
  [0 * 4 + 1]: [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  [1 * 4 + 0]: [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  [1 * 4 + 2]: [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  [2 * 4 + 1]: [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  [2 * 4 + 3]: [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  [3 * 4 + 2]: [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  [3 * 4 + 0]: [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  [0 * 4 + 3]: [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};

const KICKS_I: Record<number, readonly Kick[]> = {
  [0 * 4 + 1]: [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  [1 * 4 + 0]: [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  [1 * 4 + 2]: [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  [2 * 4 + 1]: [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  [2 * 4 + 3]: [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  [3 * 4 + 2]: [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  [3 * 4 + 0]: [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  [0 * 4 + 3]: [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

const NO_KICK: readonly Kick[] = [[0, 0]];

function kicksFor(type: number, from: number, to: number): readonly Kick[] {
  if (type === O) return NO_KICK;
  const table = type === I ? KICKS_I : KICKS_JLSTZ;
  return table[from * 4 + to] ?? NO_KICK;
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

export interface Piece {
  type: number;
  /** 0 spawn, 1 clockwise, 2 flipped, 3 anticlockwise. */
  rot: number;
  /** Bounding box's left column. */
  x: number;
  /** Bounding box's top row, counted from the top of the spawn buffer. */
  y: number;
}

/** The locked cells. Row-major, `ROWS * WELL_W`, `EMPTY` or a piece type. */
export type Well = Int8Array;

export const emptyWell = (): Well => new Int8Array(ROWS * WELL_W).fill(EMPTY);

/** Where a piece's four cells actually are, in well coordinates. */
export function cellsOf(piece: Piece): [number, number][] {
  const offsets = CELLS[piece.type]?.[piece.rot];
  if (!offsets) throw new Error(`No shape for piece ${piece.type} rot ${piece.rot}`);
  return offsets.map(([dx, dy]) => [piece.x + dx, piece.y + dy] as [number, number]);
}

/**
 * True if the piece can sit exactly where it claims to.
 *
 * Above the top of the buffer is legal — a kick may lift a piece briefly — so
 * only the sides, the floor and occupied cells refuse. The loss condition is
 * not "too high", it is a spawn that overlaps, which is checked at spawn.
 */
export function canPlace(well: Well, piece: Piece): boolean {
  for (const [x, y] of cellsOf(piece)) {
    if (x < 0 || x >= WELL_W || y >= ROWS) return false;
    if (y >= 0 && well[y * WELL_W + x] !== EMPTY) return false;
  }
  return true;
}

export const spawnPiece = (type: number): Piece => ({
  type,
  rot: 0,
  x: spawnXOf(type),
  y: 0,
});

/** The piece shifted, or null if that square is not free. */
export function moved(well: Well, piece: Piece, dx: number, dy: number): Piece | null {
  const next = { ...piece, x: piece.x + dx, y: piece.y + dy };
  return canPlace(well, next) ? next : null;
}

/**
 * The piece turned, trying each kick in order.
 *
 * `dir` is +1 clockwise, -1 anticlockwise. Returns null only when all five
 * offsets are blocked, which is what "this does not fit anywhere near here"
 * means — and is rare enough that refusing it silently is correct.
 */
export function rotated(well: Well, piece: Piece, dir: 1 | -1): Piece | null {
  const to = (piece.rot + dir + 4) % 4;
  for (const [dx, dy] of kicksFor(piece.type, piece.rot, to)) {
    // Published kick tables point y up; the well points y down.
    const next = { type: piece.type, rot: to, x: piece.x + dx, y: piece.y - dy };
    if (canPlace(well, next)) return next;
  }
  return null;
}

/** How far the piece would fall if nothing stopped it. Zero when it is resting. */
export function dropDistance(well: Well, piece: Piece): number {
  let distance = 0;
  while (canPlace(well, { ...piece, y: piece.y + distance + 1 })) distance++;
  return distance;
}

/** The piece at the bottom of its column — where the ghost is drawn. */
export const ghostOf = (well: Well, piece: Piece): Piece => ({
  ...piece,
  y: piece.y + dropDistance(well, piece),
});

export const isResting = (well: Well, piece: Piece): boolean =>
  !canPlace(well, { ...piece, y: piece.y + 1 });

/* ------------------------------------------------------------------ */
/* Locking and clearing                                                */
/* ------------------------------------------------------------------ */

export interface LockResult {
  well: Well;
  /** Row indices that were full, top to bottom, before they were removed. */
  cleared: number[];
  /**
   * The piece locked entirely inside the spawn buffer.
   *
   * This is the loss, and it is checked here rather than at the next spawn so
   * that the board a player is shown is the one that beat them. A piece that
   * came to rest without ever reaching the well is a well that is full.
   */
  toppedOut: boolean;
}

/**
 * Writes the piece into the well and takes out any full rows.
 *
 * Returns a new well rather than mutating: a lock is the one moment the board
 * changes under the player, and every caller here wants the before and after
 * (the renderer animates between them, the snapshot writes one of them).
 */
export function lock(well: Well, piece: Piece): LockResult {
  const next = Int8Array.from(well);
  let lowest = -1;
  for (const [x, y] of cellsOf(piece)) {
    if (y < 0) continue;
    next[y * WELL_W + x] = piece.type;
    if (y > lowest) lowest = y;
  }

  const cleared: number[] = [];
  for (let y = 0; y < ROWS; y++) {
    let full = true;
    for (let x = 0; x < WELL_W; x++) {
      if (next[y * WELL_W + x] === EMPTY) {
        full = false;
        break;
      }
    }
    if (full) cleared.push(y);
  }

  return { well: next, cleared, toppedOut: lowest < SPAWN_H };
}

/** The well with those rows removed and everything above them dropped down. */
export function collapse(well: Well, cleared: readonly number[]): Well {
  if (cleared.length === 0) return well;
  const gone = new Set(cleared);
  const next = new Int8Array(ROWS * WELL_W).fill(EMPTY);
  let write = ROWS - 1;
  for (let y = ROWS - 1; y >= 0; y--) {
    if (gone.has(y)) continue;
    for (let x = 0; x < WELL_W; x++) next[write * WELL_W + x] = well[y * WELL_W + x]!;
    write--;
  }
  return next;
}

/** The highest occupied row, or `ROWS` when the well is empty. */
export function stackTop(well: Well): number {
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < WELL_W; x++) {
      if (well[y * WELL_W + x] !== EMPTY) return y;
    }
  }
  return ROWS;
}

/* ------------------------------------------------------------------ */
/* Scoring and speed                                                   */
/* ------------------------------------------------------------------ */

/** The classic line values, multiplied by the level. Four at once is the prize. */
const LINE_SCORES = [0, 100, 300, 500, 800] as const;

export const lineScore = (lines: number, level: number): number =>
  (LINE_SCORES[Math.min(lines, 4)] ?? 0) * level;

export const SOFT_DROP_POINTS = 1;
export const HARD_DROP_POINTS = 2;

/** Ten lines a level, as the original does. */
export const levelOf = (lines: number): number => Math.floor(lines / 10) + 1;

/**
 * The floor on gravity, in milliseconds per row.
 *
 * The guideline curve keeps accelerating past twenty rows a second, which is a
 * fine number on a keyboard and unreachable with thumbs on glass. This is where
 * the speed ramp stops and the bag takes over as the difficulty — which is the
 * whole design of this game: see `bag.ts`. Reached at level 11, or 100 lines.
 */
export const GRAVITY_FLOOR_MS = 90;

/** Milliseconds a piece takes to fall one row, unassisted. */
export const gravityMs = (level: number): number =>
  Math.max(GRAVITY_FLOOR_MS, Math.round(1000 * Math.pow(0.78, Math.max(0, level - 1))));

/** Holding down. Fast, but never faster than a hard drop is worth. */
export const SOFT_DROP_MS = 45;

/**
 * How long a resting piece waits before it locks.
 *
 * Half a second is the guideline figure and it is what makes a last-moment
 * slide under an overhang possible. `LOCK_RESETS` caps how many times moving or
 * turning may restart that clock, because without a cap a piece that is spun on
 * the spot never locks and the game cannot be lost.
 */
export const LOCK_DELAY_MS = 500;
export const LOCK_RESETS = 15;
