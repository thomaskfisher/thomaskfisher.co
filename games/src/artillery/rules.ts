/**
 * Artillery's rules sheet. See `shared/how-to-play.ts`.
 *
 * Three steps, and they are the three things a player cannot find out by
 * tapping:
 *
 *  - a shot is *ranged in* rather than aimed — the arc it leaves behind is the
 *    instrument, and a new player who does not know that reads two misses as
 *    the game being random;
 *  - the ground is destructible, and a tank cannot climb out of a steep hole.
 *    The climb limit is invisible until a move is refused, which is exactly the
 *    case Survival's sheet exists for;
 *  - a drafted weapon fires once. Somebody who does not know that spends Big
 *    Bertha on a ranging shot, and there is no getting it back.
 *
 * Deliberately absent: the draft itself. The shop names whose pick it is and
 * how many are left, greys out what has gone, and shows both arsenals filling —
 * there is nothing left for a sentence to add. Also absent: that a blast hurts
 * the tank that fired it. It is discovered once, memorably, and it is not how
 * anybody loses a match.
 */

import type { GameRules } from '../shared/how-to-play';

/* ------------------------------------------------------------------ */
/* Drawing helpers, in the 92x64 art viewBox                           */
/* ------------------------------------------------------------------ */

/** Ground as a filled shape, from a surface line carried down to the bottom. */
function ground(points: readonly [number, number][]): string {
  const surface = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
  return (
    `<path class="ha-fill" d="${surface} L 92 64 L 0 64 Z"/>` +
    `<path class="ha-dim" d="${surface}" stroke-width="1.4" stroke-linejoin="round"/>`
  );
}

/** A tank: hull on the ground, barrel at `angle` degrees. */
function tank(cx: number, baseY: number, angle: number, lit = false): string {
  const paint = lit ? 'ha-accent-fill' : 'ha-solid';
  const stroke = lit ? 'ha-accent' : 'ha-strike';
  const radians = (angle * Math.PI) / 180;
  const pivotY = baseY - 2.4;

  return (
    `<path class="${paint}" d="M ${cx - 4.4} ${baseY} h 8.8 l -1.2 3 h -6.4 Z"/>` +
    `<circle class="${paint}" cx="${cx}" cy="${pivotY}" r="1.9"/>` +
    `<path class="${stroke}" stroke-width="1.8" stroke-linecap="round" ` +
    `d="M ${cx} ${pivotY} L ${(cx + Math.cos(radians) * 6).toFixed(1)} ${(pivotY - Math.sin(radians) * 6).toFixed(1)}"/>`
  );
}

/** A small cross, for the thing that cannot be done. */
function cross(cx: number, cy: number, r = 3.4): string {
  return (
    `<path class="ha-accent" stroke-width="1.8" stroke-linecap="round" ` +
    `d="M ${cx - r} ${cy - r} l ${r * 2} ${r * 2} M ${cx + r} ${cy - r} l ${-r * 2} ${r * 2}"/>`
  );
}

/** One weapon in the list: a chip with a shell in it. */
function chip(y: number, spent: boolean, label?: string): string {
  const out =
    `<rect class="ha-fill" x="14" y="${y}" width="64" height="13" rx="6"/>` +
    `<circle class="${spent ? 'ha-strike' : 'ha-accent-fill'}" cx="24" cy="${y + 6.5}" r="${spent ? 3 : 3.4}" ` +
    `${spent ? 'stroke-width="1.4" fill="none"' : ''}/>`;

  if (spent) {
    return (
      out +
      `<path class="ha-strike" stroke-width="1.6" stroke-linecap="round" ` +
      `d="M 32 ${y + 6.5} h 38"/>`
    );
  }

  return (
    out +
    `<path class="ha-dim" stroke-width="1.6" stroke-linecap="round" d="M 32 ${y + 6.5} h 26"/>` +
    (label ? `<text class="ha-label" x="68" y="${y + 6.8}">${label}</text>` : '')
  );
}

/* ------------------------------------------------------------------ */

export const RULES: GameRules = {
  gameName: 'Artillery',
  goal: "Knock the other tank's life down to zero.",
  steps: [
    {
      title: 'Set the angle and power',
      text: 'Fire, see where it lands, then correct the next one.',
      art:
        ground([
          [0, 47],
          [16, 46],
          [28, 40],
          [46, 20],
          [62, 39],
          [74, 45],
          [92, 46],
        ]) +
        tank(10, 46, 52, true) +
        tank(82, 46, 128) +
        // The arc clears the hill and falls short of the far tank: the picture
        // is of a shot to be corrected, not of a shot that worked. There was an
        // arrow here saying "further"; at this size it landed on top of the
        // right-hand tank and read as part of it.
        `<path class="ha-accent ha-faint" stroke-width="1.6" stroke-linecap="round" ` +
        `stroke-dasharray="3.5 3" d="M 14 41 Q 44 -2 70 40"/>`,
    },
    {
      title: 'Blasts tear up the ground',
      text: 'A tank cannot climb out of a hole this steep.',
      art:
        ground([
          [0, 44],
          [24, 43],
          [32, 44],
          [35, 56],
          [44, 58],
          [53, 56],
          [56, 44],
          [66, 43],
          [92, 44],
        ]) +
        tank(44, 58, 90, true) +
        cross(24, 49) +
        cross(64, 49),
    },
    {
      title: 'Each weapon fires once',
      text: 'The plain shell at the top never runs out.',
      art: chip(8, false, '∞') + chip(26, true) + chip(44, true),
    },
  ],
};
