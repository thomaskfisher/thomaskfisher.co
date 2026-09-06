/**
 * Board fixtures. Imported only by the tests — the game never builds a position
 * by hand, and this is not in the bundle.
 *
 * A backgammon test reads as a position, and a position written as
 * `{ 10: 2, 6: -2 }` is one anybody can check against a real board: point 10
 * holds two White, point 6 holds two Red, everything else is empty. Fifteen
 * checkers a side is deliberately not enforced, because most of what is worth
 * testing is a five-checker endgame with everything else already borne off.
 */

import { type Board, type Player, POINTS } from './board';

export function boardOf(
  points: Record<number, number>,
  bar: Partial<Record<Player, number>> = {},
  off: Partial<Record<Player, number>> = {},
): Board {
  const filled = new Array<number>(POINTS).fill(0);
  for (const [point, count] of Object.entries(points)) filled[Number(point)] = count;
  return {
    points: filled,
    bar: { white: 0, red: 0, ...bar },
    off: { white: 0, red: 0, ...off },
  };
}
