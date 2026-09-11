/**
 * Nonogram's rules sheet. See `shared/how-to-play.ts`.
 *
 * Three things here genuinely cannot be worked out by tapping, and they are
 * exactly the three steps: what the numbers mean, that the gaps between runs are
 * unknown, and that the cross is a tool rather than decoration.
 *
 * The third one is the most important and the most often skipped. A player who
 * never crosses anything off is holding every negative in their head, and the
 * puzzle stops being solvable somewhere around ten by ten.
 *
 * Deliberately absent: that a finished line's clues grey out, that a stroke
 * locks to one axis, and that the hint names a wrong cell before it offers
 * anything. Nobody loses a level for not knowing any of them.
 */

import type { GameRules } from '../shared/how-to-play';

/* ------------------------------------------------------------------ */
/* Drawing helpers, in the 92x64 art viewBox                           */
/* ------------------------------------------------------------------ */

const CELL = 9;

const px = (ox: number, column: number): number => ox + column * CELL;

/** The grid's cells, with whatever is painted or crossed in them. */
function grid(
  ox: number,
  oy: number,
  cols: number,
  rows: number,
  filled: number[] = [],
  crossed: number[] = [],
): string {
  let out = '';
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < cols; column++) {
      const index = row * cols + column;
      const x = px(ox, column);
      const y = px(oy, row);

      if (filled.includes(index)) {
        out += `<rect class="ha-accent-fill" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="1.5"/>`;
      } else {
        out += `<rect class="ha-fill" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="1.5"/>`;
      }
      out += `<rect class="ha-dim" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="1.5" stroke-width="0.7"/>`;

      if (crossed.includes(index)) {
        const cx = x + CELL / 2;
        const cy = y + CELL / 2;
        out +=
          `<path class="ha-strike" d="M${cx - 2.3} ${cy - 2.3} l4.6 4.6 M${cx + 2.3} ${cy - 2.3} ` +
          `l-4.6 4.6" stroke-width="1.5" stroke-linecap="round"/>`;
      }
    }
  }
  return out;
}

/** One clue number against a row, to the left of the grid. */
function rowClue(ox: number, oy: number, row: number, text: string): string {
  return (
    `<text class="ha-label ha-label--sm" x="${ox - 4}" y="${px(oy, row) + CELL / 2}" ` +
    `text-anchor="end">${text}</text>`
  );
}

/** One clue number above a column. */
function colClue(ox: number, oy: number, column: number, text: string): string {
  return (
    `<text class="ha-label ha-label--sm" x="${px(ox, column) + CELL / 2}" y="${oy - 4}">${text}</text>`
  );
}

export const RULES: GameRules = {
  gameName: 'Nonogram',
  goal: 'Paint the squares the numbers describe.',
  steps: [
    {
      title: 'Numbers count the runs',
      text: 'A row reading 3 1 has three painted, a gap, then one.',
      art:
        grid(30, 26, 6, 1, [0, 1, 2, 4]) +
        rowClue(30, 26, 0, '3 1') +
        `<path class="ha-accent" d="M30 21 H57" stroke-width="1.3" stroke-dasharray="2.5 2"/>`,
    },
    {
      title: 'The gaps are yours to find',
      text: 'Runs come in that order, with at least one blank between.',
      art:
        grid(26, 10, 6, 1, [0, 1, 2, 4]) +
        rowClue(26, 10, 0, '3 1') +
        grid(26, 24, 6, 1, [0, 1, 2, 5]) +
        rowClue(26, 24, 0, '3 1') +
        grid(26, 38, 6, 1, [1, 2, 3, 5]) +
        rowClue(26, 38, 0, '3 1') +
        `<text class="ha-label ha-label--sm" x="86" y="31">?</text>`,
    },
    {
      title: 'Cross off what is empty',
      text: 'Marking the blanks is how the next row becomes readable.',
      art:
        grid(22, 20, 5, 3, [5, 6, 7, 8, 9], [0, 1, 3, 4, 10, 14]) +
        colClue(22, 20, 0, '1') +
        colClue(22, 20, 2, '1') +
        rowClue(22, 20, 1, '5'),
    },
  ],
};
