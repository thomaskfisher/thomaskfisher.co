/**
 * The deduction solver, and everything built on it.
 *
 * **A level is solvable here exactly when these rules finish it with no
 * guessing.** Each rule only ever writes a square that is the same in every
 * layout consistent with what is already known, so a finished solve cannot
 * have ruled out a second answer — uniqueness comes free, as it does for
 * Nonogram's line solver. A level the rules stall on is discarded, however
 * unique its answer, because the stall is exactly where a player would have to
 * start guessing.
 *
 * The rules, cheapest first, each priced for the difficulty signal:
 *
 *  1. **Shapes** (1). A given end or single says what its neighbours are.
 *  2. **Corners** (1). The four squares diagonal to any ship are water.
 *  3. **Counts** (2). A row with all its ships found is water elsewhere; a row
 *     with exactly as many blanks as ships still owed is ships.
 *  4. **Extension** (3). A ship square that is not yet a whole ship belongs to
 *     one of the ships still unplaced. Whatever every such placement covers is
 *     ship, whatever every placement's surround covers is water.
 *  5. **Reach** (4). A blank that no unplaced ship could cover is water.
 *  6. **Last of a length** (6). With one ship of some length still to place,
 *     whatever all of its possible positions share is ship.
 *
 * The prices come from how far a player has to look: the first three read one
 * square or one line, extension reads a ship and the fleet list, and the last
 * two sweep the whole board.
 */

import {
  type Board,
  type Given,
  type Layout,
  Mark,
  type Puzzle,
  Segment,
  around,
  emptyBoard,
  segmentOf,
  sides,
} from './model';

/* ------------------------------------------------------------------ */
/* Placements                                                          */
/* ------------------------------------------------------------------ */

export interface Placement {
  length: number;
  vertical: boolean;
  cells: number[];
  /** Every square touching the ship, corners included. All water in any answer. */
  ring: number[];
  /** The squares just past each end, or -1 at the edge. */
  before: number;
  after: number;
}

const placementCache = new Map<string, Placement[]>();

/** Every straight run of `length` squares on a `size` grid, both ways. */
export function placementsFor(size: number, length: number): Placement[] {
  const key = `${size}:${length}`;
  const cached = placementCache.get(key);
  if (cached) return cached;

  const out: Placement[] = [];
  const orientations = length === 1 ? [false] : [false, true];
  for (const vertical of orientations) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (vertical ? y + length > size : x + length > size) continue;
        const step = vertical ? size : 1;
        const start = y * size + x;
        const cells: number[] = [];
        for (let i = 0; i < length; i++) cells.push(start + i * step);

        const inside = new Set(cells);
        const ring = new Set<number>();
        for (const cell of cells) {
          for (const n of around(size, cell)) if (!inside.has(n)) ring.add(n);
        }

        const last = cells[cells.length - 1] as number;
        out.push({
          length,
          vertical,
          cells,
          ring: [...ring],
          before: vertical ? (y > 0 ? start - size : -1) : x > 0 ? start - 1 : -1,
          after: vertical
            ? y + length < size
              ? last + size
              : -1
            : x + length < size
              ? last + 1
              : -1,
        });
      }
    }
  }
  placementCache.set(key, out);
  return out;
}

/** The piece each square of a placement would be. */
function segmentAt(placement: Placement, index: number): Segment {
  const { length, vertical } = placement;
  if (length === 1) return Segment.Single;
  if (index === 0) return vertical ? Segment.Down : Segment.Right;
  if (index === length - 1) return vertical ? Segment.Up : Segment.Left;
  return Segment.Middle;
}

/* ------------------------------------------------------------------ */
/* What the board already says                                         */
/* ------------------------------------------------------------------ */

interface Tally {
  shipRows: number[];
  shipCols: number[];
  blankRows: number[];
  blankCols: number[];
  /** Fleet still unplaced, by length. Negative means a contradiction. */
  remaining: Map<number, number>;
  /** Every ship square that is part of a finished ship. */
  finished: Set<number>;
}

function isClosed(board: Board, cell: number): boolean {
  return cell < 0 || board[cell] === Mark.Water;
}

/**
 * Tallies the board: ship and blank squares per line, and which ships are
 * already whole.
 *
 * A run of ship squares closed at both ends by water or the edge is a whole
 * ship — nothing can join it end-on, and nothing can join it sideways because
 * that would be an L. It uses up one ship of its length from the fleet.
 */
function tally(puzzle: Puzzle, board: Board): Tally {
  const { size } = puzzle;
  const shipRows = new Array<number>(size).fill(0);
  const shipCols = new Array<number>(size).fill(0);
  const blankRows = new Array<number>(size).fill(0);
  const blankCols = new Array<number>(size).fill(0);

  for (let cell = 0; cell < board.length; cell++) {
    const y = Math.floor(cell / size);
    const x = cell % size;
    if (board[cell] === Mark.Ship) {
      shipRows[y] = (shipRows[y] ?? 0) + 1;
      shipCols[x] = (shipCols[x] ?? 0) + 1;
    } else if (board[cell] === Mark.Blank) {
      blankRows[y] = (blankRows[y] ?? 0) + 1;
      blankCols[x] = (blankCols[x] ?? 0) + 1;
    }
  }

  const remaining = new Map<number, number>();
  for (const length of puzzle.fleet) remaining.set(length, (remaining.get(length) ?? 0) + 1);

  const finished = new Set<number>();
  for (const run of runsOf(board, size)) {
    if (!isClosed(board, run.before) || !isClosed(board, run.after)) continue;
    if (run.cells.length === 1) {
      // A single needs all four sides shut, not just two.
      const [u, d, l, r] = sides(size, run.cells[0] as number);
      if (!isClosed(board, u) || !isClosed(board, d) || !isClosed(board, l) || !isClosed(board, r)) {
        continue;
      }
    }
    for (const cell of run.cells) finished.add(cell);
    remaining.set(run.cells.length, (remaining.get(run.cells.length) ?? 0) - 1);
  }

  return { shipRows, shipCols, blankRows, blankCols, remaining, finished };
}

interface Run {
  cells: number[];
  before: number;
  after: number;
}

/**
 * Maximal runs of ship squares. A lone square is reported once, as a run of
 * one with its left and right as the ends; `tally` checks its other two sides.
 */
function runsOf(board: Board, size: number): Run[] {
  const runs: Run[] = [];
  for (let cell = 0; cell < board.length; cell++) {
    if (board[cell] !== Mark.Ship) continue;
    const [up, down, left, right] = sides(size, cell);
    const shipUp = up >= 0 && board[up] === Mark.Ship;
    const shipLeft = left >= 0 && board[left] === Mark.Ship;
    if (shipUp || shipLeft) continue;
    const shipDown = down >= 0 && board[down] === Mark.Ship;
    const shipRight = right >= 0 && board[right] === Mark.Ship;
    if (shipDown && shipRight) continue;

    const vertical = shipDown;
    const cells = [cell];
    let at = cell;
    for (;;) {
      const next = sides(size, at)[vertical ? 1 : 3];
      if (next < 0 || board[next] !== Mark.Ship) break;
      cells.push(next);
      at = next;
    }
    runs.push({
      cells,
      before: vertical ? up : left,
      after: sides(size, at)[vertical ? 1 : 3],
    });
  }
  return runs;
}

/**
 * Could a ship still unplaced sit exactly here, given everything known?
 *
 * Its squares must not be water, nothing around it may be a ship, it must not
 * overfill any row or column, it must agree with the shape of any given piece
 * it covers, and it must not simply *be* a ship that is already whole.
 */
function fits(
  puzzle: Puzzle,
  board: Board,
  t: Tally,
  givenAt: ReadonlyMap<number, Given>,
  p: Placement,
): boolean {
  if ((t.remaining.get(p.length) ?? 0) <= 0) return false;
  const { size } = puzzle;

  let allShip = true;
  let fresh = 0;
  for (let i = 0; i < p.cells.length; i++) {
    const cell = p.cells[i] as number;
    const mark = board[cell];
    if (mark === Mark.Water) return false;
    if (mark === Mark.Blank) {
      allShip = false;
      fresh++;
    }
    const given = givenAt.get(cell);
    if (given && given.kind !== 'water' && given.kind !== segmentAt(p, i)) return false;
  }
  for (const cell of p.ring) if (board[cell] === Mark.Ship) return false;
  if (allShip && t.finished.has(p.cells[0] as number)) return false;

  // Counts. Along the ship, one line takes every new square; across it, each
  // square is its own line.
  const first = p.cells[0] as number;
  if (p.vertical) {
    const x = first % size;
    if ((t.shipCols[x] as number) + fresh > (puzzle.colCounts[x] as number)) return false;
    for (const cell of p.cells) {
      if (board[cell] !== Mark.Blank) continue;
      const y = Math.floor(cell / size);
      if ((t.shipRows[y] as number) + 1 > (puzzle.rowCounts[y] as number)) return false;
    }
  } else {
    const y = Math.floor(first / size);
    if ((t.shipRows[y] as number) + fresh > (puzzle.rowCounts[y] as number)) return false;
    for (const cell of p.cells) {
      if (board[cell] !== Mark.Blank) continue;
      const x = cell % size;
      if ((t.shipCols[x] as number) + 1 > (puzzle.colCounts[x] as number)) return false;
    }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

export type Rule = 'shape' | 'corner' | 'count' | 'extend' | 'reach' | 'last';

export const RULE_COST: Record<Rule, number> = {
  shape: 1,
  corner: 1,
  count: 2,
  extend: 3,
  reach: 4,
  last: 6,
};

export interface Finding {
  cell: number;
  mark: Mark.Water | Mark.Ship;
}

export interface Deduction {
  rule: Rule;
  found: Finding[];
  /** The row or column the deduction read, when it read one. */
  line?: { kind: 'row' | 'col'; index: number };
}

/** A position no answer is consistent with. */
export const CONTRADICTION = 'contradiction' as const;

function collect(board: Board, cells: Iterable<number>, mark: Mark.Water | Mark.Ship): Finding[] {
  const out: Finding[] = [];
  for (const cell of cells) if (board[cell] === Mark.Blank) out.push({ cell, mark });
  return out;
}

function shapeRule(puzzle: Puzzle, board: Board): Deduction | null {
  const { size } = puzzle;
  for (const given of puzzle.givens) {
    if (given.kind === 'water') continue;
    const [up, down, left, right] = sides(size, given.cell);
    const ship: number[] = [];
    const water: number[] = [];
    switch (given.kind) {
      case Segment.Single:
        water.push(up, down, left, right);
        break;
      case Segment.Up:
        ship.push(up);
        water.push(down, left, right);
        break;
      case Segment.Down:
        ship.push(down);
        water.push(up, left, right);
        break;
      case Segment.Left:
        ship.push(left);
        water.push(right, up, down);
        break;
      case Segment.Right:
        ship.push(right);
        water.push(left, up, down);
        break;
      case Segment.Middle: {
        // The axis is settled by either side of it being shut, or by a ship
        // already running through.
        const across =
          isClosed(board, up) ||
          isClosed(board, down) ||
          board[left] === Mark.Ship ||
          board[right] === Mark.Ship;
        const downward =
          isClosed(board, left) ||
          isClosed(board, right) ||
          board[up] === Mark.Ship ||
          board[down] === Mark.Ship;
        if (across && !downward) {
          ship.push(left, right);
          water.push(up, down);
        } else if (downward && !across) {
          ship.push(up, down);
          water.push(left, right);
        }
        break;
      }
    }
    const found = [
      ...collect(board, ship.filter((c) => c >= 0), Mark.Ship),
      ...collect(board, water.filter((c) => c >= 0), Mark.Water),
    ];
    if (found.length) return { rule: 'shape', found };
  }
  return null;
}

function cornerRule(puzzle: Puzzle, board: Board): Deduction | null {
  const { size } = puzzle;
  for (let cell = 0; cell < board.length; cell++) {
    if (board[cell] !== Mark.Ship) continue;
    const x = cell % size;
    const corners: number[] = [];
    for (const n of around(size, cell)) {
      if (n % size !== x && Math.floor(n / size) !== Math.floor(cell / size)) corners.push(n);
    }
    const found = collect(board, corners, Mark.Water);
    if (found.length) return { rule: 'corner', found };
  }
  return null;
}

function countRule(puzzle: Puzzle, board: Board, t: Tally): Deduction | null {
  const { size } = puzzle;
  for (let i = 0; i < size * 2; i++) {
    const kind = i < size ? 'row' : 'col';
    const index = i % size;
    const ships = kind === 'row' ? (t.shipRows[index] as number) : (t.shipCols[index] as number);
    const blanks = kind === 'row' ? (t.blankRows[index] as number) : (t.blankCols[index] as number);
    const wanted =
      kind === 'row' ? (puzzle.rowCounts[index] as number) : (puzzle.colCounts[index] as number);
    if (blanks === 0) continue;

    let mark: Mark.Water | Mark.Ship | null = null;
    if (ships === wanted) mark = Mark.Water;
    else if (ships + blanks === wanted) mark = Mark.Ship;
    if (mark === null) continue;

    const cells: number[] = [];
    for (let j = 0; j < size; j++) cells.push(kind === 'row' ? index * size + j : j * size + index);
    return { rule: 'count', found: collect(board, cells, mark), line: { kind, index } };
  }
  return null;
}

/** Cells every placement in the list covers, and cells every ring covers. */
function common(placements: Placement[]): { cells: number[]; ring: number[] } {
  const first = placements[0];
  if (!first) return { cells: [], ring: [] };
  let cells = new Set(first.cells);
  let ring = new Set(first.ring);
  for (let i = 1; i < placements.length; i++) {
    const p = placements[i] as Placement;
    const pc = new Set(p.cells);
    const pr = new Set(p.ring);
    cells = new Set([...cells].filter((c) => pc.has(c)));
    ring = new Set([...ring].filter((c) => pr.has(c)));
  }
  return { cells: [...cells], ring: [...ring] };
}

function extendRule(
  board: Board,
  fitting: Placement[],
  t: Tally,
): Deduction | typeof CONTRADICTION | null {
  for (let cell = 0; cell < board.length; cell++) {
    if (board[cell] !== Mark.Ship || t.finished.has(cell)) continue;
    const covering = fitting.filter((p) => p.cells.includes(cell));
    if (covering.length === 0) return CONTRADICTION;
    const shared = common(covering);
    const found = [
      ...collect(board, shared.cells, Mark.Ship),
      ...collect(board, shared.ring, Mark.Water),
    ];
    if (found.length) return { rule: 'extend', found };
  }
  return null;
}

function reachRule(board: Board, fitting: Placement[]): Deduction | null {
  const reachable = new Set<number>();
  for (const p of fitting) for (const cell of p.cells) reachable.add(cell);
  const found: Finding[] = [];
  for (let cell = 0; cell < board.length; cell++) {
    if (board[cell] === Mark.Blank && !reachable.has(cell)) found.push({ cell, mark: Mark.Water });
  }
  return found.length ? { rule: 'reach', found } : null;
}

function lastRule(board: Board, fitting: Placement[], t: Tally): Deduction | null {
  for (const [length, count] of t.remaining) {
    if (count !== 1) continue;
    const options = fitting.filter((p) => p.length === length);
    if (options.length === 0) continue;
    const shared = common(options);
    const found = [
      ...collect(board, shared.cells, Mark.Ship),
      ...collect(board, shared.ring, Mark.Water),
    ];
    if (found.length) return { rule: 'last', found };
  }
  return null;
}

/**
 * The cheapest deduction available on this board, or a contradiction, or null
 * when the rules have nothing more to say.
 */
export function deduce(puzzle: Puzzle, board: Board): Deduction | typeof CONTRADICTION | null {
  const t = tally(puzzle, board);
  for (const count of t.remaining.values()) if (count < 0) return CONTRADICTION;
  for (let i = 0; i < puzzle.size; i++) {
    if ((t.shipRows[i] as number) > (puzzle.rowCounts[i] as number)) return CONTRADICTION;
    if ((t.shipCols[i] as number) > (puzzle.colCounts[i] as number)) return CONTRADICTION;
    if ((t.shipRows[i] as number) + (t.blankRows[i] as number) < (puzzle.rowCounts[i] as number)) {
      return CONTRADICTION;
    }
    if ((t.shipCols[i] as number) + (t.blankCols[i] as number) < (puzzle.colCounts[i] as number)) {
      return CONTRADICTION;
    }
  }

  const cheap = shapeRule(puzzle, board) ?? cornerRule(puzzle, board) ?? countRule(puzzle, board, t);
  if (cheap) return cheap;

  const givenAt = new Map(puzzle.givens.map((given) => [given.cell, given]));
  const fitting: Placement[] = [];
  for (const length of new Set(puzzle.fleet)) {
    for (const p of placementsFor(puzzle.size, length)) {
      if (fits(puzzle, board, t, givenAt, p)) fitting.push(p);
    }
  }

  const extended = extendRule(board, fitting, t);
  if (extended) return extended;
  return reachRule(board, fitting) ?? lastRule(board, fitting, t);
}

/**
 * How many separate non-trivial deductions the board offers right now: lines
 * the counts decide, ship squares that extend, ship lengths down to their last,
 * plus one if any square is out of every ship's reach.
 *
 * Corners and shapes are left out on purpose. A player does those without
 * noticing, the way nobody counts writing a 9 into a Sudoku box that is only
 * missing a 9 — they are free, and counting them would make every board look
 * wide open for a step after each new ship.
 *
 * This is the difficulty signal. A board with five places to make progress is
 * one you can hardly get stuck on; a board with exactly one is one you have to
 * hunt through, and that hunt is what hard feels like.
 */
export function optionsAt(puzzle: Puzzle, board: Board): number {
  const t = tally(puzzle, board);
  const { size } = puzzle;
  let options = 0;

  for (let i = 0; i < size * 2; i++) {
    const row = i < size;
    const index = i % size;
    const ships = row ? (t.shipRows[index] as number) : (t.shipCols[index] as number);
    const blanks = row ? (t.blankRows[index] as number) : (t.blankCols[index] as number);
    const wanted = row ? (puzzle.rowCounts[index] as number) : (puzzle.colCounts[index] as number);
    if (blanks > 0 && (ships === wanted || ships + blanks === wanted)) options++;
  }

  const givenAt = new Map(puzzle.givens.map((given) => [given.cell, given]));
  const fitting: Placement[] = [];
  for (const length of new Set(puzzle.fleet)) {
    for (const p of placementsFor(size, length)) {
      if (fits(puzzle, board, t, givenAt, p)) fitting.push(p);
    }
  }

  const reachable = new Set<number>();
  for (const p of fitting) for (const cell of p.cells) reachable.add(cell);
  for (let cell = 0; cell < board.length; cell++) {
    if (board[cell] === Mark.Blank && !reachable.has(cell)) {
      options++;
      break;
    }
  }

  const seenRuns = new Set<string>();
  for (let cell = 0; cell < board.length; cell++) {
    if (board[cell] !== Mark.Ship || t.finished.has(cell)) continue;
    const covering = fitting.filter((p) => p.cells.includes(cell));
    const shared = common(covering);
    const found = [...shared.cells, ...shared.ring].filter((c) => board[c] === Mark.Blank);
    if (found.length === 0) continue;
    // Two squares of one partial ship that yield the same thing are one option.
    const key = found.sort((a, b) => a - b).join(',');
    if (seenRuns.has(key)) continue;
    seenRuns.add(key);
    options++;
  }

  for (const [length, count] of t.remaining) {
    if (count !== 1) continue;
    const shared = common(fitting.filter((p) => p.length === length));
    if ([...shared.cells, ...shared.ring].some((c) => board[c] === Mark.Blank)) options++;
  }

  return options;
}

/* ------------------------------------------------------------------ */
/* Whole puzzles                                                       */
/* ------------------------------------------------------------------ */

export interface SolveResult {
  /** Every square decided, with no guessing. */
  solved: boolean;
  contradiction: boolean;
  board: Board;
  /** Deductions made. */
  steps: number;
  /** Their prices, summed. The raw difficulty signal. */
  work: number;
  /** How many times each rule was needed. */
  uses: Record<Rule, number>;
  /**
   * `optionsAt` before each non-trivial deduction. Only filled in when asked
   * for, because it costs a full placement sweep per step.
   */
  options: number[];
}

export function solve(puzzle: Puzzle, start?: Board, measure = false): SolveResult {
  const board = (start ?? emptyBoard(puzzle)).slice();
  const uses: Record<Rule, number> = { shape: 0, corner: 0, count: 0, extend: 0, reach: 0, last: 0 };
  const options: number[] = [];
  let steps = 0;
  let work = 0;

  for (;;) {
    const next = deduce(puzzle, board);
    if (measure && next && next !== CONTRADICTION && next.rule !== 'shape' && next.rule !== 'corner') {
      options.push(optionsAt(puzzle, board));
    }
    if (next === CONTRADICTION) {
      return { solved: false, contradiction: true, board, steps, work, uses, options };
    }
    if (!next) break;
    for (const { cell, mark } of next.found) board[cell] = mark;
    steps++;
    work += RULE_COST[next.rule];
    uses[next.rule] += 1;
  }

  const solved = board.every((mark) => mark !== Mark.Blank);
  if (solved && deduce(puzzle, board) === CONTRADICTION) {
    return { solved: false, contradiction: true, board, steps, work, uses, options };
  }
  return { solved, contradiction: false, board, steps, work, uses, options };
}

/**
 * The first square the player has marked the opposite of the answer.
 *
 * Named before anything else is offered, because a hint reasoned on top of a
 * wrong mark leads further into it.
 */
export function findMistake(board: Board, layout: Layout): number | null {
  for (let cell = 0; cell < layout.length; cell++) {
    if (board[cell] === Mark.Ship && !layout[cell]) return cell;
    if (board[cell] === Mark.Water && layout[cell]) return cell;
  }
  return null;
}

/**
 * The next square reasoning can decide from the player's position.
 *
 * One square rather than the rule's whole haul: a hint that fills in a row is
 * playing the level rather than helping with it.
 *
 * The position is taken as mistake-free — the game checks that first. The
 * rules are monotone in what is known, so a board the solver finished from
 * blank always yields something here; the fallback to the answer is for the
 * one case that is not about rules at all, a board whose remaining blanks are
 * all water the player simply has not marked.
 */
export function nextHint(
  puzzle: Puzzle,
  board: Board,
  layout: Layout,
): { cell: number; mark: Mark.Water | Mark.Ship; rule: Rule | null; line?: Deduction['line'] } | null {
  const next = deduce(puzzle, board);
  if (next && next !== CONTRADICTION) {
    // Ships before water: a ship square is progress the player can see.
    const pick = next.found.find((f) => f.mark === Mark.Ship) ?? next.found[0];
    if (pick) return { cell: pick.cell, mark: pick.mark, rule: next.rule, line: next.line };
  }
  for (let cell = 0; cell < layout.length; cell++) {
    if (board[cell] !== Mark.Blank) continue;
    if (layout[cell]) return { cell, mark: Mark.Ship, rule: null };
  }
  return null;
}

/**
 * An exhaustive count of the layouts consistent with a puzzle's counts, fleet
 * and givens, up to `limit`.
 *
 * Not used in generation — a finished deduction already implies uniqueness —
 * but it turns that argument into a measurement, so it exists for the tests
 * and small grids only.
 */
export function countLayouts(puzzle: Puzzle, limit = 2): number {
  const { size } = puzzle;
  const lengths = puzzle.fleet.slice().sort((a, b) => b - a);
  const board: Board = new Array<Mark>(size * size).fill(Mark.Blank);
  const givenAt = new Map(puzzle.givens.map((given) => [given.cell, given]));
  const rows = new Array<number>(size).fill(0);
  const cols = new Array<number>(size).fill(0);
  let found = 0;

  const place = (index: number, from: number): void => {
    if (found >= limit) return;
    if (index === lengths.length) {
      for (let i = 0; i < size; i++) {
        if (rows[i] !== puzzle.rowCounts[i] || cols[i] !== puzzle.colCounts[i]) return;
      }
      for (const given of puzzle.givens) {
        const ship = board[given.cell] === Mark.Ship;
        if ((given.kind === 'water') === ship) return;
      }
      // Given shapes, now that every neighbour is known.
      const layout = board.map((mark) => mark === Mark.Ship);
      for (const given of puzzle.givens) {
        if (given.kind === 'water') continue;
        if (segmentOf(layout, size, given.cell) !== given.kind) return;
      }
      found++;
      return;
    }
    const length = lengths[index] as number;
    // Identical ships are placed in increasing order so each layout counts once.
    const same = index > 0 && lengths[index - 1] === length;
    const all = placementsFor(size, length);
    for (let k = same ? from : 0; k < all.length; k++) {
      const p = all[k] as Placement;
      if (p.cells.some((c) => board[c] !== Mark.Blank)) continue;
      if (p.ring.some((c) => board[c] === Mark.Ship)) continue;
      if (p.cells.some((c) => givenAt.get(c)?.kind === 'water')) continue;
      let over = false;
      for (const c of p.cells) {
        const y = Math.floor(c / size);
        const x = c % size;
        rows[y] = (rows[y] ?? 0) + 1;
        cols[x] = (cols[x] ?? 0) + 1;
        if ((rows[y] ?? 0) > (puzzle.rowCounts[y] ?? 0) || (cols[x] ?? 0) > (puzzle.colCounts[x] ?? 0)) {
          over = true;
        }
      }
      if (!over) {
        for (const c of p.cells) board[c] = Mark.Ship;
        place(index + 1, k + 1);
        for (const c of p.cells) board[c] = Mark.Blank;
      }
      for (const c of p.cells) {
        const y = Math.floor(c / size);
        const x = c % size;
        rows[y] = (rows[y] ?? 0) - 1;
        cols[x] = (cols[x] ?? 0) - 1;
      }
      if (found >= limit) return;
    }
  };

  place(0, 0);
  return found;
}
