/**
 * Battleship rules — the solitaire logic puzzle, not the two-player guessing
 * game. Pure: no DOM, no randomness, no solver.
 *
 * A fleet of straight ships is hidden in a square grid. Ships lie across or
 * down, never touch one another — not even at a corner — and the player is
 * told three things: how many ship squares each row and column holds, what the
 * fleet is, and a few squares outright. From those they recover every ship.
 *
 * The two-player game was the obvious recreation and was turned down on
 * purpose: it is a game of luck against a hidden layout, so no level of it can
 * be verified before it is shown, and a loss can be nobody's fault. This one
 * can be — `solve.ts` finishes every level by deduction before it ships.
 *
 * Three cell states, as in Nonogram, and for the same reason: `Water` is how a
 * player records a negative, and every rule in `solve.ts` reasons from water as
 * hard as it does from ships.
 */

export const enum Mark {
  /** Undecided. */
  Blank = 0,
  Water = 1,
  Ship = 2,
}

/**
 * What a ship square looks like, which is information: a given square drawn as
 * a rounded end says which way its ship runs. Named for the side the ship
 * continues on, so `Up` is the bottom end of a vertical ship.
 */
export const enum Segment {
  /** A ship of one. */
  Single = 0,
  Up = 1,
  Down = 2,
  Left = 3,
  Right = 4,
  /** Ship on both sides, along an axis the square alone does not say. */
  Middle = 5,
}

export interface Given {
  cell: number;
  /** Water, or the ship piece that sits here. */
  kind: 'water' | Segment;
}

export interface Puzzle {
  size: number;
  /** Ship lengths, longest first. */
  fleet: number[];
  rowCounts: number[];
  colCounts: number[];
  givens: Given[];
}

/** True where a ship sits. Row-major. */
export type Layout = boolean[];

export type Board = Mark[];

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

/** The four orthogonal neighbours of a cell, or -1 off the edge: up, down, left, right. */
export function sides(size: number, cell: number): [number, number, number, number] {
  const x = cell % size;
  const y = Math.floor(cell / size);
  return [
    y > 0 ? cell - size : -1,
    y < size - 1 ? cell + size : -1,
    x > 0 ? cell - 1 : -1,
    x < size - 1 ? cell + 1 : -1,
  ];
}

/** Every cell touching this one, corners included. */
export function around(size: number, cell: number): number[] {
  const x = cell % size;
  const y = Math.floor(cell / size);
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      out.push(ny * size + nx);
    }
  }
  return out;
}

/** The piece a ship square is in a layout, from its neighbours. */
export function segmentOf(layout: Layout, size: number, cell: number): Segment {
  const [up, down, left, right] = sides(size, cell);
  const u = up >= 0 && layout[up] === true;
  const d = down >= 0 && layout[down] === true;
  const l = left >= 0 && layout[left] === true;
  const r = right >= 0 && layout[right] === true;
  if ((u && d) || (l && r)) return Segment.Middle;
  if (u) return Segment.Up;
  if (d) return Segment.Down;
  if (l) return Segment.Left;
  if (r) return Segment.Right;
  return Segment.Single;
}

/* ------------------------------------------------------------------ */
/* Ships                                                               */
/* ------------------------------------------------------------------ */

export interface Ship {
  /** The top or left square. */
  cell: number;
  length: number;
  vertical: boolean;
}

export function shipCells(size: number, ship: Ship): number[] {
  const step = ship.vertical ? size : 1;
  const out: number[] = [];
  for (let i = 0; i < ship.length; i++) out.push(ship.cell + i * step);
  return out;
}

/** The ships in a layout, read off as maximal straight runs. */
export function shipsOf(layout: Layout, size: number): Ship[] {
  const seen = new Array<boolean>(layout.length).fill(false);
  const ships: Ship[] = [];
  for (let cell = 0; cell < layout.length; cell++) {
    if (!layout[cell] || seen[cell]) continue;
    const x = cell % size;
    const y = Math.floor(cell / size);
    let length = 1;
    let vertical = false;
    if (x + 1 < size && layout[cell + 1]) {
      while (x + length < size && layout[cell + length]) length++;
    } else if (y + 1 < size && layout[cell + size]) {
      vertical = true;
      while (y + length < size && layout[cell + length * size]) length++;
    }
    const ship: Ship = { cell, length, vertical };
    for (const c of shipCells(size, ship)) seen[c] = true;
    ships.push(ship);
  }
  return ships;
}

/**
 * A layout is legal when its ships are straight, touch nowhere (corners
 * included), and are exactly the fleet.
 */
export function isLegalLayout(layout: Layout, size: number, fleet: readonly number[]): boolean {
  for (let cell = 0; cell < layout.length; cell++) {
    if (!layout[cell]) continue;
    const x = cell % size;
    const y = Math.floor(cell / size);
    // Diagonal neighbours are always water; orthogonal ones may be the same ship.
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      if (layout[ny * size + nx]) return false;
    }
  }
  // With no diagonal contact, a ship square with neighbours both across and
  // down would be an L — which the diagonal rule already forbids — so every
  // component is a straight run and `shipsOf` reads them correctly.
  const lengths = shipsOf(layout, size)
    .map((ship) => ship.length)
    .sort((a, b) => b - a);
  const wanted = fleet.slice().sort((a, b) => b - a);
  return lengths.length === wanted.length && lengths.every((length, i) => length === wanted[i]);
}

export function countsOf(layout: Layout, size: number): { rows: number[]; cols: number[] } {
  const rows = new Array<number>(size).fill(0);
  const cols = new Array<number>(size).fill(0);
  for (let cell = 0; cell < layout.length; cell++) {
    if (!layout[cell]) continue;
    const y = Math.floor(cell / size);
    const x = cell % size;
    rows[y] = (rows[y] ?? 0) + 1;
    cols[x] = (cols[x] ?? 0) + 1;
  }
  return { rows, cols };
}

export function isWellFormed(puzzle: Puzzle): boolean {
  const { size, fleet, rowCounts, colCounts, givens } = puzzle;
  if (rowCounts.length !== size || colCounts.length !== size) return false;
  if (fleet.some((length) => length < 1 || length > size)) return false;
  const total = fleet.reduce((sum, length) => sum + length, 0);
  const byRow = rowCounts.reduce((sum, n) => sum + n, 0);
  const byCol = colCounts.reduce((sum, n) => sum + n, 0);
  if (byRow !== total || byCol !== total) return false;
  if (rowCounts.some((n) => n < 0 || n > size)) return false;
  if (colCounts.some((n) => n < 0 || n > size)) return false;
  const seen = new Set<number>();
  for (const given of givens) {
    if (given.cell < 0 || given.cell >= size * size || seen.has(given.cell)) return false;
    seen.add(given.cell);
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Play                                                                */
/* ------------------------------------------------------------------ */

export interface Move {
  cell: number;
  mark: Mark;
}

export function packMove(move: Move): number {
  return (move.cell << 2) | move.mark;
}

export function unpackMove(packed: number): Move {
  return { cell: packed >> 2, mark: (packed & 0b11) as Mark };
}

/** The board a level starts on: blank, apart from the givens. */
export function emptyBoard(puzzle: Puzzle): Board {
  const board = new Array<Mark>(puzzle.size * puzzle.size).fill(Mark.Blank);
  for (const given of puzzle.givens) {
    board[given.cell] = given.kind === 'water' ? Mark.Water : Mark.Ship;
  }
  return board;
}

export function givenCells(puzzle: Puzzle): Set<number> {
  return new Set(puzzle.givens.map((given) => given.cell));
}

/** A given square cannot be changed; anything else can be set to anything. */
export function applyMove(board: Board, move: Move, locked: ReadonlySet<number>): Board {
  if (move.cell < 0 || move.cell >= board.length) return board;
  if (locked.has(move.cell)) return board;
  if (board[move.cell] === move.mark) return board;
  const next = board.slice();
  next[move.cell] = move.mark;
  return next;
}

/**
 * Solved when the ship squares are exactly the layout's.
 *
 * Water marks are ignored, as Nonogram ignores its crosses: a player who has
 * found every ship and left the obvious sea blank has finished the puzzle, and
 * failing them for the bookkeeping would make the game feel hostile.
 */
export function isSolved(board: Board, layout: Layout): boolean {
  for (let cell = 0; cell < layout.length; cell++) {
    if ((board[cell] === Mark.Ship) !== layout[cell]) return false;
  }
  return true;
}

/**
 * Squares marked the opposite of the answer.
 *
 * Unlike Nonogram's, a wrong *negative* counts here too. Water where a ship
 * belongs poisons the fleet count and every placement around it, which is the
 * same damage a wrong ship does.
 */
export function mistakesIn(board: Board, layout: Layout): number {
  let wrong = 0;
  for (let cell = 0; cell < layout.length; cell++) {
    if (board[cell] === Mark.Ship && !layout[cell]) wrong++;
    else if (board[cell] === Mark.Water && layout[cell]) wrong++;
  }
  return wrong;
}

/** Correctly placed ship squares, givens included. The clock pays out on this. */
export function correctIn(board: Board, layout: Layout): number {
  let right = 0;
  for (let cell = 0; cell < layout.length; cell++) {
    if (board[cell] === Mark.Ship && layout[cell]) right++;
  }
  return right;
}

/** Ship squares marked in each row and column. */
export function markedCounts(board: Board, size: number): { rows: number[]; cols: number[] } {
  const rows = new Array<number>(size).fill(0);
  const cols = new Array<number>(size).fill(0);
  for (let cell = 0; cell < board.length; cell++) {
    if (board[cell] !== Mark.Ship) continue;
    const y = Math.floor(cell / size);
    const x = cell % size;
    rows[y] = (rows[y] ?? 0) + 1;
    cols[x] = (cols[x] ?? 0) + 1;
  }
  return { rows, cols };
}

/**
 * The ships the player has visibly finished: a straight run of ship squares
 * closed at both ends by water or the edge. Counted by length, for the fleet
 * list above the grid.
 *
 * Only the ends are checked. A run with an unmarked square beside its middle is
 * still unmistakably a ship of that length — nothing can join it sideways —
 * and demanding the player water-in every flank before the list ticks it off
 * would be bookkeeping for its own sake.
 */
export function finishedShips(board: Board, size: number): number[] {
  const found: number[] = [];
  const closed = (cell: number): boolean => cell < 0 || board[cell] === Mark.Water;

  for (let cell = 0; cell < board.length; cell++) {
    if (board[cell] !== Mark.Ship) continue;
    const [up, down, left, right] = sides(size, cell);
    const shipUp = up >= 0 && board[up] === Mark.Ship;
    const shipLeft = left >= 0 && board[left] === Mark.Ship;
    if (shipUp || shipLeft) continue; // Not the first square of its run.

    const shipDown = down >= 0 && board[down] === Mark.Ship;
    const shipRight = right >= 0 && board[right] === Mark.Ship;
    if (shipDown && shipRight) continue; // An L, which is not a ship.

    if (!shipDown && !shipRight) {
      // A lone square is a ship of one only once all four sides are shut.
      if (closed(up) && closed(down) && closed(left) && closed(right)) found.push(1);
      continue;
    }

    const step = shipRight ? 1 : size;
    const before = shipRight ? left : up;
    let length = 1;
    let at = cell + step;
    while (at >= 0 && at < board.length && board[at] === Mark.Ship) {
      if (step === 1 && at % size === 0) break;
      length++;
      at += step;
    }
    const last = at - step;
    const after = sides(size, last)[shipRight ? 3 : 1];
    if (closed(before) && closed(after)) found.push(length);
  }
  return found;
}
