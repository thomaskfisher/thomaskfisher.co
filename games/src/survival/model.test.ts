import { describe, expect, it } from 'vitest';

import { createRng } from '../shared/rng';
import {
  type Board,
  COUNT_CAP,
  DEAD,
  type Node,
  applyNode,
  evaluate,
  isWellFormed,
  legalLanes,
  nodeAt,
} from './model';

const gate = (op: 'add' | 'mul' | 'sub' | 'div', value: number): Node => ({
  kind: 'gate',
  op,
  value,
});
const wall = (hp: number): Node => ({ kind: 'barrier', hp });

/** Two lanes, two rows. Lane 0 is the safe line, lane 1 the greedy trap. */
function tinyBoard(overrides: Partial<Board> = {}): Board {
  return {
    lanes: 2,
    rows: 2,
    nodes: [gate('add', 10), gate('mul', 3), gate('mul', 2), wall(40)],
    startCount: 10,
    reach: 1,
    horde: 30,
    ...overrides,
  };
}

describe('applyNode', () => {
  it('applies each operation', () => {
    expect(applyNode(gate('add', 25), 10)).toBe(35);
    expect(applyNode(gate('mul', 3), 10)).toBe(30);
    expect(applyNode(gate('sub', 4), 10)).toBe(6);
    expect(applyNode(gate('div', 3), 10)).toBe(3); // floors
  });

  it('treats reaching zero as the squad being wiped out', () => {
    expect(applyNode(gate('sub', 10), 10)).toBe(DEAD);
    expect(applyNode(gate('sub', 99), 10)).toBe(DEAD);
    expect(applyNode(gate('div', 3), 2)).toBe(DEAD);
  });

  it('requires a barrier to be outnumbered, not merely matched', () => {
    expect(applyNode(wall(40), 41)).toBe(1);
    expect(applyNode(wall(40), 40)).toBe(DEAD);
    expect(applyNode(wall(40), 39)).toBe(DEAD);
  });

  it('never resurrects a dead squad', () => {
    for (const node of [gate('add', 500), gate('mul', 9), wall(1)]) {
      expect(applyNode(node, DEAD)).toBe(DEAD);
    }
  });

  it('caps rather than losing integer precision', () => {
    expect(applyNode(gate('mul', 4), COUNT_CAP)).toBe(COUNT_CAP);
  });

  /**
   * The property `solve.ts` is built on. If this ever fails, the exact DP in the
   * solver silently stops being exact and the solvability guarantee goes with
   * it — so it is checked over the whole node space rather than by example.
   */
  it('is monotone non-decreasing in the incoming count', () => {
    const rng = createRng(0xc0ffee);
    const nodes: Node[] = [];
    for (let i = 0; i < 200; i++) {
      nodes.push(
        rng.chance(0.25)
          ? wall(rng.range(1, 400))
          : gate(rng.pick(['add', 'mul', 'sub', 'div'] as const), rng.range(2, 300)),
      );
    }

    for (const node of nodes) {
      let previous = -1;
      for (let count = 0; count <= 900; count += 7) {
        const value = applyNode(node, count);
        expect(value).toBeGreaterThanOrEqual(previous === -1 ? 0 : previous);
        previous = value;
      }
    }
  });
});

describe('lane reach', () => {
  it('opens every lane for the first row', () => {
    const board = tinyBoard({
      lanes: 4,
      rows: 2,
      nodes: Array.from({ length: 8 }, () => gate('add', 1)),
    });
    expect(legalLanes(board, [])).toEqual([0, 1, 2, 3]);
  });

  it('limits later rows to the reach', () => {
    const board = tinyBoard({
      lanes: 5,
      rows: 3,
      reach: 1,
      nodes: Array.from({ length: 15 }, () => gate('add', 1)),
    });
    expect(legalLanes(board, [2])).toEqual([1, 2, 3]);
    expect(legalLanes(board, [0])).toEqual([0, 1]);
    expect(legalLanes(board, [4])).toEqual([3, 4]);
  });

  it('offers nothing once the top is reached', () => {
    const board = tinyBoard();
    expect(legalLanes(board, [0, 0])).toEqual([]);
  });
});

describe('evaluate', () => {
  it('reports the count after every committed row', () => {
    const board = tinyBoard();
    // 10 -> +10 -> 20 -> x2 -> 40
    expect(evaluate(board, [0, 0])).toMatchObject({ phase: 'won', count: 40, counts: [20, 40] });
  });

  it('is still playing part-way up', () => {
    expect(evaluate(tinyBoard(), [0])).toMatchObject({ phase: 'playing', count: 20 });
  });

  it('distinguishes being blocked from being wiped out', () => {
    const board = tinyBoard();
    // 10 -> x3 -> 30, then the wall of 40 stops them.
    expect(evaluate(board, [1, 1])).toMatchObject({
      phase: 'lost',
      cause: 'blocked',
      death: { row: 1, lane: 1, cause: 'blocked' },
    });

    const lethal = tinyBoard({ nodes: [gate('sub', 10), gate('add', 1), gate('add', 1), gate('add', 1)] });
    expect(evaluate(lethal, [0])).toMatchObject({ phase: 'lost', cause: 'wiped' });
  });

  it('loses at the top when the squad arrives short', () => {
    const board = tinyBoard({ horde: 500 });
    expect(evaluate(board, [0, 0])).toMatchObject({ phase: 'lost', cause: 'overrun', count: 40 });
  });

  it('needs strictly more soldiers than the horde', () => {
    expect(evaluate(tinyBoard({ horde: 40 }), [0, 0]).phase).toBe('lost');
    expect(evaluate(tinyBoard({ horde: 39 }), [0, 0]).phase).toBe('won');
  });

  /**
   * Saved routes replay against a freshly generated board. A step that no
   * longer applies should cost the tail of the run rather than throwing — the
   * controller then keeps the prefix as an in-progress level.
   */
  it('stops at the first step that is no longer legal', () => {
    const board = tinyBoard({
      lanes: 4,
      rows: 3,
      reach: 1,
      nodes: Array.from({ length: 12 }, () => gate('add', 5)),
    });
    expect(evaluate(board, [0, 3, 3]).counts).toEqual([15]);
  });
});

describe('isWellFormed', () => {
  it('accepts a sane board', () => {
    expect(isWellFormed(tinyBoard())).toBe(true);
  });

  it('rejects a mis-sized node list, a no-op multiplier and a zero horde', () => {
    expect(isWellFormed(tinyBoard({ nodes: [gate('add', 1)] }))).toBe(false);
    expect(isWellFormed(tinyBoard({ nodes: [gate('mul', 1), gate('add', 1), gate('add', 1), gate('add', 1)] }))).toBe(false);
    expect(isWellFormed(tinyBoard({ horde: 0 }))).toBe(false);
  });
});

describe('nodeAt', () => {
  it('indexes row-major from the row nearest the squad', () => {
    const board = tinyBoard();
    expect(nodeAt(board, 0, 0)).toEqual(gate('add', 10));
    expect(nodeAt(board, 1, 1)).toEqual(wall(40));
  });
});
