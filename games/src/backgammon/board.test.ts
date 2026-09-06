import { describe, expect, it } from 'vitest';

import {
  BAR,
  CHECKERS,
  OFF,
  POINTS,
  allHome,
  applyCheckerMove,
  canMove,
  countAt,
  destination,
  distanceToOff,
  entryPoint,
  isBlocked,
  pipCount,
  startingBoard,
  winKind,
  winnerOf,
} from './board';
import { boardOf } from './fixtures';

describe('the opening position', () => {
  const board = startingBoard();

  it('gives each player fifteen checkers and nothing on the bar', () => {
    let white = 0;
    let red = 0;
    for (let point = 0; point < POINTS; point++) {
      white += countAt(board, point, 'white');
      red += countAt(board, point, 'red');
    }
    expect(white).toBe(CHECKERS);
    expect(red).toBe(CHECKERS);
    expect(board.bar).toEqual({ white: 0, red: 0 });
    expect(board.off).toEqual({ white: 0, red: 0 });
  });

  /**
   * The whole point of one absolute numbering is that the two halves are the
   * same position seen from opposite ends. If this ever fails, one player is
   * playing a different game from the other.
   */
  it('is symmetric under i -> 23 - i', () => {
    for (let point = 0; point < POINTS; point++) {
      // `+ 0` normalises the negative zero that negating an empty point produces,
      // which `toBe` treats as a different value from zero.
      expect(board.points[point]).toBe(-(board.points[POINTS - 1 - point] as number) + 0);
    }
  });

  it('starts both players on 167 pips', () => {
    expect(pipCount(board, 'white')).toBe(167);
    expect(pipCount(board, 'red')).toBe(167);
  });
});

describe('geometry', () => {
  it('sends each player towards their own end of the board', () => {
    expect(destination('white', 10, 4)).toBe(6);
    expect(destination('red', 10, 4)).toBe(14);
    expect(distanceToOff('white', 0)).toBe(1);
    expect(distanceToOff('red', 23)).toBe(1);
  });

  it('enters from the bar deepest-first, into the far home board', () => {
    expect(entryPoint('white', 1)).toBe(23);
    expect(entryPoint('white', 6)).toBe(18);
    expect(entryPoint('red', 1)).toBe(0);
    expect(entryPoint('red', 6)).toBe(5);
  });

  it('runs past the edge only in the owning direction', () => {
    expect(destination('white', 2, 3)).toBe(OFF);
    expect(destination('red', 21, 3)).toBe(OFF);
    expect(destination('red', 2, 3)).toBe(5);
  });
});

describe('a single move', () => {
  it('is refused onto a point held by two of the enemy', () => {
    const board = boardOf({ 10: 2, 6: -2 });
    expect(isBlocked(board, 6, 'white')).toBe(true);
    expect(canMove(board, 'white', 10, 4)).toBe(false);
    expect(canMove(board, 'white', 10, 3)).toBe(true);
  });

  it('hits a lone enemy checker and puts it on the bar', () => {
    const board = boardOf({ 10: 2, 7: -1 });
    expect(canMove(board, 'white', 10, 3)).toBe(true);

    const after = applyCheckerMove(board, 'white', 10, 3);
    expect(after.hit).toBe(true);
    expect(after.to).toBe(7);
    expect(after.board.points[7]).toBe(1);
    expect(after.board.bar.red).toBe(1);
    expect(after.board.points[10]).toBe(1);
  });

  it('lets nothing but a bar checker move while the bar is occupied', () => {
    const board = boardOf({ 10: 2 }, { white: 1 });
    expect(canMove(board, 'white', 10, 3)).toBe(false);
    expect(canMove(board, 'white', BAR, 1)).toBe(true);

    const after = applyCheckerMove(board, 'white', BAR, 1);
    expect(after.board.bar.white).toBe(0);
    expect(after.board.points[23]).toBe(1);
  });

  it('refuses a bar entry onto a made point', () => {
    const board = boardOf({ 20: -2 }, { white: 1 });
    expect(canMove(board, 'white', BAR, 4)).toBe(false);
    expect(canMove(board, 'white', BAR, 3)).toBe(true);
  });
});

describe('bearing off', () => {
  const home = boardOf({ 5: 2, 2: 3 });

  it('waits until every checker is home and the bar is clear', () => {
    expect(allHome(home, 'white')).toBe(true);
    expect(allHome(boardOf({ 5: 2, 9: 1 }), 'white')).toBe(false);
    expect(allHome(boardOf({ 5: 2 }, { white: 1 }), 'white')).toBe(false);
    expect(canMove(boardOf({ 5: 2, 9: 1 }), 'white', 5, 6)).toBe(false);
  });

  it('takes a checker off on an exact die', () => {
    expect(canMove(home, 'white', 5, 6)).toBe(true);
    expect(canMove(home, 'white', 2, 3)).toBe(true);

    const after = applyCheckerMove(home, 'white', 5, 6);
    expect(after.to).toBe(OFF);
    expect(after.board.off.white).toBe(1);
    expect(after.board.points[5]).toBe(1);
  });

  /**
   * The rule people argue about at the table: a die bigger than the checker
   * needs only works from the furthest point back. With a checker still on the
   * six, a six cannot take one off the three.
   */
  it('overshoots only from the furthest checker home', () => {
    expect(canMove(home, 'white', 2, 6)).toBe(false);
    expect(canMove(boardOf({ 2: 3 }), 'white', 2, 6)).toBe(true);
    expect(canMove(boardOf({ 2: 3 }), 'white', 2, 4)).toBe(true);
  });

  it('mirrors for red', () => {
    const red = boardOf({ 18: -2, 21: -3 });
    expect(allHome(red, 'red')).toBe(true);
    expect(canMove(red, 'red', 18, 6)).toBe(true);
    expect(canMove(red, 'red', 21, 6)).toBe(false);
  });
});

describe('the result', () => {
  it('is a win once fifteen are off', () => {
    expect(winnerOf(boardOf({}, {}, { white: 15, red: 3 }))).toBe('white');
    expect(winnerOf(boardOf({}, {}, { white: 14 }))).toBe(null);
  });

  it('names a gammon when the loser has none off', () => {
    const single = boardOf({ 10: -3 }, {}, { white: 15, red: 2 });
    expect(winKind(single, 'white')).toBe('single');

    const gammon = boardOf({ 10: -15 }, {}, { white: 15 });
    expect(winKind(gammon, 'white')).toBe('gammon');
  });

  it('names a backgammon when the loser is still on the bar or in the far home', () => {
    const onBar = boardOf({ 10: -14 }, { red: 1 }, { white: 15 });
    expect(winKind(onBar, 'white')).toBe('backgammon');

    // A red checker sitting in white's home board, which is red's furthest point.
    const stranded = boardOf({ 10: -14, 3: -1 }, {}, { white: 15 });
    expect(winKind(stranded, 'white')).toBe('backgammon');
  });
});
