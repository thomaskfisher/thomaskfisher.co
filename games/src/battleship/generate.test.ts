import { describe, expect, it } from 'vitest';

import { pressureForLevel } from '../shared/difficulty';
import { createRng, hashSeed } from '../shared/rng';
import { FLEETS, GAME_ID, MAX_SIZE, MIN_SIZE, generateLevel, score, sizeForPressure } from './generate';
import { Mark, countsOf, emptyBoard, isLegalLayout, isSolved, isWellFormed, segmentOf } from './model';
import { countLayouts, nextHint, solve } from './solve';

/**
 * The generator invariant sweep — the most valuable test in any of these games.
 *
 * On every level in the sweep:
 *
 *  1. the puzzle is well-formed, and its counts and givens describe its layout;
 *  2. the layout is a legal fleet;
 *  3. deduction alone finishes it, with no guessing anywhere;
 *  4. what deduction reaches *is* the layout the level was built from;
 *  5. it is not already solved;
 *  6. following the hint from the opening board wins it.
 */

const SWEEP = [1, 2, 3, 4, 6, 9, 13, 18, 24, 31, 40, 50, 62, 77, 95, 120, 180];

describe('generated puzzles', () => {
  for (const level of SWEEP) {
    describe(`level ${level}`, () => {
      const generated = generateLevel('sweep-seed', level);
      const { puzzle, layout } = generated;

      it('is well-formed and describes its own layout', () => {
        expect(isWellFormed(puzzle)).toBe(true);
        expect(puzzle.size).toBeGreaterThanOrEqual(MIN_SIZE);
        expect(puzzle.size).toBeLessThanOrEqual(MAX_SIZE);
        const counts = countsOf(layout, puzzle.size);
        expect(puzzle.rowCounts).toEqual(counts.rows);
        expect(puzzle.colCounts).toEqual(counts.cols);
        for (const given of puzzle.givens) {
          if (given.kind === 'water') expect(layout[given.cell]).toBe(false);
          else expect(segmentOf(layout, puzzle.size, given.cell)).toBe(given.kind);
        }
      });

      it('hides a legal fleet', () => {
        expect(isLegalLayout(layout, puzzle.size, puzzle.fleet)).toBe(true);
        expect(puzzle.fleet).toEqual(FLEETS[puzzle.size]);
      });

      it('is finished by deduction, to the layout it was built from', () => {
        const result = solve(puzzle);
        expect(result.solved).toBe(true);
        expect(result.contradiction).toBe(false);
        for (let cell = 0; cell < layout.length; cell++) {
          expect(result.board[cell] === Mark.Ship).toBe(layout[cell]);
        }
      });

      it('is not already solved', () => {
        expect(isSolved(emptyBoard(puzzle), layout)).toBe(false);
      });

      it('is won by following the hint', () => {
        let board = emptyBoard(puzzle);
        for (let guard = 0; guard < layout.length && !isSolved(board, layout); guard++) {
          const hint = nextHint(puzzle, board, layout);
          if (!hint) break;
          board = board.slice();
          board[hint.cell] = hint.mark;
        }
        expect(isSolved(board, layout)).toBe(true);
      });
    });
  }

  /**
   * A finished deduction implies one answer — but that is an argument. This
   * measures it exhaustively, on the small seas where a count is cheap.
   */
  it('has exactly one answer, checked exhaustively on the small grids', () => {
    for (const level of [1, 2, 3, 4]) {
      const generated = generateLevel('unique-seed', level);
      if (generated.puzzle.size > 7) continue;
      expect(countLayouts(generated.puzzle, 2)).toBe(1);
    }
  });
});

describe('determinism', () => {
  it('is a pure function of (seed, level)', () => {
    for (const level of [1, 17, 60]) {
      const first = generateLevel('same', level);
      const second = generateLevel('same', level);
      expect(first.puzzle).toEqual(second.puzzle);
      expect(first.layout).toEqual(second.layout);
    }
  });

  it('gives different profiles different puzzles', () => {
    expect(generateLevel('profile-a', 10).layout).not.toEqual(generateLevel('profile-b', 10).layout);
  });
});

describe('the difficulty curve', () => {
  it('climbs from level 1 to the ceiling', () => {
    const mean = (levels: number[]): number =>
      levels.reduce((sum, level) => sum + generateLevel('curve', level).difficulty, 0) / levels.length;
    const early = mean([1, 2, 3, 5, 6]);
    const middle = mean([14, 15, 16, 17, 18]);
    const late = mean([48, 49, 50, 51, 52]);
    expect(early).toBeLessThan(middle);
    expect(middle).toBeLessThan(late);
    expect(late - early).toBeGreaterThan(0.3);
  });

  it('lands inside the band it was asked for', () => {
    let hits = 0;
    const levels = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100];
    for (const level of levels) {
      const { band } = pressureForLevel(level, createRng(hashSeed('band-check', GAME_ID, level)));
      const generated = generateLevel('band-check', level);
      if (generated.difficulty >= band[0] && generated.difficulty <= band[1]) hits++;
    }
    // The probe hits every level it tries; dropping well below means a lever
    // has stopped working.
    expect(hits).toBeGreaterThanOrEqual(13);
  });

  it('starts on the small sea and stops at the classic one', () => {
    expect(sizeForPressure(0.23)).toBe(MIN_SIZE);
    expect(sizeForPressure(1)).toBe(MAX_SIZE);
    expect(sizeForPressure(1.4)).toBe(MAX_SIZE);
  });
});

describe('score', () => {
  it('rises with size, narrowness and sweeps, and stays in 0..1', () => {
    expect(score(MAX_SIZE, 4, 0)).toBeGreaterThan(score(MIN_SIZE, 4, 0));
    expect(score(8, 3.5, 0)).toBeGreaterThan(score(8, 6, 0));
    expect(score(8, 4, 2)).toBeGreaterThan(score(8, 4, 0));
    expect(score(MIN_SIZE, 99, 0)).toBeGreaterThanOrEqual(0);
    expect(score(MAX_SIZE, 0, 99)).toBeLessThanOrEqual(1);
  });
});
