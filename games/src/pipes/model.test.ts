import { describe, expect, it } from 'vitest';

import {
  type Board,
  E,
  N,
  S,
  W,
  applyMove,
  distinctRotations,
  isSolved,
  leakCount,
  misalignedCount,
  neighbour,
  opposite,
  popcount,
  replay,
  rotate,
  rotateTimes,
  turnsTo,
  wetCells,
  wetCount,
} from './model';

describe('sides', () => {
  it('turns each side into the one facing back', () => {
    expect(opposite(N)).toBe(S);
    expect(opposite(S)).toBe(N);
    expect(opposite(E)).toBe(W);
    expect(opposite(W)).toBe(E);
  });

  it('rotates a stub one side clockwise', () => {
    expect(rotate(N)).toBe(E);
    expect(rotate(E)).toBe(S);
    expect(rotate(S)).toBe(W);
    expect(rotate(W)).toBe(N);
  });

  it('comes back to itself after four turns, for every tile', () => {
    for (let mask = 0; mask < 16; mask++) {
      expect(rotateTimes(mask, 4)).toBe(mask);
      expect(rotateTimes(mask, -1)).toBe(rotateTimes(mask, 3));
    }
  });
});

/**
 * The reason a tile is four bits rather than a shape plus a rotation: the two
 * symmetric tiles need no special case anywhere in the game.
 */
describe('symmetry', () => {
  it('gives a cross one rotation and a straight two', () => {
    expect(distinctRotations(N | E | S | W)).toBe(1);
    expect(distinctRotations(N | S)).toBe(2);
    expect(distinctRotations(E | W)).toBe(2);
  });

  it('gives an elbow, a tee and an end four', () => {
    expect(distinctRotations(N | E)).toBe(4);
    expect(distinctRotations(N | E | S)).toBe(4);
    expect(distinctRotations(N)).toBe(4);
  });

  it('keeps the number of stubs through any rotation', () => {
    for (let mask = 0; mask < 16; mask++) {
      for (let turn = 0; turn < 4; turn++) {
        expect(popcount(rotateTimes(mask, turn))).toBe(popcount(mask));
      }
    }
  });

  it('counts zero turns to a tile that is already right', () => {
    expect(turnsTo(N | S, S | N)).toBe(0);
    expect(turnsTo(N | E, E | S)).toBe(1);
    expect(turnsTo(15, 15)).toBe(0);
  });
});

describe('neighbours', () => {
  const board: Board = { width: 3, height: 3, source: 4, solution: [] };

  it('walks to the cell on each side', () => {
    expect(neighbour(board, 4, 0)).toBe(1); // north
    expect(neighbour(board, 4, 1)).toBe(5); // east
    expect(neighbour(board, 4, 2)).toBe(7); // south
    expect(neighbour(board, 4, 3)).toBe(3); // west
  });

  it('refuses to leave the grid, including around the sides', () => {
    expect(neighbour(board, 0, 0)).toBe(-1);
    expect(neighbour(board, 0, 3)).toBe(-1);
    // Cell 2 is the top right; east is off the grid rather than wrapping to
    // the next row, which is the bug an index-only step would produce.
    expect(neighbour(board, 2, 1)).toBe(-1);
    expect(neighbour(board, 3, 3)).toBe(-1);
  });
});

describe('water', () => {
  /** A straight run of three, left to right, fed from the left-hand end. */
  const board: Board = {
    width: 3,
    height: 1,
    source: 0,
    solution: [E, E | W, W],
  };

  it('reaches every tile of a whole network', () => {
    expect(wetCells(board, board.solution)).toEqual([true, true, true]);
    expect(wetCount(board, board.solution)).toBe(3);
    expect(leakCount(board, board.solution)).toBe(0);
    expect(isSolved(board, board.solution)).toBe(true);
  });

  it('stops where a join does not match', () => {
    // The middle tile turned so it runs north-south: nothing past it is fed.
    const tiles = [E, N | S, W];
    expect(wetCells(board, tiles)).toEqual([true, false, false]);
    expect(isSolved(board, tiles)).toBe(false);
  });

  it('counts a stub pointing off the grid as a leak', () => {
    const tiles = [N, E | W, W];
    expect(leakCount(board, tiles)).toBeGreaterThan(0);
    expect(isSolved(board, tiles)).toBe(false);
  });

  it('counts every unmatched stub, whatever it is unmatched against', () => {
    const tiles = [E, N | S, W];
    // Four, and counting them is a useful exercise: cell 0 points east at a
    // tile that does not point back, cell 2 points west at the same, and the
    // turned middle tile has both its own stubs hanging off a one-row board.
    expect(leakCount(board, tiles)).toBe(4);
  });

  /**
   * Wetness alone is not enough and neither is leak-freedom, which is why
   * `isSolved` checks both. Rotation preserves stub counts, so a board always
   * carries exactly enough stubs for the tree — they can just pair up wrongly.
   */
  it('rejects a board that is whole but not fed', () => {
    const ring: Board = {
      width: 2,
      height: 2,
      source: 0,
      // Cells 1 and 2 join each other; 0 and 3 join each other. No leaks, two
      // components, and the source only sees one of them.
      solution: [E | S, W | S, N | E, N | W],
    };
    const split = [S, S, N, N];
    expect(leakCount(ring, split)).toBe(0);
    expect(wetCells(ring, split)).toEqual([true, false, true, false]);
    expect(isSolved(ring, split)).toBe(false);
  });
});

describe('moves', () => {
  const board: Board = { width: 3, height: 1, source: 0, solution: [E, E | W, W] };

  it('turns one tile a quarter clockwise and leaves the rest alone', () => {
    const tiles = [E, E | W, W];
    const next = applyMove(tiles, 1);
    expect(next[1]).toBe(rotate(E | W));
    expect(next[0]).toBe(tiles[0]);
    expect(tiles[1]).toBe(E | W);
  });

  it('ignores a cell that is not on the board', () => {
    const tiles = [E, E | W, W];
    expect(applyMove(tiles, 99)).toBe(tiles);
    expect(applyMove(tiles, -1)).toBe(tiles);
  });

  it('replays a move list exactly, and four turns is none', () => {
    const start = [N, N | E, S];
    expect(replay(start, [1, 1, 1, 1])).toEqual(start);
    expect(replay(start, [0, 2])).toEqual([rotate(N), N | E, rotate(S)]);
  });

  /** Compared by mask, so a straight lying the right way is never "wrong". */
  it('counts a misaligned tile by its mask, not by its turn count', () => {
    const tiles = board.solution.slice();
    expect(misalignedCount(board, tiles)).toBe(0);

    // Two turns on the middle straight puts it back where it was.
    expect(misalignedCount(board, replay(tiles, [1, 1]))).toBe(0);
    expect(misalignedCount(board, replay(tiles, [1]))).toBe(1);
  });
});
