/**
 * Yahtzee's rules sheet. See `shared/how-to-play.ts`.
 *
 * Most people who open this already know the game, so the sheet is not here to
 * teach dice — it is here for the two things that are this version's own and
 * cannot be discovered by tapping: a box takes two taps, the first only showing
 * what it would pay, and the upper section pays a bonus at 63.
 */

import type { GameRules } from '../shared/how-to-play';
import { artArrow, artTick } from '../shared/how-to-play';

/* All geometry is in the 92x64 art viewBox. */
const DIE = 14;
const GAP = 3;
const FIRST_X = 5;

const dieX = (slot: number): number => FIRST_X + slot * (DIE + GAP);

/** Pip positions within a die, as a 3x3 grid of thirds. */
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

function die(slot: number, y: number, face: number, held = false): string {
  const x = dieX(slot);
  const pips = (PIPS[face] ?? [])
    .map(([column, row]) => {
      const cx = x + 3.6 + column * 3.4;
      const cy = y + 3.6 + row * 3.4;
      return `<circle class="ha-solid" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="1.35"/>`;
    })
    .join('');

  return (
    `<rect class="ha-fill" x="${x}" y="${y}" width="${DIE}" height="${DIE}" rx="3.2"/>` +
    `<rect class="${held ? 'ha-accent' : 'ha-ink'}" x="${x}" y="${y}" width="${DIE}" ` +
    `height="${DIE}" rx="3.2" stroke-width="${held ? 1.8 : 1.2}"/>` +
    pips
  );
}

/** A row of five dice, holding the slots listed. */
function hand(y: number, faces: number[], held: number[] = []): string {
  return faces.map((face, slot) => die(slot, y, face, held.includes(slot))).join('');
}

/**
 * A scorecard box, optionally with something written in it.
 *
 * Both pieces of text are *centred*, the label over the left two thirds and the
 * value over the right — never anchored to the box's edges. `.ha-label` in
 * shell.css sets `text-anchor: middle`, and a CSS declaration beats a
 * presentation attribute, so a `text-anchor="start"` here is silently ignored
 * and the label ends up centred on the box's left edge with half of it outside
 * the tile. Laying the zones out for a middle anchor is the fix that cannot
 * quietly stop working.
 */
function box(
  x: number,
  y: number,
  width: number,
  label: string,
  value?: string,
  tone: 'plain' | 'open' | 'chosen' = 'plain',
): string {
  const height = 11;
  const middle = y + height / 2;
  const outline =
    tone === 'chosen'
      ? `<rect class="ha-accent" x="${x}" y="${y}" width="${width}" height="${height}" rx="3" stroke-width="1.8"/>`
      : `<rect class="ha-dim" x="${x}" y="${y}" width="${width}" height="${height}" rx="3" stroke-width="1.1"/>`;

  return (
    `<rect class="${tone === 'plain' ? 'ha-fill' : 'ha-fill-strong'}" x="${x}" y="${y}" ` +
    `width="${width}" height="${height}" rx="3"/>` +
    outline +
    `<text class="ha-label ha-label--sm" x="${(x + width * 0.38).toFixed(1)}" ` +
    `y="${middle}">${label}</text>` +
    (value === undefined
      ? ''
      : `<text class="ha-label ha-label--sm" x="${(x + width * 0.9).toFixed(1)}" ` +
        `y="${middle}">${value}</text>`)
  );
}

/** Two accent rings around a box: "tap here". */
function tapBox(x: number, y: number, width: number, height = 11): string {
  const ring = (inset: number, faint: boolean): string =>
    `<rect class="ha-accent${faint ? ' ha-faint' : ''}" x="${x - inset}" y="${y - inset}" ` +
    `width="${width + inset * 2}" height="${height + inset * 2}" rx="${3 + inset}" ` +
    `stroke-width="${faint ? 1.3 : 1.8}"/>`;
  return ring(2, false) + ring(5, true);
}

export const RULES: GameRules = {
  gameName: 'Yahtzee',
  goal: 'Thirteen boxes, three throws a turn.',
  steps: [
    {
      title: 'Throw, hold, throw again',
      text: 'Tap a die to hold it, then throw the rest. Three throws a turn.',
      art:
        hand(4, [6, 6, 2, 4, 1], [0, 1]) +
        artArrow(46, 22, 46, 32, 0) +
        hand(36, [6, 6, 6, 3, 5], [0, 1]),
    },
    {
      title: 'Every turn ends in a box',
      text: 'Each of the thirteen is used once.',
      art:
        box(5, 4, 82, 'Sixes', '18') +
        box(5, 18, 82, 'Full house', '25') +
        box(5, 32, 82, 'Small straight', '30') +
        box(5, 46, 82, 'Chance', '21'),
    },
    {
      title: 'A box takes two taps',
      text: 'The first shows what it would pay, the second writes it down.',
      art:
        box(14, 8, 64, 'Sixes', '24', 'chosen') +
        tapBox(14, 8, 64) +
        artArrow(46, 30, 46, 40, 0) +
        box(14, 46, 64, 'Sixes', '24') +
        artTick(84, 51.5, 6),
    },
    {
      title: '63 up top pays 35 more',
      text: 'Roughly three of each number gets you there.',
      art:
        // The six upper boxes as bars, four of them already filled — the picture
        // is "this column adds up to something", which no label would improve.
        [0, 1, 2, 3, 4, 5]
          .map((row) => {
            const y = 5 + row * 9.5;
            const filled = row < 4;
            return (
              `<rect class="${filled ? 'ha-accent-fill' : 'ha-fill'}" x="6" y="${y}" ` +
              `width="30" height="7" rx="3"/>`
            );
          })
          .join('') +
        `<rect class="ha-accent-fill" x="46" y="19" width="40" height="26" rx="7"/>` +
        `<text class="ha-label ha-label--invert" x="66" y="28">63</text>` +
        `<text class="ha-label ha-label--sm ha-label--invert" x="66" y="39">+35</text>`,
    },
  ],
};
