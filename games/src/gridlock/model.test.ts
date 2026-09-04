import { describe, expect, it } from 'vitest';

import { format, parse } from './ascii';
import {
  EMPTY,
  EXIT_ROW,
  SIZE,
  TARGET,
  applyMove,
  blockersAhead,
  decode,
  encode,
  isLegalMove,
  isSolved,
  isValidPosition,
  isWellFormed,
  legalMoves,
  occupancy,
  slideRange,
} from './model';

const OPEN = parse(`
  ..B...
  ..B...
  XXB...
  ......
  ......
  ......
`);

describe('reading a park', () => {
  it('puts the target first, horizontal, in the exit row', () => {
    const target = OPEN.board.vehicles[TARGET];
    expect(target).toEqual({ orientation: 'h', length: 2, cross: EXIT_ROW });
    expect(OPEN.position[TARGET]).toBe(0);
  });

  it('round-trips through the ASCII form', () => {
    expect(format(OPEN.board, OPEN.position, OPEN.labels)).toBe(
      ['..B...', '..B...', 'XXB...', '......', '......', '......'].join('\n'),
    );
  });

  it('refuses a vehicle with a gap in it', () => {
    expect(() =>
      parse(`
        B.B...
        ......
        XX....
        ......
        ......
        ......
      `),
    ).toThrow(/gap/);
  });
});

describe('occupancy', () => {
  it('marks every cell a vehicle covers and nothing else', () => {
    const grid = occupancy(OPEN.board, OPEN.position);
    expect(grid[EXIT_ROW * SIZE + 0]).toBe(TARGET);
    expect(grid[EXIT_ROW * SIZE + 1]).toBe(TARGET);
    expect(grid[EXIT_ROW * SIZE + 2]).toBe(1);
    expect(grid[EXIT_ROW * SIZE + 3]).toBe(EMPTY);
    expect([...grid].filter((cell) => cell !== EMPTY)).toHaveLength(5);
  });
});

describe('sliding', () => {
  it('stops at the vehicle in front and at the wall behind', () => {
    // The target sits at column 0 with B parked at column 2, so it has
    // nowhere to reverse to and exactly nowhere to go forwards.
    expect(slideRange(OPEN.board, OPEN.position, TARGET)).toEqual({ from: 0, to: 0 });
  });

  it('runs the length of an empty row', () => {
    const { board, position } = parse(`
      ......
      ......
      XX....
      ......
      ......
      ......
    `);
    expect(slideRange(board, position, TARGET)).toEqual({ from: 0, to: SIZE - 2 });
  });

  it('never lets a vehicle jump another', () => {
    const { board, position } = parse(`
      ......
      ......
      X..C.C
      ......
      ......
      ......
    `.replace('X..C.C', 'XX.CC.'));
    // XX at 0, CC at 3: the target can reach column 1 but not column 2 onwards.
    expect(slideRange(board, position, TARGET)).toEqual({ from: 0, to: 1 });
  });

  it('offers one move per reachable cell, never a move to where it already is', () => {
    const { board, position } = parse(`
      ......
      ......
      .XX...
      ......
      ......
      ......
    `);
    const moves = legalMoves(board, position).filter((move) => move.id === TARGET);
    expect(moves.map((move) => move.to).sort()).toEqual([0, 2, 3, 4]);
  });

  it('rejects a slide through an occupied cell', () => {
    expect(isLegalMove(OPEN.board, OPEN.position, { id: TARGET, to: 4 })).toBe(false);
    expect(isLegalMove(OPEN.board, OPEN.position, { id: 1, to: 3 })).toBe(true);
  });
});

/**
 * The property the whole design rests on.
 *
 * Because a vehicle leaves the cells it came from empty, every slide can be
 * taken straight back — so the state space is an *undirected* graph, there is
 * no such thing as a dead end, and a breadth-first sweep from anywhere reaches
 * its whole component. `solve.ts` is only exact while this holds. If a future
 * modifier breaks it (one-way arrows, a gate that closes behind you, anything
 * that consumes a cell), this test is what says so.
 */
describe('every move is reversible', () => {
  it('holds across a full sweep of a crowded park', () => {
    const { board, position } = parse(`
      AABCCD
      ..B..D
      XX...D
      EE.FF.
      G..H..
      G..H..
    `);

    const seen = new Set<string>([encode(position)]);
    let frontier = [position];
    let checked = 0;

    while (frontier.length > 0 && seen.size < 20_000) {
      const next: number[][] = [];
      for (const from of frontier) {
        for (const move of legalMoves(board, from)) {
          const to = applyMove(from, move);
          checked++;

          expect(isValidPosition(board, to)).toBe(true);
          // The undo of that slide has to be legal from where it landed.
          expect(isLegalMove(board, to, { id: move.id, to: from[move.id] as number })).toBe(true);
          expect(applyMove(to, { id: move.id, to: from[move.id] as number })).toEqual([...from]);

          const key = encode(to);
          if (!seen.has(key)) {
            seen.add(key);
            next.push(to);
          }
        }
      }
      frontier = next;
    }

    expect(checked).toBeGreaterThan(1000);
  });
});

describe('winning', () => {
  it('is the target parked against the right-hand wall', () => {
    const { board, position } = parse(`
      ......
      ......
      ....XX
      ......
      ......
      ......
    `);
    expect(isSolved(board, position)).toBe(true);
    expect(isSolved(OPEN.board, OPEN.position)).toBe(false);
  });

  it('names what is in the way, each vehicle once', () => {
    const { board, position } = parse(`
      ..B.C.
      ..B.C.
      XXB.C.
      ......
      ......
      ......
    `);
    expect(blockersAhead(board, position)).toEqual([1, 2]);
    expect(blockersAhead(OPEN.board, OPEN.position)).toEqual([1]);
  });
});

describe('validation', () => {
  it('accepts a well-formed park', () => {
    expect(isWellFormed(OPEN.board)).toBe(true);
    expect(isValidPosition(OPEN.board, OPEN.position)).toBe(true);
  });

  it('rejects a target that is not in the exit row', () => {
    const board = { vehicles: [{ orientation: 'h' as const, length: 2, cross: 4 }] };
    expect(isWellFormed(board)).toBe(false);
  });

  it('rejects two vehicles in the same cell', () => {
    expect(isValidPosition(OPEN.board, [2, 0])).toBe(false);
  });

  it('rejects a vehicle hanging off the edge', () => {
    expect(isValidPosition(OPEN.board, [5, 0])).toBe(false);
  });
});

describe('encoding', () => {
  it('round-trips a position', () => {
    expect(decode(encode([0, 3, 5, 1, 0]))).toEqual([0, 3, 5, 1, 0]);
  });

  it('gives different positions different keys', () => {
    expect(encode([0, 1])).not.toBe(encode([1, 0]));
  });
});
