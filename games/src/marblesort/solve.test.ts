import { describe, expect, it } from 'vitest';
import { type Level, createSim, geometryFor, settle, tap } from './model';
import { search } from './solve';

describe('solver', () => {
  it('finds the order that keeps the belt clear', () => {
    // Blue is on top of everything red, so red first overflows the belt.
    const level: Level = {
      colors: 2,
      columns: [[1, 0, 0, 0, 0]],
      blockSize: 3,
      dropSize: 12,
      straightSlots: 2,
      visibleRows: 99,
    };
    const result = search(level, createSim(level));
    expect(result.status).toBe('solved');
    expect(result.plan).toEqual([1, 0]);
  });

  it('proves a board unsolvable by exhausting it', () => {
    // Each colour sits under the other, and a handful of either fills the belt.
    const level: Level = {
      colors: 2,
      columns: [[0, 1, 1, 1, 1], [1, 0, 0, 0, 0]],
      blockSize: 3,
      dropSize: 15,
      straightSlots: 2,
      visibleRows: 99,
    };
    expect(search(level, createSim(level)).status).toBe('unsolvable');
  });

  it("returns a plan that actually wins when played", () => {
    const level: Level = {
      colors: 3,
      columns: [
        [0, 1, 2, 0],
        [2, 2, 1, 0],
        [1, 0, 2, 1],
      ],
      blockSize: 3,
      dropSize: 7,
      straightSlots: 4,
      visibleRows: 99,
    };
    const result = search(level, createSim(level));
    expect(result.status).toBe('solved');
    const g = geometryFor(level);
    const sim = createSim(level);
    let status = settle(level, sim, g);
    for (const color of result.plan ?? []) {
      tap(level, sim, color);
      status = settle(level, sim, g);
      expect(status).not.toBe('lost');
    }
    expect(status).toBe('won');
  });

  it('searches from a position still in motion by letting it settle first', () => {
    const level: Level = {
      colors: 2,
      columns: [[0, 1], [1, 0]],
      blockSize: 3,
      dropSize: 3,
      straightSlots: 4,
      visibleRows: 99,
    };
    const sim = createSim(level);
    tap(level, sim, 0);
    const result = search(level, sim);
    expect(result.status).toBe('solved');
    // Not mutated.
    expect(sim.funnel.length).toBe(3);
  });

  it('gives up on budget rather than claiming unsolvable', () => {
    const level: Level = {
      colors: 4,
      columns: [
        [0, 1, 2, 3, 0, 1],
        [3, 2, 1, 0, 3, 2],
        [1, 3, 0, 2, 1, 3],
        [2, 0, 3, 1, 2, 0],
      ],
      blockSize: 3,
      dropSize: 12,
      straightSlots: 4,
      visibleRows: 99,
    };
    const result = search(level, createSim(level), { nodeBudget: 2 });
    expect(['solved', 'budget']).toContain(result.status);
    if (result.status !== 'solved') expect(result.plan).toBeNull();
  });
});
