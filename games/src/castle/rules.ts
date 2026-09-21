/**
 * Castle's rules sheet. See `shared/how-to-play.ts`.
 *
 * Three rules, because three is what a player would otherwise learn by losing:
 * how to put a tower down (and take it back), that knights shrug off arrows,
 * and that a single enemy through the gate loses the wave.
 *
 * Frost is not on here. It slows whatever is inside its circle, the circle is
 * drawn, and the first wave shows it — nobody loses a level for not having
 * been told. Neither is the runner, for the same reason: it is visibly fast.
 */

import { type GameRules, artArrow, artCross, artTap } from '../shared/how-to-play';
import { castle, foeShape, towerBody } from './art';
import { ARROW, CANNON, GRUNT, KNIGHT } from './model';

/** A stretch of road across the art box. */
function road(d: string): string {
  return (
    `<path d="${d}" fill="none" stroke="#c9ae74" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${d}" fill="none" stroke="#e6d3a3" stroke-width="8.5" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

/** A tower drawn at (x, y), `size` px square. */
function tower(kind: 0 | 1 | 2, x: number, y: number, size: number): string {
  return `<g transform="translate(${x} ${y}) scale(${size / 24})">${towerBody(kind)}</g>`;
}

/** A plot: the stone circle a tower stands on. */
function plot(cx: number, cy: number): string {
  return `<circle cx="${cx}" cy="${cy}" r="9" fill="#c2c6c9"/><circle cx="${cx}" cy="${cy}" r="4" fill="none" stroke="#9ea4aa" stroke-width="1.3" stroke-dasharray="2 1.6"/>`;
}

export const RULES: GameRules = {
  gameName: 'Castle',
  goal: 'Hold the gate against the whole wave.',
  steps: [
    {
      title: 'Pick a tower, tap a plot',
      text: 'Tap it again to take it back.',
      art:
        road('M4 50 H88') +
        tower(ARROW, 8, 8, 22) +
        artArrow(30, 18, 56, 28, 8) +
        plot(66, 32) +
        artTap(66, 32, 11),
    },
    {
      title: 'Knights shrug off arrows',
      text: 'Cannons hit a whole pack, armour or not.',
      art:
        road('M4 50 H88') +
        tower(ARROW, 6, 6, 20) +
        `<path d="M24 18 L34 38" stroke="#fff6d8" stroke-width="1.6" stroke-linecap="round"/>` +
        foeShape(KNIGHT, 34, 49, 6) +
        tower(CANNON, 62, 6, 20) +
        `<circle cx="72" cy="49" r="12" fill="rgba(255,170,60,0.35)" stroke="rgba(255,120,40,0.8)" stroke-width="1"/>` +
        foeShape(GRUNT, 64, 49, 4.2) +
        foeShape(GRUNT, 72, 49, 4.2) +
        foeShape(GRUNT, 80, 49, 4.2),
    },
    {
      title: 'Press Go and watch',
      text: 'One enemy through the gate loses the wave.',
      art:
        road('M4 26 H58') +
        foeShape(GRUNT, 44, 26, 5) +
        castle(56, 6, 34) +
        artCross(30, 50, 7),
    },
  ],
};
