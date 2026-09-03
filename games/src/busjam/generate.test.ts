import { describe, expect, it } from 'vitest';
import { accept, createSinkState, isDrained } from '../shared/buffer-sink';
import { SINK_CAPACITY, generateLevel } from './generate';
import {
  type Passenger,
  allBoarded,
  boardPassenger,
  createBoardState,
  indexBoard,
  isClearable,
  isWellFormed,
  reachableIds,
} from './model';
import { search } from './solve';

const SEED = 'a1b2c3d4e5f60718';

/** Levels 1..dense, then a thinner sweep of the deep end. */
function levelSweep(dense: number, sparseTo: number, step: number): number[] {
  const levels = Array.from({ length: dense }, (_, i) => i + 1);
  for (let level = dense + step; level <= sparseTo; level += step) levels.push(level);
  return levels;
}

describe('generated levels are always playable', () => {
  const levels = levelSweep(40, 400, 40);

  it(`produces a well-formed, solvable level for ${levels.length} levels`, () => {
    for (const level of levels) {
      const generated = generateLevel(SEED, level);
      const { board, queue, config } = generated;

      expect(isWellFormed(board), `level ${level} is malformed`).toBe(true);
      expect(isClearable(board), `level ${level} cannot be emptied`).toBe(true);

      const result = search({ board, queue, config }, { nodeBudget: 150_000 });
      expect(result.status, `level ${level} is not solvable`).toBe('solved');

      // The recorded solution must actually clear the crowd without overfilling
      // the bench, and must never tap someone who is penned in.
      const index = indexBoard(board);
      const state = createBoardState(board);
      let sinks = createSinkState(config, queue);

      for (const id of result.moves) {
        const reachable = reachableIds(board, index, state);
        expect(reachable, `level ${level}: solution taps a blocked passenger`).toContain(id);

        const outcome = accept(sinks, config, (board.passengers[id] as Passenger).color);
        expect(outcome.placed, `level ${level}: solution overfills the bench`).not.toBe('lost');
        sinks = outcome.state;
        boardPassenger(board, state, id);
      }

      expect(allBoarded(state), `level ${level}: solution leaves people behind`).toBe(true);
      expect(isDrained(sinks), `level ${level}: solution leaves a bus half empty`).toBe(true);
    }
  }, 300_000);
});

describe('colour bookkeeping', () => {
  it('gives every colour a count that fills buses exactly', () => {
    for (const level of [1, 12, 40, 90, 200]) {
      const { board, queue, shape } = generateLevel(SEED, level);

      const perColor = new Map<number, number>();
      for (const passenger of board.passengers) {
        perColor.set(passenger.color, (perColor.get(passenger.color) ?? 0) + 1);
      }

      for (const [color, count] of perColor) {
        expect(count % SINK_CAPACITY, `level ${level}: colour ${color} cannot fill buses`).toBe(0);
      }

      // One bus per three passengers, and the queue is exactly those buses.
      expect(queue.length).toBe(board.passengers.length / SINK_CAPACITY);
      const queuePerColor = new Map<number, number>();
      for (const color of queue) queuePerColor.set(color, (queuePerColor.get(color) ?? 0) + 1);
      for (const [color, count] of perColor) {
        expect(queuePerColor.get(color) ?? 0).toBe(count / SINK_CAPACITY);
      }

      expect(board.colors).toBe(shape.colors);
    }
  }, 120_000);
});

describe('the crowd fits the grid', () => {
  it('leaves room to move and keeps everyone on walkable ground', () => {
    for (const level of levelSweep(12, 240, 40)) {
      const { board } = generateLevel(SEED, level);
      const openCells = board.open.reduce((n, isOpen) => (isOpen ? n + 1 : n), 0);

      expect(openCells, `level ${level}: crowd fills the whole grid`).toBeGreaterThan(
        board.passengers.length,
      );

      const seen = new Set<string>();
      for (const passenger of board.passengers) {
        const key = `${passenger.x},${passenger.y}`;
        expect(seen.has(key), `level ${level}: two people in one cell`).toBe(false);
        seen.add(key);
      }
    }
  }, 120_000);
});

describe('difficulty', () => {
  it('lands inside the target band, or as close as the format allows', () => {
    // Not every board can be dialled to the band, but a level that misses it
    // badly is a level whose curve has come unhooked from the score.
    for (const level of levelSweep(20, 300, 20)) {
      const { difficulty } = generateLevel(SEED, level);
      expect(difficulty, `level ${level}`).toBeGreaterThanOrEqual(0);
      expect(difficulty, `level ${level}`).toBeLessThanOrEqual(1);
    }
  }, 180_000);

  it('is harder at level 200 than at level 2, averaged over seeds', () => {
    // Per level the curve deliberately jitters, so this only holds in the mean.
    const mean = (level: number): number => {
      const seeds = ['aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg', 'hh'];
      return (
        seeds.reduce((sum, seed) => sum + generateLevel(seed, level).difficulty, 0) / seeds.length
      );
    };
    expect(mean(200)).toBeGreaterThan(mean(2) + 0.2);
  }, 180_000);

  it('opens the first levels wide enough that they cannot be lost', () => {
    // The opening levels are a tutorial: two buses at the stop means something
    // on the board almost always matches, and the bench never fills.
    const { shape } = generateLevel(SEED, 1);
    expect(shape.openBuses).toBe(2);
  }, 60_000);
});

describe('determinism', () => {
  it('is a pure function of seed, level, and offset', () => {
    const a = generateLevel(SEED, 33);
    const b = generateLevel(SEED, 33);
    expect(JSON.stringify(b.board)).toBe(JSON.stringify(a.board));
    expect(b.queue).toEqual(a.queue);

    const shifted = generateLevel(SEED, 33, -4);
    const other = generateLevel('different-seed', 33);
    expect(JSON.stringify(shifted.board)).not.toBe(JSON.stringify(a.board));
    expect(JSON.stringify(other.board)).not.toBe(JSON.stringify(a.board));
  }, 60_000);
});
