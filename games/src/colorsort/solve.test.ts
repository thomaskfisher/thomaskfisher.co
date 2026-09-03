import { describe, expect, it } from 'vitest';
import { type Board, applyMove, canonicalKey, cloneBoard, isSolved } from './model';
import { findSolution, search } from './solve';

const board = (tubes: number[][], height: number, colors: number): Board => ({
  tubes: tubes.map((t) => t.slice()),
  height,
  colors,
});

/** Replays a solution and asserts it actually wins. */
function replay(start: Board, moves: { from: number; to: number }[]): boolean {
  const b = cloneBoard(start);
  for (const move of moves) {
    if (applyMove(b, move) === 0) return false; // illegal move in the "solution"
  }
  return isSolved(b);
}

describe('unsolvable positions', () => {
  it('reports a locked two-tube board as unsolvable, not merely unsearched', () => {
    const result = search(board([[0, 1], [1, 0]], 2, 2));
    expect(result.status).toBe('unsolvable');
  });

  it('reports unsolvable with no spare tube and interleaved colors', () => {
    const result = search(
      board(
        [
          [0, 1, 0, 1],
          [1, 0, 1, 0],
        ],
        4,
        2,
      ),
    );
    expect(result.status).toBe('unsolvable');
  });
});

describe('solvable positions', () => {
  it('solves a minimal board and the solution replays to a win', () => {
    const start = board([[0, 1], [1, 0], []], 2, 2);
    const result = search(start);
    expect(result.status).toBe('solved');
    expect(replay(start, result.moves)).toBe(true);
  });

  it('finds the optimal length for a known position', () => {
    const start = board([[0, 1], [1, 0], []], 2, 2);
    const optimal = search(start, { mode: 'optimal' });
    expect(optimal.status).toBe('solved');
    expect(optimal.moves).toHaveLength(3);
    expect(replay(start, optimal.moves)).toBe(true);
  });

  it('never returns a longer solution from optimal than from first', () => {
    const start = board(
      [
        [0, 1, 2, 0],
        [1, 2, 0, 1],
        [2, 0, 1, 2],
        [],
        [],
      ],
      4,
      3,
    );
    const first = search(start);
    const optimal = search(start, { mode: 'optimal' });
    expect(first.status).toBe('solved');
    expect(optimal.status).toBe('solved');
    expect(optimal.moves.length).toBeLessThanOrEqual(first.moves.length);
    expect(replay(start, optimal.moves)).toBe(true);
  });

  it('returns an empty solution for an already-solved board', () => {
    const result = search(board([[0, 0], [1, 1], []], 2, 2));
    expect(result.status).toBe('solved');
    expect(result.moves).toHaveLength(0);
  });
});

describe('node budget', () => {
  it('reports budget rather than claiming unsolvable when it runs out', () => {
    const start = board(
      [
        [0, 1, 2, 3],
        [4, 5, 0, 1],
        [2, 3, 4, 5],
        [1, 0, 3, 2],
        [5, 4, 1, 0],
        [3, 2, 5, 4],
        [],
      ],
      4,
      6,
    );
    const result = search(start, { nodeBudget: 5 });
    expect(result.status).not.toBe('unsolvable');
    expect(result.nodes).toBeLessThanOrEqual(10);
  });
});

describe('findSolution', () => {
  it('returns a full winning line, not just one move', () => {
    const start = board([[0, 1], [1, 0], []], 2, 2);
    const plan = findSolution(start);
    expect(plan).not.toBeNull();
    expect(plan!.length).toBeGreaterThan(1);
    expect(replay(start, plan!)).toBe(true);
  });

  it('returns null when the player has locked the board', () => {
    expect(findSolution(board([[0, 1], [1, 0]], 2, 2))).toBeNull();
  });

  it('never opens by emptying a finished tube', () => {
    const start = board([[0, 0, 0, 0], [1, 2, 1, 2], [2, 1, 2, 1], []], 4, 3);
    const plan = findSolution(start);
    if (plan) expect(plan[0]!.from).not.toBe(0);
  });

  /**
   * The exact position where repeated hints used to ping-pong forever
   * (0 = blue, 1 = red, 2 = green). Hints were computed one move at a time, and
   * because two searches from adjacent positions can return different winning
   * lines, the second line's opening move undid the first's — the board bounced
   * between two states for hundreds of moves.
   *
   * The fix is to follow one plan to the end, which is what this asserts.
   */
  const PING_PONG_POSITION = () =>
    board(
      [
        [0, 0, 0],
        [2, 1],
        [0, 1, 1, 1],
        [2, 2, 2],
        [],
      ],
      4,
      3,
    );

  it('returns a plan that wins when followed to the end', () => {
    const b = PING_PONG_POSITION();
    const plan = findSolution(b);
    expect(plan).not.toBeNull();

    for (const move of plan!) {
      expect(applyMove(b, move), `illegal move ${move.from}->${move.to}`).toBeGreaterThan(0);
    }
    expect(isSolved(b)).toBe(true);
  });

  it('never revisits a position while following a single plan', () => {
    const b = PING_PONG_POSITION();
    const plan = findSolution(b);
    expect(plan).not.toBeNull();

    const seen = new Set<string>([canonicalKey(b)]);
    for (const move of plan!) {
      applyMove(b, move);
      const key = canonicalKey(b);
      expect(seen.has(key), `plan revisits a position after ${move.from}->${move.to}`).toBe(false);
      seen.add(key);
    }
  });
});
