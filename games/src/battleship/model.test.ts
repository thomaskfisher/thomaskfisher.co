import { describe, expect, it } from 'vitest';

import {
  type Layout,
  Mark,
  type Puzzle,
  Segment,
  applyMove,
  countsOf,
  emptyBoard,
  finishedShips,
  isLegalLayout,
  isSolved,
  isWellFormed,
  mistakesIn,
  packMove,
  segmentOf,
  shipsOf,
  unpackMove,
} from './model';

/** Parses a picture of a layout: `#` for ship, `.` for sea. */
function parse(rows: string[]): Layout {
  return rows.join('').split('').map((c) => c === '#');
}

/*
 * A 6x6 with the standard small fleet: a three, two twos, three ones.
 *
 *   # # # . . #
 *   . . . . . .
 *   # . # # . #
 *   # . . . . .
 *   . . . # . .
 *   . . . . . .
 */
const LAYOUT = parse(['###..#', '......', '#.##.#', '#.....', '...#..', '......']);
const FLEET = [3, 2, 2, 1, 1, 1];

function puzzleFor(layout: Layout): Puzzle {
  const counts = countsOf(layout, 6);
  return { size: 6, fleet: FLEET, rowCounts: counts.rows, colCounts: counts.cols, givens: [] };
}

describe('layouts', () => {
  it('reads ships off as straight runs', () => {
    const lengths = shipsOf(LAYOUT, 6)
      .map((ship) => ship.length)
      .sort((a, b) => b - a);
    expect(lengths).toEqual([3, 2, 2, 1, 1, 1]);
  });

  it('accepts a legal fleet', () => {
    expect(isLegalLayout(LAYOUT, 6, FLEET)).toBe(true);
  });

  it('rejects ships that touch at a corner', () => {
    const touching = parse(['#.....', '.#....', '......', '......', '......', '......']);
    expect(isLegalLayout(touching, 6, [1, 1])).toBe(false);
  });

  it('rejects the wrong fleet', () => {
    expect(isLegalLayout(LAYOUT, 6, [3, 3, 2, 1, 1])).toBe(false);
  });

  it('counts ship squares per line', () => {
    const { rows, cols } = countsOf(LAYOUT, 6);
    expect(rows).toEqual([4, 0, 4, 1, 1, 0]);
    expect(cols).toEqual([3, 1, 2, 2, 0, 2]);
  });

  it('names each piece by where its ship continues', () => {
    expect(segmentOf(LAYOUT, 6, 0)).toBe(Segment.Right);
    expect(segmentOf(LAYOUT, 6, 1)).toBe(Segment.Middle);
    expect(segmentOf(LAYOUT, 6, 2)).toBe(Segment.Left);
    expect(segmentOf(LAYOUT, 6, 5)).toBe(Segment.Single);
    expect(segmentOf(LAYOUT, 6, 12)).toBe(Segment.Down);
    expect(segmentOf(LAYOUT, 6, 18)).toBe(Segment.Up);
  });
});

describe('puzzles', () => {
  it('is well-formed when the counts add up to the fleet', () => {
    expect(isWellFormed(puzzleFor(LAYOUT))).toBe(true);
    expect(isWellFormed({ ...puzzleFor(LAYOUT), fleet: [3, 2, 1] })).toBe(false);
  });

  it('puts the givens on the opening board', () => {
    const puzzle = { ...puzzleFor(LAYOUT), givens: [{ cell: 5, kind: Segment.Single }, { cell: 6, kind: 'water' as const }] };
    const board = emptyBoard(puzzle);
    expect(board[5]).toBe(Mark.Ship);
    expect(board[6]).toBe(Mark.Water);
    expect(board[7]).toBe(Mark.Blank);
  });
});

describe('play', () => {
  it('round-trips a packed move', () => {
    for (const move of [
      { cell: 0, mark: Mark.Ship },
      { cell: 99, mark: Mark.Water },
      { cell: 41, mark: Mark.Blank },
    ]) {
      expect(unpackMove(packMove(move))).toEqual(move);
    }
  });

  it('never changes a given', () => {
    const board = emptyBoard(puzzleFor(LAYOUT));
    const locked = new Set([3]);
    expect(applyMove(board, { cell: 3, mark: Mark.Ship }, locked)).toBe(board);
    expect(applyMove(board, { cell: 4, mark: Mark.Ship }, locked)[4]).toBe(Mark.Ship);
  });

  it('is solved by the ships alone, whatever the water marks say', () => {
    const board: Mark[] = LAYOUT.map((ship) => (ship ? Mark.Ship : Mark.Blank));
    expect(isSolved(board, LAYOUT)).toBe(true);
    board[7] = Mark.Water;
    expect(isSolved(board, LAYOUT)).toBe(true);
    board[7] = Mark.Ship;
    expect(isSolved(board, LAYOUT)).toBe(false);
  });

  it('counts water on a ship as a mistake too', () => {
    const board = emptyBoard(puzzleFor(LAYOUT));
    board[0] = Mark.Water;
    board[6] = Mark.Ship;
    board[7] = Mark.Water;
    expect(mistakesIn(board, LAYOUT)).toBe(2);
  });

  it('ticks off a ship once both its ends are shut', () => {
    const board = emptyBoard(puzzleFor(LAYOUT));
    board[0] = board[1] = board[2] = Mark.Ship;
    expect(finishedShips(board, 6)).toEqual([]);
    board[3] = Mark.Water;
    // The left end is the edge of the sea.
    expect(finishedShips(board, 6)).toEqual([3]);
  });

  it('ticks off a single only when all four sides are shut', () => {
    const board = emptyBoard(puzzleFor(LAYOUT));
    board[5] = Mark.Ship;
    board[4] = Mark.Water;
    expect(finishedShips(board, 6)).toEqual([]);
    board[11] = Mark.Water;
    expect(finishedShips(board, 6)).toEqual([1]);
  });
});
