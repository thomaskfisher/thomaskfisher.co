import { describe, expect, it } from 'vitest';
import { SINK_CAPACITY, generateLevel } from './generate';
import {
  accessibleScrewIds,
  allRemoved,
  createBoardState,
  indexStructure,
  isDisassemblable,
  isWellFormed,
  removeScrew,
} from './model';
import { search } from './solve';
import { accept, createSinkState } from '../shared/buffer-sink';

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
      const { structure, queue, config } = generated;

      expect(isWellFormed(structure), `level ${level} is malformed`).toBe(true);
      expect(isDisassemblable(structure), `level ${level} cannot come apart`).toBe(true);

      const result = search({ structure, queue, config }, { nodeBudget: 150_000 });
      expect(result.status, `level ${level} is not solvable`).toBe('solved');

      // The recorded solution must actually clear the board without overflowing.
      const index = indexStructure(structure);
      const state = createBoardState(structure, index);
      let sinks = createSinkState(config, queue);

      for (const id of result.moves) {
        const reachable = accessibleScrewIds(structure, index, state);
        expect(reachable, `level ${level}: solution takes a buried screw`).toContain(id);

        const outcome = accept(sinks, config, structure.screws[id]!.color);
        expect(outcome.placed, `level ${level}: solution overflows the tray`).not.toBe('lost');
        sinks = outcome.state;
        removeScrew(structure, index, state, id);
      }

      expect(allRemoved(state), `level ${level}: solution leaves screws behind`).toBe(true);
    }
  }, 300_000);
});

describe('colour bookkeeping', () => {
  it('gives every colour a count that fills boxes exactly', () => {
    for (const level of [1, 12, 40, 90, 200]) {
      const { structure } = generateLevel(SEED, level);

      const counts = new Map<number, number>();
      for (const screw of structure.screws) {
        counts.set(screw.color, (counts.get(screw.color) ?? 0) + 1);
      }

      for (const [color, count] of counts) {
        expect(count % SINK_CAPACITY, `level ${level}, colour ${color} leaves a remainder`).toBe(0);
      }
    }
  }, 60_000);

  it('queues exactly enough boxes to absorb every screw', () => {
    for (const level of [1, 12, 40, 90, 200]) {
      const { structure, queue, config } = generateLevel(SEED, level);
      // The queue holds every box, including the ones opened at the start.
      // Their combined capacity must match the screw count exactly, or a colour
      // ends up stranded in the tray with nowhere left to go.
      expect(queue.length * config.sinkCapacity).toBe(structure.screws.length);
    }
  }, 60_000);

  it('never queues a colour that no screw uses', () => {
    for (const level of [5, 30, 120]) {
      const { structure, queue } = generateLevel(SEED, level);
      const used = new Set(structure.screws.map((s) => s.color));
      for (const color of queue) expect(used.has(color)).toBe(true);
    }
  }, 60_000);
});

describe('determinism', () => {
  it('returns an identical level for the same seed and level', () => {
    for (const level of [1, 23, 77]) {
      const a = generateLevel(SEED, level);
      const b = generateLevel(SEED, level);
      expect(a.structure).toEqual(b.structure);
      expect(a.queue).toEqual(b.queue);
      expect(a.difficulty).toBe(b.difficulty);
    }
  }, 60_000);

  it('returns different levels for different profile seeds', () => {
    const a = generateLevel(SEED, 30);
    const b = generateLevel('ffffffffffffffff', 30);
    expect(a.structure.screws).not.toEqual(b.structure.screws);
  }, 60_000);
});

describe('difficulty curve', () => {
  it('starts gentle', () => {
    for (let level = 1; level <= 4; level++) {
      const { shape } = generateLevel(SEED, level);
      expect(shape.colors).toBeLessThanOrEqual(4);
      expect(shape.trayCapacity).toBe(5);
      expect(shape.screwCount).toBeLessThanOrEqual(18);
      expect(shape.openBoxes).toBeGreaterThanOrEqual(3);
    }
  }, 60_000);

  /**
   * With four boxes open the player can nearly always find a match on the
   * board, the tray never fills, and a level that cannot be lost is not a
   * puzzle. Closing boxes is the lever that fixes that, so it has to actually
   * move as levels get harder.
   */
  it('closes boxes as levels get harder', () => {
    const meanOpen = (from: number, to: number): number => {
      let sum = 0;
      for (let level = from; level <= to; level++) sum += generateLevel(SEED, level).shape.openBoxes;
      return sum / (to - from + 1);
    };

    expect(meanOpen(1, 8)).toBeGreaterThan(3.2);
    expect(meanOpen(60, 80)).toBeLessThan(2.9);
    expect(meanOpen(200, 220)).toBeLessThan(2.6);

    // Two open boxes has to be a board the player actually meets, not a shape
    // the difficulty band always rejects for scoring too high.
    const deep = Array.from({ length: 21 }, (_, i) => generateLevel(SEED, 200 + i).shape.openBoxes);
    expect(deep.filter((n) => n === 2).length).toBeGreaterThan(8);
  }, 300_000);

  /** Colours per open box is the ratio that decides whether a board is fair. */
  it('never opens fewer boxes than the colour count can survive', () => {
    for (const level of [1, 25, 75, 150, 300, 600]) {
      const { shape, config } = generateLevel(SEED, level);
      expect(config.openSinks).toBe(shape.openBoxes);
      expect(shape.openBoxes).toBeGreaterThanOrEqual(2);
      expect(shape.colors).toBeLessThanOrEqual(shape.openBoxes + 2);
    }
  }, 120_000);

  it('rises across windows despite per-level jitter', () => {
    const windowMean = (from: number, to: number): number => {
      let sum = 0;
      for (let level = from; level <= to; level++) sum += generateLevel(SEED, level).difficulty;
      return sum / (to - from + 1);
    };

    const early = windowMean(1, 12);
    const mid = windowMean(45, 60);
    const late = windowMean(130, 145);

    expect(mid).toBeGreaterThan(early);
    expect(late).toBeGreaterThan(mid);
    expect(early).toBeLessThan(0.25);
    expect(late).toBeGreaterThan(0.35);
  }, 300_000);

  it('keeps the board within what fits a phone screen', () => {
    for (const level of [200, 400, 800]) {
      const { shape, structure } = generateLevel(SEED, level);
      expect(shape.colors).toBeLessThanOrEqual(7);
      expect(structure.gridWidth).toBeLessThanOrEqual(9);
      expect(structure.gridHeight).toBeLessThanOrEqual(11);
      expect(structure.screws.length).toBeLessThanOrEqual(42);
    }
  }, 120_000);

  /**
   * Occlusion is the whole puzzle. If most screws are reachable at once the
   * player always has an easy match in front of them, the tray never fills, and
   * the level cannot be lost however many colours are on the board.
   */
  it('keeps most screws buried at any one moment', () => {
    for (const level of [60, 150, 300]) {
      const { structure } = generateLevel(SEED, level);
      const index = indexStructure(structure);
      const state = createBoardState(structure, index);

      let total = 0;
      let steps = 0;
      for (;;) {
        const reachable = accessibleScrewIds(structure, index, state);
        if (reachable.length === 0) break;
        total += reachable.length;
        steps++;
        removeScrew(structure, index, state, reachable[0] as number);
      }

      const average = total / steps;
      expect(average, `level ${level} exposes too much at once`).toBeLessThan(
        structure.screws.length * 0.4,
      );
    }
  }, 120_000);
});
