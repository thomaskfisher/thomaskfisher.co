/**
 * 2048's rules sheet. See `shared/how-to-play.ts`.
 *
 * Most people know this game, so the sheet is not here to teach the merge. It
 * is here for the two things that are about *this* build:
 *
 *  - **the level has a target**, which is the difference between this and the
 *    endless score chase everybody has played, and the only thing on screen a
 *    player would otherwise have to guess at;
 *  - **the next tile is shown before you move**, which is genuinely new
 *    information and changes how the last few moves of a tight board are
 *    played.
 *
 * The merge rule gets the first step because a sheet that opens by explaining
 * the scoreboard of a game it never named reads as a manual page.
 *
 * Deliberately absent: that a tile merges only once per move, that a swipe into
 * a wall is refused, and that the board can jam. The first is discovered in
 * about four moves, and the last one has its own sheet when it happens.
 */

import type { GameRules } from '../shared/how-to-play';

/* ------------------------------------------------------------------ */
/* Drawing helpers, in the 92x64 art viewBox                           */
/* ------------------------------------------------------------------ */

const CELL = 13;
const GAP = 2;

const at = (origin: number, index: number): number => origin + index * (CELL + GAP);

/** A tile, or an empty well when `face` is absent. */
function tile(
  ox: number,
  oy: number,
  column: number,
  row: number,
  face?: number,
  accent = false,
): string {
  const x = at(ox, column);
  const y = at(oy, row);

  if (face === undefined) {
    return `<rect class="ha-fill" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2.5"/>`;
  }

  const fill = accent ? 'ha-accent-fill' : 'ha-fill-strong';
  const label = accent ? 'ha-label ha-label--invert ha-label--sm' : 'ha-label ha-label--sm';

  return (
    `<rect class="${fill}" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2.5"/>` +
    `<text class="${label}" x="${x + CELL / 2}" y="${y + CELL / 2 + 0.5}">${face}</text>`
  );
}

/** The swipe arrow. */
function swipe(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.sign(x2 - x1);
  const dy = Math.sign(y2 - y1);
  return (
    `<path class="ha-accent" d="M${x1} ${y1} L${x2} ${y2}" stroke-width="1.8" ` +
    `stroke-dasharray="3.5 3" stroke-linecap="round"/>` +
    `<path class="ha-accent" d="M${x2 - dx * 4 - dy * 3.4} ${y2 - dy * 4 - dx * 3.4} ` +
    `L${x2} ${y2} L${x2 - dx * 4 + dy * 3.4} ${y2 - dy * 4 + dx * 3.4}" stroke-width="1.8" ` +
    `fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

export const RULES: GameRules = {
  gameName: '2048',
  goal: 'Slide the tiles together to build the target.',
  steps: [
    {
      title: 'Swipe to slide everything',
      text: 'Two matching tiles that meet become one, doubled.',
      art:
        tile(8, 12, 0, 0, 2) +
        tile(8, 12, 1, 0, 2) +
        tile(8, 12, 2, 0) +
        tile(8, 12, 0, 1) +
        tile(8, 12, 1, 1) +
        tile(8, 12, 2, 1, 4) +
        swipe(60, 19, 76, 19) +
        tile(8, 12, 2, 0, 2) +
        `<text class="ha-label ha-label--sm" x="80" y="40">4</text>`,
    },
    {
      title: 'Each level names a tile',
      text: 'Build it once and the level is done — no score to chase.',
      art:
        tile(24, 8, 0, 0, 2) +
        tile(24, 8, 1, 0, 4) +
        tile(24, 8, 0, 1, 8) +
        tile(24, 8, 1, 1, 16) +
        tile(24, 8, 0, 2, 32) +
        tile(24, 8, 1, 2, 128, true) +
        `<circle class="ha-accent-fill" cx="74" cy="47" r="7"/>` +
        `<path class="ha-on-accent" d="M70.8 47 l2.2 2.4 l4.2 -5" stroke-width="1.9" ` +
        `fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    },
    {
      title: 'You can see what is next',
      text: 'The tile above the board is the one that arrives after your move.',
      art:
        `<text class="ha-label ha-label--sm" x="26" y="9">NEXT</text>` +
        tile(40, 3, 0, 0, 2, true) +
        tile(20, 22, 0, 0, 4) +
        tile(20, 22, 1, 0) +
        tile(20, 22, 2, 0, 8) +
        tile(20, 22, 0, 1) +
        tile(20, 22, 1, 1, 16) +
        tile(20, 22, 2, 1) +
        tile(20, 22, 0, 2, 2) +
        tile(20, 22, 1, 2) +
        tile(20, 22, 2, 2, 4) +
        swipe(46, 14, 46, 20),
    },
  ],
};
