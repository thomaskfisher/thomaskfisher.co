/**
 * Depot's rules sheet. See `shared/how-to-play.ts`.
 *
 * Three of these four rules cannot be inferred by tapping, which is the bar for
 * being in here at all:
 *
 *  - a bus drives out along its arrow and nowhere else, so a tap is refused
 *    unless that whole lane is clear;
 *  - the bays are the only place a bus can go, and running out of them is how
 *    the level ends — not by anything happening on the lot;
 *  - a `?` bus stays revealed once it has been seen, which is what makes it a
 *    move worth spending rather than a coin toss.
 *
 * A new player finds all three out by losing, and losing to a rule you were
 * never told reads as the game being unfair rather than as the game being hard.
 */

import { type GameRules, artArrow, artCross, artTap } from '../shared/how-to-play';
import { paint } from '../shared/palette';

const RED = paint(0).hex;
const BLUE = paint(1).hex;
const GREEN = paint(2).hex;
const YELLOW = paint(3).hex;

/** Grid geometry, all in the 92x64 art viewBox. */
const CELL = 15;
const STEP = 17;

/** The painted bays of the lot. Texture, so nothing reads them. */
function lot(x: number, y: number, cols: number, rows: number): string {
  const cells: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push(
        `<rect class="ha-dim" x="${x + c * STEP}" y="${y + r * STEP}" width="${CELL}" ` +
          `height="${CELL}" rx="3" stroke-width="1.2"/>`,
      );
    }
  }
  return cells.join('');
}

/**
 * A bus: a coloured slab with a windscreen band and the arrow it drives along.
 * The same silhouette the game draws, so the diagram and the board agree.
 */
function bus(x: number, y: number, w: number, h: number, color: string, arrow: string): string {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const heads: Record<string, string> = {
    right: `M${cx - 5} ${cy} h10 M${cx + 1} ${cy - 4} l4 4 l-4 4`,
    left: `M${cx + 5} ${cy} h-10 M${cx - 1} ${cy - 4} l-4 4 l4 4`,
    up: `M${cx} ${cy + 5} v-10 M${cx - 4} ${cy - 1} l4 -4 l4 4`,
    down: `M${cx} ${cy - 5} v10 M${cx - 4} ${cy + 1} l4 4 l4 -4`,
  };
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3.5" fill="${color}"/>` +
    `<path d="${heads[arrow] as string}" stroke="#ffffff" stroke-width="1.7" ` +
    `stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.92"/>`
  );
}

/** A loading bay. `color` null draws the free one. */
function bay(x: number, y: number, color: string | null): string {
  if (!color) {
    return (
      `<rect class="ha-dim" x="${x}" y="${y}" width="24" height="28" rx="5" ` +
      `stroke-width="1.6" stroke-dasharray="3.5 3"/>`
    );
  }
  return (
    `<rect x="${x}" y="${y}" width="24" height="28" rx="5" fill="${color}" ` +
    `fill-opacity="0.2" stroke="${color}" stroke-width="1.7"/>` +
    `<rect x="${x + 4}" y="${y + 7}" width="16" height="10" rx="2.5" fill="${color}"/>`
  );
}

/** A run of people waiting, front-most first. */
function line(x: number, y: number, colors: readonly string[]): string {
  return colors
    .map((color, i) => {
      const cx = x + i * 10;
      const r = i === 0 ? 4.6 : 3.4;
      const ring =
        i === 0
          ? `<circle class="ha-accent" cx="${cx}" cy="${y}" r="${r + 2.6}" stroke-width="1.5"/>`
          : '';
      return `${ring}<circle cx="${cx}" cy="${y}" r="${r}" fill="${color}"/>`;
    })
    .join('');
}

/** Seats on a bus at the kerb, filling from the front. */
function seats(x: number, y: number, count: number, taken: number, color: string): string {
  return Array.from({ length: count }, (_, i) => {
    const cx = x + i * 9;
    return i < taken
      ? `<circle cx="${cx}" cy="${y}" r="3.4" fill="${color}"/>`
      : `<circle class="ha-dim" cx="${cx}" cy="${y}" r="3.4" stroke-width="1.4"/>`;
  }).join('');
}

export const RULES: GameRules = {
  gameName: 'Depot',
  goal: 'Clear the whole queue by bringing each colour the bus it is waiting for.',
  steps: [
    {
      title: 'Tap a bus to drive it out',
      text: 'It only goes the way its arrow points, and that lane has to be clear.',
      art:
        lot(6, 12, 4, 2) +
        bus(7, 13, 32, 13, RED, 'right') +
        artArrow(41, 19.5, 74, 19.5, 6) +
        artTap(23, 19.5, 10) +
        bus(7, 30, 32, 13, BLUE, 'right') +
        bus(41, 30, 32, 13, GREEN, 'right') +
        artCross(82, 44, 7),
    },
    {
      title: 'It pulls into a loading bay',
      text: 'Bays are the only place a bus can wait, and there are never many.',
      art:
        bay(6, 20, RED) +
        bay(34, 20, YELLOW) +
        bay(62, 20, null) +
        artArrow(74, 60, 74, 51, 0),
    },
    {
      title: 'The front of the line boards',
      text: 'Only onto a bus of their own colour. Fill every seat and it drives off.',
      art:
        line(7, 46, [BLUE, BLUE, GREEN, RED, BLUE]) +
        bus(40, 10, 46, 17, BLUE, 'right') +
        seats(48, 36, 4, 3, BLUE) +
        artArrow(20, 38, 44, 30, 8),
    },
    {
      title: 'Every bay full is the end',
      text: 'If nobody at the front matches a bay, nothing can move. A ? bus hides its colour until you pull it, then stays shown.',
      art:
        bay(4, 18, RED) +
        bay(30, 18, GREEN) +
        artCross(20, 56, 7) +
        `<rect x="60" y="18" width="28" height="20" rx="4" fill="#2c3550"/>` +
        `<text class="ha-label ha-label--invert" x="74" y="32" text-anchor="middle">?</text>` +
        artArrow(74, 52, 74, 43, 0) +
        line(66, 56, [YELLOW]),
    },
  ],
};
