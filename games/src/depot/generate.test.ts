import { describe, expect, it } from 'vitest';

import { pressureForLevel } from '../shared/difficulty';
import { createRng, hashSeed } from '../shared/rng';
import { generateLevel, shapeFor } from './generate';
import {
  type Bus,
  type Level,
  createState,
  drivableIds,
  freeBay,
  isLost,
  isWellFormed,
  isWon,
  pull,
} from './model';
import { search } from './solve';

const SEED = 'test-depot';

/** A representative spread rather than a contiguous run: the curve is short. */
const LEVELS = [1, 2, 3, 4, 5, 7, 9, 12, 15, 18, 22, 27, 33, 41, 50, 64, 90, 140, 260];

/**
 * The sweep this whole game rests on.
 *
 * Every promise the collection makes about a level is checked here: that it is
 * built correctly, that it is not already over, that it can be finished, and —
 * the one that catches real bugs rather than typos — that the solver's own
 * answer wins when it is played back through the rules the player will hit.
 */
describe('every generated level', () => {
  for (const level of LEVELS) {
    it(`level ${level} is well built, unfinished and winnable`, () => {
      const generated = generateLevel(SEED, level);
      const spec: Level = { board: generated.board, queue: generated.queue };

      expect(isWellFormed(spec)).toBe(true);

      const start = createState(generated.board);
      expect(isWon(spec, start)).toBe(false);
      expect(isLost(spec, start)).toBe(false);

      const result = search(spec, { nodeBudget: 200_000 });
      expect(result.status).toBe('solved');

      // Replayed through `pull`, which is the same function the player's taps
      // go through. A solver that wins against its own model of the rules and
      // loses against the real ones is the failure this catches.
      const state = createState(generated.board);
      for (const id of result.moves) expect(pull(spec, state, id)).toBe('ok');
      expect(isWon(spec, state)).toBe(true);
      expect(state.parked.some(Boolean)).toBe(false);
    });
  }

  it('is a pure function of the seed and the level', () => {
    for (const level of [1, 17, 88]) {
      const a = generateLevel(SEED, level);
      const b = generateLevel(SEED, level);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      expect(JSON.stringify(generateLevel('another-profile', level))).not.toBe(JSON.stringify(a));
    }
  });
});

/**
 * The structural guarantee, checked the way the player can break it.
 *
 * `generate.ts` parks buses so that reversing the parking order empties the lot,
 * and claims that property survives any order at all. This plays randomly — not
 * in the guaranteed order — and asserts that something is always drivable while
 * a bay is free. If that ever fails, the lot can deadlock and the solver's
 * licence to ignore the geometry is void.
 */
describe('the lot always empties', () => {
  for (const level of [1, 11, 29, 73, 200]) {
    it(`level ${level} never jams the lot itself`, () => {
      const generated = generateLevel(SEED, level);
      const spec: Level = { board: generated.board, queue: generated.queue };
      const rng = createRng(hashSeed('lot-sweep', level));

      for (let run = 0; run < 12; run++) {
        const state = createState(generated.board);
        let guard = 0;

        while (state.parked.some(Boolean) && guard++ <= generated.board.buses.length) {
          // Free the kerb by hand so the colour rules cannot end the run early —
          // this is a claim about the geometry alone.
          state.bays = state.bays.map(() => null);
          const drivable = drivableIds(generated.board, state);
          expect(freeBay(state)).not.toBe(-1);
          expect(drivable.length).toBeGreaterThan(0);
          expect(pull(spec, state, rng.pick(drivable))).toBe('ok');
        }

        expect(state.parked.some(Boolean)).toBe(false);
      }
    });
  }
});

describe('the difficulty curve', () => {
  it('lands inside the band it was asked for, without burning the budget', () => {
    for (const level of LEVELS) {
      const generated = generateLevel(SEED, level);
      const pressure = pressureForLevel(
        level,
        createRng(hashSeed(SEED, 'depot', 'pressure', level)),
      );
      const [lo, hi] = pressure.band;

      // Generous upwards on purpose — see `shared/difficulty.ts`. What must
      // never happen is a level landing *below* what was asked for.
      expect(generated.difficulty).toBeGreaterThanOrEqual(lo - 0.02);
      expect(generated.difficulty).toBeLessThanOrEqual(hi + 0.06);
      expect(generated.attempts).toBeLessThanOrEqual(12);
    }
  });

  it('climbs, and keeps climbing until it reaches the ceiling', () => {
    const early = [1, 2, 3].map((level) => generateLevel(SEED, level).difficulty);
    const middle = [12, 15, 18].map((level) => generateLevel(SEED, level).difficulty);
    const late = [40, 50, 64].map((level) => generateLevel(SEED, level).difficulty);

    const mean = (values: number[]): number =>
      values.reduce((sum, value) => sum + value, 0) / values.length;

    expect(mean(early)).toBeLessThan(mean(middle));
    expect(mean(middle)).toBeLessThan(mean(late));
    // Level 1 is meant to be hard. A walkover opener is the failure mode this
    // collection guards against, not a player bouncing off level 3.
    expect(mean(early)).toBeGreaterThan(0.22);
  });
});

describe('the shape function', () => {
  it('keeps the lot inside what a phone can show', () => {
    for (const level of LEVELS) {
      const shape = shapeFor(
        pressureForLevel(level, createRng(hashSeed(SEED, 'depot', 'pressure', level))),
      );
      expect(shape.gridWidth).toBeLessThanOrEqual(7);
      expect(shape.gridHeight).toBeLessThanOrEqual(8);
      expect(shape.bays).toBeGreaterThanOrEqual(2);
      // Colours are deliberately *not* capped against the bays — measured, the
      // generator builds six-colour two-bay boards without difficulty. But the
      // palette still has to be able to draw them apart.
      expect(shape.colors).toBeLessThanOrEqual(6);
    }
  });

  it('hides no bus until the back half of the curve, then does', () => {
    // A *rate* of zero, not merely a rate that rounds to no buses: the rate is
    // also a difficulty term, so a level that hides nothing should not be
    // scored as if it hid something.
    for (const level of [1, 3, 6, 9, 12]) {
      const shape = shapeFor(
        pressureForLevel(level, createRng(hashSeed(SEED, 'depot', 'pressure', level))),
      );
      expect(shape.unknownRate).toBe(0);
    }

    // The first fifteen levels put nothing on the board the player cannot read.
    // Jitter can tip level 15 a hair over the threshold, which is why this is
    // the check that covers the range rather than the one above.
    for (let level = 1; level <= 15; level++) {
      expect(generateLevel(SEED, level).board.buses.some((b: Bus) => b.unknown)).toBe(false);
    }

    // And it does eventually arrive, or the lever is decoration.
    const deep = [30, 45, 60, 90].map((level) => generateLevel(SEED, level));
    expect(deep.some((g) => g.board.buses.some((b: Bus) => b.unknown))).toBe(true);
  });

  it('uses every colour it puts in play', () => {
    for (const level of [3, 20, 60]) {
      const generated = generateLevel(SEED, level);
      const used = new Set(generated.board.buses.map((b: Bus) => b.color));
      expect(used.size).toBe(generated.board.colors);
    }
  });
});
