/**
 * Screw Land 3D's rules sheet. See `shared/how-to-play.ts`.
 *
 * Two rules cost levels if nobody says them. Screws are on every side,
 * including underneath, and a player who never turns the object stalls with
 * screws left and no idea where. And the tray is not spare storage: filling it
 * ends the level.
 *
 * Screw Land's fourth step, "plates hide screws", is gone. There a buried screw
 * showed through its plate and needed explaining. Here it is simply not drawn
 * until the plate over it falls, so there is nothing to explain.
 */

import { type GameRules, artArrow, artCross, artTap } from '../shared/how-to-play';
import { paint } from '../shared/palette';

const RED = paint(0).hex;
const BLUE = paint(1).hex;
const GREEN = paint(2).hex;
const YELLOW = paint(3).hex;

/** A screw head: a coloured disc with a cross slot. */
function screw(cx: number, cy: number, color: string, r = 5.5): string {
  const s = r * 0.55;
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>` +
    `<path class="ha-on-accent" d="M${cx - s} ${cy} h${s * 2} M${cx} ${cy - s} v${s * 2}" ` +
    `stroke-width="1.5" stroke-linecap="round" stroke-opacity="0.85"/>`
  );
}

function hole(cx: number, cy: number, color?: string): string {
  return color
    ? screw(cx, cy, color, 4)
    : `<circle class="ha-dim" cx="${cx}" cy="${cy}" r="4" stroke-width="1.5"/>`;
}

/** A box wanting three screws of one colour. `filled` counts from the left. */
function box(x: number, y: number, color: string, filled: number, w = 32, h = 20): string {
  const holes = [0, 1, 2]
    .map((i) => hole(x + w / 2 + (i - 1) * 9, y + h / 2, i < filled ? color : undefined))
    .join('');
  return (
    `<rect class="ha-fill" x="${x}" y="${y}" width="${w}" height="${h}" rx="5"/>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="none" ` +
    `stroke="${color}" stroke-width="1.8"/>` +
    holes
  );
}

function tray(x: number, y: number, capacity: number, filled: readonly string[]): string {
  return Array.from({ length: capacity }, (_, i) => {
    const cx = x + 9 + i * 17;
    const slot =
      `<rect class="ha-dim" x="${cx - 8}" y="${y}" width="16" height="16" rx="4" stroke-width="1.5"/>`;
    const token = filled[i] ? screw(cx, y + 8, filled[i] as string, 4.5) : '';
    return slot + token;
  }).join('');
}

/** An isometric block, three faces showing, with a screw on each side face. */
function block(): string {
  return (
    `<path class="ha-fill-strong" d="M46 8 L66 18 L46 28 L26 18 Z"/>` +
    `<path class="ha-fill" d="M26 18 L46 28 L46 50 L26 40 Z"/>` +
    `<path class="ha-fill-strong" d="M46 28 L66 18 L66 40 L46 50 Z"/>` +
    `<path class="ha-dim" d="M46 8 L66 18 L66 40 L46 50 L26 40 L26 18 Z M46 28 V50 M26 18 L46 28 L66 18" ` +
    `stroke-width="1.4" stroke-linejoin="round"/>` +
    screw(36, 33, RED, 4.5) +
    screw(56, 33, BLUE, 4.5)
  );
}

export const RULES: GameRules = {
  gameName: 'Screw Land 3D',
  goal: 'Unscrew the whole object.',
  steps: [
    {
      title: 'Drag to turn it',
      text: 'Screws hide underneath and round the back.',
      art: block() + artArrow(20, 56, 72, 56, -7),
    },
    {
      title: 'Tap a screw to take it out',
      text: 'It flies to a box of its own colour.',
      art:
        box(50, 4, RED, 1, 36, 18) +
        `<rect class="ha-fill" x="6" y="34" width="44" height="26" rx="5"/>` +
        artTap(18, 47, 11) +
        screw(18, 47, RED) +
        screw(38, 47, BLUE) +
        artArrow(24, 38, 62, 24, 12),
    },
    {
      title: 'Or it goes to the tray',
      text: 'For colours with no box open. Fill it and the level is over.',
      art:
        tray(4, 12, 4, [RED, GREEN, YELLOW]) +
        artArrow(64, 44, 64, 32, 0) +
        screw(64, 50, BLUE) +
        artCross(82, 48, 8),
    },
  ],
};
