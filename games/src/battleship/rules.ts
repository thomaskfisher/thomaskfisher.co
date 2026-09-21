/**
 * Battleship's rules sheet. See `shared/how-to-play.ts`.
 *
 * Three things here cannot be worked out by tapping, and they are the three
 * steps: what the numbers count, that ships never touch — corners included,
 * which is the rule nobody guesses — and that a shown piece's shape is a clue.
 *
 * Deliberately absent: the fleet list (it is on screen, and fades as ships are
 * found), the water brush (Nonogram's cross, found the same way), and that the
 * hint names a wrong mark first. Nobody loses a level for not knowing them.
 */

import { type GameRules, artArrow, artCross } from '../shared/how-to-play';

/* ------------------------------------------------------------------ */
/* Drawing helpers, in the 92x64 art viewBox                           */
/* ------------------------------------------------------------------ */

const CELL = 12;

type Piece = 'single' | 'left' | 'right' | 'mid' | 'up' | 'down';

/** A strip of empty squares. */
function squares(ox: number, oy: number, cols: number, rows: number): string {
  let out = '';
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = ox + col * CELL;
      const y = oy + row * CELL;
      out +=
        `<rect class="ha-fill" x="${x}" y="${y}" width="${CELL}" height="${CELL}"/>` +
        `<rect class="ha-dim" x="${x}" y="${y}" width="${CELL}" height="${CELL}" stroke-width="0.6"/>`;
    }
  }
  return out;
}

/**
 * One ship piece in the square at (col, row). Named for the side the rounded
 * bow faces, so `left` is the left end of a ship pointing right.
 */
function piece(ox: number, oy: number, col: number, row: number, shape: Piece, cls = 'ha-accent-fill'): string {
  const x = ox + col * CELL;
  const y = oy + row * CELL;
  const i = 1.6;
  const r = (CELL - i * 2) / 2;
  const cx = x + CELL / 2;
  const cy = y + CELL / 2;
  switch (shape) {
    case 'single':
      return `<circle class="${cls}" cx="${cx}" cy="${cy}" r="${r}"/>`;
    case 'mid':
      return `<rect class="${cls}" x="${x}" y="${y + i}" width="${CELL}" height="${CELL - i * 2}"/>`;
    case 'left':
      return `<path class="${cls}" d="M${x + CELL} ${y + i} H${cx} A${r} ${r} 0 0 0 ${cx} ${y + CELL - i} H${x + CELL} Z"/>`;
    case 'right':
      return `<path class="${cls}" d="M${x} ${y + i} H${cx} A${r} ${r} 0 0 1 ${cx} ${y + CELL - i} H${x} Z"/>`;
    case 'up':
      return `<path class="${cls}" d="M${x + i} ${y + CELL} V${cy} A${r} ${r} 0 0 1 ${x + CELL - i} ${cy} V${y + CELL} Z"/>`;
    case 'down':
      return `<path class="${cls}" d="M${x + i} ${y} V${cy} A${r} ${r} 0 0 0 ${x + CELL - i} ${cy} V${y} Z"/>`;
  }
}

function label(x: number, y: number, text: string): string {
  return `<text class="ha-label ha-label--sm" x="${x}" y="${y}" text-anchor="middle">${text}</text>`;
}

export const RULES: GameRules = {
  gameName: 'Battleship',
  goal: 'Find every ship hidden in the sea.',
  steps: [
    {
      title: 'Numbers count ship squares',
      text: 'Each row and column holds exactly that many.',
      art:
        squares(16, 26, 6, 1) +
        label(8, 32, '3') +
        piece(16, 26, 0, 0, 'left') +
        piece(16, 26, 1, 0, 'right') +
        piece(16, 26, 4, 0, 'single'),
    },
    {
      title: 'Ships never touch',
      text: 'Not even at a corner.',
      art:
        squares(20, 8, 4, 4) +
        piece(20, 8, 0, 1, 'left', 'ha-solid') +
        piece(20, 8, 1, 1, 'right', 'ha-solid') +
        piece(20, 8, 2, 2, 'single', 'ha-solid') +
        artCross(76, 50, 7),
    },
    {
      title: 'Shown pieces are clues',
      text: 'A rounded end points along its ship.',
      art:
        squares(22, 30, 4, 1) +
        piece(22, 30, 0, 0, 'left', 'ha-solid') +
        `<g opacity="0.5">${piece(22, 30, 1, 0, 'mid')}${piece(22, 30, 2, 0, 'right')}</g>` +
        artArrow(28, 22, 54, 22, 8),
    },
  ],
};
