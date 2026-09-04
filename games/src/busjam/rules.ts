/**
 * Bus Jam's rules sheet. See `shared/how-to-play.ts`.
 *
 * The rule a new player will not guess is that a tap is refused unless that
 * person has a clear walk of empty cells to the top edge. Everything else about
 * the game follows from it — the order you empty the crowd in is the puzzle —
 * so it is the first thing the sheet draws, and it draws the refusal alongside
 * the success rather than leaving it to be discovered by being ignored.
 */

import { type GameRules, artArrow, artCross, artTap } from '../shared/how-to-play';
import { paint } from '../shared/palette';

const RED = paint(0).hex;
const BLUE = paint(1).hex;
const GREEN = paint(2).hex;
const YELLOW = paint(3).hex;

/** Grid geometry, all in the 92x64 art viewBox. */
const CELL = 15;
const STEP = 17; // cell plus the gap after it

/** A person in the crowd: a head and a rounded body, in their colour. */
function person(cx: number, cy: number, color: string, dim = false): string {
  const alpha = dim ? ' fill-opacity="0.4"' : '';
  return (
    `<circle cx="${cx}" cy="${cy - 4}" r="3.1" fill="${color}"${alpha}/>` +
    `<path d="M${cx - 4} ${cy + 5} v-2.6a4 4 0 0 1 8 0v2.6z" fill="${color}"${alpha}/>`
  );
}

/**
 * A walkable grid with the exit edge marked above its top row. The accent line
 * is the edge people walk off, which is the thing the first diagram is about.
 */
function grid(x: number, y: number, cols: number, rows: number): string {
  const cells: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push(
        `<rect class="ha-dim" x="${x + c * STEP}" y="${y + r * STEP}" width="${CELL}" ` +
          `height="${CELL}" rx="3.5" stroke-width="1.3"/>`,
      );
    }
  }
  return (
    `<path class="ha-accent ha-faint" d="M${x - 1} ${y - 4} h${cols * STEP + 1}" ` +
    `stroke-width="2" stroke-linecap="round"/>` +
    cells.join('')
  );
}

/** The bus at the stop, with its seats. `taken` fills from the front. */
function bus(x: number, y: number, color: string, seats: number, taken: number): string {
  const w = 12 + seats * 12;
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="22" rx="5" fill="${color}" ` +
    `fill-opacity="0.2" stroke="${color}" stroke-width="1.8"/>` +
    Array.from({ length: seats }, (_, i) => {
      const cx = x + 12 + i * 12;
      return i < taken
        ? `<circle cx="${cx}" cy="${y + 11}" r="4" fill="${color}"/>`
        : `<circle class="ha-dim" cx="${cx}" cy="${y + 11}" r="4" stroke-width="1.4"/>`;
    }).join('') +
    `<circle class="ha-fill-strong" cx="${x + 9}" cy="${y + 23}" r="2.6"/>` +
    `<circle class="ha-fill-strong" cx="${x + w - 9}" cy="${y + 23}" r="2.6"/>`
  );
}

/** A bus waiting its turn, drawn as the small queue chip the game uses. */
function queued(x: number, y: number, color: string): string {
  return (
    `<rect class="ha-dim" x="${x}" y="${y}" width="14" height="22" rx="4" stroke-width="1.6"/>` +
    `<circle cx="${x + 7}" cy="${y + 11}" r="4" fill="${color}"/>`
  );
}

/** The bench: the only place to park someone no bus wants yet. */
function bench(x: number, y: number, capacity: number, filled: readonly string[]): string {
  return Array.from({ length: capacity }, (_, i) => {
    const sx = x + i * 19;
    const slot =
      `<rect class="ha-dim" x="${sx}" y="${y}" width="17" height="20" rx="4" stroke-width="1.5"/>`;
    return slot + (filled[i] ? person(sx + 8.5, y + 10, filled[i] as string) : '');
  }).join('');
}

export const RULES: GameRules = {
  gameName: 'Bus Jam',
  goal: 'Clear the whole crowd off the board by getting everyone onto a bus.',
  steps: [
    {
      title: 'Tap someone with a clear walk out',
      text:
        'They leave across the top edge, so the cells between them and it have to be ' +
        'empty. Tap someone boxed in and nothing happens — nobody walks through anybody.',
      art:
        grid(14, 20, 3, 2) +
        artTap(21.5, 27.5, 11) +
        person(21.5, 27.5, RED) +
        person(55.5, 27.5, GREEN) +
        person(55.5, 44.5, BLUE, true) +
        artArrow(21.5, 14, 21.5, 4, 0) +
        artCross(74, 44, 7),
    },
    {
      title: 'They board the bus, if the colours match',
      text:
        'One bus is at the stop at a time. Fill its seats and it pulls away, and the next ' +
        'bus in the queue behind it moves up to take the stop.',
      art:
        bus(6, 10, BLUE, 3, 2) +
        queued(58, 10, GREEN) +
        queued(76, 10, YELLOW) +
        artArrow(32, 51, 42, 33, 0) +
        person(30, 55, BLUE),
    },
    {
      title: 'No matching bus? They wait on the bench',
      text:
        'The bench is the only other place a person can go, and it is where the level is ' +
        'lost. Fill its last seat and it is over — so keep a seat spare.',
      art:
        bench(4, 12, 4, [RED, GREEN, YELLOW]) +
        artArrow(69.5, 44, 69.5, 34, 0) +
        person(69.5, 51, BLUE) +
        artCross(84, 52, 7),
    },
    {
      title: 'Clearing the front opens the back',
      text:
        'Everyone who boards frees the cell they stood in, which is what lets the people ' +
        'behind them out. Choosing who goes first is the whole puzzle.',
      art:
        grid(10, 14, 3, 3) +
        person(34.5, 21.5, RED, true) +
        person(34.5, 55.5, BLUE) +
        artArrow(34.5, 48, 34.5, 5, 0),
    },
  ],
};
