import { describe, expect, it } from 'vitest';

import { BAR, OFF, startingBoard } from './board';
import { boardOf } from './fixtures';
import { legalPlays, maxPlays, movableSources, targetsFrom } from './legal';

/**
 * The turn search.
 *
 * This stands where the puzzles keep their solver tests, and it is guarding the
 * same kind of promise: that the game never offers a move it will later call
 * illegal, and never refuses one that is legal. Every case here is a position
 * you could set up on a real board and argue about, which is the point — the
 * "play both dice if you can" family of rules is where casual implementations
 * quietly diverge from backgammon.
 */

const sorted = (plays: { from: number; die: number; to: number }[]) =>
  [...plays].sort((a, b) => a.from - b.from || a.die - b.die);

describe('an ordinary roll', () => {
  it('offers both dice from the opening position', () => {
    const plays = legalPlays(startingBoard(), 'white', [3, 1]);
    expect(maxPlays(startingBoard(), 'white', [3, 1])).toBe(2);
    // The famous 3-1: 8/5, 6/5. Both halves are on offer before either is made.
    expect(plays).toContainEqual({ from: 7, die: 3, to: 4 });
    expect(plays).toContainEqual({ from: 5, die: 1, to: 4 });
  });

  it('gives four moves on doubles', () => {
    expect(maxPlays(startingBoard(), 'white', [2, 2, 2, 2])).toBe(4);
  });

  it('offers nothing when every die is blocked', () => {
    // White on the bar against a closed home board: the roll is dead whatever
    // it says, which is the one time a player passes without moving.
    const shut = boardOf({ 18: -2, 19: -2, 20: -2, 21: -2, 22: -2, 23: -2 }, { white: 1 });
    expect(legalPlays(shut, 'white', [4, 2])).toEqual([]);
    expect(maxPlays(shut, 'white', [4, 2])).toBe(0);
  });
});

describe('both dice must be played if they can be', () => {
  /**
   * The position the rule exists for. Die 6 is blocked from both checkers, so a
   * player looking one move ahead sees two legal ones — 10/9 and 20/19 — and
   * only the first of them leaves the six playable. Taking the other would end
   * the turn a die short, so it is not a legal move at all.
   */
  const board = boardOf({ 10: 1, 20: 1, 4: -2, 13: -2, 14: -2 });

  it('finds the order that uses both, and offers only that', () => {
    expect(maxPlays(board, 'white', [1, 6])).toBe(2);
    expect(legalPlays(board, 'white', [1, 6])).toEqual([{ from: 10, die: 1, to: 9 }]);
  });

  it('offers the six once the one has been played', () => {
    const after = boardOf({ 9: 1, 20: 1, 4: -2, 13: -2, 14: -2 });
    expect(legalPlays(after, 'white', [6])).toEqual([{ from: 9, die: 6, to: 3 }]);
  });
});

describe('when only one die can be played', () => {
  /**
   * Both dice work on their own and neither leaves the other playable, because
   * every route runs into the same blocked point. The rule is that the larger
   * one is the one you have to take — it is not the player's choice.
   */
  it('takes the larger of the two', () => {
    const board = boardOf({ 10: 1, 3: -2 });
    expect(maxPlays(board, 'white', [2, 5])).toBe(1);
    expect(legalPlays(board, 'white', [2, 5])).toEqual([{ from: 10, die: 5, to: 5 }]);
  });

  it('leaves the smaller one when the larger is the one that is blocked', () => {
    const board = boardOf({ 10: 1, 5: -2, 3: -2 });
    expect(legalPlays(board, 'white', [2, 5])).toEqual([{ from: 10, die: 2, to: 8 }]);
  });
});

describe('the bar comes first', () => {
  const board = boardOf({ 10: 3, 20: -2 }, { white: 1 });

  it('offers nothing but the entry while a checker is up there', () => {
    const plays = legalPlays(board, 'white', [3, 5]);
    expect(movableSources(plays)).toEqual([BAR]);
    expect(sorted(plays)).toEqual([
      { from: BAR, die: 3, to: 21 },
      { from: BAR, die: 5, to: 19 },
    ]);
  });

  it('refuses an entry onto a made point', () => {
    const shut = boardOf({ 10: 3, 20: -2, 21: -2 }, { white: 1 });
    expect(targetsFrom(legalPlays(shut, 'white', [3, 5]), BAR)).toEqual([19]);
  });
});

describe('bearing off', () => {
  it('comes off on an exact die, and from the back with a bigger one', () => {
    const board = boardOf({ 3: 2, 1: 3 });
    const plays = legalPlays(board, 'white', [4, 6]);

    // Four is exact for the four point; six overshoots from the furthest back,
    // which is legal, and would not be from the two point.
    expect(plays).toContainEqual({ from: 3, die: 4, to: OFF });
    expect(plays).toContainEqual({ from: 3, die: 6, to: OFF });
    expect(plays.some((play) => play.from === 1 && play.to === OFF)).toBe(false);
  });

  it('waits for the last checker to come home', () => {
    const board = boardOf({ 8: 1, 3: 4 });
    const plays = legalPlays(board, 'white', [4, 4, 4, 4]);
    expect(plays.every((play) => play.to !== OFF)).toBe(true);
    // 9/5, and then the three on the four point can start coming off.
    expect(plays).toEqual([{ from: 8, die: 4, to: 4 }]);
  });
});

describe('the search is complete rather than budgeted', () => {
  /**
   * A crowded position on doubles is the worst case: fifteen checkers, four
   * dice, and every ordering of them to consider. If this were budgeted it
   * would be where the budget ran out, and the game would start refusing legal
   * moves in exactly the position where a player is counting on them.
   */
  it('answers a full board on double sixes without giving up', () => {
    const board = startingBoard();
    // The book opening for double six is 24/18(2), 13/7(2) — all four dice —
    // and 8/2 is the third checker that can start it. Every point a six reaches
    // from is offered, because all four dice play whichever is taken first.
    expect(maxPlays(board, 'white', [6, 6, 6, 6])).toBe(4);
    expect(sorted(legalPlays(board, 'white', [6, 6, 6, 6]))).toEqual([
      { from: 7, die: 6, to: 1 },
      { from: 12, die: 6, to: 6 },
      { from: 23, die: 6, to: 17 },
    ]);
  });

  it('is fast enough to run on every tap', () => {
    const board = startingBoard();
    const started = performance.now();
    for (let i = 0; i < 200; i++) legalPlays(board, 'white', [5, 5, 5, 5]);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});
