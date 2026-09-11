import { describe, expect, it } from 'vitest';

import { pressureForLevel } from '../shared/difficulty';
import { createRng, hashSeed } from '../shared/rng';
import {
  GAME_ID,
  generateLevel,
  lengthForPressure,
  rarityWindow,
  score,
  triesFor,
} from './generate';
import { isAllowedGuess, isWin, markGuess } from './model';
import { answerPool, greedyGuesses, suggest } from './solve';

/**
 * The generator invariant sweep.
 *
 * The claims that matter here are about the *word*:
 *
 *  1. it is a legal guess, so the player can type it;
 *  2. it is in the answer pool, so the hint can find it;
 *  3. a sensible player finds it inside the rows the level gives — which is the
 *     nearest thing this game has to "solvable", and it is checked by actually
 *     playing the level rather than by asserting it.
 */

const SWEEP = [1, 2, 3, 4, 6, 9, 13, 18, 24, 31, 40, 50, 62, 77, 95, 120, 180];

/**
 * Generating a level here means playing it through repeatedly to measure how
 * many rows a sensible player needs, and sometimes sixteen more times on top to
 * measure the trap rate. Sixteen levels of that is honest work rather than a
 * hang, so the sweep tests say so rather than failing as a five-second timeout.
 */
const SLOW = 120_000;

describe('generated levels', () => {
  for (const level of SWEEP) {
    describe(`level ${level}`, () => {
      const generated = generateLevel('sweep-seed', level);

      it('is well formed', () => {
        expect(generated.answer).toHaveLength(generated.length);
        expect(/^[a-z]+$/.test(generated.answer)).toBe(true);
        expect([5, 6, 7]).toContain(generated.length);
        expect(generated.tries).toBe(triesFor(generated.length));
        expect(generated.difficulty).toBeGreaterThanOrEqual(0);
        expect(generated.difficulty).toBeLessThanOrEqual(1);
      });

      it('is a word the player is allowed to type', () => {
        expect(isAllowedGuess(generated.answer)).toBe(true);
      });

      it('is drawn from the answer pool the hint searches', () => {
        expect(answerPool(generated.length)).toContain(generated.answer);
      });

      /** The playthrough: a sensible player has to find it in the rows given. */
      it('is found inside the rows the level allows', () => {
        expect(greedyGuesses(generated.answer, generated.length, generated.tries)).toBeLessThanOrEqual(
          generated.tries,
        );
      });

      /**
       * The hint walked to the end. Every suggestion must be legal to type and
       * the last one must be the answer, which is the whole contract.
       */
      it('is reachable by following the hint', () => {
        const rows: { word: string; marks: ReturnType<typeof markGuess> }[] = [];

        for (let attempt = 0; attempt < generated.tries; attempt++) {
          const advice = suggest(generated.length, rows);
          expect(advice, `hint dried up on row ${attempt + 1}`).not.toBeNull();
          if (!advice) return;
          expect(isAllowedGuess(advice)).toBe(true);

          const marks = markGuess(advice, generated.answer);
          rows.push({ word: advice, marks });
          if (isWin(marks)) return;
        }

        expect.fail(`hint never reached ${generated.answer} in ${generated.tries} rows`);
      });
    });
  }
});

describe('determinism', () => {
  it('is a pure function of (seed, level)', () => {
    for (const level of [1, 17, 60]) {
      expect(generateLevel('same', level)).toEqual(generateLevel('same', level));
    }
  });

  it('gives different profiles different words', () => {
    const words = new Set<string>();
    for (const seed of ['a', 'b', 'c', 'd']) {
      for (const level of [1, 2, 3]) words.add(generateLevel(seed, level).answer);
    }
    expect(words.size).toBeGreaterThan(6);
  });
});

describe('the shape of the ladder', () => {
  it('grows the word and the rows with the curve', () => {
    expect(lengthForPressure(0)).toBe(5);
    expect(lengthForPressure(0.6)).toBe(6);
    expect(lengthForPressure(1)).toBe(7);

    expect(triesFor(5)).toBe(6);
    expect(triesFor(7)).toBe(7);
  });

  /** The window slides rather than widens, so late levels stop offering ABOUT. */
  it('slides the rarity window down the list', () => {
    const early = rarityWindow(0.1, 2000);
    const late = rarityWindow(0.9, 2000);

    expect(early[0]).toBeLessThan(late[0]);
    expect(late[1]).toBeLessThanOrEqual(2000);
    expect(early[1]).toBeGreaterThan(early[0]);
  });
});

describe('the difficulty curve', () => {
  it(
    'climbs from level 1 to the ceiling',
    () => {
      const mean = (levels: number[]): number =>
        levels.reduce((sum, level) => sum + generateLevel('curve', level).difficulty, 0) /
        levels.length;

      const early = mean([1, 2, 3, 4, 5]);
      const late = mean([48, 49, 50, 51, 52]);

      expect(late).toBeGreaterThan(early);
      expect(late - early).toBeGreaterThan(0.25);
    },
    SLOW,
  );

  it(
    'mostly lands inside the band it was asked for',
    () => {
      let hits = 0;
      const levels = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100];

      for (const level of levels) {
        const rng = createRng(hashSeed('band-check', GAME_ID, level));
        const { band } = pressureForLevel(level, rng);
        const generated = generateLevel('band-check', level);
        // A shade of tolerance: `par` is a whole number of rows, so the score it
        // produces is quantised and can sit a hair outside a band edge.
        if (generated.difficulty >= band[0] - 0.02 && generated.difficulty <= band[1] + 0.02) {
          hits++;
        }
      }

      expect(hits).toBeGreaterThanOrEqual(13);
    },
    SLOW,
  );
});

describe('score', () => {
  /**
   * The direction that matters, and the one the first version had backwards:
   * a word needing more rows is harder. Length is deliberately not an input —
   * see the note on `lengthForPressure`.
   */
  it('rises with the rows a sensible player needs', () => {
    expect(score(4, 0)).toBeGreaterThan(score(3, 0));
    expect(score(3, 0)).toBeGreaterThan(score(2, 0));
  });

  it('rises with the trap rate', () => {
    expect(score(3, 1)).toBeGreaterThan(score(3, 0));
  });

  it('never leaves 0..1', () => {
    expect(score(1, 0)).toBeGreaterThanOrEqual(0);
    expect(score(9, 1)).toBeLessThanOrEqual(1);
  });
});
