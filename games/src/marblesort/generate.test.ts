import { describe, expect, it } from 'vitest';
import {
  createSim,
  encodeMove,
  geometryFor,
  isWellFormed,
  replay,
  settle,
  statusOf,
  step,
  tap,
} from './model';
import { createRng } from '../shared/rng';
import { generateLevel } from './generate';
import { search } from './solve';

const LEVELS = [1, 2, 3, 4, 5, 8, 13, 20, 27, 40, 50, 75, 120, 400];

describe('generator invariants', () => {
  for (const level of LEVELS) {
    it(`level ${level} is well formed, unsolved, solvable, and its solution wins`, () => {
      const generated = generateLevel('invariant-seed', level);
      const { board } = generated;
      expect(isWellFormed(board)).toBe(true);

      const g = geometryFor(board);
      const start = createSim(board);
      expect(statusOf(board, start, g)).toBe('settled');

      const result = search(board, start);
      expect(result.status).toBe('solved');

      // Played the way the game records it: a tap at whatever tick the belt
      // came to rest on, then replayed from the move list as a save would be.
      const live = createSim(board);
      const moves: number[] = [];
      for (const color of result.plan ?? []) {
        expect(settle(board, live, g)).toBe('settled');
        moves.push(encodeMove(live.tick, color));
        tap(board, live, color);
      }
      expect(settle(board, live, g)).toBe('won');

      const restored = replay(board, moves, g);
      expect(restored.applied).toBe(moves.length);
      expect(settle(board, restored.sim, g)).toBe('won');

      // The belt never stops, so she taps wherever in its rotation she happens
      // to. The same line has to win with idle turns before every tap.
      const rng = createRng(level);
      const waited = createSim(board);
      for (const color of result.plan ?? []) {
        for (let i = rng.int(g.length * 2); i > 0; i--) step(board, waited, g);
        tap(board, waited, color);
        expect(settle(board, waited, g)).not.toBe('lost');
      }
      expect(statusOf(board, waited, g)).toBe('won');
    });
  }

  it('is deterministic', () => {
    expect(generateLevel('same', 17)).toEqual(generateLevel('same', 17));
  });

  it('gets harder along the curve', () => {
    const mean = (levels: number[]): number =>
      levels.reduce((sum, l) => sum + generateLevel('curve', l).difficulty, 0) / levels.length;
    expect(mean([1, 2, 3])).toBeLessThan(mean([30, 31, 32]));
  });

  it('only ever shows full colour on at least the top two rows', () => {
    for (const level of [1, 25, 60, 200]) {
      expect(generateLevel('vis', level).board.visibleRows).toBeGreaterThanOrEqual(2);
    }
  });

  it('fits a phone: at most six pipes and six columns', () => {
    for (const level of [1, 50, 300]) {
      const { board } = generateLevel('fit', level);
      expect(board.colors).toBeLessThanOrEqual(6);
      expect(board.columns.length).toBeLessThanOrEqual(6);
    }
  });
});
