import { describe, expect, it } from 'vitest';
import { accept, createSinkState } from '../shared/buffer-sink';
import {
  DEFAULT_VIEW,
  LOOK_DIRECTIONS,
  generateLevel,
  hiddenScrewShare,
  templateForLevel,
} from './generate';
import {
  type Screw,
  type Vec3,
  accessibleScrewIds,
  allRemoved,
  createBoardState,
  indexStructure,
  isDisassemblable,
  isVisibleFrom,
  isWellFormed,
  removeScrew,
} from './model';
import { search } from './solve';
import { TEMPLATE_NAMES } from './templates';

const SEED = 'a1b2c3d4e5f60718';

function levelSweep(dense: number, sparseTo: number, step: number): number[] {
  const levels = Array.from({ length: dense }, (_, i) => i + 1);
  for (let level = dense + step; level <= sparseTo; level += step) levels.push(level);
  return levels;
}

describe('generated levels are always playable', () => {
  const levels = levelSweep(60, 400, 40);

  it(`produces a well-formed, solvable level for ${levels.length} levels`, () => {
    for (const level of levels) {
      const generated = generateLevel(SEED, level);
      const { structure, queue, config } = generated;

      expect(isWellFormed(structure), `level ${level} is malformed`).toBe(true);
      expect(isDisassemblable(structure), `level ${level} cannot come apart`).toBe(true);

      const result = search({ structure, queue, config }, { nodeBudget: 150_000 });
      expect(result.status, `level ${level} is not solvable`).toBe('solved');

      const index = indexStructure(structure);
      const state = createBoardState(structure, index);
      let sinks = createSinkState(config, queue);

      for (const id of result.moves) {
        const reachable = accessibleScrewIds(structure, index, state);
        expect(reachable, `level ${level}: solution takes a buried screw`).toContain(id);

        // Every screw the rules allow must be findable by turning the object:
        // looking straight down its own normal always shows it.
        const screw = structure.screws[id] as Screw;
        const along: Vec3 = [0, 0, 0];
        along[screw.axis] = screw.sign;
        expect(
          isVisibleFrom(structure, state, id, along),
          `level ${level}: reachable screw ${id} can never be seen`,
        ).toBe(true);

        const outcome = accept(sinks, config, screw.color);
        expect(outcome.placed, `level ${level}: solution overflows the tray`).not.toBe('lost');
        sinks = outcome.state;
        removeScrew(structure, index, state, id);
      }

      expect(allRemoved(state), `level ${level}: solution leaves screws behind`).toBe(true);
    }
  }, 300_000);
});

describe('the third dimension matters', () => {
  it('hides some screws from the opening view on every level', () => {
    for (const level of levelSweep(30, 30, 1)) {
      const { structure } = generateLevel(SEED, level);
      expect(hiddenScrewShare(structure), `level ${level} shows everything at once`).toBeGreaterThan(
        0,
      );
    }
  }, 60_000);

  it('opens with a screw a player must turn the object to find', () => {
    // At least one screw that is reachable from the start is not visible from
    // the opening view — otherwise rotation would never be needed early on.
    let levelsWithHiddenReachable = 0;
    for (let level = 1; level <= 20; level++) {
      const { structure } = generateLevel(SEED, level);
      const index = indexStructure(structure);
      const state = createBoardState(structure, index);
      const hidden = accessibleScrewIds(structure, index, state).some(
        (id) => !isVisibleFrom(structure, state, id, DEFAULT_VIEW),
      );
      if (hidden) levelsWithHiddenReachable++;
    }
    expect(levelsWithHiddenReachable).toBeGreaterThanOrEqual(18);
  }, 60_000);

  it('offers look directions on every side', () => {
    expect(LOOK_DIRECTIONS).toHaveLength(26);
  });
});

describe('determinism and variety', () => {
  it('generates the same level from the same seed', () => {
    const a = generateLevel(SEED, 17);
    const b = generateLevel(SEED, 17);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('never repeats a template on consecutive levels', () => {
    let previous = templateForLevel(SEED, 1);
    for (let level = 2; level <= 200; level++) {
      const current = templateForLevel(SEED, level);
      expect(current, `level ${level} repeats ${previous}`).not.toBe(previous);
      previous = current;
    }
  });

  it('uses every template within each block', () => {
    const n = TEMPLATE_NAMES.length;
    for (const block of [0, 1, 7]) {
      const seen = new Set(
        Array.from({ length: n }, (_, i) => templateForLevel(SEED, block * n + i + 1)),
      );
      expect(seen.size).toBe(TEMPLATE_NAMES.length);
    }
  });
});

describe('colour bookkeeping', () => {
  it('gives every colour a count that fills boxes exactly', () => {
    for (const level of [1, 12, 40, 90, 200]) {
      const { structure, shape, queue, config } = generateLevel(SEED, level);
      const counts = new Map<number, number>();
      for (const screw of structure.screws) {
        counts.set(screw.color, (counts.get(screw.color) ?? 0) + 1);
      }
      for (const [color, count] of counts) {
        expect(count % shape.boxCapacity, `level ${level}, colour ${color}`).toBe(0);
      }
      expect(queue.length * config.sinkCapacity).toBe(structure.screws.length);
    }
  }, 60_000);
});
