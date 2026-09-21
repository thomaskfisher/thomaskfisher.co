import { describe, expect, it } from 'vitest';

import {
  CELLS,
  EMPTY,
  GRAVITY_FLOOR_MS,
  I,
  J,
  L,
  O,
  ROWS,
  S,
  SPAWN_H,
  T,
  WELL_H,
  WELL_W,
  Z,
  canPlace,
  cellsOf,
  collapse,
  dropDistance,
  emptyWell,
  ghostOf,
  gravityMs,
  isResting,
  levelOf,
  lineScore,
  lock,
  moved,
  rotated,
  spawnPiece,
  stackTop,
} from './model';

const key = (cells: readonly (readonly [number, number])[]): string =>
  cells.map(([x, y]) => `${x},${y}`).sort().join(' ');

const fill = (well: Int8Array, x: number, y: number, type = 0): void => {
  well[y * WELL_W + x] = type;
};

describe('shapes', () => {
  it('gives every piece four cells in every rotation', () => {
    for (let type = 0; type < 7; type++) {
      for (let rot = 0; rot < 4; rot++) {
        expect(CELLS[type]?.[rot], `${type}/${rot}`).toHaveLength(4);
      }
    }
  });

  /*
   * The published SRS orientations. Worth spelling out rather than trusting the
   * rotation formula, because the formula only agrees with SRS when each piece
   * turns inside a box of the right size — and a box one too large rotates the
   * piece around a point beside itself, which looks exactly like a kick bug.
   */
  it('turns T clockwise into the right-pointing state', () => {
    expect(key(CELLS[T]![0]!)).toBe(key([[1, 0], [0, 1], [1, 1], [2, 1]]));
    expect(key(CELLS[T]![1]!)).toBe(key([[1, 0], [1, 1], [2, 1], [1, 2]]));
    expect(key(CELLS[T]![2]!)).toBe(key([[0, 1], [1, 1], [2, 1], [1, 2]]));
    expect(key(CELLS[T]![3]!)).toBe(key([[1, 0], [0, 1], [1, 1], [1, 2]]));
  });

  it('stands I up in its third column', () => {
    expect(key(CELLS[I]![0]!)).toBe(key([[0, 1], [1, 1], [2, 1], [3, 1]]));
    expect(key(CELLS[I]![1]!)).toBe(key([[2, 0], [2, 1], [2, 2], [2, 3]]));
  });

  it('never moves O', () => {
    const spawn = key(CELLS[O]![0]!);
    for (let rot = 1; rot < 4; rot++) expect(key(CELLS[O]![rot]!)).toBe(spawn);
  });

  it('spawns every piece inside the well', () => {
    const well = emptyWell();
    for (let type = 0; type < 7; type++) {
      expect(canPlace(well, spawnPiece(type)), `piece ${type}`).toBe(true);
      for (const [x] of cellsOf(spawnPiece(type))) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(WELL_W);
      }
    }
  });
});

describe('placement', () => {
  it('refuses the walls and the floor', () => {
    const well = emptyWell();
    const piece = spawnPiece(O);
    expect(moved(well, { ...piece, x: 0 }, -1, 0)).toBeNull();
    expect(moved(well, { ...piece, x: WELL_W - 2 }, 1, 0)).toBeNull();
    expect(moved(well, { ...piece, y: ROWS - 2 }, 0, 1)).toBeNull();
  });

  it('refuses an occupied cell', () => {
    const well = emptyWell();
    fill(well, 4, 5);
    expect(canPlace(well, { type: O, rot: 0, x: 4, y: 4 })).toBe(false);
    expect(canPlace(well, { type: O, rot: 0, x: 4, y: 3 })).toBe(true);
  });

  it('allows a piece to sit above the buffer, where a kick may put it', () => {
    expect(canPlace(emptyWell(), { type: T, rot: 0, x: 3, y: -1 })).toBe(true);
  });

  it('drops to the floor and no further', () => {
    const well = emptyWell();
    const piece = spawnPiece(O);
    const landed = ghostOf(well, piece);
    expect(landed.y).toBe(ROWS - 2);
    expect(isResting(well, landed)).toBe(true);
    expect(dropDistance(well, landed)).toBe(0);
  });

  it('drops onto what is already there', () => {
    const well = emptyWell();
    for (let x = 0; x < WELL_W; x++) fill(well, x, ROWS - 1);
    expect(ghostOf(well, spawnPiece(O)).y).toBe(ROWS - 3);
  });
});

describe('wall kicks', () => {
  /*
   * The kick table being consulted at all, and consulted in order. Rotating T
   * clockwise from x=7 wants (8,0) (8,1) (9,1) (8,2); with (8,2) filled the
   * first offset fails and the table's second — one column left — is the one
   * that fits. A piece that simply refuses to turn here is a table that was
   * never read; a piece that ends up somewhere else is one read in the wrong
   * sign, which is the easy mistake because published tables point y up.
   */
  it('shifts left when the spot in place is blocked', () => {
    const well = emptyWell();
    fill(well, 8, 2);
    const turned = rotated(well, { type: T, rot: 0, x: 7, y: 0 }, 1);
    expect(turned).not.toBeNull();
    expect(turned!.rot).toBe(1);
    expect(turned!.x).toBe(6);
    expect(turned!.y).toBe(0);
  });

  it('turns in place when nothing is in the way', () => {
    const turned = rotated(emptyWell(), { type: J, rot: 0, x: 4, y: 6 }, 1);
    expect(turned).toMatchObject({ rot: 1, x: 4, y: 6 });
  });

  it('gives up when every offset is blocked', () => {
    const well = emptyWell();
    // Bury an I flat with solid rows above and below, so no vertical state fits.
    for (let x = 0; x < WELL_W; x++) {
      fill(well, x, 9);
      fill(well, x, 11);
    }
    expect(rotated(well, { type: I, rot: 0, x: 3, y: 9 }, 1)).toBeNull();
  });

  it('comes back to where it started after four turns', () => {
    const well = emptyWell();
    let piece = { type: L, rot: 0, x: 4, y: 8 };
    for (let i = 0; i < 4; i++) piece = rotated(well, piece, 1)!;
    expect(piece).toMatchObject({ type: L, rot: 0, x: 4, y: 8 });
  });
});

describe('locking and clearing', () => {
  it('writes the piece in and finds no rows when none are full', () => {
    const result = lock(emptyWell(), { type: O, rot: 0, x: 4, y: ROWS - 2 });
    expect(result.cleared).toEqual([]);
    expect(result.toppedOut).toBe(false);
    expect(result.well[(ROWS - 1) * WELL_W + 4]).toBe(O);
  });

  it('clears a row the piece completes', () => {
    const well = emptyWell();
    const row = ROWS - 1;
    for (let x = 0; x < WELL_W; x++) if (x !== 4 && x !== 5) fill(well, x, row);

    const result = lock(well, { type: O, rot: 0, x: 4, y: ROWS - 2 });
    expect(result.cleared).toEqual([row]);

    // Only the O's top half is left, and it has fallen into the cleared row.
    const after = collapse(result.well, result.cleared);
    expect(after[(ROWS - 1) * WELL_W + 4]).toBe(O);
    expect(after[(ROWS - 1) * WELL_W + 5]).toBe(O);
    expect(after[(ROWS - 1) * WELL_W + 0]).toBe(EMPTY);
    expect(stackTop(after)).toBe(ROWS - 1);
  });

  it('clears four at once and drops everything above by four', () => {
    const well = emptyWell();
    for (let y = ROWS - 4; y < ROWS; y++) {
      for (let x = 0; x < WELL_W; x++) if (x !== 9) fill(well, x, y);
    }
    fill(well, 0, ROWS - 6, S);

    const result = lock(well, { type: I, rot: 1, x: 7, y: ROWS - 4 });
    expect(result.cleared).toHaveLength(4);

    const after = collapse(result.well, result.cleared);
    expect(after[(ROWS - 2) * WELL_W]).toBe(S);
    expect(stackTop(after)).toBe(ROWS - 2);
  });

  it('calls it a top out when the piece never reached the well', () => {
    const inBuffer = lock(emptyWell(), { type: O, rot: 0, x: 4, y: 0 });
    expect(inBuffer.toppedOut).toBe(true);

    const justInside = lock(emptyWell(), { type: O, rot: 0, x: 4, y: SPAWN_H - 1 });
    expect(justInside.toppedOut).toBe(false);
  });

  it('leaves an untouched well alone', () => {
    const well = emptyWell();
    expect(collapse(well, [])).toBe(well);
    expect(stackTop(well)).toBe(ROWS);
  });
});

describe('scoring and speed', () => {
  it('pays the classic line values, times the level', () => {
    expect(lineScore(0, 5)).toBe(0);
    expect(lineScore(1, 1)).toBe(100);
    expect(lineScore(4, 1)).toBe(800);
    expect(lineScore(4, 7)).toBe(5600);
    // Four at once beats four singles, which is the only reason to dig a well.
    expect(lineScore(4, 1)).toBeGreaterThan(4 * lineScore(1, 1));
  });

  it('turns over a level every ten lines', () => {
    expect(levelOf(0)).toBe(1);
    expect(levelOf(9)).toBe(1);
    expect(levelOf(10)).toBe(2);
    expect(levelOf(105)).toBe(11);
  });

  it('accelerates, then stops at a speed thumbs can reach', () => {
    expect(gravityMs(1)).toBe(1000);
    for (let level = 2; level <= 40; level++) {
      expect(gravityMs(level), `level ${level}`).toBeLessThanOrEqual(gravityMs(level - 1));
      expect(gravityMs(level)).toBeGreaterThanOrEqual(GRAVITY_FLOOR_MS);
    }
    // The floor is reached well inside a good run, which is the whole reason
    // the bag has to carry the difficulty past it. See `bag.ts`.
    expect(gravityMs(11)).toBe(GRAVITY_FLOOR_MS);
    expect(gravityMs(10)).toBeGreaterThan(GRAVITY_FLOOR_MS);
  });

  it('keeps the well the size a phone can show', () => {
    expect(WELL_W).toBe(10);
    expect(WELL_H).toBe(20);
    expect(ROWS).toBe(WELL_H + SPAWN_H);
    expect(Z).toBe(4);
  });
});
