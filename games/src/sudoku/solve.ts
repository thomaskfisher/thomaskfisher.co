/**
 * Two solvers, for two different jobs.
 *
 * **`countSolutions` is exact and complete.** It is a plain backtracking search
 * with constraint propagation, and it exhausts the state space rather than
 * giving up at a node budget — so "one solution" from it means exactly one
 * solution exists, not that it stopped looking. That is the claim the generator
 * rests on, and the one a player notices if it is wrong: a grid with two
 * answers is a grid where a correct deduction can be marked as an error.
 *
 * **`logicalSolve` is the difficulty signal, and it is also the hint.** It
 * solves the way a person does — a ranked ladder of techniques, easiest first,
 * never guessing — and reports the hardest rung it had to stand on. Trap rate,
 * the signal the other puzzles here are calibrated on, has nothing to measure
 * in Sudoku: there is no dead end to fall into, because every deduction is
 * forced and unlimited undo means a wrong guess costs a tap. What makes one grid
 * harder than another is entirely *which technique sees the next digit*, so that
 * is what gets measured.
 *
 * A grid this solver cannot finish is discarded by the generator even when it
 * has a unique solution. "Solvable" in this collection means solvable by
 * reasoning; a puzzle that needs a guess and a page of bookkeeping is the kind
 * of thing the apps this replaces call Expert, and it is not a puzzle.
 */

import {
  ALL,
  CELLS,
  type Grid,
  PEERS,
  SIZE,
  UNITS,
  bit,
  candidates,
  digitsOf,
  loneDigit,
  popcount,
} from './model';

/* ------------------------------------------------------------------ */
/* Precomputed geometry                                                */
/* ------------------------------------------------------------------ */

/**
 * The 54 places a box meets a row or a column, which is the only geometry
 * locked candidates is about. Precomputed because the technique runs on every
 * pass of the solve loop and rediscovering these by scanning unit pairs was the
 * single slowest thing in the file.
 */
interface Intersection {
  box: readonly number[];
  line: readonly number[];
  /** The three cells both contain. */
  shared: readonly number[];
}

const INTERSECTIONS: readonly Intersection[] = buildIntersections();

function buildIntersections(): Intersection[] {
  const out: Intersection[] = [];
  // UNITS is rows 0-8, columns 9-17, boxes 18-26.
  for (let boxIndex = 18; boxIndex < 27; boxIndex++) {
    const box = UNITS[boxIndex] as readonly number[];
    for (let lineIndex = 0; lineIndex < 18; lineIndex++) {
      const line = UNITS[lineIndex] as readonly number[];
      const shared = box.filter((cell) => line.includes(cell));
      if (shared.length === 3) out.push({ box, line, shared });
    }
  }
  return out;
}

/** `SEES[a * CELLS + b]` — do these two cells share a row, column or box? */
const SEES = buildSees();

function buildSees(): Uint8Array {
  const table = new Uint8Array(CELLS * CELLS);
  for (let cell = 0; cell < CELLS; cell++) {
    for (const peer of PEERS[cell] as readonly number[]) table[cell * CELLS + peer] = 1;
  }
  return table;
}

const sees = (a: number, b: number): boolean => SEES[a * CELLS + b] === 1;

/* ------------------------------------------------------------------ */
/* Exact search                                                        */
/* ------------------------------------------------------------------ */

/**
 * Counts solutions, stopping once `limit` have been found.
 *
 * The generator only ever asks for two: it does not care how many answers a bad
 * grid has, only that it has more than one.
 */
export function countSolutions(grid: Grid, limit = 2): number {
  if (!consistent(grid)) return 0;

  const working = grid.slice();
  const masks = candidates(working);

  // A cell with no candidates left cannot be filled, so there is nothing here.
  for (let cell = 0; cell < CELLS; cell++) {
    if (!working[cell] && masks[cell] === 0) return 0;
  }

  return search(working, masks, limit, null);
}

/** The first solution found, or null. Used to build full grids and to mark errors. */
export function solveOne(grid: Grid): Grid | null {
  if (!consistent(grid)) return null;

  const working = grid.slice();
  const masks = candidates(working);
  let found: Grid | null = null;
  search(working, masks, 1, (solution) => {
    found = solution;
  });
  return found;
}

/**
 * Do the digits already on the board agree with each other?
 *
 * **Both searches above are unusable without this, and the reason is not
 * obvious.** The search only ever reasons about *empty* cells: it propagates a
 * placement out to the peers and never re-examines two cells that were filled
 * before it started. So a grid holding two 4s in one box is not rejected — it is
 * explored, in full, until every branch has been proved dead. That is a genuinely
 * exponential proof of something a single pass can see, and it hangs outright.
 *
 * The generator never produces such a grid. The *game* does: this is also what
 * marks a player's wrong digit, and a player's board is exactly where two 4s in
 * a box come from. Without this guard, entering a contradiction freezes the app.
 */
function consistent(grid: Grid): boolean {
  for (const unit of UNITS) {
    let seen = 0;
    for (const cell of unit) {
      const digit = grid[cell] as number;
      if (!digit) continue;
      const flag = bit(digit);
      if (seen & flag) return false;
      seen |= flag;
    }
  }
  return true;
}

function search(
  grid: Grid,
  masks: number[],
  limit: number,
  onSolution: ((grid: Grid) => void) | null,
): number {
  // Most-constrained cell first. Without it this is slow enough to matter: the
  // generator runs a uniqueness check after every single dug hole.
  let best = -1;
  let bestCount = SIZE + 1;
  for (let cell = 0; cell < CELLS; cell++) {
    if (grid[cell]) continue;
    const count = popcount(masks[cell] as number);
    if (count === 0) return 0; // dead end
    if (count < bestCount) {
      bestCount = count;
      best = cell;
      if (count === 1) break;
    }
  }

  if (best === -1) {
    onSolution?.(grid.slice());
    return 1;
  }

  let found = 0;
  for (const digit of digitsOf(masks[best] as number)) {
    const undo = assign(grid, masks, best, digit);
    if (undo.ok) found += search(grid, masks, limit - found, onSolution);
    revert(grid, masks, undo);
    if (found >= limit) return found;
  }
  return found;
}

/**
 * Records what an assignment changed, so it can be taken back exactly.
 *
 * Copying the whole grid and mask array per node is the obvious alternative and
 * it is roughly six times slower — which shows up directly as the generator
 * taking six times as long, on a worker, while someone waits for a level.
 *
 * `flag` is carried rather than recomputed on the way out: by the time `revert`
 * runs, the grid cell has been blanked and the digit that was in it is gone.
 */
interface Undo {
  cell: number;
  mask: number;
  flag: number;
  cleared: number[];
  /** False when propagation emptied some cell's candidates — a dead branch. */
  ok: boolean;
}

/**
 * Places a digit and propagates it to the peers, stopping at the first
 * contradiction. Always returns an undo record, even for a failed assignment:
 * the partial propagation still has to come back off.
 */
function assign(grid: Grid, masks: number[], cell: number, digit: number): Undo {
  const undo: Undo = { cell, mask: masks[cell] as number, flag: bit(digit), cleared: [], ok: true };

  grid[cell] = digit;
  masks[cell] = 0;

  for (const peer of PEERS[cell] as readonly number[]) {
    if (grid[peer]) continue;
    const mask = masks[peer] as number;
    if (!(mask & undo.flag)) continue;
    masks[peer] = mask & ~undo.flag;
    undo.cleared.push(peer);
    if (masks[peer] === 0) {
      undo.ok = false;
      return undo;
    }
  }
  return undo;
}

function revert(grid: Grid, masks: number[], undo: Undo): void {
  grid[undo.cell] = 0;
  masks[undo.cell] = undo.mask;
  for (const peer of undo.cleared) masks[peer] = (masks[peer] as number) | undo.flag;
}

/* ------------------------------------------------------------------ */
/* The technique ladder                                                */
/* ------------------------------------------------------------------ */

/**
 * How hard the hardest step in a grid was.
 *
 * The ranks are ordered the way a person learns them, which is also roughly the
 * order of how much of the board you have to hold in your head at once. The
 * numbers are the difficulty signal: the generator's band is expressed in them.
 */
export const TECHNIQUES = [
  { rank: 1, id: 'naked-single', label: 'Only one digit fits here' },
  { rank: 2, id: 'hidden-single', label: 'Only one cell in this group takes it' },
  { rank: 3, id: 'locked', label: 'A digit is trapped in one line of a box' },
  { rank: 4, id: 'naked-set', label: 'Two or three cells share two or three digits' },
  { rank: 5, id: 'hidden-set', label: 'Two digits hide in the same two cells' },
  { rank: 6, id: 'x-wing', label: 'A rectangle rules a digit out' },
  { rank: 7, id: 'xy-wing', label: 'Three linked cells rule a digit out' },
] as const;

export const MAX_RANK = 7;

export type TechniqueId = (typeof TECHNIQUES)[number]['id'];

/** One deduction. A placement fills a cell; an elimination only narrows one. */
export interface Step {
  technique: TechniqueId;
  rank: number;
  /** Set when the step names a digit for a cell. */
  placement: { cell: number; digit: number } | null;
  /** Cells whose candidates the step rules out, for an elimination. */
  eliminations: { cell: number; digit: number }[];
  /** The cells that justify it, for the hint's highlight. */
  because: number[];
}

export interface LogicalResult {
  solved: boolean;
  /** Highest rank used. 0 on a grid that was already finished. */
  hardest: number;
  /** How many steps of each rank were taken, indexed by rank. */
  counts: number[];
  /** The finished grid, when `solved`. */
  grid: Grid;
}

/**
 * Solves as far as reasoning goes, and reports how hard that was.
 *
 * Techniques are tried in rank order and the loop restarts from the top after
 * every success, so a grid is only charged for a hard technique when nothing
 * easier was available at that moment. That matters: charging for the hardest
 * technique *present* rather than *needed* rates half the easy grids as expert,
 * because an X-wing is usually sitting there next to a naked single.
 */
export function logicalSolve(givens: Grid): LogicalResult {
  const grid = givens.slice();
  const masks = candidates(grid);
  const counts = new Array<number>(MAX_RANK + 1).fill(0);
  let hardest = 0;

  for (;;) {
    const step = nextStep(grid, masks);
    if (!step) break;

    counts[step.rank] = (counts[step.rank] as number) + 1;
    hardest = Math.max(hardest, step.rank);

    if (step.placement) {
      place(grid, masks, step.placement.cell, step.placement.digit);
    } else {
      for (const { cell, digit } of step.eliminations) {
        masks[cell] = (masks[cell] as number) & ~bit(digit);
      }
    }
  }

  let solved = true;
  for (let cell = 0; cell < CELLS; cell++) if (!grid[cell]) solved = false;

  return { solved, hardest, counts, grid };
}

/**
 * The next digit reasoning can put on the board, for the hint button.
 *
 * Eliminations are worked through internally rather than shown: "this cell
 * cannot be a 4" is a true and useless thing to tell someone who wanted to know
 * where to look next. The technique that *finally* placed a digit is the one
 * reported, because that is the one whose name explains the answer.
 */
export function nextPlacement(
  current: Grid,
): { cell: number; digit: number; technique: TechniqueId; because: number[] } | null {
  const grid = current.slice();
  const masks = candidates(grid);

  for (let guard = 0; guard < CELLS * MAX_RANK; guard++) {
    const step = nextStep(grid, masks);
    if (!step) return null;

    if (step.placement) {
      const { cell, digit } = step.placement;
      // Only offer a cell the player has not already answered correctly.
      if (!current[cell]) {
        return { cell, digit, technique: step.technique, because: step.because };
      }
      place(grid, masks, cell, digit);
      continue;
    }

    for (const { cell, digit } of step.eliminations) {
      masks[cell] = (masks[cell] as number) & ~bit(digit);
    }
  }

  return null;
}

function place(grid: Grid, masks: number[], cell: number, digit: number): void {
  grid[cell] = digit;
  masks[cell] = 0;
  const flag = bit(digit);
  for (const peer of PEERS[cell] as readonly number[]) {
    masks[peer] = (masks[peer] as number) & ~flag;
  }
}

/** Tries every technique in rank order and returns the first that finds anything. */
function nextStep(grid: Grid, masks: number[]): Step | null {
  return (
    nakedSingle(grid, masks) ??
    hiddenSingle(grid, masks) ??
    lockedCandidates(grid, masks) ??
    nakedSet(grid, masks) ??
    hiddenSet(grid, masks) ??
    xWing(grid, masks) ??
    xyWing(grid, masks)
  );
}

/* ------------------------------ rank 1 ------------------------------ */

/** One cell, one candidate. */
function nakedSingle(grid: Grid, masks: number[]): Step | null {
  for (let cell = 0; cell < CELLS; cell++) {
    if (grid[cell]) continue;
    const digit = loneDigit(masks[cell] as number);
    if (digit) {
      return {
        technique: 'naked-single',
        rank: 1,
        placement: { cell, digit },
        eliminations: [],
        because: [cell],
      };
    }
  }
  return null;
}

/* ------------------------------ rank 2 ------------------------------ */

/** One digit, one place left in a row, column or box. */
function hiddenSingle(grid: Grid, masks: number[]): Step | null {
  for (const unit of UNITS) {
    for (let digit = 1; digit <= SIZE; digit++) {
      const flag = bit(digit);
      let seat = -1;
      let count = 0;
      let taken = false;
      for (const cell of unit) {
        if (grid[cell] === digit) {
          taken = true;
          break;
        }
        if ((masks[cell] as number) & flag) {
          seat = cell;
          count++;
        }
      }
      if (!taken && count === 1) {
        return {
          technique: 'hidden-single',
          rank: 2,
          placement: { cell: seat, digit },
          eliminations: [],
          because: unit.filter((cell) => grid[cell] !== 0),
        };
      }
    }
  }
  return null;
}

/* ------------------------------ rank 3 ------------------------------ */

/**
 * Locked candidates, both directions.
 *
 * Pointing: a digit confined to one line inside a box leaves that line elsewhere.
 * Claiming: a digit confined to one box inside a line leaves that box elsewhere.
 *
 * Both are statements about the same 27 box/line intersections, which are
 * precomputed at module load. The first version of this searched all 27×27 unit
 * pairs with `filter` and `includes` to find them, allocating four arrays per
 * digit per pair — and it did that inside the solve loop, sixty times a grid.
 * It was slow enough to hang the test suite outright.
 */
function lockedCandidates(_grid: Grid, masks: number[]): Step | null {
  for (const { box, line, shared } of INTERSECTIONS) {
    let boxMask = 0;
    let lineMask = 0;
    let sharedMask = 0;

    for (const cell of box) boxMask |= masks[cell] as number;
    for (const cell of line) lineMask |= masks[cell] as number;
    for (const cell of shared) sharedMask |= masks[cell] as number;

    // Outside-the-intersection candidates on each side. A digit present in the
    // intersection but absent from one side's remainder is locked to it.
    let boxRest = 0;
    for (const cell of box) if (!shared.includes(cell)) boxRest |= masks[cell] as number;
    let lineRest = 0;
    for (const cell of line) if (!shared.includes(cell)) lineRest |= masks[cell] as number;

    void boxMask;
    void lineMask;

    // Pointing: locked inside the box, so it goes from the rest of the line.
    const pointing = sharedMask & ~boxRest & lineRest;
    if (pointing) {
      const digit = digitsOf(pointing)[0] as number;
      const flag = bit(digit);
      return {
        technique: 'locked',
        rank: 3,
        placement: null,
        eliminations: line
          .filter((cell) => !shared.includes(cell) && (masks[cell] as number) & flag)
          .map((cell) => ({ cell, digit })),
        because: shared.filter((cell) => (masks[cell] as number) & flag),
      };
    }

    // Claiming: locked inside the line, so it goes from the rest of the box.
    const claiming = sharedMask & ~lineRest & boxRest;
    if (claiming) {
      const digit = digitsOf(claiming)[0] as number;
      const flag = bit(digit);
      return {
        technique: 'locked',
        rank: 3,
        placement: null,
        eliminations: box
          .filter((cell) => !shared.includes(cell) && (masks[cell] as number) & flag)
          .map((cell) => ({ cell, digit })),
        because: shared.filter((cell) => (masks[cell] as number) & flag),
      };
    }
  }
  return null;
}

/* ------------------------------ rank 4 ------------------------------ */

/**
 * Two or three cells in a unit sharing exactly two or three candidates between
 * them. Nothing else in the unit can hold any of those digits.
 *
 * Written as explicit nested loops rather than over a combinations generator:
 * this runs on every pass of the solve loop, and the generator allocated an
 * array per combination — 3,240 of them per call.
 */
function nakedSet(_grid: Grid, masks: number[]): Step | null {
  for (const unit of UNITS) {
    const open: number[] = [];
    for (const cell of unit) if ((masks[cell] as number) !== 0) open.push(cell);

    for (let i = 0; i < open.length; i++) {
      const a = open[i] as number;
      const maskA = masks[a] as number;
      if (popcount(maskA) > 3) continue;

      for (let j = i + 1; j < open.length; j++) {
        const b = open[j] as number;
        const pairMask = maskA | (masks[b] as number);
        const pairSize = popcount(pairMask);

        if (pairSize === 2) {
          const step = sweepNakedSet(open, [a, b], pairMask, masks);
          if (step) return step;
        }
        if (pairSize > 3) continue;

        for (let k = j + 1; k < open.length; k++) {
          const c = open[k] as number;
          const tripleMask = pairMask | (masks[c] as number);
          if (popcount(tripleMask) !== 3) continue;
          const step = sweepNakedSet(open, [a, b, c], tripleMask, masks);
          if (step) return step;
        }
      }
    }
  }
  return null;
}

function sweepNakedSet(
  open: readonly number[],
  set: number[],
  union: number,
  masks: number[],
): Step | null {
  const eliminations: { cell: number; digit: number }[] = [];
  for (const cell of open) {
    if (set.includes(cell)) continue;
    for (const digit of digitsOf((masks[cell] as number) & union)) {
      eliminations.push({ cell, digit });
    }
  }
  if (!eliminations.length) return null;
  return { technique: 'naked-set', rank: 4, placement: null, eliminations, because: set };
}

/* ------------------------------ rank 5 ------------------------------ */

/**
 * Two or three digits confined to the same two or three cells of a unit. Those
 * cells hold nothing else, whatever their masks currently say.
 *
 * Seats are tracked as a nine-bit mask over positions within the unit, so
 * "these digits live in the same cells" is one OR and one popcount.
 */
function hiddenSet(_grid: Grid, masks: number[]): Step | null {
  for (const unit of UNITS) {
    const seats = new Array<number>(SIZE + 1).fill(0);
    for (let position = 0; position < SIZE; position++) {
      const mask = masks[unit[position] as number] as number;
      for (let digit = 1; digit <= SIZE; digit++) {
        if (mask & bit(digit)) seats[digit] = (seats[digit] as number) | (1 << position);
      }
    }

    // A digit with one seat is a hidden single, which rank 2 already took.
    const live: number[] = [];
    for (let digit = 1; digit <= SIZE; digit++) {
      if (popcount(seats[digit] as number) >= 2) live.push(digit);
    }

    for (let i = 0; i < live.length; i++) {
      const first = live[i] as number;
      const seatsA = seats[first] as number;
      if (popcount(seatsA) > 3) continue;

      for (let j = i + 1; j < live.length; j++) {
        const second = live[j] as number;
        const seatsAB = seatsA | (seats[second] as number);
        const pairSize = popcount(seatsAB);

        if (pairSize === 2) {
          const step = sweepHiddenSet(unit, seatsAB, [first, second], masks);
          if (step) return step;
        }
        if (pairSize > 3) continue;

        for (let k = j + 1; k < live.length; k++) {
          const third = live[k] as number;
          const seatsABC = seatsAB | (seats[third] as number);
          if (popcount(seatsABC) !== 3) continue;
          const step = sweepHiddenSet(unit, seatsABC, [first, second, third], masks);
          if (step) return step;
        }
      }
    }
  }
  return null;
}

function sweepHiddenSet(
  unit: readonly number[],
  seatMask: number,
  digits: number[],
  masks: number[],
): Step | null {
  let keep = 0;
  for (const digit of digits) keep |= bit(digit);

  const cells: number[] = [];
  const eliminations: { cell: number; digit: number }[] = [];

  for (let position = 0; position < SIZE; position++) {
    if (!(seatMask & (1 << position))) continue;
    const cell = unit[position] as number;
    cells.push(cell);
    for (const digit of digitsOf((masks[cell] as number) & ~keep)) {
      eliminations.push({ cell, digit });
    }
  }

  if (!eliminations.length) return null;
  return { technique: 'hidden-set', rank: 5, placement: null, eliminations, because: cells };
}

/* ------------------------------ rank 6 ------------------------------ */

/**
 * X-wing: a digit sitting in the same two columns of two rows (or the
 * transpose) cannot appear elsewhere in those columns.
 */
function xWing(_grid: Grid, masks: number[]): Step | null {
  for (const transposed of [false, true]) {
    const index = (line: number, offset: number): number =>
      transposed ? offset * SIZE + line : line * SIZE + offset;

    for (let digit = 1; digit <= SIZE; digit++) {
      const flag = bit(digit);
      const seats: number[] = [];
      for (let line = 0; line < SIZE; line++) {
        let mask = 0;
        for (let offset = 0; offset < SIZE; offset++) {
          if ((masks[index(line, offset)] as number) & flag) mask |= 1 << offset;
        }
        seats.push(mask);
      }

      for (let a = 0; a < SIZE; a++) {
        const first = seats[a] as number;
        if (popcount(first) !== 2) continue;

        for (let b = a + 1; b < SIZE; b++) {
          if (seats[b] !== first) continue;

          const offsets = [...Array(SIZE).keys()].filter((offset) => first & (1 << offset));
          const eliminations: { cell: number; digit: number }[] = [];
          for (const offset of offsets) {
            for (let line = 0; line < SIZE; line++) {
              if (line === a || line === b) continue;
              const cell = index(line, offset);
              if ((masks[cell] as number) & flag) eliminations.push({ cell, digit });
            }
          }
          if (eliminations.length) {
            return {
              technique: 'x-wing',
              rank: 6,
              placement: null,
              eliminations,
              because: offsets.flatMap((offset) => [index(a, offset), index(b, offset)]),
            };
          }
        }
      }
    }
  }
  return null;
}

/* ------------------------------ rank 7 ------------------------------ */

/**
 * XY-wing: a pivot of two candidates with two pincers, each sharing one digit
 * with it and both sharing a third. Whichever way the pivot falls, the third
 * digit lands on a pincer, so anything seeing both pincers cannot hold it.
 */
function xyWing(_grid: Grid, masks: number[]): Step | null {
  const pairs: number[] = [];
  for (let cell = 0; cell < CELLS; cell++) {
    if (popcount(masks[cell] as number) === 2) pairs.push(cell);
  }

  for (const pivot of pairs) {
    const [x, y] = digitsOf(masks[pivot] as number) as [number, number];

    for (const first of pairs) {
      if (!sees(pivot, first)) continue;
      const firstMask = masks[first] as number;
      if (!(firstMask & bit(x)) || firstMask & bit(y)) continue;
      const z = (digitsOf(firstMask).find((digit) => digit !== x) as number) ?? 0;
      if (!z) continue;

      for (const second of pairs) {
        if (second === first || !sees(pivot, second)) continue;
        if ((masks[second] as number) !== (bit(y) | bit(z))) continue;

        const flag = bit(z);
        const eliminations: { cell: number; digit: number }[] = [];
        for (let cell = 0; cell < CELLS; cell++) {
          if (cell === pivot || cell === first || cell === second) continue;
          if (!((masks[cell] as number) & flag)) continue;
          if (sees(cell, first) && sees(cell, second)) eliminations.push({ cell, digit: z });
        }
        if (eliminations.length) {
          return {
            technique: 'xy-wing',
            rank: 7,
            placement: null,
            eliminations,
            because: [pivot, first, second],
          };
        }
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** A complete grid built from nothing, for the generator. `rng` picks the order. */
export function fillGrid(pick: (max: number) => number): Grid {
  const grid = new Array<number>(CELLS).fill(0);
  const masks = new Array<number>(CELLS).fill(ALL);
  if (fill(grid, masks, pick)) return grid;
  // Unreachable: an empty grid always fills. Throwing rather than returning a
  // partial grid, because a partial one would flow into the digger and produce
  // a puzzle with no answer.
  throw new Error('failed to build a full grid');
}

function fill(grid: Grid, masks: number[], pick: (max: number) => number): boolean {
  let best = -1;
  let bestCount = SIZE + 1;
  for (let cell = 0; cell < CELLS; cell++) {
    if (grid[cell]) continue;
    const count = popcount(masks[cell] as number);
    if (count === 0) return false;
    if (count < bestCount) {
      bestCount = count;
      best = cell;
    }
  }
  if (best === -1) return true;

  const options = digitsOf(masks[best] as number);
  // Fisher-Yates with the caller's seeded picker, so a grid is a pure function
  // of the seed.
  for (let i = options.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    [options[i], options[j]] = [options[j] as number, options[i] as number];
  }

  for (const digit of options) {
    const undo = assign(grid, masks, best, digit);
    // The assignment stays in place on the way up — this is building a grid,
    // not counting them, so the first complete fill is the answer.
    if (undo.ok && fill(grid, masks, pick)) return true;
    revert(grid, masks, undo);
  }
  return false;
}
