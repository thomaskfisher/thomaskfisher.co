/**
 * Gridlock's rules sheet. See `shared/how-to-play.ts`.
 *
 * Two things here genuinely cannot be worked out by tapping, and they are the
 * reason this sheet exists rather than being a courtesy:
 *
 *  - **A slide of any length is one move.** The top bar shows the move count
 *    against the best possible, and without knowing the unit that number is
 *    meaningless — someone counting cells will think a nine-move par is absurd.
 *  - **The park cannot be lost.** Every other game in the collection can end a
 *    level badly, so a new player arrives braced for it and plays carefully
 *    around a danger that is not there. Saying plainly that any slide can be
 *    taken straight back is what turns this into a puzzle you poke at.
 *
 * The third, the control scheme, is inferable but expensive to discover: a car
 * that answers only to being dragged reads as broken to someone who taps it.
 */

import type { GameRules } from '../shared/how-to-play';

/* Mini park geometry, in the 92x64 art viewBox. Five columns by four rows,
   which is enough to show a jam without the cars becoming specks. */
const CELL = 11;
const OX = 13;
const OY = 9;
const COLS = 5;
const ROWS = 4;

const x = (column: number): number => OX + column * CELL;
const y = (row: number): number => OY + row * CELL;

/** The tarmac and its markings. */
function park(): string {
  let out =
    `<rect class="ha-fill" x="${OX}" y="${OY}" width="${COLS * CELL}" height="${ROWS * CELL}" rx="3"/>` +
    `<rect class="ha-dim" x="${OX}" y="${OY}" width="${COLS * CELL}" height="${ROWS * CELL}" ` +
    `rx="3" stroke-width="1.2"/>`;

  for (let column = 1; column < COLS; column++) {
    out +=
      `<path class="ha-dim" d="M${x(column)} ${OY} V${OY + ROWS * CELL}" ` +
      `stroke-width="0.7" stroke-dasharray="2 2"/>`;
  }
  for (let row = 1; row < ROWS; row++) {
    out +=
      `<path class="ha-dim" d="M${OX} ${y(row)} H${OX + COLS * CELL}" ` +
      `stroke-width="0.7" stroke-dasharray="2 2"/>`;
  }
  return out;
}

/**
 * A vehicle.
 *
 * The target is drawn in the same red the board uses, and every other car in
 * ink, because colour carries no meaning in this game and the sheet should not
 * imply that it does. One car matters; the rest are scenery.
 */
function car(
  column: number,
  row: number,
  length: number,
  orientation: 'h' | 'v',
  target = false,
): string {
  const width = (orientation === 'h' ? length : 1) * CELL - 3;
  const height = (orientation === 'h' ? 1 : length) * CELL - 3;
  const left = x(column) + 1.5;
  const top = y(row) + 1.5;

  if (target) {
    return (
      `<rect x="${left}" y="${top}" width="${width}" height="${height}" rx="2.5" ` +
      `fill="#e6394a" fill-opacity="0.9"/>` +
      `<rect x="${left + 2.5}" y="${top + 2.5}" width="${width - 5}" height="${height - 5}" ` +
      `rx="1.5" fill="#7d1520" fill-opacity="0.5"/>`
    );
  }

  return (
    `<rect class="ha-fill-strong" x="${left}" y="${top}" width="${width}" height="${height}" rx="2.5"/>` +
    `<rect class="ha-dim" x="${left}" y="${top}" width="${width}" height="${height}" rx="2.5" stroke-width="1"/>`
  );
}

/** The gap in the wall, and the arrow through it. */
function exit(row: number): string {
  const midY = y(row) + CELL / 2;
  const left = OX + COLS * CELL;
  return (
    `<path d="M${left} ${y(row)} V${y(row + 1)}" stroke="#e6394a" stroke-width="2" ` +
    `stroke-linecap="round"/>` +
    `<path d="M${left + 3} ${midY} H${left + 11}" stroke="#e6394a" stroke-width="1.8" ` +
    `stroke-linecap="round"/>` +
    `<path d="M${left + 8} ${midY - 3.2} l3.4 3.2 l-3.4 3.2" fill="none" stroke="#e6394a" ` +
    `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

/** A dashed accent track showing how far a car may slide, with a head at the end. */
function track(
  fromColumn: number,
  fromRow: number,
  toColumn: number,
  toRow: number,
): string {
  const x1 = x(fromColumn) + CELL / 2;
  const y1 = y(fromRow) + CELL / 2;
  const x2 = x(toColumn) + CELL / 2;
  const y2 = y(toRow) + CELL / 2;
  const dx = Math.sign(x2 - x1);
  const dy = Math.sign(y2 - y1);
  return (
    `<path class="ha-accent" d="M${x1} ${y1} L${x2} ${y2}" stroke-width="1.6" ` +
    `stroke-dasharray="3 2.5" stroke-linecap="round"/>` +
    `<path class="ha-accent" d="M${x2 - dx * 3 - dy * 3} ${y2 - dy * 3 - dx * 3} ` +
    `L${x2} ${y2} L${x2 - dx * 3 + dy * 3} ${y2 - dy * 3 + dx * 3}" stroke-width="1.6" ` +
    `stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

/** A ring marking a bay a car can be sent to. */
function spot(column: number, row: number): string {
  return (
    `<circle class="ha-accent-fill" cx="${x(column) + CELL / 2}" cy="${y(row) + CELL / 2}" ` +
    `r="2.6" fill-opacity="0.55"/>`
  );
}

/** Crosses a direction out: this is not a way a car can go. */
function forbidden(column: number, row: number): string {
  const cx = x(column) + CELL / 2;
  const cy = y(row) + CELL / 2;
  return (
    `<circle class="ha-veil" cx="${cx}" cy="${cy}" r="5"/>` +
    `<path class="ha-strike" d="M${cx - 3} ${cy - 3} l6 6 M${cx + 3} ${cy - 3} l-6 6" ` +
    `stroke-width="1.8" stroke-linecap="round"/>`
  );
}

/** The curling arrow that means "and back again". */
function undoArrow(cx: number, cy: number): string {
  return (
    `<path class="ha-accent" d="M${cx - 8} ${cy} a8 8 0 1 1 3 6.2" stroke-width="1.7" ` +
    `stroke-linecap="round" fill="none"/>` +
    `<path class="ha-accent" d="M${cx - 12} ${cy - 3.6} l4 3.8 l4.2 -3.4" stroke-width="1.7" ` +
    `stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
  );
}

export const RULES: GameRules = {
  gameName: 'Gridlock',
  goal: 'Slide the other cars out of the way until the red one can drive out through the gap.',
  steps: [
    {
      title: 'Get the red car out',
      text:
        'It is the only one that leaves. Everything else is in the way — clear its row and ' +
        'drive it through the gap on the right.',
      art:
        park() +
        exit(1) +
        car(0, 1, 2, 'h', true) +
        car(3, 0, 2, 'v') +
        car(2, 2, 3, 'h') +
        exit(1) +
        track(2, 1, 4, 1),
    },
    {
      title: 'Cars only go the way they point',
      text:
        'A car across the park slides left and right; one facing up the park slides up and ' +
        'down. Nothing turns, nothing changes lane, and nothing jumps another car.',
      art:
        park() +
        car(1, 1, 2, 'h') +
        track(1, 1, 0, 1) +
        track(2, 1, 3, 1) +
        forbidden(1, 0) +
        forbidden(1, 2) +
        car(4, 0, 3, 'v') +
        track(4, 2, 4, 3),
    },
    {
      title: 'Drag it, or tap to see where it goes',
      text:
        'Drag a car as far as you like — however many bays it travels, that is one move. ' +
        'Or tap it, and every bay it can reach is marked for you.',
      art:
        park() +
        car(1, 2, 2, 'v') +
        spot(1, 0) +
        spot(1, 1) +
        `<circle class="ha-accent" cx="${x(1) + CELL / 2}" cy="${y(2) + CELL / 2}" r="8" ` +
        `stroke-width="1.6"/>` +
        `<circle class="ha-accent ha-faint" cx="${x(1) + CELL / 2}" cy="${y(2) + CELL / 2}" ` +
        `r="11.5" stroke-width="1.3"/>` +
        car(3, 1, 2, 'h'),
    },
    {
      title: 'You cannot get stuck',
      text:
        'Every slide can be taken straight back, so there is no wrong move and no way to ' +
        'lose. The only question a level asks is how few moves you can do it in.',
      art:
        park() +
        car(0, 1, 2, 'h', true) +
        car(2, 0, 2, 'v') +
        car(4, 2, 2, 'v') +
        exit(1) +
        undoArrow(46, 48),
    },
  ],
};
