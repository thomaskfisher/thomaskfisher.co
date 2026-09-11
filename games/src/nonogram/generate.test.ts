import { describe, expect, it } from 'vitest';

import { pressureForLevel } from '../shared/difficulty';
import { createRng, hashSeed } from '../shared/rng';
import { GAME_ID, MAX_SIZE, MIN_SIZE, generateLevel, score, sizeForPressure } from './generate';
import { cluesFor, isWellFormed, paintedCount } from './model';
import { countPictures, solveByLines } from './solve';

/**
 * The generator invariant sweep — the most valuable test in any of these games.
 *
 * Four claims, on every level in the sweep:
 *
 *  1. the puzzle is well-formed and its clues describe its own picture;
 *  2. line logic alone finishes it, with no guessing anywhere;
 *  3. what line logic reaches *is* the picture the level was built from;
 *  4. the picture is substantial enough to be a picture.
 *
 * Claim 2 is the one a player feels. A nonogram that needs a guess is one where
 * an hour of correct reasoning ends in a wrong picture and no way to tell where
 * it went astray.
 */

const SWEEP = [1, 2, 3, 4, 6, 9, 13, 18, 24, 31, 40, 50, 62, 77, 95, 120, 180];

describe('generated puzzles', () => {
  for (const level of SWEEP) {
    describe(`level ${level}`, () => {
      const generated = generateLevel('sweep-seed', level);

      it('is a well-formed puzzle', () => {
        expect(isWellFormed(generated.puzzle)).toBe(true);
        expect(generated.puzzle.width).toBeGreaterThanOrEqual(MIN_SIZE);
        expect(generated.puzzle.width).toBeLessThanOrEqual(MAX_SIZE);
        expect(generated.picture).toHaveLength(
          generated.puzzle.width * generated.puzzle.height,
        );
      });

      it('carries clues that describe its own picture', () => {
        const derived = cluesFor(
          generated.picture,
          generated.puzzle.width,
          generated.puzzle.height,
        );
        expect(derived.rowClues).toEqual(generated.puzzle.rowClues);
        expect(derived.colClues).toEqual(generated.puzzle.colClues);
      });

      it('can be finished by line logic, with no guessing', () => {
        const result = solveByLines(generated.puzzle);
        expect(result.solved).toBe(true);
        expect(result.contradiction).toBe(false);
      });

      it('is solved to the picture it was built from', () => {
        const result = solveByLines(generated.puzzle);
        for (let cell = 0; cell < generated.picture.length; cell++) {
          expect(result.board[cell] === 1).toBe(generated.picture[cell]);
        }
      });

      it('is not already solved, and has a picture worth seeing', () => {
        const cells = generated.puzzle.width * generated.puzzle.height;
        expect(generated.painted).toBe(paintedCount(generated.picture));
        expect(generated.painted).toBeGreaterThanOrEqual(generated.puzzle.width * 2);
        expect(generated.painted).toBeLessThan(cells);
      });
    });
  }

  /**
   * Line solvability implies uniqueness — every cell written was the same in
   * every consistent arrangement — but that is an argument, not a measurement.
   * This measures it, on the small levels where an exhaustive count is cheap.
   */
  it('has exactly one answer, checked exhaustively on the small grids', () => {
    for (const level of [1, 2, 3]) {
      const generated = generateLevel('unique-seed', level);
      if (generated.puzzle.width > 9) continue;
      expect(countPictures(generated.puzzle, 2)).toBe(1);
    }
  });
});

describe('determinism', () => {
  it('is a pure function of (seed, level)', () => {
    for (const level of [1, 17, 60]) {
      const first = generateLevel('same', level);
      const second = generateLevel('same', level);
      expect(first.picture).toEqual(second.picture);
      expect(first.puzzle).toEqual(second.puzzle);
      expect(first.difficulty).toBe(second.difficulty);
    }
  });

  it('gives different profiles different puzzles', () => {
    expect(generateLevel('profile-a', 10).picture).not.toEqual(
      generateLevel('profile-b', 10).picture,
    );
  });
});

describe('the difficulty curve', () => {
  it('climbs from level 1 to the ceiling', () => {
    const mean = (levels: number[]): number =>
      levels.reduce((sum, level) => sum + generateLevel('curve', level).difficulty, 0) /
      levels.length;

    const early = mean([1, 2, 3, 4, 5]);
    const middle = mean([14, 15, 16, 17, 18]);
    const late = mean([48, 49, 50, 51, 52]);

    expect(early).toBeLessThan(middle);
    expect(middle).toBeLessThan(late);
    expect(late - early).toBeGreaterThan(0.25);
  });

  it('lands inside the band it was asked for', () => {
    let hits = 0;
    const levels = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100];

    for (const level of levels) {
      const rng = createRng(hashSeed('band-check', GAME_ID, level));
      const { band } = pressureForLevel(level, rng);
      const generated = generateLevel('band-check', level);
      if (generated.difficulty >= band[0] && generated.difficulty <= band[1]) hits++;
    }

    // Sweeping the density within a size reaches most of the band, so this is a
    // high bar on purpose: dropping below it means a lever has stopped working.
    expect(hits).toBeGreaterThanOrEqual(13);
  });

  it('grows the grid with the curve, and stops at what a phone can show', () => {
    expect(sizeForPressure(0)).toBe(MIN_SIZE);
    expect(sizeForPressure(1)).toBe(MAX_SIZE);
    expect(sizeForPressure(1.4)).toBe(MAX_SIZE);
    expect(sizeForPressure(0.5)).toBeGreaterThan(MIN_SIZE);
  });
});

describe('score', () => {
  it('rises with both the grid and the depth of the reasoning', () => {
    expect(score(MAX_SIZE, 4)).toBeGreaterThan(score(MIN_SIZE, 4));
    expect(score(10, 5.5)).toBeGreaterThan(score(10, 3.1));
  });

  it('never leaves 0..1', () => {
    expect(score(MIN_SIZE, 0)).toBeGreaterThanOrEqual(0);
    expect(score(MAX_SIZE, 99)).toBeLessThanOrEqual(1);
  });
});
