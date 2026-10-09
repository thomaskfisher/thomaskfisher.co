import { describe, expect, it } from 'vitest';
import {
  type Piece,
  type Screw,
  type Structure,
  accessibleScrewIds,
  allRemoved,
  createBoardState,
  hasFallen,
  indexStructure,
  isAccessible,
  isDisassemblable,
  isSupported,
  isVisibleFrom,
  isWellFormed,
  removeScrew,
} from './model';
import { search } from './solve';

/**
 * A 2x2x2 block (piece 0) with:
 *   plate 1 across the whole front (+z), two screws;
 *   plate 2 stacked on plate 1's right half, one screw — covers screw 1 only;
 *   plate 3 on the back (-z), one screw;
 *   plate 4 on the underside (-y), one screw;
 *   and the block's own screw 5 on its front face, under plate 1, which holds
 *   plate 1 up and keeps the block from falling before it.
 */
function cube(colors: number[] = [0, 0, 1, 1, 0, 1]): Structure {
  const pieces: Piece[] = [
    { id: 0, kind: 'body', min: [0, 0, 0], max: [2, 2, 2] },
    { id: 1, kind: 'plate', min: [0, 0, 2], max: [2, 2, 2.25] },
    { id: 2, kind: 'plate', min: [1, 0, 2.25], max: [2, 1, 2.5] },
    { id: 3, kind: 'plate', min: [0, 0, -0.25], max: [2, 2, 0] },
    { id: 4, kind: 'plate', min: [0, -0.25, 0], max: [2, 0, 2] },
  ];
  const screws: Screw[] = [
    { id: 0, color: colors[0]!, pieceId: 1, point: [0.5, 0.5, 2.25], axis: 2, sign: 1 },
    { id: 1, color: colors[1]!, pieceId: 1, point: [1.5, 0.5, 2.25], axis: 2, sign: 1 },
    { id: 2, color: colors[2]!, pieceId: 2, point: [1.5, 0.5, 2.5], axis: 2, sign: 1 },
    { id: 3, color: colors[3]!, pieceId: 3, point: [0.5, 0.5, -0.25], axis: 2, sign: -1 },
    { id: 4, color: colors[4]!, pieceId: 4, point: [1.5, -0.25, 1.5], axis: 1, sign: -1 },
    { id: 5, color: colors[5]!, pieceId: 0, point: [0.5, 1.5, 2], axis: 2, sign: 1 },
  ];
  return { template: 'test', pieces, screws, colors: 2 };
}

describe('covering in 3D', () => {
  it('covers only screws behind a piece along their own normal', () => {
    const index = indexStructure(cube());
    expect(index.coveringPieces[0]).toEqual([]);
    expect(index.coveringPieces[1]).toEqual([2]);
    expect(index.coveringPieces[2]).toEqual([]);
    // The front plate never covers the back or the underside.
    expect(index.coveringPieces[3]).toEqual([]);
    expect(index.coveringPieces[4]).toEqual([]);
    // The block's own screw is under the front plate.
    expect(index.coveringPieces[5]).toEqual([1]);
  });

  it('uncovers a screw once the piece in front of it falls', () => {
    const structure = cube();
    const index = indexStructure(structure);
    const state = createBoardState(structure, index);
    expect(isAccessible(index, state, 1)).toBe(false);
    removeScrew(structure, index, state, 2);
    expect(isAccessible(index, state, 1)).toBe(true);
    expect(accessibleScrewIds(structure, index, state)).toEqual([0, 1, 3, 4]);
  });

  it('lets a solid block cover a screw, not only a plate', () => {
    // A roof block sitting on the top face hides the screw in that face.
    const structure = cube();
    structure.pieces.push({ id: 5, kind: 'roof', min: [0, 2, 0], max: [2, 3, 2] });
    structure.screws.push({ id: 6, color: 0, pieceId: 0, point: [1.5, 2, 0.5], axis: 1, sign: 1 });
    structure.screws.push({ id: 7, color: 0, pieceId: 5, point: [1.5, 3, 1.5], axis: 1, sign: 1 });
    const index = indexStructure(structure);
    expect(index.coveringPieces[6]).toEqual([5]);
    const state = createBoardState(structure, index);
    expect(isAccessible(index, state, 6)).toBe(false);
    removeScrew(structure, index, state, 7);
    expect(isAccessible(index, state, 6)).toBe(true);
  });

  it('accepts the cube and proves it comes apart', () => {
    expect(isWellFormed(cube())).toBe(true);
    expect(isDisassemblable(cube())).toBe(true);
  });

  it('leaves nothing standing once every screw is out', () => {
    const structure = cube();
    const index = indexStructure(structure);
    const state = createBoardState(structure, index);
    for (let guard = 0; guard < 10 && !allRemoved(state); guard++) {
      for (const id of accessibleScrewIds(structure, index, state)) {
        removeScrew(structure, index, state, id);
      }
    }
    expect(allRemoved(state)).toBe(true);
    structure.pieces.forEach((_, i) => expect(hasFallen(state, i)).toBe(true));
  });

  it('rejects a piece with no screw holding it', () => {
    const structure = cube();
    structure.screws.pop(); // the block's only screw
    expect(isWellFormed(structure)).toBe(false);
  });

  it('rejects pieces that pass through each other', () => {
    const structure = cube();
    (structure.pieces[2] as Piece).min[2] = 2.1;
    expect(isWellFormed(structure)).toBe(false);
  });
});

describe('support', () => {
  it('rejects a piece that could be left floating', () => {
    // The back plate touches only the block and hides none of its screws, so
    // the block could fall first and leave the plate hanging in the air.
    expect(isSupported(cube())).toBe(false);
  });

  it('accepts pieces that each hide a screw of something under them', () => {
    const structure = cube();
    structure.screws.push({ id: 6, color: 0, pieceId: 0, point: [1.5, 1.5, 0], axis: 2, sign: -1 });
    structure.screws.push({ id: 7, color: 0, pieceId: 0, point: [0.5, 0, 0.5], axis: 1, sign: -1 });
    expect(isSupported(structure)).toBe(true);
  });
});

describe('visibility', () => {
  it('shows the front from the front and hides the back and underside', () => {
    const structure = cube();
    const state = createBoardState(structure, indexStructure(structure));
    const front: [number, number, number] = [0, 0, 1];
    expect(isVisibleFrom(structure, state, 0, front)).toBe(true);
    expect(isVisibleFrom(structure, state, 1, front)).toBe(false); // under plate 2
    expect(isVisibleFrom(structure, state, 2, front)).toBe(true);
    expect(isVisibleFrom(structure, state, 3, front)).toBe(false);
    expect(isVisibleFrom(structure, state, 4, front)).toBe(false);
  });

  it('shows the underside only from below', () => {
    const structure = cube();
    const state = createBoardState(structure, indexStructure(structure));
    expect(isVisibleFrom(structure, state, 4, [0, -1, 0])).toBe(true);
    const s = Math.SQRT1_2;
    expect(isVisibleFrom(structure, state, 4, [0, -s, s])).toBe(true);
    expect(isVisibleFrom(structure, state, 4, [0, s, s])).toBe(false);
  });

  it('a screw is hidden by a piece between it and the eye', () => {
    const structure = cube();
    const state = createBoardState(structure, indexStructure(structure));
    // A block off to the back right sits between the back plate and an eye
    // looking from that side.
    structure.pieces.push({ id: 5, kind: 'block', min: [2, 0, -2], max: [4, 2, -0.5] });
    state.remainingPerPiece.push(1);
    const v: [number, number, number] = [0.95, 0, -0.31];
    expect(isVisibleFrom(structure, state, 3, v)).toBe(false);
    expect(isVisibleFrom(structure, state, 3, [0, 0, -1])).toBe(true);
  });
});

describe('solver on a 3D structure', () => {
  it('solves a solvable cube', () => {
    const config = { openSinks: 1, sinkCapacity: 3, bufferCapacity: 2 };
    const result = search({ structure: cube([0, 0, 1, 1, 0, 1]), queue: [1, 0], config });
    expect(result.status).toBe('solved');
  });

  it('proves an impossible order unsolvable rather than giving up', () => {
    // Colour 1: screws 1 (under plate 2), 3, and 5 (under plate 1). Colour 0:
    // 0, 2, 4. With the colour-1 box first and no tray, it can never fill:
    // screw 1 needs plate 2's only screw out, and that screw is colour 0.
    const structure = cube([0, 1, 0, 1, 0, 1]);
    const tight = { openSinks: 1, sinkCapacity: 3, bufferCapacity: 0 };
    expect(search({ structure, queue: [1, 0], config: tight }).status).toBe('unsolvable');
    const roomy = { openSinks: 1, sinkCapacity: 3, bufferCapacity: 3 };
    expect(search({ structure, queue: [0, 1], config: roomy }).status).toBe('solved');
  });
});
