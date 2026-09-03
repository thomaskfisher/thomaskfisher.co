import { describe, expect, it } from 'vitest';
import {
  type Structure,
  accessibleScrewIds,
  allRemoved,
  createBoardState,
  indexStructure,
  isAccessible,
  isDisassemblable,
  isWellFormed,
  platesOverlap,
  removeScrew,
  restoreScrew,
  structureKey,
} from './model';

/**
 * Two plates, one directly on top of the other. The lower plate's screw sits
 * under the upper plate, so it cannot be reached until the upper plate falls.
 *
 *   layer 1:  plate 1 at (0,0) 2x2, screw 1
 *   layer 0:  plate 0 at (0,0) 3x3, screws 0 (covered) and 2 (clear)
 */
function stacked(): Structure {
  return {
    plates: [
      { id: 0, layer: 0, x: 0, y: 0, w: 3, h: 3 },
      { id: 1, layer: 1, x: 0, y: 0, w: 2, h: 2 },
    ],
    screws: [
      { id: 0, color: 0, plateId: 0, x: 1, y: 1 }, // under plate 1
      { id: 1, color: 0, plateId: 1, x: 0, y: 0 }, // on top
      { id: 2, color: 0, plateId: 0, x: 2, y: 2 }, // outside plate 1
    ],
    gridWidth: 3,
    gridHeight: 3,
    colors: 1,
  };
}

describe('plate geometry', () => {
  it('detects overlap', () => {
    expect(
      platesOverlap(
        { id: 0, layer: 0, x: 0, y: 0, w: 3, h: 3 },
        { id: 1, layer: 1, x: 2, y: 2, w: 2, h: 2 },
      ),
    ).toBe(true);
  });

  it('treats touching edges as not overlapping', () => {
    expect(
      platesOverlap(
        { id: 0, layer: 0, x: 0, y: 0, w: 2, h: 2 },
        { id: 1, layer: 1, x: 2, y: 0, w: 2, h: 2 },
      ),
    ).toBe(false);
  });
});

describe('accessibility', () => {
  it('blocks a screw sitting under a standing plate', () => {
    const structure = stacked();
    const index = indexStructure(structure);
    const state = createBoardState(structure, index);

    expect(isAccessible(index, state, 0)).toBe(false); // covered
    expect(isAccessible(index, state, 1)).toBe(true); // on top
    expect(isAccessible(index, state, 2)).toBe(true); // beside the cover
  });

  it('reveals covered screws once the plate above loses its last screw', () => {
    const structure = stacked();
    const index = indexStructure(structure);
    const state = createBoardState(structure, index);

    removeScrew(structure, index, state, 1); // plate 1 falls
    expect(isAccessible(index, state, 0)).toBe(true);
  });

  it('does not treat a partially unscrewed plate as fallen', () => {
    const structure: Structure = {
      plates: [
        { id: 0, layer: 0, x: 0, y: 0, w: 3, h: 3 },
        { id: 1, layer: 1, x: 0, y: 0, w: 2, h: 2 },
      ],
      screws: [
        { id: 0, color: 0, plateId: 0, x: 1, y: 1 },
        { id: 1, color: 0, plateId: 1, x: 0, y: 0 },
        { id: 2, color: 0, plateId: 1, x: 1, y: 0 },
      ],
      gridWidth: 3,
      gridHeight: 3,
      colors: 1,
    };
    const index = indexStructure(structure);
    const state = createBoardState(structure, index);

    removeScrew(structure, index, state, 1); // one of plate 1's two screws
    expect(isAccessible(index, state, 0)).toBe(false); // still covered
    removeScrew(structure, index, state, 2);
    expect(isAccessible(index, state, 0)).toBe(true);
  });

  it('never reports a removed screw as accessible', () => {
    const structure = stacked();
    const index = indexStructure(structure);
    const state = createBoardState(structure, index);
    removeScrew(structure, index, state, 2);
    expect(isAccessible(index, state, 2)).toBe(false);
  });

  it('lists exactly the reachable screws', () => {
    const structure = stacked();
    const index = indexStructure(structure);
    const state = createBoardState(structure, index);
    expect(accessibleScrewIds(structure, index, state).sort()).toEqual([1, 2]);
  });
});

describe('remove / restore', () => {
  it('round-trips exactly, including plate counters', () => {
    const structure = stacked();
    const index = indexStructure(structure);
    const state = createBoardState(structure, index);
    const before = structureKey(state);
    const counters = state.remainingPerPlate.slice();

    removeScrew(structure, index, state, 1);
    expect(structureKey(state)).not.toBe(before);

    restoreScrew(structure, index, state, 1);
    expect(structureKey(state)).toBe(before);
    expect(state.remainingPerPlate).toEqual(counters);
  });

  it('is idempotent in both directions', () => {
    const structure = stacked();
    const index = indexStructure(structure);
    const state = createBoardState(structure, index);

    removeScrew(structure, index, state, 1);
    removeScrew(structure, index, state, 1); // second call must not double-count
    expect(state.remainingPerPlate[1]).toBe(0);

    restoreScrew(structure, index, state, 1);
    restoreScrew(structure, index, state, 1);
    expect(state.remainingPerPlate[1]).toBe(1);
  });

  it('reports completion once every screw is out', () => {
    const structure = stacked();
    const index = indexStructure(structure);
    const state = createBoardState(structure, index);
    expect(allRemoved(state)).toBe(false);
    for (const id of [0, 1, 2]) removeScrew(structure, index, state, id);
    expect(allRemoved(state)).toBe(true);
  });
});

describe('well-formedness', () => {
  it('accepts a sane structure', () => {
    expect(isWellFormed(stacked())).toBe(true);
  });

  it('rejects a plate with no screws, which could never have stood', () => {
    const structure = stacked();
    structure.plates.push({ id: 2, layer: 2, x: 0, y: 2, w: 1, h: 1 });
    expect(isWellFormed(structure)).toBe(false);
  });

  it('rejects two screws sharing a point, one of which would be unclickable', () => {
    const structure = stacked();
    (structure.screws[2] as { x: number; y: number }).x = 0;
    (structure.screws[2] as { x: number; y: number }).y = 0;
    expect(isWellFormed(structure)).toBe(false);
  });

  it('rejects a screw outside its own plate', () => {
    const structure = stacked();
    (structure.screws[1] as { x: number }).x = 2; // plate 1 is only 2 wide
    expect(isWellFormed(structure)).toBe(false);
  });
});

describe('disassembly', () => {
  it('accepts a stack built in layers', () => {
    expect(isDisassemblable(stacked())).toBe(true);
  });

  /**
   * Deadlock is structurally impossible while layers are strictly ordered: the
   * topmost plate has nothing above it, so its screws are reachable, so it
   * falls — and the same argument then applies to the next plate down.
   *
   * Even a pair stacked squarely on top of each other comes apart, which is why
   * generation assigns each plate a distinct increasing layer. `isDisassemblable`
   * is kept as a guard against that invariant being broken later, not because a
   * generated structure is expected to fail it.
   */
  it('comes apart even when plates sit squarely on top of one another', () => {
    const squarelyStacked: Structure = {
      plates: [
        { id: 0, layer: 0, x: 0, y: 0, w: 2, h: 2 },
        { id: 1, layer: 1, x: 0, y: 0, w: 2, h: 2 },
      ],
      screws: [
        { id: 0, color: 0, plateId: 0, x: 0, y: 0 }, // fully covered by plate 1
        { id: 1, color: 0, plateId: 1, x: 1, y: 1 },
      ],
      gridWidth: 2,
      gridHeight: 2,
      colors: 1,
    };

    const index = indexStructure(squarelyStacked);
    const state = createBoardState(squarelyStacked, index);
    expect(isAccessible(index, state, 0)).toBe(false); // buried at the start
    expect(isDisassemblable(squarelyStacked)).toBe(true); // but not stuck
  });

  /** A screw nothing can ever uncover is the failure this guard exists for. */
  it('rejects a structure where a covering plate can never fall', () => {
    const stuck: Structure = {
      plates: [
        { id: 0, layer: 0, x: 0, y: 0, w: 2, h: 2 },
        // Plate 1 covers plate 0's screw, but plate 1's own screw is recorded
        // against plate 0 — so plate 1 never loses a screw and never falls.
        { id: 1, layer: 1, x: 0, y: 0, w: 2, h: 2 },
      ],
      screws: [
        { id: 0, color: 0, plateId: 0, x: 0, y: 0 },
        { id: 1, color: 0, plateId: 0, x: 1, y: 1 },
      ],
      gridWidth: 2,
      gridHeight: 2,
      colors: 1,
    };

    expect(isWellFormed(stuck)).toBe(false); // plate 1 has no screws
    expect(isDisassemblable(stuck)).toBe(false);
  });
});
