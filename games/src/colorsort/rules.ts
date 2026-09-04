/**
 * Color Sort's rules sheet. See `shared/how-to-play.ts`.
 *
 * The rule worth drawing is the pour condition — same colour on top, or an
 * empty tube — together with the fact that a pour moves the *whole* run of
 * matching colour rather than one band. Both are learnable by tapping, but a
 * player who has not noticed the second one is playing a much longer game than
 * they need to, and nothing on the board says it out loud.
 */

import { type GameRules, artArrow, artTap, artTick } from '../shared/how-to-play';
import { paint } from '../shared/palette';

const RED = paint(0).hex;
const BLUE = paint(1).hex;
const GREEN = paint(2).hex;

/** Tube geometry, all in the 92x64 art viewBox. */
const W = 16;
const TOP = 9;
const FLOOR = 53; // inside of the rounded bottom
const BAND = 11; // four of these fill a tube
const ARC = TOP + 36; // where the straight sides give way to the bowl

/** An empty tube: straight sides, a round bottom, open at the top. */
function glass(x: number): string {
  return (
    `<path class="ha-dim" d="M${x} ${TOP} V${ARC} a8 8 0 0 0 ${W} 0 V${TOP}" ` +
    `stroke-width="1.8" stroke-linecap="round"/>`
  );
}

/**
 * Liquid, bottom band first.
 *
 * The bottom band is its own path so it can carry the bowl of the tube; every
 * band above it is a plain rect. That is cheaper and steadier than clipping the
 * lot to the glass outline, which would need a unique id per tube.
 */
function liquid(x: number, colors: readonly string[]): string {
  return colors
    .map((color, i) => {
      const top = FLOOR - BAND * (i + 1);
      if (i === 0) {
        return `<path fill="${color}" d="M${x} ${top} V${ARC} a8 8 0 0 0 ${W} 0 V${top} Z"/>`;
      }
      return `<rect x="${x}" y="${top}" width="${W}" height="${BAND}" fill="${color}"/>`;
    })
    .join('');
}

/** A whole tube. `colors` runs bottom to top; `lift` raises it as a tap does. */
function tube(x: number, colors: readonly string[], lift = 0): string {
  const body = liquid(x, colors) + glass(x);
  return lift ? `<g transform="translate(0 ${-lift})">${body}</g>` : body;
}

/** Bands that are not there yet: where the pour in the diagram is going. */
function ghostBands(x: number, from: number, count: number, color: string): string {
  const top = FLOOR - BAND * (from + count);
  return (
    `<rect x="${x}" y="${top}" width="${W}" height="${BAND * count}" ` +
    `fill="${color}" fill-opacity="0.3"/>`
  );
}

/** Rings the top `count` bands of a tube — the run a pour would carry. */
function runOutline(x: number, from: number, count: number): string {
  const top = FLOOR - BAND * (from + count);
  return (
    `<rect class="ha-accent" x="${x - 1}" y="${top - 1}" width="${W + 2}" ` +
    `height="${BAND * count + 2}" rx="2.5" stroke-width="1.6" stroke-dasharray="3.5 3"/>`
  );
}

/** The Undo control, drawn as a badge. Same glyph as the button in the footer. */
function undoBadge(cx: number, cy: number, r = 10): string {
  const scale = (r * 2 * 0.62) / 24;
  const offset = 12 * scale;
  return (
    `<circle class="ha-accent-fill" cx="${cx}" cy="${cy}" r="${r}"/>` +
    `<g class="ha-on-accent" transform="translate(${cx - offset} ${cy - offset}) scale(${scale.toFixed(3)})" ` +
    `stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M4 10h10a5 5 0 0 1 0 10H9"/><path d="M4 10l4.5-4.5M4 10l4.5 4.5"/></g>`
  );
}

export const RULES: GameRules = {
  gameName: 'Color Sort',
  goal: 'Pour the liquid from tube to tube until every tube holds a single colour.',
  steps: [
    {
      title: 'Tap a tube to pick it up',
      text: 'It lifts, so you can see which one you are holding. Tap it again to put it back.',
      art: artTap(26, 28, 13) + tube(18, [RED, BLUE, BLUE], 6) + tube(56, [BLUE, RED]),
    },
    {
      title: 'Tap a second tube to pour into it',
      text:
        'A pour only works onto its own colour, or into an empty tube — and it moves the ' +
        'whole run of that colour at once, as much of it as there is room for.',
      art:
        tube(18, [RED, BLUE, BLUE]) +
        runOutline(18, 1, 2) +
        // Drawn before the tube so the glass outline still reads over the top
        // of it: these two bands are the pour arriving, not liquid already
        // there, which is the whole point of the picture.
        ghostBands(56, 1, 2, BLUE) +
        tube(56, [BLUE]) +
        runOutline(56, 1, 2) +
        artArrow(28, 14, 62, 14, 9),
    },
    {
      title: 'Finish when every tube is one colour',
      text: 'Tubes you emptied along the way are fine to leave empty — that is the level done.',
      art:
        tube(8, [RED, RED, RED, RED]) +
        tube(32, [BLUE, BLUE, BLUE, BLUE]) +
        tube(56, [GREEN, GREEN, GREEN, GREEN]) +
        artTick(83, 16, 7),
    },
    {
      title: 'Running out of pours is not losing',
      text:
        'A board with no legal pour left will say so and offer you the way back. Undo as ' +
        'far as you need — this board is still solvable, and so is every other one.',
      art:
        tube(16, [GREEN, RED, BLUE, RED]) +
        tube(42, [RED, GREEN, RED, BLUE]) +
        undoBadge(78, 30, 11),
    },
  ],
};
