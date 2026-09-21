import { describe, expect, it } from 'vitest';

import { createRng } from '../shared/rng';
import { FLEETS, placeFleet } from './generate';
import { type Layout, Mark, type Puzzle, Segment, countsOf, emptyBoard, segmentOf } from './model';
import { CONTRADICTION, countLayouts, deduce, findMistake, nextHint, solve } from './solve';

function parse(rows: string[]): Layout {
  return rows.join('').split('').map((c) => c === '#');
}

const LAYOUT = parse(['###..#', '......', '#.##.#', '#.....', '...#..', '......']);
const FLEET = [3, 2, 2, 1, 1, 1];

function puzzleFor(layout: Layout, size: number, fleet: number[], givens: Puzzle['givens'] = []): Puzzle {
  const counts = countsOf(layout, size);
  return { size, fleet, rowCounts: counts.rows, colCounts: counts.cols, givens };
}

describe('single rules', () => {
  it('reads a given single as water all round', () => {
    const puzzle = puzzleFor(LAYOUT, 6, FLEET, [{ cell: 5, kind: Segment.Single }]);
    const next = deduce(puzzle, emptyBoard(puzzle));
    expect(next).not.toBe(CONTRADICTION);
    if (!next || next === CONTRADICTION) return;
    expect(next.rule).toBe('shape');
    expect(next.found.map((f) => f.cell).sort((a, b) => a - b)).toEqual([4, 11]);
    expect(next.found.every((f) => f.mark === Mark.Water)).toBe(true);
  });

  it('extends a given end into its ship', () => {
    const puzzle = puzzleFor(LAYOUT, 6, FLEET, [{ cell: 12, kind: Segment.Down }]);
    const next = deduce(puzzle, emptyBoard(puzzle));
    if (!next || next === CONTRADICTION) throw new Error('expected a deduction');
    expect(next.found).toContainEqual({ cell: 18, mark: Mark.Ship });
    expect(next.found).toContainEqual({ cell: 6, mark: Mark.Water });
  });

  it('waters a row whose count is already met', () => {
    // Row 1 holds no ships at all.
    const puzzle = puzzleFor(LAYOUT, 6, FLEET);
    const next = deduce(puzzle, emptyBoard(puzzle));
    if (!next || next === CONTRADICTION) throw new Error('expected a deduction');
    expect(next.rule).toBe('count');
    expect(next.found.every((f) => f.mark === Mark.Water)).toBe(true);
  });

  it('reports a board no answer fits', () => {
    const puzzle = puzzleFor(LAYOUT, 6, FLEET);
    const board = emptyBoard(puzzle);
    // Two ships in row 1, which holds none.
    board[6] = Mark.Ship;
    board[8] = Mark.Ship;
    expect(deduce(puzzle, board)).toBe(CONTRADICTION);
  });
});

/**
 * Soundness, measured rather than argued: on random layouts with random
 * givens, every square any rule ever writes agrees with the layout the puzzle
 * was built from. A rule that wrote one wrong square would ship levels whose
 * hint leads the player astray.
 */
describe('soundness', () => {
  it('never writes a square that disagrees with the answer', () => {
    const rng = createRng(7);
    for (let trial = 0; trial < 60; trial++) {
      const size = 6 + (trial % 5);
      const fleet = FLEETS[size] as number[];
      const layout = placeFleet(rng, size, fleet);
      if (!layout) throw new Error('fleet would not place');
      const givens: Puzzle['givens'] = [];
      for (let cell = 0; cell < layout.length; cell++) {
        if (!rng.chance(0.08)) continue;
        givens.push({ cell, kind: layout[cell] ? segmentOf(layout, size, cell) : 'water' });
      }
      const puzzle = puzzleFor(layout, size, fleet, givens);
      const result = solve(puzzle);
      expect(result.contradiction).toBe(false);
      for (let cell = 0; cell < layout.length; cell++) {
        if (result.board[cell] === Mark.Blank) continue;
        expect(result.board[cell] === Mark.Ship).toBe(layout[cell]);
      }
    }
  });

  it('only finishes puzzles with exactly one answer', () => {
    const rng = createRng(11);
    let finished = 0;
    for (let trial = 0; trial < 40; trial++) {
      const layout = placeFleet(rng, 6, FLEET);
      if (!layout) throw new Error('fleet would not place');
      const givens: Puzzle['givens'] = [];
      for (let cell = 0; cell < layout.length; cell++) {
        if (layout[cell] && rng.chance(0.25)) givens.push({ cell, kind: segmentOf(layout, 6, cell) });
      }
      const puzzle = puzzleFor(layout, 6, FLEET, givens);
      if (!solve(puzzle).solved) continue;
      finished++;
      expect(countLayouts(puzzle, 2)).toBe(1);
    }
    expect(finished).toBeGreaterThan(10);
  });
});

describe('hints', () => {
  it('names a wrong mark before anything else', () => {
    const board = emptyBoard(puzzleFor(LAYOUT, 6, FLEET));
    board[7] = Mark.Ship;
    expect(findMistake(board, LAYOUT)).toBe(7);
    board[7] = Mark.Blank;
    board[0] = Mark.Water;
    expect(findMistake(board, LAYOUT)).toBe(0);
  });

  it('always has a correct next square on a mistake-free board', () => {
    const puzzle = puzzleFor(LAYOUT, 6, FLEET, [{ cell: 0, kind: Segment.Right }]);
    let board = emptyBoard(puzzle);
    for (let guard = 0; guard < 36; guard++) {
      if (board.every((mark, cell) => (mark === Mark.Ship) === LAYOUT[cell] || mark === Mark.Blank) &&
          LAYOUT.every((ship, cell) => !ship || board[cell] === Mark.Ship)) {
        break;
      }
      const hint = nextHint(puzzle, board, LAYOUT);
      if (!hint) throw new Error('no hint on an unfinished board');
      expect(hint.mark === Mark.Ship).toBe(LAYOUT[hint.cell]);
      board = board.slice();
      board[hint.cell] = hint.mark;
    }
    expect(LAYOUT.every((ship, cell) => !ship || board[cell] === Mark.Ship)).toBe(true);
  });
});
