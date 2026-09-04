import { describe, expect, it } from 'vitest';
import { generateLevel } from './generate';
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
      const { structure, shape } = generateLevel(SEED, level);

      const counts = new Map<number, number>();
      for (const screw of structure.screws) {
        counts.set(screw.color, (counts.get(screw.color) ?? 0) + 1);
      }

      for (const [color, count] of counts) {
        expect(count % shape.boxCapacity, `level ${level}, colour ${color} leaves a remainder`).toBe(
          0,
        );
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
  /**
   * Replaces a test that asserted level 1 handed out four open boxes and four
   * colours — a board that could not be lost. Three boxes is now the most
   * generous setting in the game and it does not survive past the opening
   * levels.
   */
  it('opens hard rather than gentle', () => {
    let total = 0;
    for (let level = 1; level <= 6; level++) {
      const { shape, difficulty } = generateLevel(SEED, level);
      expect(shape.openBoxes, `level ${level} opens too many boxes`).toBeLessThanOrEqual(3);
      expect(shape.colors, `level ${level} deals too few colours`).toBeGreaterThanOrEqual(4);
      expect(difficulty, `level ${level} is a walkover`).toBeGreaterThan(0.12);
      total += difficulty;
    }
    // The mean is the real assertion. Per-level pressure carries +-0.06 of
    // jitter by design, so a single opening level is a noisy thing to pin —
    // pinning one is how this test ended up asserting a threshold that held for
    // some profile seeds and not others.
    expect(total / 6, 'the opening levels are a walkover on average').toBeGreaterThan(0.25);
  }, 120_000);

  /**
   * Two open boxes is the game; three is a breather.
   *
   * This lever used to run 4 -> 3 -> 2 across the curve, and the top of that
   * range was the problem: with three or four colours accepted at once the tray
   * cannot fill, so the level cannot be lost, and a level that cannot be lost is
   * not a puzzle. Four is gone entirely and three now appears only on breather
   * levels, which is a deliberate narrowing — the difficulty that used to come
   * from closing boxes now comes from box capacity, tray size and the queue
   * preview, none of which make a board unloseable.
   */
  it('opens two boxes on ordinary levels and three only as a breather', () => {
    const shapes = Array.from({ length: 60 }, (_, i) => generateLevel(SEED, i + 1).shape);

    expect(shapes.every((shape) => shape.openBoxes <= 3)).toBe(true);
    const twos = shapes.filter((shape) => shape.openBoxes === 2).length;
    expect(twos, 'two boxes should be the standing setting').toBeGreaterThan(50);

    // Every three-box board is a breather (levels 9k+4). See shared/difficulty.ts.
    shapes.forEach((shape, i) => {
      if (shape.openBoxes === 3) expect((i + 1) % 9, `level ${i + 1}`).toBe(4);
    });
  }, 300_000);

  /** Colours per open box is the ratio that decides whether a board is fair. */
  it('never opens fewer boxes than the colour count can survive', () => {
    for (const level of [1, 25, 75, 150, 300, 600]) {
      const { shape, config } = generateLevel(SEED, level);
      expect(config.openSinks).toBe(shape.openBoxes);
      expect(config.sinkCapacity).toBe(shape.boxCapacity);
      expect(shape.openBoxes).toBeGreaterThanOrEqual(2);
      // The measured budget from tools/probe.ts — see `colorBudget` in the
      // generator — with a floor of four under it. The floor wins where the two
      // disagree, which happens only at the top of the curve: the budget says
      // three there and the probe says four colours is solvable in 11 deals in
      // 20, and a three-colour board looks like an easy one whatever it
      // measures.
      expect(shape.colors).toBeLessThanOrEqual(
        Math.max(4, shape.openBoxes + shape.trayCapacity + 2 - shape.boxCapacity),
      );
      expect(shape.colors, 'a three-colour board reads as easy').toBeGreaterThanOrEqual(4);
    }
  }, 120_000);

  it('rises across windows despite per-level jitter', () => {
    const windowMean = (from: number, to: number): number => {
      let sum = 0;
      for (let level = from; level <= to; level++) sum += generateLevel(SEED, level).difficulty;
      return sum / (to - from + 1);
    };

    // Windows sit inside the ramp, which is levels 1-50 now, not 1-500.
    const early = windowMean(1, 10);
    const mid = windowMean(14, 26);
    const late = windowMean(30, 50);

    expect(mid).toBeGreaterThan(early);
    expect(late).toBeGreaterThan(mid);
    // Both ends are guarded. The opening is meant to sit a quarter of the way
    // up rather than on the floor — the old curve put this window at 0.11 —
    // and a top window collapsing means the target band went unreachable.
    expect(early, 'the opening window is a walkover').toBeGreaterThan(0.2);
    expect(late, 'the curve does not reach its ceiling').toBeGreaterThan(0.75);
  }, 300_000);

  /**
   * Past level 50 the curve stops climbing on purpose: levels keep coming
   * forever and are all pitched at the ceiling, so what varies is the board
   * rather than the pressure.
   */
  it('plateaus past the peak instead of creeping on', () => {
    const windowMean = (from: number, to: number): number => {
      let sum = 0;
      for (let level = from; level <= to; level++) sum += generateLevel(SEED, level).difficulty;
      return sum / (to - from + 1);
    };

    expect(Math.abs(windowMean(50, 62) - windowMean(160, 172))).toBeLessThan(0.1);
  }, 300_000);

  it('keeps the board within what fits a phone screen', () => {
    for (const level of [200, 400, 800]) {
      const { shape, structure } = generateLevel(SEED, level);
      expect(shape.colors).toBeLessThanOrEqual(8);
      expect(structure.gridWidth).toBeLessThanOrEqual(9);
      expect(structure.gridHeight).toBeLessThanOrEqual(11);
      expect(structure.screws.length).toBeLessThanOrEqual(45);
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
