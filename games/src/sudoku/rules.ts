/**
 * Sudoku's rules sheet. See `shared/how-to-play.ts`.
 *
 * Sudoku is the one game in this collection most people already know, so the
 * sheet is not here to teach the puzzle. It is here for the two things that are
 * about *this* build and cannot be worked out by tapping: that a cell is chosen
 * before a digit rather than typed into, and that the Notes key exists at all.
 *
 * The first step states the rule anyway, in one line, because a sheet that opens
 * by explaining the controls of a game it never named reads as a manual page.
 *
 * What is deliberately absent: that a wrong digit turns red, that tapping a
 * digit twice removes it, that finished digits fade on the keypad, and that
 * writing a digit sweeps it out of the neighbours' notes. Nobody loses a level
 * for not knowing any of them, and all four are nicer discovered.
 */

import type { GameRules } from '../shared/how-to-play';

/* ------------------------------------------------------------------ */
/* Drawing helpers, in the 92x64 art viewBox                           */
/* ------------------------------------------------------------------ */

/** A full nine-by-nine, small. Reads as "a sudoku" rather than as any board. */
function miniGrid(ox: number, oy: number, cell: number): string {
  const span = cell * 9;
  let out =
    `<rect class="ha-fill" x="${ox}" y="${oy}" width="${span}" height="${span}" rx="2"/>` +
    `<rect class="ha-dim" x="${ox}" y="${oy}" width="${span}" height="${span}" rx="2" stroke-width="1.2"/>`;

  for (let line = 1; line < 9; line++) {
    const heavy = line % 3 === 0;
    const width = heavy ? 1.1 : 0.5;
    const offset = ox + line * cell;
    const down = oy + line * cell;
    out +=
      `<path class="ha-dim" d="M${offset.toFixed(1)} ${oy} V${(oy + span).toFixed(1)}" stroke-width="${width}"/>` +
      `<path class="ha-dim" d="M${ox} ${down.toFixed(1)} H${(ox + span).toFixed(1)}" stroke-width="${width}"/>`;
  }
  return out;
}

/** An accent wash over a run of cells — one row, one column, or one box. */
function band(
  ox: number,
  oy: number,
  cell: number,
  col: number,
  row: number,
  wide: number,
  tall: number,
): string {
  return (
    `<rect class="ha-accent-fill" x="${(ox + col * cell).toFixed(1)}" ` +
    `y="${(oy + row * cell).toFixed(1)}" width="${(wide * cell).toFixed(1)}" ` +
    `height="${(tall * cell).toFixed(1)}" rx="1" fill-opacity="0.3"/>`
  );
}

/** A big cell, for the close-up steps. */
function bigCell(x: number, y: number, size: number, digit?: string): string {
  let out =
    `<rect class="ha-fill" x="${x}" y="${y}" width="${size}" height="${size}" rx="3"/>` +
    `<rect class="ha-dim" x="${x}" y="${y}" width="${size}" height="${size}" rx="3" stroke-width="1.1"/>`;
  if (digit) {
    out +=
      `<text class="ha-label" x="${x + size / 2}" y="${y + size / 2 + 0.5}">${digit}</text>`;
  }
  return out;
}

/** Pencil marks inside a cell, in their fixed 3x3 places. */
function notes(x: number, y: number, size: number, digits: number[]): string {
  const step = size / 3;
  return digits
    .map((digit) => {
      const index = digit - 1;
      const cx = x + (index % 3) * step + step / 2;
      const cy = y + Math.floor(index / 3) * step + step / 2;
      return `<text class="ha-label ha-label--sm" x="${cx.toFixed(1)}" y="${cy.toFixed(1)}">${digit}</text>`;
    })
    .join('');
}

/** A keypad key. */
function key(x: number, y: number, size: number, label: string, on = false): string {
  const fill = on ? 'ha-accent-fill' : 'ha-fill-strong';
  const text = on ? 'ha-label ha-label--invert' : 'ha-label ha-label--sm';
  return (
    `<rect class="${fill}" x="${x}" y="${y}" width="${size}" height="${size}" rx="2.5"/>` +
    `<text class="${text}" x="${x + size / 2}" y="${y + size / 2 + 0.5}">${label}</text>`
  );
}

/** The "tap here" rings, sized for a grid cell. */
function tapRing(cx: number, cy: number, r: number): string {
  return (
    `<circle class="ha-accent" cx="${cx}" cy="${cy}" r="${r}" stroke-width="1.6"/>` +
    `<circle class="ha-accent ha-faint" cx="${cx}" cy="${cy}" r="${r + 3.5}" stroke-width="1.3"/>`
  );
}

/* ------------------------------------------------------------------ */

const MINI_CELL = 5.2;
const MINI_X = 20;
const MINI_Y = 6;

export const RULES: GameRules = {
  gameName: 'Sudoku',
  goal: 'Fill every row, column and box with 1-9.',
  steps: [
    {
      title: 'One of each, three ways',
      text: 'No digit repeats in a row, a column or a box.',
      art:
        miniGrid(MINI_X, MINI_Y, MINI_CELL) +
        band(MINI_X, MINI_Y, MINI_CELL, 0, 4, 9, 1) +
        band(MINI_X, MINI_Y, MINI_CELL, 7, 0, 1, 9) +
        band(MINI_X, MINI_Y, MINI_CELL, 3, 6, 3, 3),
    },
    {
      title: 'Tap a cell, then a digit',
      text: 'The keypad writes into whichever cell is lit.',
      art:
        bigCell(6, 12, 17) +
        bigCell(23, 12, 17, '4') +
        bigCell(6, 29, 17, '7') +
        bigCell(23, 29, 17) +
        tapRing(14.5, 20.5, 7) +
        key(56, 10, 13, '1') +
        key(71, 10, 13, '2') +
        key(56, 25, 13, '3', true) +
        key(71, 25, 13, '4') +
        key(56, 40, 13, '5') +
        key(71, 40, 13, '6'),
    },
    {
      title: 'Notes hold the maybes',
      text: 'Turn Notes on to pencil several digits into one cell.',
      art:
        bigCell(10, 17, 30) +
        notes(10, 17, 30, [2, 5, 9]) +
        `<path class="ha-accent" d="M46 32 H62" stroke-width="1.7" stroke-dasharray="3.5 3" ` +
        `stroke-linecap="round"/>` +
        `<path class="ha-accent" d="M58 28 l4.5 4 l-4.5 4" fill="none" stroke-width="1.7" ` +
        `stroke-linecap="round" stroke-linejoin="round"/>` +
        bigCell(66, 17, 20, '5'),
    },
  ],
};
