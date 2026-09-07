import { describe, expect, it } from 'vitest';

import { rankOf } from '../shared/cards';
import { createRng, hashSeed } from '../shared/rng';
import { pressureForLevel } from '../shared/difficulty';
import { CARDS, SETS, applyMove, deal, isWon, stateKey, unpackMove } from './model';
import {
  GOOD_ENOUGH,
  TWO_SUIT_FROM,
  generateLevel,
  packFor,
  shortfall,
  suitsFor,
} from './generate';

/**
 * The sweep.
 *
 * The most valuable test in the game: for a spread of levels it asserts that the
 * pack is a real pack, that the board is not already out, that the line the
 * generator verified with actually wins when it is replayed, and that the whole
 * thing is a pure function of the seed. Spider's search cannot prove a deal
 * unsolvable, so the *replay* is what carries the promise here — it is the only
 * thing standing between a player and a level that cannot be finished.
 */
const LEVELS = [1, 2, 4, 8, 15, 22, 28, 34, 60, 140];

describe('generated levels', () => {
  for (const level of LEVELS) {
    describe(`level ${level}`, () => {
      const generated = generateLevel('sweep-seed', level);

      it('deals a real pack', () => {
        expect(generated.pack).toHaveLength(CARDS);
        const sorted = [...generated.pack].sort((a, b) => a - b);
        expect(sorted).toEqual([...packFor(generated.suits)].sort((a, b) => a - b));
        for (let rank = 1; rank <= 13; rank++) {
          expect(generated.pack.filter((card) => rankOf(card) === rank)).toHaveLength(SETS);
        }
      });

      it('is not over before it starts', () => {
        expect(isWon(deal(generated.pack))).toBe(false);
      });

      it('goes out when the verified line is replayed', () => {
        const state = deal(generated.pack);
        for (const packed of generated.solution) {
          expect(applyMove(state, unpackMove(packed)), `level ${level} line broke`).toBe(true);
        }
        expect(isWon(state)).toBe(true);
        expect(generated.moves).toBe(generated.solution.length);
      });

      it('uses the suits the ladder says it should', () => {
        expect(generated.suits).toBe(suitsFor(level));
      });
    });
  }

  it(
    'gives the same board for the same seed and a different one otherwise',
    () => {
      const board = generateLevel('twice', 3).pack;
      expect(generateLevel('twice', 3).pack).toEqual(board);
      expect(generateLevel('other', 3).pack).not.toEqual(board);
      expect(generateLevel('twice', 4).pack).not.toEqual(board);
    },
    180_000,
  );

  /**
   * A band the format cannot reach makes every attempt miss, which is invisible
   * from inside a single level.
   *
   * What the generator promises is `GOOD_ENOUGH` rather than zero — it stops
   * looking once it is that close — and the two-suit levels just above the
   * ladder step are where it spends that allowance: a two-suit board scores at
   * the top of the scale and the band up there has not quite saturated, so they
   * land a shade *harder* than asked, which is the direction this collection
   * prefers to miss in.
   */
  it(
    'lands inside the band the curve asked for',
    () => {
      const misses: number[] = [];
      for (const level of [1, 5, 12, 20, 60, 120]) {
        const pressure = pressureForLevel(level, createRng(hashSeed('band', 'pressure', level)));
        const generated = generateLevel('band', level);
        const [lo, hi] = pressure.band;
        misses.push(
          generated.difficulty < lo
            ? lo - generated.difficulty
            : generated.difficulty > hi
              ? generated.difficulty - hi
              : 0,
        );
      }

      expect(Math.max(...misses), 'a level landed nowhere near its band').toBeLessThanOrEqual(0.12);
      expect(
        misses.filter((distance) => distance > GOOD_ENOUGH).length,
        'too many levels fell back past the good-enough stop',
      ).toBeLessThanOrEqual(1);
    },
    300_000,
  );

  it(
    'gets harder as the levels go up',
    () => {
      const early = [1, 2, 3, 4].map((level) => generateLevel('ramp', level).difficulty);
      const late = [40, 50, 60, 70].map((level) => generateLevel('ramp', level).difficulty);
      const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
      expect(mean(late)).toBeGreaterThan(mean(early) + 0.2);
    },
    300_000,
  );

  it('steps up to two suits once, and never back down', () => {
    for (let level = 1; level < TWO_SUIT_FROM; level++) expect(suitsFor(level)).toBe(1);
    for (let level = TWO_SUIT_FROM; level < TWO_SUIT_FROM + 200; level++) {
      expect(suitsFor(level)).toBe(2);
    }
  });
});

describe('the difficulty signal', () => {
  it('is 0 on a board that is out and 1 on one that cannot move', () => {
    const rng = createRng(hashSeed('signal'));

    const won = deal(packFor(1));
    won.completed = SETS;
    expect(shortfall(won, rng, 4)).toBe(0);

    const dead = deal(packFor(1));
    dead.stock = [];
    dead.columns = dead.columns.map(() => ({ cards: [], down: 0 }));
    expect(shortfall(dead, rng, 4)).toBe(1);
  });

  it('leaves the board it was handed alone', () => {
    const state = deal(createRng(hashSeed('untouched')).shuffle(packFor(2)));
    const before = stateKey(state);
    shortfall(state, createRng(hashSeed('untouched', 'roll')), 6);
    expect(stateKey(state)).toBe(before);
  });
});
