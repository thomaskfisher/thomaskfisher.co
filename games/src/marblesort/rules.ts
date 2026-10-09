/**
 * Marble Sort's rules sheet. See `shared/how-to-play.ts`.
 *
 * The rule nobody guesses is the loss: marbles that match nothing do not
 * vanish, they ride round and round taking up room. That is the whole game, so
 * it gets the last step to itself. Hidden blocks are not mentioned — a `?`
 * says what it is.
 */

import { type GameRules, artArrow, artCross, artTap } from '../shared/how-to-play';
import { paint } from '../shared/palette';

const RED = paint(0).hex;
const BLUE = paint(1).hex;
const GREEN = paint(2).hex;
const YELLOW = paint(3).hex;

function marble(cx: number, cy: number, color: string, r = 3.6): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`;
}

/** A pipe hanging from the top edge, with its nozzle. */
function pipe(x: number, color: string): string {
  return (
    `<rect x="${x}" y="0" width="14" height="24" rx="3" fill="${color}"/>` +
    `<rect x="${x + 1.5}" y="22" width="11" height="7" rx="2" fill="${color}" fill-opacity="0.75"/>`
  );
}

/** A block of three holes; `filled` count from the left. */
function block(x: number, y: number, color: string, filled: number): string {
  const holes = [0, 1, 2]
    .map((i) => {
      const cx = x + 8 + i * 9;
      return i < filled
        ? marble(cx, y + 7, color, 3.2)
        : `<circle cx="${cx}" cy="${y + 7}" r="3.2" fill="#fff" fill-opacity="0.6"/>`;
    })
    .join('');
  return `<rect x="${x}" y="${y}" width="34" height="14" rx="3" fill="${color}" fill-opacity="0.85"/>` + holes;
}

/** The belt: a stadium outline, with marbles at the given points. */
function belt(x: number, y: number, w: number, h: number): string {
  return `<rect class="ha-dim" x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" stroke-width="1.6"/>`;
}

export const RULES: GameRules = {
  gameName: 'Marble Sort',
  goal: 'Drop every marble into a matching block.',
  steps: [
    {
      title: 'Tap a pipe to drop marbles',
      text: 'They ride the belt past the blocks.',
      art:
        pipe(20, BLUE) +
        pipe(58, RED) +
        artTap(27, 12, 9) +
        artArrow(27, 34, 27, 52, 0) +
        marble(22, 58, BLUE) +
        marble(30, 58, BLUE),
    },
    {
      title: 'Only the top blocks take them',
      text: 'Same colour only. Fill a block and it clears.',
      art:
        belt(6, 4, 80, 18) +
        marble(30, 21, RED) +
        artArrow(30, 26, 30, 36, 0) +
        block(13, 38, RED, 2) +
        block(13, 54, BLUE, 0) +
        block(52, 38, GREEN, 1) +
        block(52, 54, YELLOW, 0),
    },
    {
      title: 'Keep the belt from filling',
      text: 'Unmatched marbles keep circling. A full belt ends the level.',
      art:
        belt(6, 12, 70, 26) +
        [12, 22, 32, 42, 52, 62, 70].map((cx, i) => marble(cx, 13, [BLUE, GREEN, YELLOW][i % 3] as string)).join('') +
        [16, 26, 36, 46, 56, 66].map((cx, i) => marble(cx, 37, [GREEN, YELLOW, BLUE][i % 3] as string)).join('') +
        marble(7, 25, YELLOW) +
        marble(75, 25, BLUE) +
        block(14, 46, RED, 1) +
        artCross(82, 52, 7),
    },
  ],
};
