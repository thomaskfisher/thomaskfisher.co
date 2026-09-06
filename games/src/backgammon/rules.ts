/**
 * Backgammon's rules sheet. See `shared/how-to-play.ts`.
 *
 * Most people who open this already know backgammon, and the ones who do not
 * are sitting opposite somebody who does — so the sheet is not here to teach
 * the game. It names the three things a player has to know before their first
 * turn makes sense, and leaves everything else to the board, which refuses
 * illegal moves and marks the legal ones.
 *
 * Two real rules are deliberately absent. "Both dice must be played if they
 * can be" is enforced rather than explained: it only ever shows up as a move
 * the board declines to offer, and nobody loses a game for not having read it.
 * Entering from the bar is the same — a checker on the bar is the only thing
 * lit up, which is a clearer explanation than a sentence would be.
 */

import type { GameRules } from '../shared/how-to-play';
import { artArrow, artCross } from '../shared/how-to-play';

/* All geometry is in the 92x64 art viewBox. */
const POINT_WIDTH = 13;
const POINT_HEIGHT = 25;

/** A point hanging from the top of the tile. */
function point(x: number, tone: 'ha-fill' | 'ha-fill-strong' = 'ha-fill'): string {
  const apex = 4 + POINT_HEIGHT;
  return (
    `<path class="${tone}" d="M${x} 4 L${x + POINT_WIDTH} 4 ` +
    `L${(x + POINT_WIDTH / 2).toFixed(1)} ${apex} Z"/>`
  );
}

/** A point standing up from the bottom of the tile. */
function upPoint(x: number, tone: 'ha-fill' | 'ha-fill-strong' = 'ha-fill'): string {
  const apex = 60 - POINT_HEIGHT;
  return (
    `<path class="${tone}" d="M${x} 60 L${x + POINT_WIDTH} 60 ` +
    `L${(x + POINT_WIDTH / 2).toFixed(1)} ${apex} Z"/>`
  );
}

/** A checker. `dark` is the other side, drawn in ink rather than as a wash. */
function checker(cx: number, cy: number, dark = false): string {
  return dark
    ? `<circle class="ha-solid" cx="${cx}" cy="${cy}" r="5"/>`
    : `<circle class="ha-fill-strong" cx="${cx}" cy="${cy}" r="5"/>` +
      `<circle class="ha-ink" cx="${cx}" cy="${cy}" r="5" stroke-width="1.3"/>`;
}

/** The ring that means "this is where it can land". */
function landing(cx: number, cy: number, r = 6.5): string {
  return `<circle class="ha-accent" cx="${cx}" cy="${cy}" r="${r}" stroke-width="1.8"/>`;
}

/** A die of the given face, at the given corner. */
function die(x: number, y: number, face: number): string {
  const size = 12;
  const grid: Record<number, [number, number][]> = {
    2: [[0, 0], [2, 2]],
    3: [[0, 0], [1, 1], [2, 2]],
    4: [[0, 0], [2, 0], [0, 2], [2, 2]],
    5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  };
  const pips = (grid[face] ?? [])
    .map(([column, row]) => {
      const cx = x + 3 + column * 3;
      const cy = y + 3 + row * 3;
      return `<circle class="ha-solid" cx="${cx}" cy="${cy}" r="1.2"/>`;
    })
    .join('');

  return (
    `<rect class="ha-fill-strong" x="${x}" y="${y}" width="${size}" height="${size}" rx="2.6"/>` +
    `<rect class="ha-ink" x="${x}" y="${y}" width="${size}" height="${size}" rx="2.6" ` +
    `stroke-width="1.1"/>` +
    pips
  );
}

export const RULES: GameRules = {
  gameName: 'Backgammon',
  goal: 'Bring all fifteen home, then bear off.',
  steps: [
    {
      title: 'One move per die',
      text: 'Tap a checker, then tap where it lands.',
      art:
        // Four points across the top, a checker on the first, and the two
        // places the two dice would take it.
        point(4, 'ha-fill-strong') +
        point(22, 'ha-fill-strong') +
        point(40, 'ha-fill-strong') +
        point(58, 'ha-fill-strong') +
        checker(10.5, 10) +
        landing(46.5, 10) +
        landing(64.5, 10) +
        artArrow(16, 12, 42, 12, 9) +
        die(50, 40, 3) +
        die(66, 40, 5),
    },
    {
      title: 'Two make a point',
      text: 'Land on a lone checker and it goes to the bar.',
      art:
        // Two checkers with a cross over them — nothing may land there — beside
        // the lone one that may, on its way to the bar.
        upPoint(10, 'ha-fill-strong') +
        upPoint(44, 'ha-fill-strong') +
        checker(16.5, 54, true) +
        checker(16.5, 44, true) +
        artCross(16.5, 24, 6) +
        checker(50.5, 54) +
        landing(50.5, 54, 8) +
        // The bar it is on its way to.
        `<rect class="ha-fill-strong" x="74" y="6" width="13" height="52" rx="3"/>` +
        checker(80.5, 16) +
        artArrow(56, 48, 78, 24, 12),
    },
    {
      title: 'Bear off from home',
      text: 'Every checker in your home board first.',
      art:
        upPoint(6, 'ha-fill-strong') +
        upPoint(20, 'ha-fill-strong') +
        upPoint(34, 'ha-fill-strong') +
        upPoint(48, 'ha-fill-strong') +
        checker(12.5, 54) +
        checker(26.5, 54) +
        checker(26.5, 44) +
        checker(40.5, 54) +
        checker(54.5, 54) +
        // The tray, filling up.
        `<rect class="ha-fill" x="70" y="10" width="17" height="48" rx="3"/>` +
        `<rect class="ha-accent-fill" x="73" y="40" width="11" height="5" rx="2"/>` +
        `<rect class="ha-accent-fill" x="73" y="48" width="11" height="5" rx="2"/>` +
        artArrow(58, 46, 78, 30, 10),
    },
  ],
};
