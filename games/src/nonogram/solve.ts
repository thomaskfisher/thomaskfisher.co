/**
 * The line solver, and everything built on it.
 *
 * **One idea does all the work here.** Take a single row or column, its clue
 * list, and whatever is already known about its cells; enumerate every way the
 * runs could be laid out that is consistent with what is known; and keep any
 * cell that came out the same way in all of them. That is the whole of nonogram
 * logic, and a puzzle is "solvable" in this collection exactly when repeating it
 * over the rows and columns finishes the picture.
 *
 * **Enumeration rather than a dynamic program.** The obvious worry is that
 * enumerating arrangements is exponential, and in general it is — but not at the
 * sizes a phone can show. The worst line here is fifteen cells, and the most
 * arrangements any fifteen-cell clue list admits is under five hundred. A DP
 * would be faster and considerably harder to be sure of; this is a loop anyone
 * can read and check.
 *
 * **`solveByLines` is complete, in the sense the generator needs.** When it
 * stalls with cells undecided, that means no *single line* yields anything
 * further — which is exactly when a human would have to start guessing. Such a
 * puzzle is discarded. That is a stronger promise than "has one solution": a
 * uniquely-solvable nonogram that needs a two-line contradiction to crack is
 * technically fair and is not what anyone wants on a phone.
 *
 * Uniqueness comes free with it. Every step only writes cells that were the same
 * in *every* consistent arrangement, so a completed line solve cannot have
 * ruled out a second answer — there was never more than one.
 */

import {
  type Board,
  type Mark,
  Mark as M,
  type Picture,
  type Puzzle,
  emptyBoard,
  minimumSpan,
} from './model';

/* ------------------------------------------------------------------ */
/* One line                                                            */
/* ------------------------------------------------------------------ */

/**
 * Tightens one line as far as it goes.
 *
 * Returns a line of the same length where a cell is `Filled` or `Cross` only if
 * it held that value in every consistent arrangement, and `Blank` where the
 * arrangements disagreed. Returns null when no arrangement is consistent at all,
 * which means the board has been painted into a contradiction.
 */
export function solveLine(clues: readonly number[], cells: readonly Mark[]): Mark[] | null {
  const n = cells.length;

  /** Least space clues[i..] still needs, so a placement can be cut off early. */
  const tail: number[] = new Array<number>(clues.length + 1).fill(0);
  for (let i = clues.length - 1; i >= 0; i--) {
    tail[i] = (clues[i] as number) + (i + 1 < clues.length ? 1 + (tail[i + 1] as number) : 0);
  }

  const canFill = new Array<boolean>(n).fill(false);
  const canEmpty = new Array<boolean>(n).fill(false);
  const line = new Array<boolean>(n).fill(false);
  let arrangements = 0;

  const place = (clueIndex: number, start: number): void => {
    if (clueIndex === clues.length) {
      // Everything left over is empty, which only works if nothing there is
      // already painted.
      for (let i = start; i < n; i++) {
        if (cells[i] === M.Filled) return;
        line[i] = false;
      }
      arrangements++;
      for (let i = 0; i < n; i++) {
        if (line[i]) canFill[i] = true;
        else canEmpty[i] = true;
      }
      return;
    }

    const run = clues[clueIndex] as number;
    const needed = tail[clueIndex] as number;

    for (let at = start; at + needed <= n; at++) {
      // Cells skipped over to reach `at` must be able to be empty. A painted one
      // ends the search rather than skipping it: no later start can cover it.
      if (at > start && cells[at - 1] === M.Filled) break;

      let ok = true;
      for (let i = at; i < at + run; i++) {
        if (cells[i] === M.Cross) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      // The run has to end somewhere, so the cell after it cannot be painted.
      if (at + run < n && cells[at + run] === M.Filled) continue;

      for (let i = start; i < at; i++) line[i] = false;
      for (let i = at; i < at + run; i++) line[i] = true;
      if (at + run < n) line[at + run] = false;

      place(clueIndex + 1, at + run + 1);
    }
  };

  place(0, 0);
  if (arrangements === 0) return null;

  const out = new Array<Mark>(n);
  for (let i = 0; i < n; i++) {
    if (canFill[i] && !canEmpty[i]) out[i] = M.Filled;
    else if (canEmpty[i] && !canFill[i]) out[i] = M.Cross;
    else out[i] = M.Blank;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Lines of a puzzle                                                   */
/* ------------------------------------------------------------------ */

export interface Line {
  kind: 'row' | 'col';
  index: number;
  clues: readonly number[];
  /** Board indices, in reading order along the line. */
  cells: number[];
}

export function linesOf(puzzle: Puzzle): Line[] {
  const lines: Line[] = [];

  for (let y = 0; y < puzzle.height; y++) {
    const cells: number[] = [];
    for (let x = 0; x < puzzle.width; x++) cells.push(y * puzzle.width + x);
    lines.push({ kind: 'row', index: y, clues: puzzle.rowClues[y] as number[], cells });
  }

  for (let x = 0; x < puzzle.width; x++) {
    const cells: number[] = [];
    for (let y = 0; y < puzzle.height; y++) cells.push(y * puzzle.width + x);
    lines.push({ kind: 'col', index: x, clues: puzzle.colClues[x] as number[], cells });
  }

  return lines;
}

/** What one line has to say about the board right now. */
interface LineResult {
  /** Cells this line can decide that are still blank. */
  found: { cell: number; mark: Mark }[];
  /** True when the line admits no arrangement at all. */
  contradiction: boolean;
}

function examine(board: Board, line: Line): LineResult {
  const cells = line.cells.map((cell) => board[cell] as Mark);
  const tightened = solveLine(line.clues, cells);
  if (!tightened) return { found: [], contradiction: true };

  const found: { cell: number; mark: Mark }[] = [];
  for (let i = 0; i < line.cells.length; i++) {
    const mark = tightened[i] as Mark;
    if (mark === M.Blank) continue;
    if (cells[i] === mark) continue;
    found.push({ cell: line.cells[i] as number, mark });
  }
  return { found, contradiction: false };
}

/* ------------------------------------------------------------------ */
/* Whole puzzles                                                       */
/* ------------------------------------------------------------------ */

export interface SolveResult {
  /** Every cell decided, with no guessing. */
  solved: boolean;
  /** The board the line solver reached. */
  board: Board;
  /**
   * Lines examined before each deduction, summed.
   *
   * This is the difficulty signal, and it is deliberately a model of the player
   * rather than of the algorithm. A puzzle where the next deduction is always in
   * the line you just worked on costs about one examination per step; one where
   * you have to sweep the whole board to find anything at all costs thirty. That
   * difference is exactly what makes a nonogram feel hard, and nothing about the
   * grid's size or fill rate predicts it — see `tools/nonogram.ts`.
   */
  examined: number;
  /** Deductions made. */
  steps: number;
  contradiction: boolean;
}

export function solveByLines(puzzle: Puzzle): SolveResult {
  const board = emptyBoard(puzzle);
  const lines = linesOf(puzzle);

  let examined = 0;
  let steps = 0;
  /*
   * Where the next sweep starts.
   *
   * Kept at the line that last yielded, rather than reset to zero, because that
   * is how a person works: you finish the row you just learned something about
   * before wandering off. Resetting to zero instead makes every puzzle score as
   * though its easiest lines were re-read from scratch after every single
   * deduction, which measures the scan order rather than the puzzle.
   */
  let cursor = 0;

  for (;;) {
    let progressed = false;

    for (let scan = 0; scan < lines.length; scan++) {
      const index = (cursor + scan) % lines.length;
      const line = lines[index] as Line;
      examined++;

      const result = examine(board, line);
      if (result.contradiction) {
        return { solved: false, board, examined, steps, contradiction: true };
      }
      if (result.found.length === 0) continue;

      for (const { cell, mark } of result.found) board[cell] = mark;
      steps++;
      cursor = index;
      progressed = true;
      break;
    }

    if (!progressed) break;
  }

  const solved = board.every((mark) => mark !== M.Blank);
  return { solved, board, examined, steps, contradiction: false };
}

/**
 * The next cell reasoning can decide, given what the player has already done.
 *
 * Deliberately one cell rather than a whole line: a hint that fills in a row is
 * playing the level rather than helping with it.
 *
 * The player's own work is taken as given, including their mistakes — so the
 * first thing this does is check for a painted cell that does not belong, since
 * a deduction offered on top of a contradiction is worse than no deduction at
 * all. The game asks for that check separately; here the contradiction simply
 * makes every line unsatisfiable and the hint comes back null.
 *
 * Pure in the position, so two answers to the same question are the same
 * answer — there is no ping-pong here for a cached plan to prevent.
 */
export function nextDeduction(
  puzzle: Puzzle,
  board: Board,
): { cell: number; mark: Mark; line: Line } | null {
  for (const line of linesOf(puzzle)) {
    const result = examine(board, line);
    if (result.contradiction || result.found.length === 0) continue;
    const first = result.found[0];
    if (!first) continue;
    return { cell: first.cell, mark: first.mark, line };
  }
  return null;
}

/**
 * The first cell the player has painted that the picture says is empty.
 *
 * Nonograms punish a single wrong cell hard — every deduction downstream of it
 * is poisoned — so the hint names the mistake before it offers anything else.
 */
export function findMistake(board: Board, picture: Picture): number | null {
  for (let cell = 0; cell < picture.length; cell++) {
    if (board[cell] === M.Filled && !picture[cell]) return cell;
  }
  return null;
}

/**
 * A slow, exhaustive count of how many pictures fit a clue set, up to `limit`.
 *
 * Not used in generation — line solvability already implies uniqueness — but it
 * is what makes that claim testable rather than asserted, so it exists for the
 * tests and for small puzzles only.
 */
export function countPictures(puzzle: Puzzle, limit = 2): number {
  const { width, height } = puzzle;
  const picture: boolean[] = new Array<boolean>(width * height).fill(false);
  let found = 0;

  const rowArrangements = (clues: readonly number[]): boolean[][] => {
    const out: boolean[][] = [];
    const line = new Array<boolean>(width).fill(false);

    const place = (clueIndex: number, start: number): void => {
      if (clueIndex === clues.length) {
        for (let i = start; i < width; i++) line[i] = false;
        out.push(line.slice());
        return;
      }
      const run = clues[clueIndex] as number;
      const needed = minimumSpan(clues.slice(clueIndex));
      for (let at = start; at + needed <= width; at++) {
        for (let i = start; i < at; i++) line[i] = false;
        for (let i = at; i < at + run; i++) line[i] = true;
        if (at + run < width) line[at + run] = false;
        place(clueIndex + 1, at + run + 1);
      }
    };

    place(0, 0);
    return out;
  };

  const perRow = puzzle.rowClues.map(rowArrangements);

  const walk = (y: number): void => {
    if (found >= limit) return;
    if (y === height) {
      for (let x = 0; x < width; x++) {
        const column: boolean[] = [];
        for (let row = 0; row < height; row++) column.push(picture[row * width + x] as boolean);
        const runs: number[] = [];
        let current = 0;
        for (const painted of column) {
          if (painted) current++;
          else if (current) {
            runs.push(current);
            current = 0;
          }
        }
        if (current) runs.push(current);
        const expected = puzzle.colClues[x] as number[];
        if (runs.length !== expected.length) return;
        for (let i = 0; i < runs.length; i++) if (runs[i] !== expected[i]) return;
      }
      found++;
      return;
    }

    for (const arrangement of perRow[y] as boolean[][]) {
      for (let x = 0; x < width; x++) picture[y * width + x] = arrangement[x] as boolean;
      walk(y + 1);
      if (found >= limit) return;
    }
  };

  walk(0);
  return found;
}
