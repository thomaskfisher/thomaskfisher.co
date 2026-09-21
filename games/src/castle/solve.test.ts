import { describe, expect, it } from 'vitest';

import { type Level, ARROW, CANNON, EMPTY, GRUNT, KNIGHT, simulate } from './model';
import { countWinners, forEachCompletion, search } from './solve';

/** Straight road, three plots, one of them useless (far from the road). */
function fixture(wave: Level['wave']): Level {
  return {
    width: 5,
    height: 6,
    path: [2, 7, 12, 17, 22, 27],
    plots: [11, 13, 0],
    towers: [1, 1, 0],
    wave,
  };
}

describe('forEachCompletion', () => {
  it('visits each distinct layout exactly once', () => {
    const level = fixture([{ kind: GRUNT, hp: 1, spawn: 0 }]);
    const seen = new Set<string>();
    forEachCompletion(level, [EMPTY, EMPTY, EMPTY], (layout) => {
      const key = layout.join(',');
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      return false;
    });
    // Arrow on one of three plots, cannon on one of the other two.
    expect(seen.size).toBe(6);
  });

  it('keeps the towers already placed', () => {
    const level = fixture([{ kind: GRUNT, hp: 1, spawn: 0 }]);
    forEachCompletion(level, [EMPTY, EMPTY, ARROW], (layout) => {
      expect(layout[2]).toBe(ARROW);
      expect(layout.filter((k) => k === CANNON).length).toBe(1);
      return false;
    });
  });
});

describe('search', () => {
  it('finds a winning layout and it wins', () => {
    const level = fixture([
      { kind: KNIGHT, hp: 9, spawn: 0 },
      { kind: GRUNT, hp: 6, spawn: 6 },
    ]);
    const result = search(level);
    expect(result.status).toBe('solved');
    expect(simulate(level, result.layout).won).toBe(true);
  });

  it('says unsolvable only after trying everything', () => {
    const level = fixture([{ kind: KNIGHT, hp: 500, spawn: 0 }]);
    const result = search(level);
    expect(result.status).toBe('unsolvable');
    expect(result.nodes).toBe(countWinners(level).total);
  });

  it('reports a budget stop as a budget stop, not as unsolvable', () => {
    const level = fixture([{ kind: KNIGHT, hp: 500, spawn: 0 }]);
    expect(search(level, undefined, { nodeBudget: 2 }).status).toBe('budget');
  });

  it('completes from a partial layout, or says it cannot', () => {
    const level = fixture([
      { kind: GRUNT, hp: 12, spawn: 0 },
      { kind: GRUNT, hp: 12, spawn: 3 },
    ]);
    const fromGood = search(level, [ARROW, EMPTY, EMPTY]);
    expect(fromGood.status).toBe('solved');
    expect(fromGood.layout[0]).toBe(ARROW);

    // Both towers wasted on the far plot and one more: nothing can win from
    // a cannon stranded in the corner if the wave needs both near the road.
    const fromBad = search(level, [EMPTY, EMPTY, CANNON]);
    if (fromBad.status === 'solved') expect(simulate(level, fromBad.layout).won).toBe(true);
    else expect(fromBad.status).toBe('unsolvable');
  });
});
