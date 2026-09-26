/**
 * Connections' rules sheet. See `shared/how-to-play.ts`.
 *
 * Three things a player loses a puzzle for not knowing:
 *
 *  - four words make a group, and nothing happens until Submit;
 *  - the fourth mistake ends it, and "one away" is the only feedback;
 *  - some words fit two groups on purpose.
 *
 * Deliberately absent: that a repeated guess is refused for free, that the
 * colours run easiest to trickiest, and that the hint selects the group on its
 * fifth press. All three are nicer found.
 */

import type { GameRules } from '../shared/how-to-play';
import { artCross, artTick } from '../shared/how-to-play';

const W = 18;
const H = 11;
const GAP = 2;

/** A four-by-N block of tiles; `on` lists the selected ones by grid index. */
function tiles(ox: number, oy: number, rows: number, on: number[] = []): string {
  let out = '';
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < 4; column++) {
      const x = ox + column * (W + GAP);
      const y = oy + row * (H + GAP);
      const cls = on.includes(row * 4 + column) ? 'ha-accent-fill' : 'ha-fill';
      out += `<rect class="${cls}" x="${x}" y="${y}" width="${W}" height="${H}" rx="2"/>`;
    }
  }
  return out;
}

/** A solved bar the width of four tiles, in one of the group colours. */
function bar(ox: number, oy: number, fill: string): string {
  return `<rect x="${ox}" y="${oy}" width="${4 * W + 3 * GAP}" height="${H}" rx="2" fill="${fill}"/>`;
}

function dots(ox: number, oy: number, left: number): string {
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += `<circle class="${i < left ? 'ha-solid' : 'ha-dim'}" cx="${ox + i * 7}" cy="${oy}" r="2.4"/>`;
  }
  return out;
}

export const RULES: GameRules = {
  gameName: 'Connections',
  goal: 'Sort sixteen words into four groups of four.',
  steps: [
    {
      title: 'Pick four that belong together',
      text: 'Tap four words, then Submit to check them.',
      art: bar(3, 4, '#f9df6d') + tiles(3, 17, 3, [1, 4, 6, 11]) + artTick(84, 30),
    },
    {
      title: 'Four mistakes ends it',
      text: '“One away” means three of your four were right.',
      art: tiles(3, 10, 3, [0, 1, 2, 7]) + dots(20, 53, 1) + artCross(84, 30),
    },
    {
      title: 'Some words are traps',
      text: 'A word can seem to fit two groups. Only one is right.',
      art:
        tiles(3, 10, 3, [5]) +
        `<rect class="ha-accent" x="${3 + W + GAP - 2}" y="${10 + H + GAP - 2}" width="${W + 4}" ` +
        `height="${H + 4}" rx="3" stroke-width="1.6" fill="none"/>` +
        `<text class="ha-label ha-label--sm" x="84" y="31">?</text>`,
    },
  ],
};
