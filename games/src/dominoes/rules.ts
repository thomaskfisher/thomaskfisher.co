/**
 * Mexican Train's rules sheet. See `shared/how-to-play.ts`.
 *
 * Most people have played dominoes and almost nobody has played this, so the
 * sheet spends none of its four steps on "the numbers have to match" beyond the
 * first picture, and all the rest on the three rules that are actually Mexican
 * Train:
 *
 *  - there is more than one train, and which ones you may use changes;
 *  - failing to play opens your train to everybody, which is the whole tension;
 *  - a double stops the board until somebody answers it.
 *
 * Deliberately absent: that the engine steps down a pip each round, and that
 * the round can end blocked. The first is visible in the top bar and changes
 * nothing about how a round is played; the second explains itself the one time
 * in four it happens, and a sheet that opens by describing the ways a game can
 * fizzle is a sheet about the wrong game.
 */

import type { GameRules } from '../shared/how-to-play';

/* ------------------------------------------------------------------ */
/* Drawing helpers, in the 92x64 art viewBox                           */
/* ------------------------------------------------------------------ */

/** The side of one half of a tile. A whole tile is twice this by this. */
const HALF = 9;

/** Which cells of a three-by-three grid a pip count fills. Matches render.ts. */
const PIPS: readonly (readonly (readonly [number, number])[])[] = [
  [],
  [[2, 2]],
  [
    [1, 1],
    [3, 3],
  ],
  [
    [1, 1],
    [2, 2],
    [3, 3],
  ],
  [
    [1, 1],
    [1, 3],
    [3, 1],
    [3, 3],
  ],
  [
    [1, 1],
    [1, 3],
    [2, 2],
    [3, 1],
    [3, 3],
  ],
  [
    [1, 1],
    [1, 3],
    [2, 1],
    [2, 3],
    [3, 1],
    [3, 3],
  ],
];

/** One half's worth of pips, drawn inside the square at (x, y). */
function pips(x: number, y: number, value: number): string {
  const cell = HALF / 3;
  return (PIPS[value] ?? [])
    .map(([row, column]) => {
      const cx = x + (column - 0.5) * cell;
      const cy = y + (row - 0.5) * cell;
      return `<circle class="ha-solid" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="0.95"/>`;
    })
    .join('');
}

interface TileOptions {
  /** Laid crosswise, the way a double goes on a real table. */
  cross?: boolean;
  /** Ringed in the accent, for the tile a step is about. */
  lit?: boolean;
  /** Greyed, for a tile that is there for context rather than for reading. */
  faint?: boolean;
}

/** One tile, `a` then `b`, left to right unless it is laid crosswise. */
function tile(x: number, y: number, a: number, b: number, options: TileOptions = {}): string {
  const width = options.cross ? HALF : HALF * 2;
  const height = options.cross ? HALF * 2 : HALF;
  const edge = options.lit ? 'ha-accent' : 'ha-dim';

  let out =
    `<rect class="ha-fill" x="${x}" y="${y}" width="${width}" height="${height}" rx="1.6"/>` +
    `<rect class="${edge}" x="${x}" y="${y}" width="${width}" height="${height}" rx="1.6" ` +
    `stroke-width="${options.lit ? 1.4 : 0.9}" fill="none"/>`;

  // The bar down the middle, and the two halves either side of it.
  out += options.cross
    ? `<path class="ha-dim" d="M${x} ${y + HALF} h${HALF}" stroke-width="0.7"/>`
    : `<path class="ha-dim" d="M${x + HALF} ${y} v${HALF}" stroke-width="0.7"/>`;

  if (!options.faint) {
    out += pips(x, y, a);
    out += options.cross ? pips(x, y + HALF, b) : pips(x + HALF, y, b);
  }
  return out;
}

/** A tick in an accent disc. "Yes, this one." */
function tick(cx: number, cy: number): string {
  return (
    `<circle class="ha-accent-fill" cx="${cx}" cy="${cy}" r="5.4"/>` +
    `<path class="ha-on-accent" d="M${cx - 2.4} ${cy} l1.7 1.9 l3.2 -3.8" stroke-width="1.5" ` +
    `fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

/** A short label in the small art face. */
const label = (x: number, y: number, text: string): string =>
  `<text class="ha-label ha-label--sm" x="${x}" y="${y}">${text}</text>`;

/**
 * A cross through a tile, for the one a step says you may not use.
 *
 * Drawn corner to corner over the tile rather than as a separate mark, because
 * at this size a small ✗ beside something reads as a bullet point.
 */
function struck(x: number, y: number): string {
  return (
    `<path class="ha-strike" d="M${x - 1} ${y + HALF + 2} L${x + HALF * 2 + 1} ${y - 2}" ` +
    `stroke-width="1.7" stroke-linecap="round"/>`
  );
}

export const RULES: GameRules = {
  gameName: 'Mexican Train',
  goal: 'Be rid of your tiles. Whatever you are still holding counts against you, and the lowest score after a round wins it.',
  steps: [
    {
      title: 'Lay a tile that matches the end',
      text: 'Every round starts from one double, and the trains grow out of it.',
      art:
        tile(6, 18, 6, 6, { cross: true }) +
        tile(19, 27, 6, 3) +
        tile(40, 27, 3, 5) +
        tile(61, 27, 5, 2, { lit: true }) +
        label(50, 13, 'match') +
        `<path class="ha-accent" fill="none" stroke-width="1.4" stroke-linecap="round" ` +
        `d="M57 24 q6 -6 12 0"/>`,
    },
    {
      /*
       * Tick, tile, name — in that order across the row, so the labels all
       * start from the same place and none of them has to fit in the gap
       * beside a tile. Written the other way round first, and at nine pixels
       * `MEXICAN` is wider than the margin it was given.
       */
      title: 'Your train, or the shared one',
      text: 'Plus anybody’s train that has fallen open — and they all do.',
      art:
        tick(9, 10) +
        tile(21, 5.5, 4, 1) +
        label(63, 10, 'YOURS') +
        tick(9, 32) +
        tile(21, 27.5, 1, 5) +
        label(63, 32, 'MEXICAN') +
        tile(21, 49.5, 2, 2, { faint: true }) +
        struck(21, 49.5) +
        label(63, 54, 'THEIRS'),
    },
    {
      title: 'Stuck? Draw one, then your train opens',
      text: 'An open train is one everybody may play on until you use it again.',
      art:
        tile(4, 10, 0, 0, { faint: true }) +
        tile(7, 14, 0, 0, { faint: true }) +
        tile(10, 18, 0, 0, { faint: true }) +
        label(41, 8, 'DRAW') +
        `<path class="ha-accent" fill="none" stroke-width="1.5" stroke-linecap="round" ` +
        `d="M33 19 h11"/>` +
        `<path class="ha-accent" fill="none" stroke-width="1.5" stroke-linecap="round" ` +
        `stroke-linejoin="round" d="M41 15.6 L45 19 L41 22.4"/>` +
        tile(50, 14.5, 3, 4) +
        `<rect class="ha-accent ha-faint" x="6" y="40" width="50" height="16" rx="8" ` +
        `stroke-width="1.2" fill="none"/>` +
        tile(10, 43.5, 1, 6) +
        label(72, 48, 'OPEN'),
    },
    {
      title: 'A double stops everything',
      text: 'Nobody may play anywhere else until somebody answers it.',
      art:
        label(48, 10, 'answer it') +
        `<path class="ha-accent" fill="none" stroke-width="1.4" stroke-linecap="round" ` +
        `d="M37 20 q11 -7 20 4"/>` +
        tile(10, 30, 2, 4) +
        tile(31, 21, 4, 4, { cross: true, lit: true }) +
        tile(44, 30, 4, 1, { lit: true }) +
        tile(68, 50, 5, 1, { faint: true }) +
        struck(68, 50),
    },
  ],
};
