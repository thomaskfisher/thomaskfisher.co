import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEW, generateLevel } from './generate';
import { accessibleScrewIds, createBoardState, indexStructure, isVisibleFrom } from './model';
import {
  type Mat3,
  defaultRotation,
  dragRotate,
  fromQuat,
  hintRotation,
  slerp,
  toQuat,
  viewerDirection,
} from './view';

const close = (a: readonly number[], b: readonly number[], eps = 1e-6): void => {
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i] as number, -Math.log10(eps)));
};

describe('rotation maths', () => {
  it('opens looking from the default view', () => {
    close(viewerDirection(defaultRotation()), DEFAULT_VIEW);
  });

  it('survives a round trip through a quaternion', () => {
    const r = dragRotate(defaultRotation(), 120, -80, 0.01);
    close(fromQuat(toQuat(r)), r, 1e-5);
  });

  it('keeps a long drag a pure rotation', () => {
    let r: Mat3 = defaultRotation();
    for (let i = 0; i < 500; i++) r = dragRotate(r, 7, 3, 0.013);
    // Rows stay unit length and mutually perpendicular.
    for (const i of [0, 1, 2]) {
      expect(Math.hypot(r[i * 3]!, r[i * 3 + 1]!, r[i * 3 + 2]!)).toBeCloseTo(1, 6);
    }
    expect(r[0] * r[3] + r[1] * r[4] + r[2] * r[5]).toBeCloseTo(0, 6);
  });

  it('ends a slerp exactly at its target', () => {
    const a = defaultRotation();
    const b = dragRotate(a, 300, 200, 0.01);
    close(fromQuat(slerp(toQuat(a), toQuat(b), 1)), b, 1e-5);
  });
});

describe('the hint turns to a screw it can show', () => {
  it('always lands on a view where the hinted screw is visible', () => {
    for (const level of [1, 7, 23, 60]) {
      const { structure } = generateLevel('a1b2c3d4e5f60718', level);
      const index = indexStructure(structure);
      const state = createBoardState(structure, index);
      for (const id of accessibleScrewIds(structure, index, state)) {
        const current = defaultRotation();
        const target = hintRotation(structure, state, id, current) ?? current;
        expect(
          isVisibleFrom(structure, state, id, viewerDirection(target)),
          `level ${level} screw ${id}`,
        ).toBe(true);
      }
    }
  });
});
