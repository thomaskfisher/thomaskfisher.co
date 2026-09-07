import { describe, expect, it } from 'vitest';

import { CARDS_IN_DECK, orderedDeck } from '../shared/cards';
import { createRng, hashSeed } from '../shared/rng';
import { pressureForLevel } from '../shared/difficulty';
import { applyMove, deal, isWon, stateKey, unpackMove } from './model';
import { GOOD_ENOUGH, generateLevel, trapRate } from './generate';

/**
 * The sweep.
 *
 * This is the most valuable test in the game: for a spread of levels it asserts
 * that the deal is a real deck, that it is not already over, that the line the
 * generator verified with actually wins when it is replayed, and that the whole
 * thing is a pure function of the seed. If this passes, the promise the
 * collection is built on — no level is ever a dead end — holds.
 *
 * The levels are spaced rather than consecutive because a hard level costs a
 * few seconds to build and the interesting variation is across the curve.
 */
const LEVELS = [1, 2, 3, 5, 9, 14, 22, 35, 50, 90, 160];

describe('generated levels', () => {
  for (const level of LEVELS) {
    describe(`level ${level}`, () => {
      const generated = generateLevel('sweep-seed', level);

      it('deals a real deck', () => {
        expect(generated.deck).toHaveLength(CARDS_IN_DECK);
        expect([...generated.deck].sort((a, b) => a - b)).toEqual(orderedDeck());
      });

      it('is not over before it starts', () => {
        expect(isWon(deal(generated.deck))).toBe(false);
      });

      it('goes out when the verified line is replayed', () => {
        const state = deal(generated.deck);
        for (const packed of generated.solution) {
          expect(applyMove(state, unpackMove(packed)), `level ${level} line broke`).toBe(true);
        }
        expect(isWon(state)).toBe(true);
        expect(generated.moves).toBe(generated.solution.length);
      });

      it('scores somewhere on the difficulty scale', () => {
        expect(generated.difficulty).toBeGreaterThanOrEqual(0);
        expect(generated.difficulty).toBeLessThanOrEqual(1);
      });
    });
  }

  it(
    'gives the same board for the same seed and a different one otherwise',
    () => {
      const board = generateLevel('twice', 4).deck;
      expect(generateLevel('twice', 4).deck).toEqual(board);
      expect(generateLevel('other', 4).deck).not.toEqual(board);
      expect(generateLevel('twice', 5).deck).not.toEqual(board);
    },
    120_000,
  );

  /**
   * The curve is only worth anything if the generator can actually reach it.
   * A band the format cannot hit makes every attempt miss, which is the failure
   * that flattened an earlier game's difficulty and is invisible from inside a
   * single level.
   */
  it(
    'lands inside the band the curve asked for',
    () => {
      const checked = [1, 6, 18, 40, 75];
      const misses: number[] = [];

      for (const level of checked) {
        const pressure = pressureForLevel(level, createRng(hashSeed('band', 'pressure', level)));
        const generated = generateLevel('band', level);
        const [lo, hi] = pressure.band;
        const distance =
          generated.difficulty < lo
            ? lo - generated.difficulty
            : generated.difficulty > hi
              ? generated.difficulty - hi
              : 0;
        misses.push(distance);
      }

      // The generator stops looking once it is within `GOOD_ENOUGH` of the
      // band, so that — not zero — is what it actually promises. Anything
      // further out is the last-resort fallback, which should be rare and
      // should still be close; a pile of those means the band is asking for a
      // board the format cannot deal, which is invisible from inside a level.
      expect(Math.max(...misses), 'a level landed nowhere near its band').toBeLessThanOrEqual(0.12);
      expect(
        misses.filter((distance) => distance > GOOD_ENOUGH).length,
        'too many levels fell back past the good-enough stop',
      ).toBeLessThanOrEqual(1);
    },
    180_000,
  );

  it(
    'gets harder as the levels go up',
    () => {
      const early = [1, 2, 3, 4].map((level) => generateLevel('ramp', level).difficulty);
      const late = [45, 55, 65, 75].map((level) => generateLevel('ramp', level).difficulty);
      const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
      expect(mean(late)).toBeGreaterThan(mean(early) + 0.2);
    },
    180_000,
  );
});

describe('the trap rate', () => {
  it('is 0 on a board that is already home and 1 on one that cannot move', () => {
    const rng = createRng(hashSeed('trap'));

    const won = deal(orderedDeck());
    won.foundations = [13, 13, 13, 13];
    expect(trapRate(won, rng, 4)).toBe(0);

    const dead = deal(orderedDeck());
    dead.stock = [];
    dead.waste = [];
    dead.tableau = dead.tableau.map(() => ({ cards: [], down: 0 }));
    dead.foundations = [0, 0, 0, 0];
    expect(trapRate(dead, rng, 4)).toBe(1);
  });

  it('leaves the board it was handed alone', () => {
    const state = deal(createRng(hashSeed('untouched')).shuffle(orderedDeck()));
    const before = stateKey(state);
    trapRate(state, createRng(hashSeed('untouched', 'roll')), 6);
    expect(stateKey(state)).toBe(before);
  });
});
