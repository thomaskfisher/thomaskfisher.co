import { describe, expect, it } from 'vitest';

import {
  type Level,
  type Move,
  ARROW,
  CANNON,
  EMPTY,
  FROST,
  GRUNT,
  KNIGHT,
  RUNNER,
  SUB,
  applyMove,
  createState,
  geometry,
  isWellFormed,
  packMove,
  remaining,
  simulate,
  unpackMove,
} from './model';

/**
 * A straight road down the middle column of a 3x6 map, with a plot either side
 * of the third cell. Small enough to reason about by hand.
 *
 *   . R .
 *   . R .
 *   P R P      plots 0 and 1
 *   . R .
 *   . R .
 *   . R .
 */
function straight(wave: Level['wave'], towers = [1, 1, 0]): Level {
  return {
    width: 3,
    height: 6,
    path: [1, 4, 7, 10, 13, 16],
    plots: [6, 8],
    towers,
    wave,
  };
}

describe('geometry', () => {
  it('walks the road in whole SUB steps', () => {
    const level = straight([{ kind: GRUNT, hp: 1, spawn: 0 }]);
    const geo = geometry(level);
    expect(geo.end).toBe(5 * SUB);
    expect(geo.x[0]).toBe(SUB + SUB / 2);
    expect(geo.y[0]).toBe(SUB / 2);
    expect(geo.y[SUB + 3]).toBe(SUB + SUB / 2 + 3);
    for (let pos = 0; pos <= geo.end; pos++) expect(Number.isInteger(geo.y[pos])).toBe(true);
  });

  it('gives each tower the reach its range implies', () => {
    const level = straight([{ kind: GRUNT, hp: 1, spawn: 0 }]);
    const geo = geometry(level);
    // A plot beside a straight road reaches the cell beside it and the two
    // diagonals — frost's one and a half cells only just, at 1.41 — while the
    // arrow's two cells of range reach further along the road between centres.
    expect(geo.reach[0 * 3 + ARROW]).toBe(3);
    expect(geo.reach[0 * 3 + FROST]).toBe(3);
    const arrowPoints = geo.cover[0 * 3 + ARROW]?.reduce((a, b) => a + b, 0) ?? 0;
    const frostPoints = geo.cover[0 * 3 + FROST]?.reduce((a, b) => a + b, 0) ?? 0;
    expect(arrowPoints).toBeGreaterThan(frostPoints);
  });
});

describe('simulate', () => {
  it('loses when nothing is built', () => {
    const level = straight([{ kind: GRUNT, hp: 1, spawn: 0 }]);
    const outcome = simulate(level, [EMPTY, EMPTY]);
    expect(outcome.won).toBe(false);
    expect(outcome.leaked).toBe(0);
  });

  it('wins when the towers can kill everything in reach', () => {
    const level = straight([{ kind: GRUNT, hp: 4, spawn: 0 }]);
    expect(simulate(level, [ARROW, EMPTY]).won).toBe(true);
  });

  it('lets armour turn arrows into a tickle', () => {
    // The knight walks slower and is in range for longer — and still lives.
    const grunt = straight([{ kind: GRUNT, hp: 9, spawn: 0 }]);
    const knight = straight([{ kind: KNIGHT, hp: 9, spawn: 0 }]);
    expect(simulate(grunt, [ARROW, EMPTY]).won).toBe(true);
    expect(simulate(knight, [ARROW, EMPTY]).won).toBe(false);
  });

  it('splashes a cannon shell across a pack', () => {
    const pack = straight([
      { kind: GRUNT, hp: 4, spawn: 0 },
      { kind: GRUNT, hp: 4, spawn: 1 },
      { kind: GRUNT, hp: 4, spawn: 2 },
    ]);
    const outcome = simulate(pack, [CANNON, EMPTY], true);
    expect(outcome.won).toBe(true);
    // One shot killed all three: nothing shot twice.
    const shots = outcome.frames?.flatMap((frame) => frame.shots) ?? [];
    expect(shots.length).toBe(1);
  });

  it('slows everything in frost, and that is the difference', () => {
    const level = straight([{ kind: RUNNER, hp: 7, spawn: 0 }], [1, 0, 1]);
    expect(simulate(level, [ARROW, EMPTY]).won).toBe(false);
    expect(simulate(level, [ARROW, FROST]).won).toBe(true);
  });

  it('is deterministic, and the trace agrees with the verdict', () => {
    const level = straight([
      { kind: GRUNT, hp: 5, spawn: 0 },
      { kind: RUNNER, hp: 3, spawn: 4 },
      { kind: KNIGHT, hp: 7, spawn: 9 },
    ]);
    const a = simulate(level, [ARROW, CANNON]);
    const b = simulate(level, [ARROW, CANNON], true);
    expect(b.won).toBe(a.won);
    expect(b.ticks).toBe(a.ticks);
    expect(b.frames?.length).toBe(a.ticks);
    // Every foe dies exactly once in the trace.
    const deaths = b.frames?.flatMap((f) => f.foes.filter((foe) => foe.hp === 0)) ?? [];
    expect(deaths.length).toBe(a.killed);
  });
});

describe('moves', () => {
  const level = straight([{ kind: GRUNT, hp: 1, spawn: 0 }], [1, 1, 0]);

  it('places, refuses and removes', () => {
    const state = createState(level);
    expect(applyMove(level, state, { kind: 'place', plot: 0, tower: ARROW })).toBe('ok');
    expect(applyMove(level, state, { kind: 'place', plot: 0, tower: CANNON })).toBe('occupied');
    expect(applyMove(level, state, { kind: 'place', plot: 1, tower: ARROW })).toBe('none-left');
    expect(applyMove(level, state, { kind: 'place', plot: 1, tower: FROST })).toBe('none-left');
    expect(remaining(level, state.layout)).toEqual([0, 1, 0]);
    expect(applyMove(level, state, { kind: 'remove', plot: 1 })).toBe('empty');
    expect(applyMove(level, state, { kind: 'remove', plot: 0 })).toBe('ok');
    expect(state.layout).toEqual([EMPTY, EMPTY]);
  });

  it('locks the map once the wave is launched', () => {
    const state = createState(level);
    expect(applyMove(level, state, { kind: 'go' })).toBe('ok');
    expect(applyMove(level, state, { kind: 'place', plot: 0, tower: ARROW })).toBe('launched');
  });

  it('packs every move into one integer and back', () => {
    const moves: Move[] = [
      { kind: 'go' as const },
      { kind: 'remove' as const, plot: 7 },
      { kind: 'place' as const, plot: 0, tower: ARROW },
      { kind: 'place' as const, plot: 9, tower: FROST },
    ];
    for (const move of moves) expect(unpackMove(packMove(move))).toEqual(move);
    expect(unpackMove(-5)).toBeNull();
  });
});

describe('isWellFormed', () => {
  it('accepts the fixture', () => {
    expect(isWellFormed(straight([{ kind: GRUNT, hp: 1, spawn: 0 }]))).toBe(true);
  });

  it('rejects a road that runs beside itself', () => {
    const level: Level = {
      ...straight([{ kind: GRUNT, hp: 1, spawn: 0 }]),
      width: 4,
      height: 4,
      // Down, right, back up — and cell 6 sits beside cell 5 two steps earlier.
      path: [1, 5, 9, 10, 6, 7, 11, 15],
      plots: [0],
    };
    expect(isWellFormed(level)).toBe(false);
  });

  it('rejects a plot on the road, and more towers than plots', () => {
    const base = straight([{ kind: GRUNT, hp: 1, spawn: 0 }]);
    expect(isWellFormed({ ...base, plots: [7, 8] })).toBe(false);
    expect(isWellFormed({ ...base, towers: [2, 1, 0] })).toBe(false);
  });
});
