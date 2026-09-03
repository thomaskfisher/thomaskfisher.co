import { describe, expect, it } from 'vitest';
import {
  type Board,
  applyMove,
  canPour,
  canonicalKey,
  cloneBoard,
  heuristic,
  isComplete,
  isSolved,
  isWellFormed,
  legalMoves,
  pourAmount,
  topRunLength,
  undoMove,
} from './model';

const board = (tubes: number[][], height = 4, colors = 2): Board => ({
  tubes: tubes.map((t) => t.slice()),
  height,
  colors,
});

describe('pour legality', () => {
  it('refuses to pour onto a mismatched color', () => {
    const b = board([[0, 1], [1, 0]], 2);
    expect(canPour(b, 0, 1)).toBe(false);
    expect(canPour(b, 1, 0)).toBe(false);
  });

  it('allows pouring onto an empty tube or a matching top', () => {
    const b = board([[0, 1], [1], []], 2);
    expect(canPour(b, 0, 2)).toBe(true); // into empty
    expect(canPour(b, 0, 1)).toBe(true); // 1 onto 1
  });

  it('refuses to pour from an empty tube or into a full one', () => {
    const b = board([[], [0, 0]], 2);
    expect(canPour(b, 0, 1)).toBe(false);
    expect(canPour(b, 1, 0)).toBe(true);
    const full = board([[0], [0, 0]], 2);
    expect(canPour(full, 0, 1)).toBe(false);
  });
});

describe('pour amounts', () => {
  it('moves the whole top run when there is room', () => {
    const b = board([[1, 0, 0], []], 4);
    expect(topRunLength(b.tubes[0]!)).toBe(2);
    expect(pourAmount(b, 0, 1)).toBe(2);
  });

  it('caps the pour at the space available', () => {
    const b = board([[0, 0, 0], [1, 0]], 4);
    expect(pourAmount(b, 0, 1)).toBe(2); // run of 3, only 2 slots free
  });
});

describe('applyMove / undoMove', () => {
  it('round-trips exactly', () => {
    const b = board([[1, 0, 0], [0], []], 4);
    const before = canonicalKey(b);
    const move = { from: 0, to: 1 };
    const amount = applyMove(b, move);
    expect(amount).toBe(2);
    expect(canonicalKey(b)).not.toBe(before);
    undoMove(b, move, amount);
    expect(canonicalKey(b)).toBe(before);
  });

  it('conserves units across a random walk', () => {
    const b = board(
      [
        [0, 1, 0, 1],
        [1, 0, 1, 0],
        [],
      ],
      4,
    );
    expect(isWellFormed(b)).toBe(true);
    for (let i = 0; i < 40; i++) {
      const moves = legalMoves(b);
      if (moves.length === 0) break;
      applyMove(b, moves[i % moves.length]!);
      expect(isWellFormed(b)).toBe(true);
    }
  });

  it('never overflows a tube, splitting the run when space runs out', () => {
    const b = board([[1, 0, 0, 0], [1, 1, 0], [1]], 4);
    expect(isWellFormed(b)).toBe(true);

    // Top run is three 0s but only one slot is free, so only one unit moves.
    expect(applyMove(b, { from: 0, to: 1 })).toBe(1);
    expect(b.tubes[1]).toEqual([1, 1, 0, 0]);
    expect(b.tubes[0]).toEqual([1, 0, 0]);
    expect(isWellFormed(b)).toBe(true);
  });
});

describe('win detection', () => {
  it('requires every non-empty tube to be full and single-colored', () => {
    expect(isSolved(board([[0, 0], [1, 1], []], 2))).toBe(true);
    expect(isSolved(board([[0, 0], [1], [1]], 2))).toBe(false);
    expect(isSolved(board([[0, 1], [1, 0], []], 2))).toBe(false);
  });

  it('does not count a short monochrome tube as complete', () => {
    expect(isComplete([0, 0], 4)).toBe(false);
    expect(isComplete([0, 0, 0, 0], 4)).toBe(true);
  });
});

describe('canonicalKey', () => {
  it('is invariant under tube reordering', () => {
    const a = board([[0, 1], [1, 0], []], 2);
    const b = board([[], [1, 0], [0, 1]], 2);
    expect(canonicalKey(a)).toBe(canonicalKey(b));
  });

  it('distinguishes genuinely different positions', () => {
    const a = board([[0, 1], [1, 0]], 2);
    const b = board([[0, 0], [1, 1]], 2);
    expect(canonicalKey(a)).not.toBe(canonicalKey(b));
  });
});

describe('heuristic', () => {
  it('is zero on a solved board', () => {
    expect(heuristic(board([[0, 0], [1, 1], []], 2))).toBe(0);
  });

  it('counts surplus tubes per color', () => {
    // Each color sits in two tubes: one surplus each.
    expect(heuristic(board([[0, 1], [1, 0], []], 2))).toBe(2);
  });

  it('counts a color appearing twice in one tube only once', () => {
    // Color 0 is in tube 0 (twice, separated) and tube 1. Surplus = 1.
    const b = board([[0, 1, 0], [0, 1, 1]], 3, 2);
    expect(heuristic(b)).toBe(2); // color 0: 2 tubes, color 1: 2 tubes
  });

  it('never exceeds the true cost of a solvable position', () => {
    const b = board([[0, 1], [1, 0], []], 2);
    expect(heuristic(b)).toBeLessThanOrEqual(3); // 3 is optimal here
  });
});

describe('legalMoves pruning', () => {
  it('never suggests disturbing a finished tube', () => {
    const b = board([[0, 0, 0, 0], [1, 1], []], 4);
    expect(legalMoves(b).some((m) => m.from === 0)).toBe(false);
  });

  it('does not relocate a monochrome tube into an empty one', () => {
    const b = board([[0, 0], [], [1, 0]], 4);
    expect(legalMoves(b).some((m) => m.from === 0 && m.to === 1)).toBe(false);
  });

  it('treats interchangeable empty tubes as one destination', () => {
    const b = board([[0, 1], [], []], 4);
    const intoEmpty = legalMoves(b).filter((m) => b.tubes[m.to]!.length === 0);
    expect(intoEmpty).toHaveLength(1);
  });

  it('returns nothing on a locked board', () => {
    expect(legalMoves(board([[0, 1], [1, 0]], 2))).toHaveLength(0);
  });
});

describe('cloneBoard', () => {
  it('is a deep copy', () => {
    const original = board([[0, 1], []], 2);
    const copy = cloneBoard(original);
    applyMove(copy, { from: 0, to: 1 });
    expect(original.tubes[0]).toHaveLength(2);
  });
});
