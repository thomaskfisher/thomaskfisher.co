/**
 * Mancala's rules sheet. See `shared/how-to-play.ts`.
 *
 * Three steps, and they are the three rules that are not guessable by tapping:
 *
 *  - sowing goes *round*, and it steps past the other player's store;
 *  - finishing in your own store buys another turn, which looks on the board
 *    exactly like the turn simply not having changed hands;
 *  - finishing in an empty pit of your own takes everything facing it, which is
 *    the only way a seed ever crosses the board.
 *
 * Deliberately absent: that the game ends the moment a side runs dry and the
 * other player banks the rest. It decides a lot of games, but it is legible
 * when it happens — the board empties and the numbers move — and a player who
 * has been told it beforehand has been told a rule about an ending they have
 * not reached yet.
 *
 * The diagrams straighten the board into a line. The real one is drawn on its
 * end (see `render.ts`), but sowing is "go along, one each" whichever way up
 * the board is, and a picture of the real layout at this size would be twelve
 * dots in a column.
 */

import type { GameRules } from '../shared/how-to-play';

/* ------------------------------------------------------------------ */
/* Drawing helpers, in the 92x64 art viewBox                           */
/* ------------------------------------------------------------------ */

/** Seed positions inside a pit, as offsets from its centre. Up to four. */
const SPOTS = [
  [0, 0],
  [-3.4, -2.6],
  [3.4, -2.6],
  [0, 3.6],
] as const;

/** One pit: the bowl, an optional accent ring, and up to four seeds. */
function pit(cx: number, cy: number, r: number, seeds: number, lit = false, litSeeds = false): string {
  let out = `<circle class="ha-fill" cx="${cx}" cy="${cy}" r="${r}"/>`;
  if (lit) {
    out += `<circle class="ha-accent" cx="${cx}" cy="${cy}" r="${r}" stroke-width="1.6" fill="none"/>`;
  } else {
    out += `<circle class="ha-dim" cx="${cx}" cy="${cy}" r="${r}" stroke-width="1" fill="none"/>`;
  }

  const paint = litSeeds ? 'ha-accent-fill' : 'ha-solid';
  const spots = seeds === 1 ? [[0, 0] as const] : SPOTS.slice(0, seeds);
  for (const [dx, dy] of spots) {
    out += `<circle class="${paint}" cx="${(cx + dx).toFixed(1)}" cy="${(cy + dy).toFixed(1)}" r="1.7"/>`;
  }
  return out;
}

/** A store: the long bowl at the end of a row. */
function store(x: number, y: number, width: number, height: number): string {
  const r = Math.min(width, height) / 2;
  return (
    `<rect class="ha-fill" x="${x}" y="${y}" width="${width}" height="${height}" rx="${r}"/>` +
    `<rect class="ha-dim" x="${x}" y="${y}" width="${width}" height="${height}" rx="${r}" ` +
    `stroke-width="1" fill="none"/>`
  );
}

/** An arrowhead pointing along the direction (dx, dy). */
function head(x: number, y: number, dx: number, dy: number, cls = 'ha-accent'): string {
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const size = 4;
  const back = { x: x - ux * size, y: y - uy * size };
  const wing = { x: -uy * size * 0.6, y: ux * size * 0.6 };
  return (
    `<path class="${cls}" fill="none" stroke-width="1.7" stroke-linecap="round" ` +
    `stroke-linejoin="round" d="M${(back.x + wing.x).toFixed(1)} ${(back.y + wing.y).toFixed(1)} ` +
    `L${x.toFixed(1)} ${y.toFixed(1)} L${(back.x - wing.x).toFixed(1)} ${(back.y - wing.y).toFixed(1)}"/>`
  );
}

export const RULES: GameRules = {
  gameName: 'Mancala',
  goal: 'Finish with more seeds in your store than the other player has in theirs.',
  steps: [
    {
      title: 'Pick a pit, drop one seed in each',
      text: 'The seeds go round the board, one per pit, never into their store.',
      art:
        pit(10, 38, 8, 4, true) +
        pit(28, 38, 8, 1, false, true) +
        pit(46, 38, 8, 1, false, true) +
        pit(64, 38, 8, 1, false, true) +
        pit(82, 38, 8, 1, false, true) +
        `<path class="ha-accent" fill="none" stroke-width="1.7" stroke-linecap="round" ` +
        `d="M10 26 Q46 6 80 24"/>` +
        head(81.5, 25.2, 2.2, 2.6),
    },
    {
      title: 'Land in your store and go again',
      text: 'A move that ends in your own store hands nothing over.',
      art:
        pit(12, 36, 8, 2) +
        pit(30, 36, 8, 2) +
        pit(48, 36, 8, 1, true, true) +
        store(62, 18, 26, 36) +
        `<path class="ha-accent" fill="none" stroke-width="1.7" stroke-linecap="round" ` +
        `d="M48 26 Q60 14 70 22"/>` +
        head(71, 23, 1.6, 1.6) +
        `<path class="ha-accent" fill="none" stroke-width="1.7" stroke-linecap="round" ` +
        `d="M68 10 A7 7 0 1 1 75 3"/>` +
        head(75, 3, 2.4, -2.4),
    },
    {
      title: 'Land in your own empty pit and take across',
      text: 'You win that seed and every seed in the pit facing it.',
      art:
        // The two labels sit over their own pit and no closer: at this size
        // `THEIRS` and `YOURS` are each about thirty units wide, so centring
        // them any nearer runs one word into the other.
        `<text class="ha-label ha-label--sm" x="23" y="9">THEIRS</text>` +
        `<text class="ha-label ha-label--sm" x="61" y="9">YOURS</text>` +
        pit(18, 30, 9, 3) +
        pit(58, 30, 9, 1, true, true) +
        store(74, 14, 14, 40) +
        `<text class="ha-label" x="81" y="34">4</text>` +
        `<path class="ha-accent" fill="none" stroke-width="1.6" stroke-linecap="round" ` +
        `d="M18 41 Q46 58 74 46"/>` +
        head(75, 45.6, 2.6, -1.2) +
        `<path class="ha-accent" fill="none" stroke-width="1.6" stroke-linecap="round" ` +
        `d="M58 21 Q68 12 76 20"/>` +
        head(76.6, 20.8, 1.5, 1.5),
    },
  ],
};
