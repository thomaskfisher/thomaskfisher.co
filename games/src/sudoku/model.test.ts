import { describe, expect, it } from 'vitest';

import {
  ALL,
  CELLS,
  PEERS,
  UNITS,
  applyMove,
  bit,
  boxOf,
  candidates,
  colOf,
  conflicts,
  digitsOf,
  emptySheet,
  isSolved,
  loneDigit,
  packMove,
  popcount,
  replay,
  rowOf,
  unpackMove,
} from './model';

const blank = (): number[] => new Array<number>(CELLS).fill(0);

describe('geometry', () => {
  it('gives every cell three units and twenty peers', () => {
    for (let cell = 0; cell < CELLS; cell++) {
      expect(PEERS[cell]).toHaveLength(20);
      expect(UNITS.filter((unit) => unit.includes(cell))).toHaveLength(3);
    }
  });

  it('has 27 units of nine cells each', () => {
    expect(UNITS).toHaveLength(27);
    for (const unit of UNITS) expect(new Set(unit).size).toBe(9);
  });

  it('agrees with the row, column and box arithmetic', () => {
    // The middle cell of the middle box.
    expect(rowOf(40)).toBe(4);
    expect(colOf(40)).toBe(4);
    expect(boxOf(40)).toBe(4);
    // Top right.
    expect(boxOf(8)).toBe(2);
    // Bottom left.
    expect(boxOf(72)).toBe(6);
  });

  it('never lists a cell as its own peer', () => {
    for (let cell = 0; cell < CELLS; cell++) {
      expect(PEERS[cell]).not.toContain(cell);
    }
  });
});

describe('candidate masks', () => {
  it('opens every cell of an empty grid to every digit', () => {
    const masks = candidates(blank());
    for (const mask of masks) expect(mask).toBe(ALL);
  });

  it('takes a placed digit off its peers and nothing else', () => {
    const grid = blank();
    grid[0] = 5;
    const masks = candidates(grid);

    // The filled cell itself has an answer rather than candidates.
    expect(masks[0]).toBe(0);
    for (const peer of PEERS[0] as readonly number[]) {
      expect((masks[peer] as number) & bit(5)).toBe(0);
    }
    // Cell 40 is in neither row 0, column 0, nor box 0.
    expect((masks[40] as number) & bit(5)).toBe(bit(5));
  });
});

describe('bit helpers', () => {
  it('counts and lists the digits a mask allows', () => {
    expect(popcount(ALL)).toBe(9);
    expect(popcount(0)).toBe(0);
    expect(digitsOf(bit(1) | bit(4) | bit(9))).toEqual([1, 4, 9]);
  });

  it('reads a lone digit out, and only a lone one', () => {
    expect(loneDigit(bit(7))).toBe(7);
    expect(loneDigit(bit(2) | bit(3))).toBe(0);
    expect(loneDigit(0)).toBe(0);
  });
});

describe('conflicts', () => {
  it('finds nothing in an empty grid', () => {
    expect(conflicts(blank()).size).toBe(0);
  });

  it('marks both cells of a repeat, in every kind of unit', () => {
    for (const [a, b] of [
      [0, 8], // same row
      [0, 72], // same column
      [0, 10], // same box
    ] as const) {
      const grid = blank();
      grid[a] = 3;
      grid[b] = 3;
      expect([...conflicts(grid)].sort((x, y) => x - y)).toEqual([a, b]);
    }
  });

  it('does not mark a digit repeated where no unit is shared', () => {
    const grid = blank();
    grid[0] = 3;
    grid[40] = 3;
    expect(conflicts(grid).size).toBe(0);
  });
});

describe('move packing', () => {
  it('round-trips every cell, digit and kind', () => {
    for (const cell of [0, 1, 40, 79, 80]) {
      for (const value of [0, 1, 5, 9]) {
        for (const pencil of [false, true]) {
          const move = { cell, value, pencil };
          expect(unpackMove(packMove(move))).toEqual(move);
        }
      }
    }
  });
});

describe('applying moves', () => {
  const givens = blank();

  it('writes a digit into an empty cell', () => {
    const sheet = applyMove(emptySheet(givens), givens, { cell: 4, value: 7, pencil: false });
    expect(sheet.grid[4]).toBe(7);
  });

  it('takes the digit back out when it is tapped again', () => {
    const once = applyMove(emptySheet(givens), givens, { cell: 4, value: 7, pencil: false });
    const twice = applyMove(once, givens, { cell: 4, value: 7, pencil: false });
    expect(twice.grid[4]).toBe(0);
  });

  it('refuses to touch a given', () => {
    const fixed = blank();
    fixed[4] = 2;
    const sheet = applyMove(emptySheet(fixed), fixed, { cell: 4, value: 7, pencil: false });
    expect(sheet.grid[4]).toBe(2);
  });

  it('toggles a pencil mark without disturbing its neighbours', () => {
    let sheet = applyMove(emptySheet(givens), givens, { cell: 4, value: 7, pencil: true });
    sheet = applyMove(sheet, givens, { cell: 4, value: 3, pencil: true });
    expect(digitsOf(sheet.notes[4] as number)).toEqual([3, 7]);

    sheet = applyMove(sheet, givens, { cell: 4, value: 7, pencil: true });
    expect(digitsOf(sheet.notes[4] as number)).toEqual([3]);
  });

  /**
   * The tedious half of pencil marks done by hand is what stops people using
   * them, so writing a digit sweeps it out of every peer's notes.
   */
  it('clears the written digit from every peer note', () => {
    let sheet = emptySheet(givens);
    for (const peer of (PEERS[0] as readonly number[]).slice(0, 5)) {
      sheet = applyMove(sheet, givens, { cell: peer, value: 6, pencil: true });
      sheet = applyMove(sheet, givens, { cell: peer, value: 2, pencil: true });
    }

    sheet = applyMove(sheet, givens, { cell: 0, value: 6, pencil: false });

    for (const peer of (PEERS[0] as readonly number[]).slice(0, 5)) {
      expect(digitsOf(sheet.notes[peer] as number)).toEqual([2]);
    }
  });

  it('drops a cell own notes when it is answered', () => {
    let sheet = applyMove(emptySheet(givens), givens, { cell: 4, value: 3, pencil: true });
    sheet = applyMove(sheet, givens, { cell: 4, value: 9, pencil: false });
    expect(sheet.notes[4]).toBe(0);
  });

  it('never mutates the sheet it was given', () => {
    const before = emptySheet(givens);
    const snapshot = before.grid.slice();
    applyMove(before, givens, { cell: 4, value: 7, pencil: false });
    expect(before.grid).toEqual(snapshot);
  });
});

describe('replay', () => {
  it('reproduces a sheet exactly from its move list', () => {
    const givens = blank();
    const moves = [
      { cell: 0, value: 4, pencil: false },
      { cell: 1, value: 7, pencil: true },
      { cell: 1, value: 2, pencil: true },
      { cell: 9, value: 4, pencil: false },
      { cell: 0, value: 4, pencil: false },
    ];

    let direct = emptySheet(givens);
    for (const move of moves) direct = applyMove(direct, givens, move);

    expect(replay(givens, moves)).toEqual(direct);
  });

  /** The save stores packed integers, so the round trip has to be exact. */
  it('survives the trip through packed integers', () => {
    const givens = blank();
    const moves = [
      { cell: 12, value: 3, pencil: false },
      { cell: 44, value: 8, pencil: true },
      { cell: 80, value: 0, pencil: false },
    ];
    const packed = moves.map(packMove).map(unpackMove);
    expect(replay(givens, packed)).toEqual(replay(givens, moves));
  });
});

describe('isSolved', () => {
  it('is false for an empty grid and true for a legal full one', () => {
    expect(isSolved(blank())).toBe(false);

    // A shifted-row Latin square that also satisfies the boxes.
    const grid = blank();
    const base = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (let row = 0; row < 9; row++) {
      const shift = ((row % 3) * 3 + Math.floor(row / 3)) % 9;
      for (let col = 0; col < 9; col++) {
        grid[row * 9 + col] = base[(col + shift) % 9] as number;
      }
    }
    expect(isSolved(grid)).toBe(true);
  });
});
