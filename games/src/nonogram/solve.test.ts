import { describe, expect, it } from 'vitest';

import { createRng, hashSeed } from '../shared/rng';
import { Mark, type Picture, cluesFor, emptyBoard, isSolved } from './model';
import { countPictures, findMistake, linesOf, nextDeduction, solveByLines, solveLine } from './solve';

const B = Mark.Blank;
const F = Mark.Filled;
const X = Mark.Cross;

const blankLine = (n: number): Mark[] => new Array<Mark>(n).fill(B);

describe('solveLine', () => {
  it('fills a run that takes the whole line', () => {
    expect(solveLine([5], blankLine(5))).toEqual([F, F, F, F, F]);
  });

  it('crosses off a line with nothing in it', () => {
    expect(solveLine([], blankLine(4))).toEqual([X, X, X, X]);
  });

  /**
   * The overlap rule, which is the first thing anybody learns: a run longer than
   * half the line has to cover the middle however it is placed.
   */
  it('finds the overlap in the middle of a long run', () => {
    expect(solveLine([4], blankLine(5))).toEqual([B, F, F, F, B]);
    expect(solveLine([3], blankLine(5))).toEqual([B, B, F, B, B]);
  });

  it('learns nothing when the run can go anywhere', () => {
    expect(solveLine([1], blankLine(5))).toEqual([B, B, B, B, B]);
  });

  it('uses what is already painted', () => {
    // The 2 must cover cell 0, so it is cells 0-1 and the rest is empty.
    expect(solveLine([2], [F, B, B, B])).toEqual([F, F, X, X]);
  });

  it('uses crosses as hard as it uses paint', () => {
    // With cell 1 ruled out, a run of 3 can only sit at cells 2-4.
    expect(solveLine([3], [B, X, B, B, B])).toEqual([X, X, F, F, F]);
  });

  it('handles several runs at once', () => {
    expect(solveLine([1, 1], [B, B, B])).toEqual([F, X, F]);
    expect(solveLine([2, 1], [B, B, B, B])).toEqual([F, F, X, F]);
  });

  it('returns null when no arrangement is possible', () => {
    // A run of 3 cannot fit either side of a crossed-out middle.
    expect(solveLine([3], [B, B, X, B, B])).toBeNull();
    // Painted cells too far apart for one run.
    expect(solveLine([2], [F, B, F, B])).toBeNull();
    // Clues that simply do not fit.
    expect(solveLine([3, 3], blankLine(5))).toBeNull();
  });

  it('never contradicts a cell that is already decided', () => {
    // Cell 0 painted forces the first run onto it; the second can then sit at
    // cell 2 or cell 4, so only cell 1 is newly decided.
    const cells: Mark[] = [F, B, B, X, B];
    const out = solveLine([1, 1], cells);
    expect(out).toEqual([F, X, B, X, B]);

    for (let i = 0; i < cells.length; i++) {
      if (cells[i] !== B) expect(out?.[i]).toBe(cells[i]);
    }
  });
});

describe('solveByLines', () => {
  /** A 5x5 plus sign. Every line falls out of the overlap rule. */
  const PLUS: Picture = [
    false, false, true, false, false,
    false, false, true, false, false,
    true, true, true, true, true,
    false, false, true, false, false,
    false, false, true, false, false,
  ];

  it('finishes a puzzle that line logic can reach', () => {
    const puzzle = cluesFor(PLUS, 5, 5);
    const result = solveByLines(puzzle);

    expect(result.solved).toBe(true);
    expect(result.contradiction).toBe(false);
    for (let cell = 0; cell < PLUS.length; cell++) {
      expect(result.board[cell] === Mark.Filled).toBe(PLUS[cell]);
    }
  });

  it('reports the work it did', () => {
    const result = solveByLines(cluesFor(PLUS, 5, 5));
    expect(result.steps).toBeGreaterThan(0);
    // Never fewer lines read than deductions made.
    expect(result.examined).toBeGreaterThanOrEqual(result.steps);
  });

  /**
   * The checkerboard is the standard example of a nonogram with two answers —
   * every row and column reads `1 1 ...` either way round. Line logic can make
   * no progress at all on it, which is exactly what "needs a guess" looks like,
   * and is why the generator throws such a puzzle away.
   */
  it('stalls rather than guessing when a puzzle has two answers', () => {
    const checker: Picture = [];
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) checker.push((x + y) % 2 === 0);
    }
    const puzzle = cluesFor(checker, 4, 4);

    const result = solveByLines(puzzle);
    expect(result.solved).toBe(false);
    expect(result.contradiction).toBe(false);
    expect(countPictures(puzzle, 3)).toBeGreaterThan(1);
  });

  /**
   * The claim the generator rests on: finishing by line logic alone means the
   * answer was never in doubt, because every cell written was the same in every
   * consistent arrangement.
   */
  it('implies the picture is the only one that fits', () => {
    for (let sample = 0; sample < 10; sample++) {
      const rng = createRng(hashSeed('unique', sample));
      const size = 6;
      const picture: Picture = Array.from({ length: size * size }, () => rng.chance(0.5));
      const puzzle = cluesFor(picture, size, size);

      if (!solveByLines(puzzle).solved) continue;
      expect(countPictures(puzzle, 2)).toBe(1);
    }
  });
});

describe('nextDeduction — the hint', () => {
  const PLUS: Picture = [
    false, false, true, false, false,
    false, false, true, false, false,
    true, true, true, true, true,
    false, false, true, false, false,
    false, false, true, false, false,
  ];
  const puzzle = cluesFor(PLUS, 5, 5);

  it('names a cell the picture agrees with', () => {
    const hint = nextDeduction(puzzle, emptyBoard(puzzle));
    expect(hint).not.toBeNull();
    if (!hint) return;
    expect(hint.mark === Mark.Filled).toBe(PLUS[hint.cell]);
  });

  /** Pure in the position, so there is no ping-pong for a cache to prevent. */
  it('gives the same answer to the same position', () => {
    const board = emptyBoard(puzzle);
    expect(nextDeduction(puzzle, board)).toEqual(nextDeduction(puzzle, board.slice()));
  });

  it('walks a whole puzzle to a win one hint at a time', () => {
    const board = emptyBoard(puzzle);

    for (let step = 0; step < 200; step++) {
      if (isSolved(board, PLUS)) break;
      const hint = nextDeduction(puzzle, board);
      expect(hint, `stalled at step ${step}`).not.toBeNull();
      if (!hint) return;
      board[hint.cell] = hint.mark;
    }

    expect(isSolved(board, PLUS)).toBe(true);
  });

  it('returns null once there is nothing left to deduce', () => {
    const board = emptyBoard(puzzle);
    for (let cell = 0; cell < PLUS.length; cell++) {
      board[cell] = PLUS[cell] ? Mark.Filled : Mark.Cross;
    }
    expect(nextDeduction(puzzle, board)).toBeNull();
  });

  it('finds a painted cell the picture says is empty', () => {
    const board = emptyBoard(puzzle);
    expect(findMistake(board, PLUS)).toBeNull();
    board[0] = Mark.Filled;
    expect(findMistake(board, PLUS)).toBe(0);
  });
});

describe('linesOf', () => {
  it('produces one line per row and column, in reading order', () => {
    const puzzle = { width: 3, height: 2, rowClues: [[1], [1]], colClues: [[1], [], [1]] };
    const lines = linesOf(puzzle);

    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatchObject({ kind: 'row', index: 0, cells: [0, 1, 2] });
    expect(lines[2]).toMatchObject({ kind: 'col', index: 0, cells: [0, 3] });
  });
});
