import { describe, expect, it } from 'vitest';

import {
  type Board,
  Mark,
  type Picture,
  applyMove,
  cluesFor,
  colOf,
  completedLines,
  correctIn,
  emptyBoard,
  isSolved,
  isWellFormed,
  minimumSpan,
  mistakesIn,
  packMove,
  paintedCount,
  replay,
  rowOf,
  runsOf,
  unpackMove,
} from './model';

/** A 5x5 plus sign, which has clues worth reading. */
const PLUS: Picture = [
  false, false, true, false, false,
  false, false, true, false, false,
  true, true, true, true, true,
  false, false, true, false, false,
  false, false, true, false, false,
];

const PLUS_PUZZLE = cluesFor(PLUS, 5, 5);

describe('runsOf', () => {
  it('reads the runs out of a line', () => {
    expect(runsOf([true, true, false, true])).toEqual([2, 1]);
    expect(runsOf([false, false])).toEqual([]);
    expect(runsOf([true, true, true])).toEqual([3]);
    // A run touching the end still counts.
    expect(runsOf([false, true])).toEqual([1]);
  });
});

describe('cluesFor', () => {
  it('describes the plus sign correctly', () => {
    expect(PLUS_PUZZLE.rowClues).toEqual([[1], [1], [5], [1], [1]]);
    expect(PLUS_PUZZLE.colClues).toEqual([[1], [1], [5], [1], [1]]);
  });

  it('reads rows and columns consistently', () => {
    for (let y = 0; y < 5; y++) {
      expect(runsOf(rowOf(PLUS, PLUS_PUZZLE, y))).toEqual(PLUS_PUZZLE.rowClues[y]);
    }
    for (let x = 0; x < 5; x++) {
      expect(runsOf(colOf(PLUS, PLUS_PUZZLE, x))).toEqual(PLUS_PUZZLE.colClues[x]);
    }
  });
});

describe('minimumSpan', () => {
  it('counts the runs plus one gap between each pair', () => {
    expect(minimumSpan([])).toBe(0);
    expect(minimumSpan([3])).toBe(3);
    expect(minimumSpan([1, 1])).toBe(3);
    expect(minimumSpan([2, 3, 1])).toBe(8);
  });
});

describe('isWellFormed', () => {
  it('accepts a real puzzle', () => {
    expect(isWellFormed(PLUS_PUZZLE)).toBe(true);
  });

  it('rejects clues that cannot fit their line', () => {
    expect(
      isWellFormed({ ...PLUS_PUZZLE, rowClues: [[3, 3], [1], [5], [1], [1]] }),
    ).toBe(false);
  });

  /** The same painted cells counted two ways have to come to the same number. */
  it('rejects rows and columns that disagree on the total', () => {
    expect(isWellFormed({ ...PLUS_PUZZLE, rowClues: [[1], [1], [4], [1], [1]] })).toBe(false);
  });

  it('rejects a run of zero', () => {
    expect(isWellFormed({ ...PLUS_PUZZLE, rowClues: [[0], [1], [5], [1], [1]] })).toBe(false);
  });
});

describe('marks', () => {
  it('round-trips a move through its packed integer', () => {
    for (const cell of [0, 1, 40, 224]) {
      for (const mark of [Mark.Blank, Mark.Filled, Mark.Cross]) {
        expect(unpackMove(packMove({ cell, mark }))).toEqual({ cell, mark });
      }
    }
  });

  it('leaves the board alone when nothing changes', () => {
    const board = emptyBoard(PLUS_PUZZLE);
    expect(applyMove(board, { cell: 0, mark: Mark.Blank })).toBe(board);
  });

  it('never mutates the board it was given', () => {
    const board = emptyBoard(PLUS_PUZZLE);
    const next = applyMove(board, { cell: 3, mark: Mark.Filled });
    expect(board[3]).toBe(Mark.Blank);
    expect(next[3]).toBe(Mark.Filled);
  });

  it('replays a move list exactly', () => {
    const moves = [
      { cell: 2, mark: Mark.Filled },
      { cell: 7, mark: Mark.Cross },
      { cell: 2, mark: Mark.Blank },
      { cell: 12, mark: Mark.Filled },
    ];
    const board = replay(PLUS_PUZZLE, moves);
    expect(board[2]).toBe(Mark.Blank);
    expect(board[7]).toBe(Mark.Cross);
    expect(board[12]).toBe(Mark.Filled);
  });
});

describe('isSolved', () => {
  const painted = (cells: number[]): Board => {
    const board = emptyBoard(PLUS_PUZZLE);
    for (const cell of cells) board[cell] = Mark.Filled;
    return board;
  };

  const allPainted = PLUS.map((on, index) => (on ? index : -1)).filter((i) => i >= 0);

  it('accepts the picture painted exactly', () => {
    expect(isSolved(painted(allPainted), PLUS)).toBe(true);
  });

  /**
   * The crosses are the player's own bookkeeping, not a condition. Requiring
   * them would fail a correct picture for an omission.
   */
  it('does not care whether the empties were crossed off', () => {
    const board = painted(allPainted);
    board[0] = Mark.Cross;
    expect(isSolved(board, PLUS)).toBe(true);
    board[0] = Mark.Blank;
    expect(isSolved(board, PLUS)).toBe(true);
  });

  it('rejects a missing cell and an extra one', () => {
    const missing = painted(allPainted.slice(1));
    expect(isSolved(missing, PLUS)).toBe(false);

    const extra = painted([...allPainted, 0]);
    expect(isSolved(extra, PLUS)).toBe(false);
  });
});

describe('progress measures', () => {
  it('counts painted, correct and mistaken cells', () => {
    expect(paintedCount(PLUS)).toBe(9);

    const board = emptyBoard(PLUS_PUZZLE);
    board[2] = Mark.Filled; // right
    board[0] = Mark.Filled; // wrong
    expect(correctIn(board, PLUS)).toBe(1);
    expect(mistakesIn(board, PLUS)).toBe(1);
  });

  it('marks a line complete only when it matches the picture', () => {
    const board = emptyBoard(PLUS_PUZZLE);
    // Row 2 is the full bar.
    for (let x = 0; x < 5; x++) board[2 * 5 + x] = Mark.Filled;

    const done = completedLines(board, PLUS, PLUS_PUZZLE);
    expect(done.rows.has(2)).toBe(true);
    // Row 0 still wants the one cell of the upright.
    expect(done.rows.has(0)).toBe(false);
    // Column 2 is the upright and still needs its four other cells.
    expect(done.cols.has(2)).toBe(false);
    // Columns either side hold exactly one painted cell, and the bar just
    // supplied it — so they are finished, and their clues grey out.
    expect(done.cols.has(0)).toBe(true);
    expect(done.cols.has(4)).toBe(true);
  });
});
