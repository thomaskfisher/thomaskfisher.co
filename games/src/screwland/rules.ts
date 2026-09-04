/**
 * Screw Land's rules sheet. See `shared/how-to-play.ts`.
 *
 * Two rules here cannot be discovered without losing a level. The tray is not
 * spare storage — filling it ends the level — and a screw under another plate
 * cannot be tapped at all until that plate loses its last screw and falls. Both
 * are visible on the board once you know to look, and invisible until then.
 */

import { type GameRules, artArrow, artCross, artTap, artTick } from '../shared/how-to-play';
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

/** An empty screw hole in a box, or a hole a screw has already gone into. */
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

/** A row of tray slots. `filled` colours are placed left to right. */
function tray(x: number, y: number, capacity: number, filled: readonly string[]): string {
  return Array.from({ length: capacity }, (_, i) => {
    const cx = x + 9 + i * 17;
    const slot =
      `<rect class="ha-dim" x="${cx - 8}" y="${y}" width="16" height="16" rx="4" stroke-width="1.5"/>`;
    const token = filled[i] ? screw(cx, y + 8, filled[i] as string, 4.5) : '';
    return slot + token;
  }).join('');
}

export const RULES: GameRules = {
  gameName: 'Screw Land',
  goal: 'Take the whole structure apart by unscrewing it in an order that works.',
  steps: [
    {
      title: 'Tap a screw to take it out',
      text:
        'It flies to a box of its own colour up at the top. The boxes tell you which ' +
        'colours have somewhere to go right now.',
      art:
        box(50, 4, RED, 1, 36, 18) +
        `<rect class="ha-fill" x="6" y="34" width="44" height="26" rx="5"/>` +
        artTap(18, 47, 11) +
        screw(18, 47, RED) +
        screw(38, 47, BLUE) +
        artArrow(24, 38, 62, 24, 12),
    },
    {
      title: 'Fill a box and it seals',
      text:
        'A full box is carried off and the next one in the little queue beside it takes ' +
        'its place. Only the boxes you can see are open — the queue is what is coming.',
      art:
        box(6, 24, BLUE, 3, 34, 20) +
        artTick(23, 12, 7) +
        `<rect class="ha-dim" x="52" y="24" width="14" height="20" rx="4" stroke-width="1.6"/>` +
        `<circle cx="59" cy="34" r="4" fill="${GREEN}"/>` +
        `<rect class="ha-dim" x="72" y="24" width="14" height="20" rx="4" stroke-width="1.6"/>` +
        `<circle cx="79" cy="34" r="4" fill="${YELLOW}"/>` +
        artArrow(62, 18, 44, 20, 5),
    },
    {
      title: 'A screw with no box open goes to the tray',
      text:
        'The tray is the only place to park a colour you cannot use yet — and it is where ' +
        'the level is lost. Fill the last slot and it is over, so keep a slot spare.',
      art:
        tray(4, 12, 4, [RED, GREEN, YELLOW]) +
        artArrow(64, 44, 64, 32, 0) +
        screw(64, 50, BLUE) +
        artCross(82, 48, 8),
    },
    {
      title: 'Plates cover the screws underneath them',
      text:
        'A screw you cannot tap is under a plate. Take that plate’s own last screw out, ' +
        'it falls away, and everything beneath it is yours.',
      art:
        `<rect class="ha-fill" x="6" y="26" width="52" height="32" rx="5"/>` +
        screw(18, 44, GREEN) +
        // Drawn before the upper plate on purpose: it ends up underneath it,
        // showing through the translucent fill exactly as a buried screw does
        // on the real board.
        screw(48, 34, GREEN) +
        `<rect class="ha-fill-strong" x="34" y="6" width="52" height="32" rx="5"/>` +
        `<rect class="ha-accent ha-faint" x="34" y="6" width="52" height="32" rx="5" ` +
        `stroke-width="1.6" stroke-dasharray="4 3"/>` +
        artTap(70, 22, 11) +
        screw(70, 22, YELLOW),
    },
  ],
};
