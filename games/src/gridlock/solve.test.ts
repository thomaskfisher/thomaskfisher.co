import { describe, expect, it } from 'vitest';

import { format, parse } from './ascii';
import { TARGET, applyMove, decode, isLegalMove, isSolved } from './model';
import { analyse, findSolution, isSolvable, minMoves } from './solve';

describe('shortest solutions', () => {
  it('counts a slide of any length as one move', () => {
    // B has to drop out of the exit row, then the target drives the whole way
    // out. Four cells of travel, two decisions.
    const { board, position } = parse(`
      ..B...
      ..B...
      XXB...
      ......
      ......
      ......
    `);

    expect(minMoves(board, position)).toBe(2);
    expect(findSolution(board, position)).toEqual([
      { id: 1, to: 3 },
      { id: TARGET, to: 4 },
    ]);
  });

  it('is zero when the target is already at the exit', () => {
    const { board, position } = parse(`
      ......
      ......
      ....XX
      ......
      ......
      ......
    `);
    expect(findSolution(board, position)).toEqual([]);
    expect(minMoves(board, position)).toBe(0);
  });

  it('proves a jammed park unsolvable rather than giving up on it', () => {
    // Column 2 is full end to end, so neither vehicle in it can shift and the
    // target can never pass. There are no legal moves at all.
    const { board, position } = parse(`
      ..C...
      ..C...
      XXC...
      ..D...
      ..D...
      ..D...
    `);

    expect(isSolvable(board, position)).toBe(false);
    expect(findSolution(board, position)).toBeNull();
    expect(analyse(board, position)).toBeNull();
  });
});

/**
 * The generator picks a starting position by its distance in the analysis and
 * ships that number as the level's difficulty, so the two have to agree
 * exactly. A discrepancy here is a mis-rated level, silently, forever.
 */
describe('the analysis of a component', () => {
  const { board, position } = parse(`
    .ABBCC
    .A.D.E
    XX.D.E
    F..D..
    F.GG.H
    F....H
  `);

  const result = analyse(board, position);
  if (!result) throw new Error('this park is solvable and should analyse');

  it('reaches every position exactly once, and groups them by their distance', () => {
    let counted = 0;
    for (let depth = 0; depth < result.byDistance.length; depth++) {
      for (const key of result.byDistance[depth] as string[]) {
        expect(result.distance.get(key)).toBe(depth);
        counted++;
      }
    }
    expect(counted).toBe(result.size);
    expect(result.byDistance).toHaveLength(result.depth + 1);
  });

  it('puts exactly the winning positions at distance zero', () => {
    for (const key of result.byDistance[0] as string[]) {
      expect(isSolved(board, decode(key))).toBe(true);
    }
    for (const [key, distance] of result.distance) {
      expect(isSolved(board, decode(key))).toBe(distance === 0);
    }
  });

  /**
   * The load-bearing one. Every recorded distance is checked against an
   * independent search from that position — measured from all wins at once,
   * which is the only way a position closer to a *different* exit line is not
   * quietly overstated.
   */
  it('agrees with a fresh search from every hundredth position', () => {
    let checked = 0;
    for (const [key, distance] of result.distance) {
      if (checked % 100 === 0) {
        const solution = findSolution(board, decode(key));
        expect(solution, `no solution from\n${format(board, decode(key))}`).not.toBeNull();
        expect(solution).toHaveLength(distance);
      }
      checked++;
    }
    expect(result.size).toBeGreaterThan(500);
  });

  it('reports a depth that some position actually sits at', () => {
    const deepest = (result.byDistance[result.depth] as string[])[0] as string;
    expect(minMoves(board, decode(deepest))).toBe(result.depth);
    expect(result.depth).toBeGreaterThan(5);
  });
});

describe('a returned solution', () => {
  it('is legal move by move and finishes the level', () => {
    const { board, position } = parse(`
      AA.BBC
      ....DC
      XX..DC
      EE..D.
      F..GG.
      F.HH..
    `);

    const solution = findSolution(board, position);
    expect(solution).not.toBeNull();

    let at: readonly number[] = position;
    for (const move of solution as { id: number; to: number }[]) {
      expect(isLegalMove(board, at, move), `illegal move on\n${format(board, at)}`).toBe(true);
      at = applyMove(at, move);
    }

    expect(isSolved(board, at)).toBe(true);
  });
});
