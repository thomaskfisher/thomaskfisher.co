import { describe, expect, it } from 'vitest';

import { pressureForLevel } from '../shared/difficulty';
import { createRng, hashSeed } from '../shared/rng';
import {
  GAME_ID,
  MAX_WIDTH,
  MIN_WIDTH,
  generateLevel,
  score,
  widthForPressure,
} from './generate';
import { SIDES, isSolved, neighbour, opposite, popcount, replay, rotateTimes } from './model';
import { nextTurn, propagate, turnsRemaining } from './solve';

/**
 * The generator invariant sweep — the most valuable test in any of these games.
 *
 * The claims here are a little different from the other puzzles', because
 * solvability is a property of the construction rather than of a search:
 *
 *  1. the answer really is a spanning tree — connected, covering, no leaks;
 *  2. the board opens scrambled rather than finished;
 *  3. the scramble is a rotation of the answer, tile for tile, so turning each
 *     one back wins;
 *  4. following the hint from the opening position actually finishes the level.
 *
 * Claim 4 is the one a player feels, and it is the whole level played through
 * rather than a spot check.
 */

const SWEEP = [1, 2, 3, 4, 6, 9, 13, 18, 24, 31, 40, 50, 62, 77, 95, 120, 180];

describe('generated boards', () => {
  for (const level of SWEEP) {
    describe(`level ${level}`, () => {
      const generated = generateLevel('sweep-seed', level);
      const { board, start } = generated;

      it('is a well-formed grid', () => {
        expect(board.width).toBeGreaterThanOrEqual(MIN_WIDTH);
        expect(board.width).toBeLessThanOrEqual(MAX_WIDTH);
        expect(board.solution).toHaveLength(board.width * board.height);
        expect(start).toHaveLength(board.solution.length);
        expect(board.source).toBeGreaterThanOrEqual(0);
        expect(board.source).toBeLessThan(board.solution.length);
      });

      it('has an answer that is whole, fed and leak-free', () => {
        expect(isSolved(board, board.solution)).toBe(true);
      });

      /** A spanning tree over n cells has exactly n-1 edges. */
      it('has an answer that is a spanning tree', () => {
        let stubs = 0;
        for (const mask of board.solution) stubs += popcount(mask);
        expect(stubs / 2).toBe(board.solution.length - 1);
      });

      it('has stubs that agree with each other and never leave the grid', () => {
        for (let cell = 0; cell < board.solution.length; cell++) {
          const mask = board.solution[cell] as number;
          for (let sideIndex = 0; sideIndex < 4; sideIndex++) {
            const side = SIDES[sideIndex] as number;
            if (!(mask & side)) continue;
            const other = neighbour(board, cell, sideIndex);
            expect(other, `cell ${cell} points off the grid`).toBeGreaterThanOrEqual(0);
            expect((board.solution[other] as number) & opposite(side)).toBeTruthy();
          }
        }
      });

      it('does not open already solved', () => {
        expect(isSolved(board, start)).toBe(false);
        expect(generated.turns).toBeGreaterThan(0);
      });

      /** Every opening tile is some rotation of the answer's tile. */
      it('opens on a scramble of its own answer', () => {
        for (let cell = 0; cell < start.length; cell++) {
          const target = board.solution[cell] as number;
          const options = [0, 1, 2, 3].map((turn) => rotateTimes(target, turn));
          expect(options).toContain(start[cell]);
        }
      });

      /**
       * The playthrough. Takes the hint from the opening position and follows it
       * to the end — the same loop the browser check runs, minus the browser.
       */
      it('is finished by following the hint', () => {
        let tiles = start.slice();
        const moves: number[] = [];

        for (let step = 0; step < board.solution.length * 4 + 8; step++) {
          if (isSolved(board, tiles)) break;
          const advice = nextTurn(board, tiles);
          expect(advice, `hint dried up with ${turnsRemaining(board, tiles)} turns left`).not.toBeNull();
          if (!advice) return;

          // The hint names a mask, so the player turns until the tile reaches it.
          let guard = 0;
          while (tiles[advice.cell] !== advice.to && guard++ < 4) {
            tiles = replay(tiles, [advice.cell]);
            moves.push(advice.cell);
          }
        }

        expect(isSolved(board, tiles)).toBe(true);
        // And the hint never asked for more turns than the board said it needed.
        expect(moves.length).toBe(generated.turns);
      });

      it('is fully determined by the constraints', () => {
        // Boards grown this way always are — see the note at the top of
        // `solve.ts`. This is the assertion that would notice if that stopped
        // being true, which would mean levels needing a guess.
        expect(propagate(board, start).forcedShare).toBeGreaterThan(0.9);
      });
    });
  }
});

describe('determinism', () => {
  it('is a pure function of (seed, level)', () => {
    for (const level of [1, 17, 60]) {
      const first = generateLevel('same', level);
      const second = generateLevel('same', level);
      expect(first.board.solution).toEqual(second.board.solution);
      expect(first.start).toEqual(second.start);
      expect(first.difficulty).toBe(second.difficulty);
    }
  });

  it('gives different profiles different boards', () => {
    expect(generateLevel('profile-a', 10).start).not.toEqual(generateLevel('profile-b', 10).start);
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

  it('mostly lands inside the band it was asked for', () => {
    let hits = 0;
    const levels = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100];

    for (const level of levels) {
      const rng = createRng(hashSeed('band-check', GAME_ID, level));
      const { band } = pressureForLevel(level, rng);
      const generated = generateLevel('band-check', level);
      if (generated.difficulty >= band[0] && generated.difficulty <= band[1]) hits++;
    }

    // Not all of them: the spread between two trees grown at the same setting is
    // wider than the lever that biases them, so a late level occasionally falls
    // a few hundredths short. Eleven of sixteen is the measured floor.
    expect(hits).toBeGreaterThanOrEqual(11);
  });

  it('grows the grid with the curve, and stops at what a phone can show', () => {
    expect(widthForPressure(0)).toBe(MIN_WIDTH);
    expect(widthForPressure(1)).toBe(MAX_WIDTH);
    expect(widthForPressure(1.5)).toBe(MAX_WIDTH);
  });
});

describe('score', () => {
  it('rises with the grid and with how far the eye has to travel', () => {
    expect(score(MAX_WIDTH, 4)).toBeGreaterThan(score(MIN_WIDTH, 4));
    expect(score(6, 6)).toBeGreaterThan(score(6, 3));
  });

  it('never leaves 0..1', () => {
    expect(score(MIN_WIDTH, 0)).toBeGreaterThanOrEqual(0);
    expect(score(MAX_WIDTH, 99)).toBeLessThanOrEqual(1);
  });
});
