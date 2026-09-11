import { describe, expect, it } from 'vitest';

import { pressureForLevel } from '../shared/difficulty';
import { createRng, hashSeed } from '../shared/rng';
import { GAME_ID, generateLevel, score } from './generate';
import { CELLS, conflicts, isSolved } from './model';
import { countSolutions, logicalSolve } from './solve';

/**
 * The generator invariant sweep — the most valuable test in any of these games.
 *
 * Four claims, on every level in the sweep:
 *
 *  1. the grid is well-formed and consistent with its own answer;
 *  2. it has **exactly one** solution, checked by exhaustive search rather than
 *     by the generator's say-so;
 *  3. reasoning alone finishes it, with no guessing;
 *  4. the answer the generator carries is the answer the solver finds.
 *
 * Claim 2 is the one a player feels. A grid with two answers marks a correct
 * deduction as an error, and the only way to find out is to have somebody lose
 * an hour to it.
 */

const SWEEP = [1, 2, 3, 4, 6, 9, 13, 18, 24, 31, 40, 50, 62, 77, 95, 120, 180];

describe('generated grids', () => {
  for (const level of SWEEP) {
    describe(`level ${level}`, () => {
      const generated = generateLevel('sweep-seed', level);

      it('is a well-formed grid', () => {
        expect(generated.givens).toHaveLength(CELLS);
        expect(generated.solution).toHaveLength(CELLS);
        for (const digit of generated.givens) {
          expect(Number.isInteger(digit)).toBe(true);
          expect(digit).toBeGreaterThanOrEqual(0);
          expect(digit).toBeLessThanOrEqual(9);
        }
        expect(conflicts(generated.givens).size).toBe(0);
      });

      it('is not already finished', () => {
        expect(generated.clues).toBeLessThan(CELLS);
        expect(isSolved(generated.givens)).toBe(false);
      });

      it('carries a legal, complete answer', () => {
        expect(isSolved(generated.solution)).toBe(true);
        for (let cell = 0; cell < CELLS; cell++) {
          if (generated.givens[cell]) {
            expect(generated.givens[cell]).toBe(generated.solution[cell]);
          }
        }
      });

      it('has exactly one solution', () => {
        expect(countSolutions(generated.givens, 3)).toBe(1);
      });

      it('can be finished by reasoning, with no guessing', () => {
        const result = logicalSolve(generated.givens);
        expect(result.solved).toBe(true);
        // And what reasoning reaches is the answer the level was built from.
        expect(result.grid).toEqual(generated.solution);
      });

      it('keeps enough clues on the board to be readable', () => {
        expect(generated.clues).toBeGreaterThanOrEqual(22);
        expect(generated.clues).toBeLessThanOrEqual(46);
      });
    });
  }
});

describe('determinism', () => {
  it('is a pure function of (seed, level)', () => {
    for (const level of [1, 17, 60]) {
      const first = generateLevel('same', level);
      const second = generateLevel('same', level);
      expect(first.givens).toEqual(second.givens);
      expect(first.solution).toEqual(second.solution);
      expect(first.difficulty).toBe(second.difficulty);
    }
  });

  it('gives different profiles different grids', () => {
    const a = generateLevel('profile-a', 10);
    const b = generateLevel('profile-b', 10);
    expect(a.givens).not.toEqual(b.givens);
  });
});

describe('the difficulty curve', () => {
  /**
   * Not "every level lands in its band" — the band is a target and a dig can
   * fall short of it. What has to hold is that the curve *goes somewhere*: the
   * bug this guards against is the one Color Sort shipped, where difficulty
   * plateaued early and level 100 played like level 20.
   */
  it('climbs from level 1 to the ceiling', () => {
    const mean = (levels: number[]): number =>
      levels.reduce((sum, level) => sum + generateLevel('curve', level).difficulty, 0) /
      levels.length;

    const early = mean([1, 2, 3, 4, 5]);
    const middle = mean([14, 15, 16, 17, 18]);
    const late = mean([48, 49, 50, 51, 52]);

    expect(early).toBeLessThan(middle);
    expect(middle).toBeLessThan(late);
    expect(late - early).toBeGreaterThan(0.2);
  });

  it('mostly lands inside the band it was asked for', () => {
    let hits = 0;
    const levels = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100];

    for (const level of levels) {
      const rng = createRng(hashSeed('band-check', GAME_ID, level));
      const { band } = pressureForLevel(level, rng);
      const generated = generateLevel('band-check', level);
      if (generated.difficulty >= band[0] && generated.difficulty <= band[1]) hits++;
    }

    // Not all of them: the deepest dig from a given solution has a ceiling, and
    // a late level occasionally falls a few hundredths short of the band's
    // bottom. Ten out of sixteen is the measured floor; below that something has
    // stopped working rather than merely being unlucky.
    expect(hits).toBeGreaterThanOrEqual(10);
  });
});

describe('score', () => {
  it('is zero for a grid that takes no work', () => {
    expect(score([0, 0, 0, 0, 0, 0, 0, 0])).toBe(0);
  });

  it('rises with the amount of work, and with how hard it is', () => {
    const twentySingles = [0, 20, 0, 0, 0, 0, 0, 0];
    const fortySingles = [0, 40, 0, 0, 0, 0, 0, 0];
    const withHardSteps = [0, 20, 0, 0, 0, 0, 0, 3];

    expect(score(fortySingles)).toBeGreaterThan(score(twentySingles));
    expect(score(withHardSteps)).toBeGreaterThan(score(twentySingles));
  });

  it('never leaves 0..1', () => {
    expect(score([0, 200, 50, 50, 50, 50, 50, 50])).toBeLessThanOrEqual(1);
    expect(score([0, 1, 0, 0, 0, 0, 0, 0])).toBeGreaterThanOrEqual(0);
  });
});
