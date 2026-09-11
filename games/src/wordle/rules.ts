/**
 * Wordle's rules sheet. See `shared/how-to-play.ts`.
 *
 * Nearly everybody knows this game, so the sheet is short and is about the two
 * things that are *this* build rather than the game:
 *
 *  - the word is not always five letters, because the ladder grows it;
 *  - a guess has to be a real word, which is the one place the game says no —
 *    and a player who does not know that reads the refusal as a bug.
 *
 * The colours get the first step anyway, because a sheet that opens on the
 * exceptions to a game it never named reads as a manual page.
 *
 * Deliberately absent: that the keyboard keeps the best news about each letter,
 * that a repeated letter is only coloured as often as the answer can cover, and
 * that the hint fills the row rather than spending it. The first two are
 * discovered in a row or two; the third is nicer found.
 */

import type { GameRules } from '../shared/how-to-play';

/* ------------------------------------------------------------------ */
/* Drawing helpers, in the 92x64 art viewBox                           */
/* ------------------------------------------------------------------ */

const CELL = 13;
const GAP = 2;

/**
 * The last step draws a seven-letter row, which does not fit the art box at the
 * size the other two use. All three rows in that step shrink together rather
 * than only the long one — the step is about the words getting longer, and a
 * row that was also drawn smaller would say the opposite.
 */
const SMALL_CELL = 10;
const SMALL_GAP = 1.5;

/** One tile. `state` is 'correct', 'present', 'absent' or 'empty'. */
function tile(
  ox: number,
  oy: number,
  column: number,
  row: number,
  letter: string,
  state: 'correct' | 'present' | 'absent' | 'empty',
  cell = CELL,
  gap = GAP,
): string {
  const x = ox + column * (cell + gap);
  const y = oy + row * (cell + gap);

  /*
   * Green and yellow are literal here rather than taken from the theme. They
   * are the only colours in this collection that carry a rule, and the sheet
   * would be teaching the wrong thing if it drew them in the accent blue.
   */
  const fills: Record<string, string> = {
    correct: '#3aa757',
    present: '#d4a72c',
    absent: '',
    empty: '',
  };

  const fill = fills[state];
  let out = fill
    ? `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${fill}"/>`
    : `<rect class="${state === 'absent' ? 'ha-fill-strong' : 'ha-fill'}" x="${x}" y="${y}" ` +
      `width="${cell}" height="${cell}" rx="2"/>`;

  if (state === 'empty') {
    out += `<rect class="ha-dim" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" stroke-width="1"/>`;
  }

  if (letter) {
    const label = fill ? 'ha-label ha-label--invert ha-label--sm' : 'ha-label ha-label--sm';
    out += `<text class="${label}" x="${x + cell / 2}" y="${y + cell / 2 + 0.5}">${letter}</text>`;
  }

  return out;
}

/** A row of tiles from a word and a pattern of states. */
function row(
  ox: number,
  oy: number,
  index: number,
  word: string,
  pattern: string,
  cell = CELL,
  gap = GAP,
): string {
  const states = { c: 'correct', p: 'present', a: 'absent', e: 'empty' } as const;
  let out = '';
  for (let column = 0; column < word.length; column++) {
    const key = pattern[column] as keyof typeof states;
    out += tile(ox, oy, column, index, word[column] as string, states[key], cell, gap);
  }
  return out;
}

/** A row of empty tiles, centred in the art box at the smaller size. */
function centred(oy: number, word: string): string {
  const width = word.length * SMALL_CELL + (word.length - 1) * SMALL_GAP;
  return row((92 - width) / 2, oy, 0, word, 'e'.repeat(word.length), SMALL_CELL, SMALL_GAP);
}

export const RULES: GameRules = {
  gameName: 'Wordle',
  goal: 'Find the hidden word before the rows run out.',
  steps: [
    {
      title: 'Green is right, yellow is close',
      text: 'Yellow means the letter is in the word, somewhere else.',
      // The rows start at 3 rather than centred: the two marks down the right
      // need a column of their own, and a five-letter row is seventy-three
      // units wide in a ninety-two unit box.
      art:
        row(3, 10, 0, 'CRANE', 'aacap') +
        row(3, 10, 1, 'TRACK', 'acccc') +
        `<text class="ha-label ha-label--sm" x="84" y="17">?</text>` +
        `<circle class="ha-accent-fill" cx="84" cy="35" r="6"/>` +
        `<path class="ha-on-accent" d="M81.4 35 l1.8 2 l3.4 -4" stroke-width="1.7" fill="none" ` +
        `stroke-linecap="round" stroke-linejoin="round"/>`,
    },
    {
      title: 'Only real words count',
      text: 'A guess that is not a word is refused, and costs you nothing.',
      art:
        row(9, 6, 0, 'ZQXWV', 'eeeee') +
        `<path class="ha-strike" d="M7 12.5 L84 12.5" stroke-width="2" stroke-linecap="round"/>` +
        row(9, 26, 0, 'SLATE', 'eeeee') +
        `<circle class="ha-accent-fill" cx="46" cy="52" r="7"/>` +
        `<path class="ha-on-accent" d="M42.8 52 l2.2 2.4 l4.2 -5" stroke-width="1.9" fill="none" ` +
        `stroke-linecap="round" stroke-linejoin="round"/>`,
    },
    {
      title: 'The words get longer',
      text: 'Later levels hide six and seven letters, with a row more to find them.',
      art: centred(11, 'HOMEY') + centred(26, 'SERMON') + centred(41, 'TAINTED'),
    },
  ],
};
