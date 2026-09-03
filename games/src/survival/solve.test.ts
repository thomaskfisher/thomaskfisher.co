import { describe, expect, it } from 'vitest';

import { createRng, hashSeed } from '../shared/rng';
import { type Board, DEAD, type Node, applyNode, evaluate, nodeAt } from './model';
import { bestContinuation, findSolution, isWinnable, maxFinal } from './solve';

const gate = (op: 'add' | 'mul' | 'sub' | 'div', value: number): Node => ({
  kind: 'gate',
  op,
  value,
});

/**
 * Every route on the board, walked exhaustively. Exponential and only usable on
 * small boards, which is exactly what makes it the right thing to check the
 * linear-time solver against.
 */
function bruteForce(board: Board, route: readonly number[] = []): { final: number; lanes: number[] } | null {
  const { phase, count } = evaluate(board, route);
  if (phase !== 'playing') return null;

  let best: { final: number; lanes: number[] } | null = null;

  const walk = (row: number, lane: number, current: number, taken: number[]): void => {
    if (current <= DEAD) return;
    if (row === board.rows) {
      if (!best || current > best.final) best = { final: current, lanes: [...taken] };
      return;
    }
    const lo = lane < 0 ? 0 : Math.max(0, lane - board.reach);
    const hi = lane < 0 ? board.lanes - 1 : Math.min(board.lanes - 1, lane + board.reach);
    for (let next = lo; next <= hi; next++) {
      taken.push(next);
      walk(row + 1, next, applyNode(nodeAt(board, row, next), current), taken);
      taken.pop();
    }
  };

  walk(route.length, route.length === 0 ? -1 : (route[route.length - 1] as number), count, []);
  return best;
}

/** A board of random gates. Small enough to brute-force, varied enough to matter. */
function randomBoard(seed: number): Board {
  const rng = createRng(seed);
  const lanes = rng.range(2, 4);
  const rows = rng.range(1, 6);
  const nodes: Node[] = [];
  for (let i = 0; i < lanes * rows; i++) {
    if (rng.chance(0.2)) {
      nodes.push({ kind: 'barrier', hp: rng.range(1, 260) });
    } else {
      const op = rng.pick(['add', 'mul', 'sub', 'div'] as const);
      nodes.push(gate(op, op === 'mul' || op === 'div' ? rng.range(2, 4) : rng.range(1, 200)));
    }
  }
  return {
    lanes,
    rows,
    nodes,
    startCount: rng.range(3, 60),
    reach: rng.range(1, 2),
    horde: rng.range(1, 400),
  };
}

describe('bestContinuation', () => {
  it('finds the line a greedy reader walls itself off from', () => {
    // On a squad of ten, +100 is plainly the best gate in row 0 and x4 is
    // plainly not. Taking it strands the run on the left of the board, because
    // one lane per row is all the reach there is, and the multipliers stack up
    // the right-hand side. This is the whole shape of the game in three rows.
    const board: Board = {
      lanes: 3,
      rows: 3,
      nodes: [
        gate('add', 100), gate('add', 5), gate('mul', 4),
        gate('add', 5), gate('add', 5), gate('mul', 4),
        gate('add', 5), gate('add', 5), gate('mul', 3),
      ],
      startCount: 10,
      reach: 1,
      horde: 200,
    };

    const best = bestContinuation(board);
    expect(best?.lanes).toEqual([2, 2, 2]);
    expect(best?.final).toBe(480); // 10 x4 x4 x3

    // Staying greedy the whole way finishes on 120 against a horde of 200.
    expect(evaluate(board, [0, 0, 0])).toMatchObject({ phase: 'lost', cause: 'overrun', count: 120 });

    // Crabbing back across one lane per row still catches the last multiplier,
    // which is the difference reach makes: a bad opening is recoverable, and
    // how long it stays recoverable is what the board is really made of.
    expect(evaluate(board, [0, 1, 2])).toMatchObject({ phase: 'won', count: 345 });
  });

  it('agrees with exhaustive search on random boards', () => {
    for (let seed = 0; seed < 400; seed++) {
      const board = randomBoard(hashSeed('solve', seed));
      const exact = bestContinuation(board);
      const brute = bruteForce(board);

      if (brute === null) {
        expect(exact).toBeNull();
        continue;
      }
      expect(exact).not.toBeNull();
      expect(exact?.final).toBe(brute.final);
      // The lanes need not match — ties are common — but the route it hands
      // back has to actually produce the number it claims.
      expect(evaluate(board, exact?.lanes ?? []).count).toBe(brute.final);
    }
  });

  it('agrees with exhaustive search from part-way up a board', () => {
    let checked = 0;
    for (let seed = 0; seed < 400 && checked < 150; seed++) {
      const board = randomBoard(hashSeed('mid', seed));
      if (board.rows < 3) continue;

      for (let lane = 0; lane < board.lanes; lane++) {
        const prefix = [lane];
        if (evaluate(board, prefix).phase !== 'playing') continue;
        checked++;

        const exact = bestContinuation(board, prefix);
        const brute = bruteForce(board, prefix);
        if (brute === null) {
          expect(exact).toBeNull();
          continue;
        }
        expect(exact?.final).toBe(brute.final);
        expect(evaluate(board, [...prefix, ...(exact?.lanes ?? [])]).count).toBe(brute.final);
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('returns null when nothing survives to the top', () => {
    const board: Board = {
      lanes: 2,
      rows: 2,
      nodes: [gate('add', 5), gate('add', 5), { kind: 'barrier', hp: 999 }, { kind: 'barrier', hp: 999 }],
      startCount: 10,
      reach: 1,
      horde: 1,
    };
    expect(bestContinuation(board)).toBeNull();
    expect(maxFinal(board)).toBe(DEAD);
    expect(isWinnable(board)).toBe(false);
  });
});

describe('findSolution', () => {
  it('returns a route that actually wins', () => {
    for (let seed = 0; seed < 400; seed++) {
      const board = randomBoard(hashSeed('hint', seed));
      const solution = findSolution(board);
      if (!solution) {
        expect(isWinnable(board)).toBe(false);
        continue;
      }
      expect(evaluate(board, solution).phase).toBe('won');
    }
  });

  it('completes a route already half played', () => {
    const board: Board = {
      lanes: 3,
      rows: 4,
      nodes: [
        gate('mul', 2), gate('add', 30), gate('sub', 5),
        gate('add', 40), gate('mul', 3), gate('add', 10),
        gate('mul', 2), gate('add', 20), gate('mul', 2),
        gate('add', 15), gate('add', 15), gate('add', 15),
      ],
      startCount: 12,
      reach: 1,
      horde: 100,
    };

    const opening = [1];
    const rest = findSolution(board, opening);
    expect(rest).not.toBeNull();
    expect(rest).toHaveLength(3);
    expect(evaluate(board, [...opening, ...(rest as number[])]).phase).toBe('won');
  });

  it('is null once the run is already lost', () => {
    const board: Board = {
      lanes: 2,
      rows: 2,
      nodes: [gate('sub', 99), gate('add', 5), gate('add', 5), gate('add', 5)],
      startCount: 10,
      reach: 1,
      horde: 1,
    };
    expect(findSolution(board, [0])).toBeNull();
  });
});
