/**
 * Tetris's rules sheet. See `shared/how-to-play.ts`.
 *
 * Three steps, and the test each one had to pass is "would somebody lose
 * without being told". The gestures go in because there is nothing on screen
 * to discover them from — a well does not look like it takes swipes. The ghost
 * outline goes in because a player who has not
 * noticed it is aiming blind and will read the game as imprecise; the four-row
 * bonus goes in because it is the only reason to build a well rather than keep
 * the stack flat, and nobody discovers a scoring rule by tapping; the top of
 * the well goes in because it is how the game ends.
 *
 * Deliberately absent: hold, which the dimmed slot explains better than a
 * sentence would; that the bag gets meaner with the level, which is felt and
 * would only make the opening read as a trick; and swiping up to hold, which
 * the slot itself also does when tapped.
 */

import { artCross, type GameRules } from '../shared/how-to-play';

/** The well's outline, with a floor. Everything else is drawn inside it. */
function well(x: number, y: number, cols: number, rows: number, cell: number): string {
  return (
    `<rect class="ha-dim" x="${x - 1.5}" y="${y - 1.5}" ` +
    `width="${cols * cell + 3}" height="${rows * cell + 3}" rx="3" stroke-width="1.4"/>`
  );
}

/** A block at grid position, in the given class. */
function block(
  x: number,
  y: number,
  col: number,
  row: number,
  cell: number,
  cls: string,
): string {
  return (
    `<rect class="${cls}" x="${x + col * cell + 0.6}" y="${y + row * cell + 0.6}" ` +
    `width="${cell - 1.2}" height="${cell - 1.2}" rx="1.6"/>`
  );
}

const blocks = (
  x: number,
  y: number,
  cell: number,
  cls: string,
  cells: [number, number][],
): string => cells.map(([col, row]) => block(x, y, col, row, cell, cls)).join('');

/** An outlined block — the ghost. */
function ghost(x: number, y: number, col: number, row: number, cell: number): string {
  return (
    `<rect class="ha-accent ha-faint" x="${x + col * cell + 0.8}" y="${y + row * cell + 0.8}" ` +
    `width="${cell - 1.6}" height="${cell - 1.6}" rx="1.6" stroke-width="1.3"/>`
  );
}

const CELL = 7.5;

/* A piece in the air, its ghost on the floor below it. */
const STEP_ONE = (() => {
  const x = 28;
  const y = 8;
  const piece: [number, number][] = [[1, 0], [2, 0], [1, 1], [2, 1]];
  const landing: [number, number][] = [[1, 4], [2, 4], [1, 5], [2, 5]];
  return (
    well(x, y, 5, 6, CELL) +
    blocks(x, y, CELL, 'ha-fill-strong', piece) +
    landing.map(([c, r]) => ghost(x, y, c, r, CELL)).join('') +
    `<path class="ha-accent ha-faint" d="M${x + 1.9 * CELL} ${y + 2.4 * CELL} v${1.1 * CELL}" ` +
    `stroke-width="1.4" stroke-dasharray="2.5 2.5" stroke-linecap="round"/>`
  );
})();

/* A row one block short of full, with the piece that completes it above. */
const STEP_TWO = (() => {
  const x = 26;
  const y = 8;
  const stack: [number, number][] = [
    [0, 5], [1, 5], [2, 5], [4, 5],
    [0, 4], [2, 4],
  ];
  return (
    well(x, y, 5, 6, CELL) +
    blocks(x, y, CELL, 'ha-fill', stack) +
    block(x, y, 3, 5, CELL, 'ha-fill') +
    blocks(x, y, CELL, 'ha-fill-strong', [[3, 1], [3, 2]]) +
    ghost(x, y, 3, 5, CELL) +
    // The row that is about to go.
    `<path class="ha-accent" d="M${x - 3} ${y + 5.5 * CELL} H${x + 5 * CELL + 3}" ` +
    `stroke-width="1.8" stroke-linecap="round"/>`
  );
})();

/* A stack that has reached the lip. */
const STEP_THREE = (() => {
  const x = 22;
  const y = 8;
  const stack: [number, number][] = [
    [0, 5], [1, 5], [2, 5], [3, 5], [4, 5],
    [0, 4], [1, 4], [3, 4], [4, 4],
    [0, 3], [1, 3], [4, 3],
    [1, 2], [4, 2],
    [1, 1], [1, 0],
  ];
  return (
    well(x, y, 5, 6, CELL) +
    blocks(x, y, CELL, 'ha-fill-strong', stack) +
    artCross(x + 5 * CELL + 16, y + 3 * CELL, 8.5)
  );
})();

export const RULES: GameRules = {
  gameName: 'Tetris',
  goal: 'Clear rows for as long as you can.',
  steps: [
    {
      title: 'Tap to turn, swipe to slide',
      text: 'Swipe down to drop it where the outline shows.',
      art: STEP_ONE,
    },
    {
      title: 'Fill a row to clear it',
      text: 'Four rows at once is worth the most.',
      art: STEP_TWO,
    },
    {
      title: 'Stacking to the top ends it',
      text: 'Your best score is kept.',
      art: STEP_THREE,
    },
  ],
};
