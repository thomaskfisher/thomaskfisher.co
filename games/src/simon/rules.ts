/**
 * Simon's rules sheet. See `shared/how-to-play.ts`.
 *
 * Three steps: watch, repeat, and what ends it. The third is the only one a
 * player could not guess, and "no clock" rides along with the second because
 * the original has one — anybody who has played it will otherwise rush.
 *
 * Deliberately absent: that the flashes speed up. It is felt rather than
 * learned, and knowing it in advance changes nothing about how to play.
 */

import { artCross, artTap, type GameRules } from '../shared/how-to-play';

/** The four pads as a small 2x2, one of them lit. Centred on (cx, cy). */
function board(cx: number, cy: number, lit: number | null): string {
  const size = 17;
  const gap = 2.5;
  const colours = ['#35b56a', '#e6394a', '#f5c518', '#2b7fe8'];
  let out = '';
  colours.forEach((colour, index) => {
    const x = cx - size - gap / 2 + (index % 2) * (size + gap);
    const y = cy - size - gap / 2 + Math.floor(index / 2) * (size + gap);
    const opacity = lit === null || lit === index ? 1 : 0.32;
    out +=
      `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="5" ` +
      `fill="${colour}" fill-opacity="${opacity}"/>`;
  });
  return out;
}

/** A sequence as a row of dots, left to right from `x`. */
function dots(x: number, y: number, colours: string[]): string {
  return colours
    .map((colour, index) => `<circle cx="${x + index * 11}" cy="${y}" r="4" fill="${colour}"/>`)
    .join('');
}

export const RULES: GameRules = {
  gameName: 'Simon',
  goal: 'Repeat the colours for as long as you can.',
  steps: [
    {
      title: 'Watch the colours light up',
      text: 'Each round adds one more to the end.',
      art:
        board(26, 32, 1) + dots(58, 24, ['#e6394a', '#2b7fe8']) +
        dots(58, 42, ['#e6394a', '#2b7fe8', '#35b56a']),
    },
    {
      title: 'Tap them back in order',
      text: 'Take your time. There is no clock.',
      art: board(46, 32, 3) + artTap(55.75, 41.75, 7),
    },
    {
      title: 'One wrong tap ends the game',
      text: 'Your best run is kept.',
      art: board(34, 32, 2) + artCross(72, 32, 9),
    },
  ],
};
