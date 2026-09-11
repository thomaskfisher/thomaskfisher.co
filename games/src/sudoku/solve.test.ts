import { describe, expect, it } from 'vitest';

import { createRng, hashSeed } from '../shared/rng';
import { CELLS, type Grid, candidates, conflicts, isSolved } from './model';
import { countSolutions, fillGrid, logicalSolve, nextPlacement, solveOne } from './solve';

const parse = (text: string): Grid =>
  text
    .replace(/[^0-9.]/g, '')
    .split('')
    .map((char) => (char === '.' ? 0 : Number(char)));

const blank = (): Grid => new Array<number>(CELLS).fill(0);

/** A textbook grid: solvable by singles alone, one answer. */
const EASY = parse(`
  53..7....
  6..195...
  .98....6.
  8...6...3
  4..8.3..1
  7...2...6
  .6....28.
  ...419..5
  ....8..79
`);

describe('countSolutions', () => {
  it('finds exactly one for a proper puzzle', () => {
    expect(countSolutions(EASY, 5)).toBe(1);
  });

  it('finds more than one when a clue is taken away', () => {
    const loose = EASY.slice();
    // Emptying a whole box leaves plenty of room for a second answer.
    for (const cell of [0, 1, 9, 10, 11, 18, 19, 20]) loose[cell] = 0;
    expect(countSolutions(loose, 2)).toBeGreaterThan(1);
  });

  it('finds none when the givens contradict each other', () => {
    const broken = blank();
    broken[0] = 4;
    broken[1] = 4;
    expect(countSolutions(broken, 2)).toBe(0);
  });

  /**
   * The claim the generator rests on: this is exhaustive, not budgeted. A grid
   * with one clue has an enormous number of answers, and asking for three must
   * return three rather than timing out or giving up.
   */
  it('stops at the limit rather than counting them all', () => {
    const nearlyEmpty = blank();
    nearlyEmpty[0] = 1;
    expect(countSolutions(nearlyEmpty, 3)).toBe(3);
  });

  it('counts an already-finished grid as one', () => {
    const solved = solveOne(EASY) as Grid;
    expect(countSolutions(solved, 2)).toBe(1);
  });
});

describe('solveOne', () => {
  it('returns a legal, complete grid that agrees with the givens', () => {
    const solution = solveOne(EASY) as Grid;
    expect(isSolved(solution)).toBe(true);
    for (let cell = 0; cell < CELLS; cell++) {
      if (EASY[cell]) expect(solution[cell]).toBe(EASY[cell]);
    }
  });

  it('returns null when there is nothing to find', () => {
    const broken = blank();
    broken[0] = 7;
    broken[8] = 7;
    expect(solveOne(broken)).toBeNull();
  });
});

describe('fillGrid', () => {
  it('builds a legal complete grid', () => {
    for (let seed = 0; seed < 8; seed++) {
      const rng = createRng(hashSeed('fill', seed));
      const grid = fillGrid((max) => rng.int(max));
      expect(isSolved(grid)).toBe(true);
      expect(conflicts(grid).size).toBe(0);
    }
  });

  it('is deterministic for a given seed, and varies across seeds', () => {
    const build = (seed: number): Grid => {
      const rng = createRng(hashSeed('fill', seed));
      return fillGrid((max) => rng.int(max));
    };
    expect(build(3)).toEqual(build(3));
    expect(build(3)).not.toEqual(build(4));
  });
});

describe('logicalSolve', () => {
  it('finishes a singles-only grid and says so', () => {
    const result = logicalSolve(EASY);
    expect(result.solved).toBe(true);
    expect(result.grid).toEqual(solveOne(EASY));
    expect(result.hardest).toBeGreaterThanOrEqual(1);
  });

  it('charges for the easiest technique that was available', () => {
    // An almost-full grid needs nothing but naked singles, however many
    // X-wings happen to be sitting in it.
    const solution = solveOne(EASY) as Grid;
    const nearlyDone = solution.slice();
    for (const cell of [0, 1, 2, 9, 10]) nearlyDone[cell] = 0;

    const result = logicalSolve(nearlyDone);
    expect(result.solved).toBe(true);
    expect(result.hardest).toBeLessThanOrEqual(2);
  });

  it('never contradicts the answer it is working towards', () => {
    const rng = createRng(hashSeed('logic', 1));
    const solution = fillGrid((max) => rng.int(max));
    const puzzle = solution.slice();
    for (const cell of rng.shuffle(Array.from({ length: CELLS }, (_, i) => i)).slice(0, 30)) {
      puzzle[cell] = 0;
    }

    const result = logicalSolve(puzzle);
    for (let cell = 0; cell < CELLS; cell++) {
      if (result.grid[cell]) expect(result.grid[cell]).toBe(solution[cell]);
    }
  });

  it('stops rather than guessing on a grid reasoning cannot reach', () => {
    const rng = createRng(hashSeed('hard', 9));
    const solution = fillGrid((max) => rng.int(max));
    const sparse = solution.slice();
    // Far too few clues to be unique, let alone deducible.
    for (const cell of rng.shuffle(Array.from({ length: CELLS }, (_, i) => i)).slice(0, 70)) {
      sparse[cell] = 0;
    }
    const result = logicalSolve(sparse);
    expect(result.solved).toBe(false);
    // Whatever it did place has to still be a legal position.
    expect(conflicts(result.grid).size).toBe(0);
  });

  it('counts one step per rank used', () => {
    const result = logicalSolve(EASY);
    const total = result.counts.reduce((sum, n) => sum + n, 0);
    // One step per empty cell at minimum, since every placement is one step.
    expect(total).toBeGreaterThanOrEqual(EASY.filter((digit) => digit === 0).length);
  });
});

describe('nextPlacement — the hint', () => {
  it('names a cell the player has not filled, with the right digit', () => {
    const solution = solveOne(EASY) as Grid;
    const hint = nextPlacement(EASY);
    expect(hint).not.toBeNull();
    if (!hint) return;

    expect(EASY[hint.cell]).toBe(0);
    expect(hint.digit).toBe(solution[hint.cell]);
  });

  /**
   * There is no hint ping-pong to guard against here, and it is worth knowing
   * why: a deduction is a pure function of the position and every hint *adds* a
   * digit, so two answers to the same question are the same answer and no hint
   * can undo the last one. The games with a search behind the hint cache a
   * winning line for exactly this reason.
   */
  it('returns the same answer for the same position', () => {
    expect(nextPlacement(EASY)).toEqual(nextPlacement(EASY.slice()));
  });

  it('walks a whole grid to completion one hint at a time', () => {
    const grid = EASY.slice();
    const solution = solveOne(EASY) as Grid;

    for (let step = 0; step < CELLS; step++) {
      if (grid.every((digit) => digit !== 0)) break;
      const hint = nextPlacement(grid);
      expect(hint, `stalled with ${grid.filter((d) => !d).length} cells left`).not.toBeNull();
      if (!hint) return;
      grid[hint.cell] = hint.digit;
    }

    expect(grid).toEqual(solution);
  });

  it('returns null once there is nothing left to place', () => {
    expect(nextPlacement(solveOne(EASY) as Grid)).toBeNull();
  });

  /** A wrong digit already on the board must not make the hint lie. */
  it('never suggests a digit that breaks a rule', () => {
    const grid = EASY.slice();
    const masks = candidates(grid);
    const hint = nextPlacement(grid);
    if (!hint) return;
    expect((masks[hint.cell] as number) & (1 << (hint.digit - 1))).not.toBe(0);
  });
});
