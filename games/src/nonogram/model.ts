/**
 * Nonogram rules. Pure — no DOM, no randomness, no solver.
 *
 * A puzzle is a grid of cells that are either painted or blank, described only
 * by the *runs* along each row and column. The player is told the runs and has
 * to recover the picture.
 *
 * Three cell states rather than two, and the third one is not decoration.
 * `Blank` means "I have not decided"; `Cross` means "I have worked out this one
 * is empty". Every technique in `solve.ts` reasons from crosses as hard as it
 * does from paint, and a player who cannot record a negative is forced to hold
 * it in their head — which is the difference between a nonogram being a logic
 * puzzle and it being a memory test.
 */

export const enum Mark {
  /** Undecided. */
  Blank = 0,
  Filled = 1,
  /** Known empty. */
  Cross = 2,
}

export interface Puzzle {
  width: number;
  height: number;
  /** Run lengths down each row, left to right. An empty row is `[]`. */
  rowClues: number[][];
  /** Run lengths down each column, top to bottom. */
  colClues: number[][];
}

/** The picture itself: true where the cell is painted. Row-major. */
export type Picture = boolean[];

export type Board = Mark[];

export const indexOf = (puzzle: Puzzle, x: number, y: number): number => y * puzzle.width + x;

/* ------------------------------------------------------------------ */
/* Clues                                                               */
/* ------------------------------------------------------------------ */

/** The run lengths in a line of booleans. */
export function runsOf(line: readonly boolean[]): number[] {
  const runs: number[] = [];
  let current = 0;
  for (const painted of line) {
    if (painted) {
      current++;
    } else if (current) {
      runs.push(current);
      current = 0;
    }
  }
  if (current) runs.push(current);
  return runs;
}

export function rowOf(picture: Picture, puzzle: Puzzle, y: number): boolean[] {
  return picture.slice(y * puzzle.width, (y + 1) * puzzle.width);
}

export function colOf(picture: Picture, puzzle: Puzzle, x: number): boolean[] {
  const out: boolean[] = [];
  for (let y = 0; y < puzzle.height; y++) out.push(picture[y * puzzle.width + x] as boolean);
  return out;
}

/** Derives a puzzle's clues from the picture it describes. */
export function cluesFor(picture: Picture, width: number, height: number): Puzzle {
  const puzzle: Puzzle = { width, height, rowClues: [], colClues: [] };
  for (let y = 0; y < height; y++) puzzle.rowClues.push(runsOf(rowOf(picture, puzzle, y)));
  for (let x = 0; x < width; x++) puzzle.colClues.push(runsOf(colOf(picture, puzzle, x)));
  return puzzle;
}

/**
 * The least width a line of these runs can occupy — every run plus one gap
 * between each pair. A clue list longer than its line is not a puzzle.
 */
export function minimumSpan(clues: readonly number[]): number {
  if (clues.length === 0) return 0;
  return clues.reduce((sum, run) => sum + run, 0) + clues.length - 1;
}

export function isWellFormed(puzzle: Puzzle): boolean {
  if (puzzle.rowClues.length !== puzzle.height) return false;
  if (puzzle.colClues.length !== puzzle.width) return false;

  for (const clues of puzzle.rowClues) {
    if (clues.some((run) => run <= 0)) return false;
    if (minimumSpan(clues) > puzzle.width) return false;
  }
  for (const clues of puzzle.colClues) {
    if (clues.some((run) => run <= 0)) return false;
    if (minimumSpan(clues) > puzzle.height) return false;
  }

  // The same cells counted two ways have to agree.
  const byRow = puzzle.rowClues.flat().reduce((sum, run) => sum + run, 0);
  const byCol = puzzle.colClues.flat().reduce((sum, run) => sum + run, 0);
  return byRow === byCol;
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

export function emptyBoard(puzzle: Puzzle): Board {
  return new Array<Mark>(puzzle.width * puzzle.height).fill(Mark.Blank);
}

export function applyMove(board: Board, move: Move): Board {
  if (move.cell < 0 || move.cell >= board.length) return board;
  if (board[move.cell] === move.mark) return board;
  const next = board.slice();
  next[move.cell] = move.mark;
  return next;
}

export function replay(puzzle: Puzzle, moves: readonly Move[]): Board {
  let board = emptyBoard(puzzle);
  for (const move of moves) board = applyMove(board, move);
  return board;
}

/**
 * Solved when the painted cells are exactly the picture's.
 *
 * **Crosses are ignored, and blanks on empty cells are fine.** A player who
 * paints the whole picture and never marks a single cross has solved it, and
 * one who leaves the last few empties blank because they are obviously empty has
 * too. Requiring the crosses would fail a correct picture for a bookkeeping
 * omission, which is the sort of thing that makes a puzzle game feel hostile.
 */
export function isSolved(board: Board, picture: Picture): boolean {
  for (let cell = 0; cell < picture.length; cell++) {
    const painted = board[cell] === Mark.Filled;
    if (painted !== picture[cell]) return false;
  }
  return true;
}

/** Painted cells that should not be. Shown as the level's mistake count. */
export function mistakesIn(board: Board, picture: Picture): number {
  let wrong = 0;
  for (let cell = 0; cell < picture.length; cell++) {
    if (board[cell] === Mark.Filled && !picture[cell]) wrong++;
  }
  return wrong;
}

/** Correctly painted cells. The clock pays out on this. */
export function correctIn(board: Board, picture: Picture): number {
  let right = 0;
  for (let cell = 0; cell < picture.length; cell++) {
    if (board[cell] === Mark.Filled && picture[cell]) right++;
  }
  return right;
}

export function paintedCount(picture: Picture): number {
  let count = 0;
  for (const painted of picture) if (painted) count++;
  return count;
}

/**
 * Which rows and columns the player has completely and correctly accounted for.
 *
 * Used only to grey out a finished clue, which is the one piece of feedback a
 * paper nonogram cannot give and every good digital one does. A line counts as
 * done when its painted cells match the picture's — the crosses, again, are the
 * player's own bookkeeping and not a condition.
 */
export function completedLines(
  board: Board,
  picture: Picture,
  puzzle: Puzzle,
): { rows: Set<number>; cols: Set<number> } {
  const rows = new Set<number>();
  const cols = new Set<number>();

  for (let y = 0; y < puzzle.height; y++) {
    let matches = true;
    for (let x = 0; x < puzzle.width; x++) {
      const cell = y * puzzle.width + x;
      if ((board[cell] === Mark.Filled) !== picture[cell]) {
        matches = false;
        break;
      }
    }
    if (matches) rows.add(y);
  }

  for (let x = 0; x < puzzle.width; x++) {
    let matches = true;
    for (let y = 0; y < puzzle.height; y++) {
      const cell = y * puzzle.width + x;
      if ((board[cell] === Mark.Filled) !== picture[cell]) {
        matches = false;
        break;
      }
    }
    if (matches) cols.add(x);
  }

  return { rows, cols };
}
