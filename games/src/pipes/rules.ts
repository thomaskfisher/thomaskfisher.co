/**
 * Pipes' rules sheet. See `shared/how-to-play.ts`.
 *
 * Two of the three steps are rules a player genuinely cannot infer, and the
 * third is the control scheme, which is inferable but expensive to discover.
 *
 * The one that matters most is the third: **every tile has to end up connected,
 * not just the ones between the well and the taps.** Without it the level looks
 * finished long before it is, and "why won't it accept this" is the worst
 * possible first experience of a puzzle.
 *
 * Deliberately absent: that a cross cannot be turned, that a straight has only
 * two positions, and that the hint works outward from the well. Nobody loses a
 * level for not knowing any of them.
 */

import type { GameRules } from '../shared/how-to-play';

/* ------------------------------------------------------------------ */
/* Drawing helpers, in the 92x64 art viewBox                           */
/* ------------------------------------------------------------------ */

const CELL = 16;

/** One tile of pipework. `sides` is any of 'nesw'. */
function tile(
  ox: number,
  oy: number,
  column: number,
  row: number,
  sides: string,
  options: { wet?: boolean; source?: boolean; tap?: boolean } = {},
): string {
  const x = ox + column * CELL;
  const y = oy + row * CELL;
  const cx = x + CELL / 2;
  const cy = y + CELL / 2;
  const paint = options.wet ? 'ha-accent' : 'ha-dim';
  const fill = options.wet ? 'ha-accent-fill' : 'ha-fill-strong';

  let out = `<rect class="ha-fill" x="${x + 0.5}" y="${y + 0.5}" width="${CELL - 1}" height="${CELL - 1}" rx="2"/>`;

  const ends: Record<string, [number, number]> = {
    n: [cx, y],
    e: [x + CELL, cy],
    s: [cx, y + CELL],
    w: [x, cy],
  };

  for (const side of sides) {
    const end = ends[side];
    if (!end) continue;
    out +=
      `<path class="${paint}" d="M${cx} ${cy} L${end[0]} ${end[1]}" stroke-width="3" ` +
      `stroke-linecap="round"/>`;
  }

  if (options.source) {
    out += `<circle class="${fill}" cx="${cx}" cy="${cy}" r="4.6"/>`;
  } else if (options.tap) {
    out += `<rect class="${fill}" x="${cx - 3.4}" y="${cy - 3.4}" width="6.8" height="6.8" rx="1.8"/>`;
  } else {
    out += `<circle class="${fill}" cx="${cx}" cy="${cy}" r="2.6"/>`;
  }

  return out;
}

/** The turning arrow over a tile. */
function turnArrow(ox: number, oy: number, column: number, row: number): string {
  const cx = ox + column * CELL + CELL / 2;
  const cy = oy + row * CELL + CELL / 2;
  const r = 9.5;
  return (
    `<path class="ha-accent" d="M${cx - r} ${cy} a${r} ${r} 0 1 1 ${r} ${r}" fill="none" ` +
    `stroke-width="1.7" stroke-linecap="round"/>` +
    `<path class="ha-accent" d="M${cx - 3.4} ${cy + r - 3.4} l3.4 3.4 l3.4 -3.4" fill="none" ` +
    `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

/** A drip, for the stub that leads nowhere. */
function drip(ox: number, oy: number, column: number, row: number, side: 'e' | 's'): string {
  const x = ox + column * CELL + (side === 'e' ? CELL + 3 : CELL / 2);
  const y = oy + row * CELL + (side === 'e' ? CELL / 2 : CELL + 3);
  return (
    `<path class="ha-danger-fill" d="M${x} ${y - 2.4} c2 2.6 2.4 3.4 2.4 4.4 a2.4 2.4 0 0 1 -4.8 0 ` +
    `c0 -1 .4 -1.8 2.4 -4.4 z"/>`
  );
}

const OX = 14;
const OY = 8;

export const RULES: GameRules = {
  gameName: 'Pipes',
  goal: 'Turn the pipes until every one carries water.',
  steps: [
    {
      title: 'Tap a tile to turn it',
      text: 'Each tap swings it a quarter turn clockwise.',
      art:
        tile(OX, OY, 0, 0, 'es') +
        tile(OX, OY, 1, 0, 'ew') +
        tile(OX, OY, 2, 0, 'sw') +
        tile(OX, OY, 0, 1, 'ne') +
        tile(OX, OY, 1, 1, 'nw') +
        tile(OX, OY, 2, 1, 'ns') +
        turnArrow(OX, OY, 1, 1),
    },
    {
      title: 'Water starts at the well',
      text: 'It flows only where two pipes meet end to end.',
      art:
        tile(OX + 8, OY + 8, 0, 0, 'e', { wet: true, source: true }) +
        tile(OX + 8, OY + 8, 1, 0, 'ew', { wet: true }) +
        tile(OX + 8, OY + 8, 2, 0, 'w', { wet: true, tap: true }) +
        tile(OX + 8, OY + 8, 0, 1, 'e') +
        tile(OX + 8, OY + 8, 1, 1, 'ns') +
        tile(OX + 8, OY + 8, 2, 1, 'w') +
        drip(OX + 8, OY + 8, 0, 1, 'e'),
    },
    {
      title: 'Every pipe has to join up',
      text: 'The level is done when nothing is left dry or dripping.',
      art:
        tile(OX, OY, 0, 0, 'es', { wet: true, source: true }) +
        tile(OX, OY, 1, 0, 'esw', { wet: true }) +
        tile(OX, OY, 2, 0, 'w', { wet: true, tap: true }) +
        tile(OX, OY, 0, 1, 'n', { wet: true, tap: true }) +
        tile(OX, OY, 1, 1, 'ne', { wet: true }) +
        tile(OX, OY, 2, 1, 'w', { wet: true, tap: true }) +
        `<circle class="ha-accent-fill" cx="78" cy="16" r="7"/>` +
        `<path class="ha-on-accent" d="M74.8 16 l2.2 2.4 l4.2 -5" stroke-width="1.9" ` +
        `fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    },
  ],
};
