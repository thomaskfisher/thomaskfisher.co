/**
 * Depot's rules sheet. See `shared/how-to-play.ts`.
 *
 * Three rules, because three is what cannot be inferred by tapping: a bus
 * drives along its arrow and nowhere else, only a matching colour boards, and
 * a full kerb with nobody able to board is the end of the level. A player finds
 * all three out by losing otherwise, and losing to a rule you were never told
 * reads as the game being unfair rather than as the game being hard.
 *
 * The `?` bus is deliberately not in here. It is a fourth step for a mechanic
 * that does not appear until level 18, and nobody loses a level for not knowing
 * that a revealed colour stays revealed — the bar for this sheet is a rule you
 * would otherwise discover by being punished for it, not every rule there is.
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
  goal: 'Clear the lot and the queue with it.',
  steps: [
    {
      title: 'Tap a bus to send it out',
      text: 'It drives the way its arrow points. The lane has to be clear.',
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
      title: 'The front of the line boards',
      text: 'Only a bus of their own colour. Fill it and it leaves.',
      art:
        line(7, 46, [BLUE, BLUE, GREEN, RED, BLUE]) +
        bus(40, 10, 46, 17, BLUE, 'right') +
        seats(48, 36, 4, 3, BLUE) +
        artArrow(20, 38, 44, 30, 8),
    },
    {
      title: 'A bus needs a free bay',
      text: 'Fill them with colours nobody wants and the level is over.',
      art:
        // Every bay taken, and the person at the front matching none of them.
        // An empty bay here would say the opposite of the caption.
        bay(6, 14, RED) +
        bay(34, 14, YELLOW) +
        bay(62, 14, RED) +
        line(14, 55, [GREEN]) +
        artCross(34, 55, 7),
    },
  ],
};
