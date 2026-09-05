import { describe, expect, it } from 'vitest';

import {
  type Board,
  type Bus,
  type Facing,
  type Level,
  boardWaiting,
  canDriveOut,
  cellsOf,
  createState,
  drivableIds,
  exitLane,
  freeBay,
  isLost,
  isWellFormed,
  isWon,
  occupancy,
  pull,
  stateKey,
} from './model';

function bus(
  x: number,
  y: number,
  facing: Facing,
  color: number,
  capacity = 2,
  length = 2,
  unknown = false,
): Bus {
  return { x, y, length, facing, color, capacity, unknown };
}

function boardOf(buses: Bus[], bays = 2, width = 5, height = 5): Board {
  const colors = Math.max(...buses.map((b) => b.color)) + 1;
  return { width, height, buses, colors, bays };
}

/** A queue with exactly as many of each colour as there are seats for it. */
function seatedQueue(board: Board): number[] {
  const queue: number[] = [];
  for (const b of board.buses) for (let i = 0; i < b.capacity; i++) queue.push(b.color);
  return queue;
}

describe('geometry', () => {
  it('lays a bus along its own axis', () => {
    const board = boardOf([bus(1, 2, 'right', 0)]);
    expect(cellsOf(board, board.buses[0] as Bus)).toEqual([11, 12]);

    const upright = boardOf([bus(1, 2, 'down', 0)]);
    expect(cellsOf(upright, upright.buses[0] as Bus)).toEqual([11, 16]);
  });

  it('drives out of the nose cell, all the way to the edge', () => {
    const board = boardOf([bus(1, 2, 'right', 0)]);
    // Occupies (1,2) and (2,2); the lane is (3,2) then (4,2).
    expect(exitLane(board, board.buses[0] as Bus)).toEqual([13, 14]);

    const left = boardOf([bus(2, 2, 'left', 0)]);
    expect(exitLane(left, left.buses[0] as Bus)).toEqual([11, 10]);

    const up = boardOf([bus(2, 2, 'up', 0)]);
    expect(exitLane(up, up.buses[0] as Bus)).toEqual([7, 2]);

    const down = boardOf([bus(2, 1, 'down', 0)]);
    expect(exitLane(down, down.buses[0] as Bus)).toEqual([17, 22]);
  });

  it('has no lane at all when it is already against the edge it faces', () => {
    const board = boardOf([bus(3, 2, 'right', 0)]);
    expect(exitLane(board, board.buses[0] as Bus)).toEqual([]);
    expect(canDriveOut(board, createState(board), 0)).toBe(true);
  });

  it('will not drive through another bus', () => {
    // Blue faces right out of column 0; red is parked across its lane.
    const board = boardOf([bus(0, 2, 'right', 0), bus(3, 2, 'right', 1)]);
    const state = createState(board);
    expect(canDriveOut(board, state, 0)).toBe(false);
    expect(canDriveOut(board, state, 1)).toBe(true);

    // Taking the blocker off the grid never blocks anything else.
    state.parked[1] = false;
    expect(canDriveOut(board, state, 0)).toBe(true);
  });

  it('reports one owner per occupied cell', () => {
    const board = boardOf([bus(0, 0, 'left', 0), bus(0, 2, 'up', 1)]);
    const grid = occupancy(board, createState(board).parked);
    expect([...grid].filter((owner) => owner !== 255)).toHaveLength(4);
    expect(grid[0]).toBe(0);
    expect(grid[10]).toBe(1);
  });
});

describe('pulling a bus', () => {
  it('refuses a blocked bus and leaves the position untouched', () => {
    const board = boardOf([bus(0, 2, 'right', 0), bus(3, 2, 'right', 1)]);
    const level: Level = { board, queue: seatedQueue(board) };
    const state = createState(board);
    const before = stateKey(state);

    expect(pull(level, state, 0)).toBe('blocked');
    expect(stateKey(state)).toBe(before);
  });

  it('refuses when the kerb is full, and that is the only way to lose', () => {
    const board = boardOf([bus(0, 0, 'left', 0), bus(0, 2, 'left', 1), bus(0, 4, 'left', 2)], 2);
    // A queue that wants colour 2 first, which neither of the first two buses
    // can take — so filling both bays with them ends the level.
    const level: Level = { board, queue: [2, 2, 0, 0, 1, 1] };
    const state = createState(board);

    expect(pull(level, state, 0)).toBe('ok');
    expect(pull(level, state, 1)).toBe('ok');
    expect(freeBay(state)).toBe(-1);
    expect(pull(level, state, 2)).toBe('no-bay');
    expect(isLost(level, state)).toBe(true);
    expect(isWon(level, state)).toBe(false);
  });

  it('boards the queue from the front, and only into a matching bay', () => {
    const board = boardOf([bus(0, 0, 'left', 0, 2), bus(0, 2, 'left', 1, 2)], 2);
    const level: Level = { board, queue: [1, 1, 0, 0] };
    const state = createState(board);

    // Colour 0 arrives first but the front of the queue is colour 1: nobody moves.
    pull(level, state, 0);
    expect(state.boarded).toBe(0);

    pull(level, state, 1);
    // Both 1s board and that bus fills and leaves, which frees the front for the 0s.
    expect(state.boarded).toBe(4);
    expect(state.departed).toBe(2);
    expect(isWon(level, state)).toBe(true);
  });

  it('sends a passenger to the bay closest to leaving', () => {
    // Built by hand rather than played into, so the intermediate step is
    // visible: a full bay departs the instant it fills, so a level that reaches
    // this position through `pull` is already past it by the time it returns.
    const board = boardOf([bus(0, 0, 'left', 0, 2)], 2);
    const state = createState(board);
    state.bays[0] = { id: 0, color: 0, capacity: 4, loaded: 0 };
    state.bays[1] = { id: 1, color: 0, capacity: 3, loaded: 2 };

    boardWaiting({ board, queue: [0, 0] }, state);

    // The first passenger finishes the bay that needed one, not the empty one.
    expect(state.bays[1]).toBeNull();
    expect(state.departed).toBe(1);
    expect(state.bays[0]?.loaded).toBe(1);
  });

  it('never lets the lot itself deadlock while a bay is free', () => {
    // Three buses in a chain, each facing into the next. Whatever order they
    // come out in, something is always drivable — see the header of model.ts.
    const board = boardOf([bus(0, 2, 'right', 0), bus(2, 2, 'right', 0), bus(0, 0, 'left', 0)], 3);
    const level: Level = { board, queue: seatedQueue(board) };
    const state = createState(board);

    for (let step = 0; step < 3; step++) {
      const drivable = drivableIds(board, state);
      expect(drivable.length).toBeGreaterThan(0);
      pull(level, state, drivable[0] as number);
    }
    expect(isWon(level, state)).toBe(true);
  });
});

describe('well-formedness', () => {
  const board = boardOf([bus(0, 0, 'left', 0, 3), bus(0, 2, 'left', 1, 2)], 2);

  it('accepts a level whose seats match its crowd exactly', () => {
    expect(isWellFormed({ board, queue: [0, 0, 0, 1, 1] })).toBe(true);
  });

  it('rejects a crowd with more of a colour than there are seats', () => {
    expect(isWellFormed({ board, queue: [0, 0, 0, 0, 1, 1] })).toBe(false);
  });

  it('rejects a bus nobody will ever fill', () => {
    // One seat short of colour 1, so that bus would hold a bay for good.
    expect(isWellFormed({ board, queue: [0, 0, 0, 1] })).toBe(false);
  });

  it('rejects overlapping buses', () => {
    const overlapping = boardOf([bus(0, 0, 'right', 0, 1), bus(1, 0, 'right', 0, 1)], 2);
    expect(isWellFormed({ board: overlapping, queue: [0, 0] })).toBe(false);
  });

  it('rejects a bus hanging off the grid', () => {
    const off = boardOf([bus(4, 0, 'right', 0, 1)], 2);
    expect(isWellFormed({ board: off, queue: [0] })).toBe(false);
  });
});

describe('the solver key', () => {
  it('treats two bays holding the same thing as the same position', () => {
    const board = boardOf([bus(0, 0, 'left', 0, 2), bus(0, 2, 'left', 0, 2)], 2);
    const level: Level = { board, queue: [0, 0, 0, 0] };

    const a = createState(board);
    a.bays[0] = { id: 0, color: 1, capacity: 3, loaded: 1 };
    const b = createState(board);
    b.bays[1] = { id: 9, color: 1, capacity: 3, loaded: 1 };

    // Same colour, capacity and load: `bayFor` cannot tell them apart, so
    // nothing downstream may either.
    expect(stateKey(a)).toBe(stateKey(b));

    const c = createState(board);
    c.bays[0] = { id: 0, color: 1, capacity: 3, loaded: 2 };
    expect(stateKey(c)).not.toBe(stateKey(a));

    // And the queue position is a consequence of the rest, not part of the key.
    const drained = createState(board);
    boardWaiting(level, drained);
    expect(stateKey(drained)).toBe(stateKey(createState(board)));
  });
});
