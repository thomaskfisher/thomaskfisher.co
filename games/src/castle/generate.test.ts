import { describe, expect, it } from 'vitest';

import { pressureForLevel } from '../shared/difficulty';
import { createRng, hashSeed } from '../shared/rng';
import { generateLevel } from './generate';
import {
  type Level,
  EMPTY,
  applyMove,
  createState,
  isWellFormed,
  remaining,
  simulate,
} from './model';
import { countWinners, search } from './solve';

const SEED = 'test-castle';

/** A representative spread rather than a contiguous run: the curve is short. */
const LEVELS = [1, 2, 3, 4, 5, 7, 9, 12, 15, 18, 22, 27, 33, 41, 50, 64, 90, 140, 260];

/**
 * The sweep this whole game rests on.
 *
 * Every promise the collection makes about a level is checked here: that it is
 * built correctly, that it is not already won with nothing built, that it can
 * be won, and — the one that catches real bugs — that the solver's own layout
 * wins when it is placed tower by tower through the same `applyMove` the
 * player's taps go through, and then launched.
 */
describe('every generated level', () => {
  for (const level of LEVELS) {
    it(`level ${level} is well built, not free, and winnable`, () => {
      const generated = generateLevel(SEED, level);
      const spec: Level = generated;

      expect(isWellFormed(spec)).toBe(true);
      expect(simulate(spec, spec.plots.map(() => EMPTY)).won).toBe(false);

      const result = search(spec);
      expect(result.status).toBe('solved');

      const state = createState(spec);
      result.layout.forEach((kind, plot) => {
        if (kind === EMPTY) return;
        expect(applyMove(spec, state, { kind: 'place', plot, tower: kind as 0 | 1 | 2 })).toBe('ok');
      });
      expect(remaining(spec, state.layout).every((n) => n === 0)).toBe(true);
      expect(applyMove(spec, state, { kind: 'go' })).toBe('ok');
      expect(simulate(spec, state.layout).won).toBe(true);
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

describe('the difficulty curve', () => {
  it('lands inside the band it was asked for, without burning the budget', () => {
    for (const level of LEVELS) {
      const generated = generateLevel(SEED, level);
      const pressure = pressureForLevel(
        level,
        createRng(hashSeed(SEED, 'castle', 'pressure', level)),
      );
      const [lo, hi] = pressure.band;
      expect(generated.difficulty).toBeGreaterThanOrEqual(lo - 0.04);
      expect(generated.difficulty).toBeLessThanOrEqual(hi + 0.06);
      expect(generated.attempts).toBeLessThanOrEqual(8);
    }
  });

  it('gets harder: fewer layouts win deep in the curve than at the start', () => {
    const share = (level: number): number => {
      const { wins, total } = countWinners(generateLevel(SEED, level));
      return wins / total;
    };
    const early = (share(1) + share(2) + share(3)) / 3;
    const late = (share(50) + share(64) + share(90)) / 3;
    expect(late).toBeLessThan(early / 2);
  });
});
