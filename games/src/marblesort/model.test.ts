import { describe, expect, it } from 'vitest';
import {
  type Level,
  CURVE_SLOTS,
  cellAt,
  createSim,
  emptyEvents,
  encodeMove,
  geometryFor,
  isWellFormed,
  pipeCounts,
  replay,
  settle,
  slotOf,
  statusOf,
  step,
  tap,
} from './model';

/** Two columns, one block each: red over nothing, blue over nothing. */
const tiny: Level = {
  colors: 2,
  columns: [[0], [1]],
  blockSize: 3,
  dropSize: 3,
  straightSlots: 4,
  visibleRows: 99,
};

describe('geometry', () => {
  it('sizes the belt from its straights and curves', () => {
    const g = geometryFor(tiny);
    expect(g.length).toBe(2 * 4 + 2 * CURVE_SLOTS);
    expect(new Set(g.drops).size).toBe(2);
    for (const drop of g.drops) expect(drop).toBeLessThan(4);
    // The spout is on the top straight.
    expect(g.entry).toBeGreaterThanOrEqual(4 + CURVE_SLOTS);
    expect(g.entry).toBeLessThan(2 * 4 + CURVE_SLOTS);
  });

  it('gives every column its own drop slot even when they are packed', () => {
    const level: Level = { ...tiny, columns: [[0], [1], [0], [1], [0], [1]], straightSlots: 6 };
    expect(new Set(geometryFor(level).drops).size).toBe(6);
  });

  it('keeps a marble on its cell while the belt turns', () => {
    const g = geometryFor(tiny);
    const sim = createSim(tiny);
    const cell = cellAt(sim, g.entry, g.length);
    sim.offset = 5;
    expect(slotOf(sim, cell, g.length)).toBe((g.entry + 5) % g.length);
    expect(cellAt(sim, slotOf(sim, cell, g.length), g.length)).toBe(cell);
  });
});

describe('pipes', () => {
  it('hold exactly what the blocks want', () => {
    expect(pipeCounts(tiny)).toEqual([3, 3]);
  });

  it('drop a handful, or what is left', () => {
    const level = { ...tiny, dropSize: 2 };
    const sim = createSim(level);
    expect(tap(level, sim, 0)).toBe(2);
    expect(tap(level, sim, 0)).toBe(1);
    expect(tap(level, sim, 0)).toBe(0);
    expect(sim.funnel).toEqual([0, 0, 0]);
  });
});

describe('the belt', () => {
  it('is settled before anything is tapped', () => {
    const sim = createSim(tiny);
    expect(statusOf(tiny, sim, geometryFor(tiny))).toBe('settled');
  });

  it('feeds one marble per tick onto an empty spout', () => {
    const g = geometryFor(tiny);
    const sim = createSim(tiny);
    tap(tiny, sim, 0);
    const events = emptyEvents();
    step(tiny, sim, g, events);
    expect(sim.beltCount).toBe(1);
    expect(sim.funnel.length).toBe(2);
    expect(events.entered).toBeGreaterThanOrEqual(0);
  });

  it('drops matching marbles into the block below and clears it when full', () => {
    const g = geometryFor(tiny);
    const sim = createSim(tiny);
    tap(tiny, sim, 0);
    expect(settle(tiny, sim, g)).toBe('settled');
    expect(sim.beltCount).toBe(0);
    expect(sim.depth).toEqual([1, 0]);
  });

  it('wins once every pipe, the funnel and the belt are empty', () => {
    const g = geometryFor(tiny);
    const sim = createSim(tiny);
    tap(tiny, sim, 0);
    tap(tiny, sim, 1);
    expect(settle(tiny, sim, g)).toBe('won');
  });

  it('only fills the top block of a column', () => {
    // Blue sits under red: blue marbles have nowhere to go until red clears.
    const level: Level = { ...tiny, columns: [[0, 1]], straightSlots: 4 };
    const g = geometryFor(level);
    const sim = createSim(level);
    tap(level, sim, 1);
    expect(settle(level, sim, g)).toBe('settled');
    expect(sim.beltCount).toBe(3);
    tap(level, sim, 0);
    expect(settle(level, sim, g)).toBe('won');
  });

  it('is lost when full of marbles nothing will take', () => {
    // Belt of 12; three colours of blocks stacked so blue and green are buried.
    const level: Level = {
      colors: 3,
      columns: [[0, 1, 1, 1, 2, 2, 2]],
      blockSize: 3,
      dropSize: 9,
      straightSlots: 2,
      visibleRows: 99,
    };
    const g = geometryFor(level);
    expect(g.length).toBe(12);
    const sim = createSim(level);
    tap(level, sim, 1);
    expect(settle(level, sim, g)).toBe('settled');
    tap(level, sim, 2);
    expect(settle(level, sim, g)).toBe('lost');
  });

  it('is not lost while something on a full belt can still land', () => {
    const level: Level = {
      colors: 2,
      columns: [[1, 0, 0, 0, 0]],
      blockSize: 3,
      dropSize: 12,
      straightSlots: 2,
      visibleRows: 99,
    };
    const g = geometryFor(level);
    // Twelve reds fill a belt of twelve while blue is on top: a loss —
    const sim = createSim(level);
    tap(level, sim, 0);
    expect(settle(level, sim, g)).toBe('lost');
    // — whereas blue first opens the reds' blocks, and the same twelve land.
    const sim2 = createSim(level);
    tap(level, sim2, 1);
    expect(settle(level, sim2, g)).toBe('settled');
    tap(level, sim2, 0);
    expect(settle(level, sim2, g)).toBe('won');
  });
});

describe('moves', () => {
  it('replays taps made mid-motion exactly', () => {
    const level: Level = { ...tiny, columns: [[0, 1], [1, 0]], dropSize: 2 };
    const g = geometryFor(level);
    const live = createSim(level);
    const moves: number[] = [];
    const play = (color: number): void => {
      moves.push(encodeMove(live.tick, color));
      tap(level, live, color);
    };
    play(0);
    step(level, live, g);
    step(level, live, g);
    play(1);
    for (let i = 0; i < 7; i++) step(level, live, g);
    play(0);

    const { sim, applied } = replay(level, moves);
    expect(applied).toBe(3);
    expect(sim).toEqual(live);
  });

  it('turns through settled ticks to reach a later tap', () => {
    // The belt never stops, so a tap long after everything landed still applies.
    const { sim, applied } = replay(tiny, [encodeMove(0, 0), encodeMove(500, 1)]);
    expect(applied).toBe(2);
    expect(sim.tick).toBe(500);
  });

  it('drops a move whose tick runs backwards, and everything after it', () => {
    const { applied } = replay(tiny, [encodeMove(5, 0), encodeMove(2, 1)]);
    expect(applied).toBe(1);
  });

  it('refuses a tick no save could honestly reach', () => {
    const { applied } = replay(tiny, [encodeMove(0, 0), encodeMove(5_000_000, 1)]);
    expect(applied).toBe(1);
  });

  it('refuses a malformed level', () => {
    expect(isWellFormed(tiny)).toBe(true);
    expect(isWellFormed({ ...tiny, straightSlots: 1 })).toBe(false);
    expect(isWellFormed({ ...tiny, columns: [[0], [5]] })).toBe(false);
  });
});
