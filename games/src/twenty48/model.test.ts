import { describe, expect, it } from 'vitest';

import {
  Dir,
  type Grid,
  emptyCells,
  emptyGrid,
  faceOf,
  hasReached,
  highestTile,
  isStuck,
  legalMoves,
  lineCells,
  openingPosition,
  placeSpawn,
  replay,
  slide,
  spawnAt,
  step,
} from './model';

const SIZE = 4;

/** Builds a grid from rows of exponents, so the tests read like a board. */
const grid = (...rows: number[][]): Grid => rows.flat();

describe('faces', () => {
  it('turns an exponent into the number on the tile', () => {
    expect(faceOf(0)).toBe(0);
    expect(faceOf(1)).toBe(2);
    expect(faceOf(4)).toBe(16);
    expect(faceOf(11)).toBe(2048);
  });
});

describe('lineCells', () => {
  it('lists a line from the wall tiles pile against', () => {
    // Moving left, row 0 travels towards cell 0.
    expect(lineCells(4, Dir.Left, 0)).toEqual([0, 1, 2, 3]);
    expect(lineCells(4, Dir.Right, 0)).toEqual([3, 2, 1, 0]);
    expect(lineCells(4, Dir.Up, 0)).toEqual([0, 4, 8, 12]);
    expect(lineCells(4, Dir.Down, 0)).toEqual([12, 8, 4, 0]);
  });
});

describe('slide', () => {
  it('packs tiles against the wall without merging unequal ones', () => {
    const before = grid([0, 1, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
    const after = slide(before, SIZE, Dir.Left);
    expect(after.grid.slice(0, 4)).toEqual([1, 2, 0, 0]);
    expect(after.moved).toBe(true);
    expect(after.merges).toEqual([]);
  });

  it('merges a matching pair into the next exponent', () => {
    const before = grid([1, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
    const after = slide(before, SIZE, Dir.Left);
    expect(after.grid.slice(0, 4)).toEqual([2, 0, 0, 0]);
    expect(after.merges).toEqual([2]);
  });

  /**
   * The rule this game is most often got wrong: a tile merges once per move.
   * `2 2 4` must become `4 4`, never `8`.
   */
  it('never merges the same tile twice in one move', () => {
    const before = grid([1, 1, 2, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
    const after = slide(before, SIZE, Dir.Left);
    expect(after.grid.slice(0, 4)).toEqual([2, 2, 0, 0]);
    expect(after.merges).toEqual([2]);
  });

  it('merges each pair of four equal tiles separately', () => {
    const before = grid([1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
    const after = slide(before, SIZE, Dir.Left);
    expect(after.grid.slice(0, 4)).toEqual([2, 2, 0, 0]);
    expect(after.merges).toEqual([2, 2]);
  });

  it('merges the pair nearest the wall first', () => {
    // Moving left, `2 2 2` gives `4 2` rather than `2 4`.
    const before = grid([1, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
    expect(slide(before, SIZE, Dir.Left).grid.slice(0, 4)).toEqual([2, 1, 0, 0]);
    // And the mirror image moving right.
    const mirrored = grid([0, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
    expect(slide(mirrored, SIZE, Dir.Right).grid.slice(0, 4)).toEqual([0, 0, 1, 2]);
  });

  it('reports a move that changes nothing', () => {
    const packed = grid([1, 2, 3, 4], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
    expect(slide(packed, SIZE, Dir.Left).moved).toBe(false);
    expect(slide(emptyGrid(SIZE), SIZE, Dir.Up).moved).toBe(false);
  });

  it('works in every direction', () => {
    const before = grid([0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [1, 1, 0, 0]);
    expect(slide(before, SIZE, Dir.Up).grid[0]).toBe(1);
    expect(slide(before, SIZE, Dir.Down).grid[12]).toBe(1);
    expect(slide(before, SIZE, Dir.Right).grid[15]).toBe(2);
  });
});

describe('legal moves', () => {
  it('finds none on a full board with no matching neighbours', () => {
    const jammed = grid([1, 2, 1, 2], [2, 1, 2, 1], [1, 2, 1, 2], [2, 1, 2, 1]);
    expect(legalMoves(jammed, SIZE)).toEqual([]);
    expect(isStuck(jammed, SIZE)).toBe(true);
  });

  it('finds a move on a full board that still has a pair', () => {
    const nearly = grid([1, 1, 1, 2], [2, 1, 2, 1], [1, 2, 1, 2], [2, 1, 2, 1]);
    expect(isStuck(nearly, SIZE)).toBe(false);
  });

  it('finds every direction on a board with room', () => {
    const sparse = grid([0, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
    expect(legalMoves(sparse, SIZE)).toHaveLength(4);
  });
});

describe('spawning', () => {
  /**
   * The property the whole game rests on: the tile that arrives is a function of
   * *when* it arrives, not of what was played. Rewinding and playing something
   * else is therefore not an oracle — only where the tile lands can change.
   */
  it('gives the same tile for the same move number', () => {
    for (const moveIndex of [0, 1, 7, 40]) {
      expect(spawnAt('seed', 3, moveIndex)).toEqual(spawnAt('seed', 3, moveIndex));
    }
  });

  it('gives different tiles across moves, levels and profiles', () => {
    const values = new Set<string>();
    for (let moveIndex = 0; moveIndex < 40; moveIndex++) {
      values.add(JSON.stringify(spawnAt('seed', 1, moveIndex)));
    }
    expect(values.size).toBeGreaterThan(20);
    expect(spawnAt('a', 1, 0)).not.toEqual(spawnAt('b', 1, 0));
    expect(spawnAt('a', 1, 0)).not.toEqual(spawnAt('a', 2, 0));
  });

  it('spawns a 2 far more often than a 4', () => {
    let fours = 0;
    for (let moveIndex = 0; moveIndex < 400; moveIndex++) {
      if (spawnAt('ratio', 1, moveIndex).exponent === 2) fours++;
    }
    // A tenth, give or take. Wide bounds — this is a sanity check, not a
    // distribution test.
    expect(fours).toBeGreaterThan(15);
    expect(fours).toBeLessThan(90);
  });

  it('lands only on an empty cell, and does nothing on a full board', () => {
    const board = grid([1, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
    const placed = placeSpawn(board, spawnAt('seed', 1, 0));
    expect(placed.cell).toBeGreaterThan(0);
    expect(emptyCells(placed.grid)).toHaveLength(14);

    const full = grid([1, 2, 1, 2], [2, 1, 2, 1], [1, 2, 1, 2], [2, 1, 2, 1]);
    expect(placeSpawn(full, spawnAt('seed', 1, 0)).cell).toBe(-1);
  });
});

describe('positions', () => {
  it('opens with the right number of tiles', () => {
    const opening = openingPosition('seed', 1, SIZE, 2);
    expect(emptyCells(opening.grid)).toHaveLength(SIZE * SIZE - 2);
    expect(opening.moveIndex).toBe(0);
    expect(opening.score).toBe(0);
  });

  it('refuses a direction that changes nothing', () => {
    const opening = openingPosition('seed', 1, SIZE, 2);
    const dead = [Dir.Up, Dir.Right, Dir.Down, Dir.Left].filter(
      (direction) => !slide(opening.grid, SIZE, direction).moved,
    );
    for (const direction of dead) {
      expect(step(opening, SIZE, direction, 'seed', 1)).toBeNull();
    }
  });

  it('scores every merge at its face value', () => {
    const position = {
      grid: grid([1, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]),
      moveIndex: 0,
      score: 0,
      lastSpawn: -1,
      movements: [],
    };
    const next = step(position, SIZE, Dir.Left, 'seed', 1);
    expect(next?.score).toBe(4);
  });

  it('replays a move list to exactly the same position', () => {
    const moves: Dir[] = [];
    let position = openingPosition('replay', 5, SIZE, 2);

    for (let move = 0; move < 30; move++) {
      const options = legalMoves(position.grid, SIZE);
      if (options.length === 0) break;
      const direction = options[move % options.length] as Dir;
      const next = step(position, SIZE, direction, 'replay', 5);
      if (!next) break;
      position = next;
      moves.push(direction);
    }

    expect(replay('replay', 5, SIZE, 2, moves)).toEqual(position);
  });

  it('stops a replay at the first move that no longer applies', () => {
    const opening = openingPosition('replay', 5, SIZE, 2);
    const dead = ([Dir.Up, Dir.Right, Dir.Down, Dir.Left] as Dir[]).find(
      (direction) => !slide(opening.grid, SIZE, direction).moved,
    );
    if (dead === undefined) return;
    expect(replay('replay', 5, SIZE, 2, [dead])).toEqual(opening);
  });
});

describe('movements', () => {
  it('records where each tile came from, so a slide can be animated', () => {
    const before = grid([0, 1, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
    const after = slide(before, SIZE, Dir.Left);
    expect(after.movements).toEqual([
      { from: 1, to: 0, merged: false },
      { from: 3, to: 1, merged: false },
    ]);
  });

  it('records both halves of a merge arriving at the same cell', () => {
    const before = grid([1, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
    const after = slide(before, SIZE, Dir.Left);
    expect(after.movements).toEqual([
      { from: 0, to: 0, merged: true },
      { from: 1, to: 0, merged: true },
    ]);
  });

  it('accounts for every tile on the board', () => {
    const before = grid([1, 2, 3, 3], [4, 0, 4, 1], [0, 0, 0, 0], [5, 5, 0, 2]);
    const after = slide(before, SIZE, Dir.Left);
    const occupied = before.filter((exponent) => exponent !== 0).length;
    expect(after.movements).toHaveLength(occupied);
  });
});

describe('reaching the target', () => {
  it('is true once any tile is big enough', () => {
    const board = grid([7, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
    expect(highestTile(board)).toBe(7);
    expect(hasReached(board, 7)).toBe(true);
    expect(hasReached(board, 8)).toBe(false);
  });
});
