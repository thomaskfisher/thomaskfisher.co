/**
 * Spider's rules sheet. See `shared/how-to-play.ts`.
 *
 * Three rules, and the first two are the two halves of the one thing that makes
 * Spider Spider: a card lands on *any* suit, and only its own suit comes back
 * up as one piece. Everybody who has played Klondike arrives expecting those to
 * be the same rule, discovers they are not by picking up a run and finding one
 * card in their hand, and reads that as the game being broken.
 *
 * The third is the one you lose levels to: the stock will not deal while a
 * column is empty, which turns the most valuable thing on the board into
 * something you have to spend.
 *
 * What is deliberately not here is the set lifting off on its own. Nobody has
 * ever lost a game of Spider for not expecting thirteen cards to vanish, which
 * is the bar for this sheet.
 */

import { type GameRules, artArrow, artCross, artTap, artTick } from '../shared/how-to-play';

const BLACK = '#1d2b45';
const RED = '#cf2f3f';

const CARD_W = 13;
const CARD_H = 18;

/**
 * A card face. The ink arrives as `style` rather than as a `fill` attribute:
 * `ha-label` sets `fill: currentColor`, and a class beats a presentation
 * attribute, so a `fill` here loses and every card comes out drawn in the dim
 * body colour on a white background.
 */
function card(x: number, y: number, rank: string, suit: string, ink: string): string {
  return (
    `<rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="2" ` +
    `fill="#fbfaf7" stroke="rgba(20,32,55,0.28)" stroke-width="1"/>` +
    `<text class="ha-label ha-label--sm" style="fill:${ink}" x="${x + 4.5}" y="${y + 5.5}">` +
    `${rank}${suit}</text>`
  );
}

/** The back of a card. */
function back(x: number, y: number, w = CARD_W, h = CARD_H): string {
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" ` +
    `fill="#2f4f86" stroke="rgba(10,20,40,0.4)" stroke-width="1"/>`
  );
}

/** An empty column: the most valuable thing on a Spider board. */
function gap(x: number, y: number, w = CARD_W, h = CARD_H): string {
  return (
    `<rect class="ha-dim" x="${x}" y="${y}" width="${w}" height="${h}" rx="2" ` +
    `stroke-width="1.3" stroke-dasharray="3 2.5"/>`
  );
}

export const RULES: GameRules = {
  gameName: 'Spider',
  goal: 'Build king down to ace, eight times.',
  steps: [
    {
      title: 'Tap a run, then a column',
      text: 'It lands on any card one rank higher.',
      art:
        card(7, 6, '9', '♠', BLACK) +
        card(7, 19, '8', '♠', BLACK) +
        artTap(13.5, 26, 13) +
        card(68, 12, '10', '♥', RED) +
        artArrow(30, 24, 65, 22, 11),
    },
    {
      title: 'One suit moves as one',
      text: 'Mixed suits travel a card at a time.',
      art:
        card(6, 10, '9', '♠', BLACK) +
        card(6, 21, '8', '♠', BLACK) +
        artTick(29, 28, 7.5) +
        card(50, 10, '9', '♠', BLACK) +
        card(50, 21, '8', '♥', RED) +
        artCross(73, 28, 7.5),
    },
    {
      title: 'The stock needs a full board',
      text: 'It refuses to deal while a column is empty.',
      art:
        back(5, 16, 11, 22) +
        back(8, 18, 11, 22) +
        // The stock reaching for the board, and the bar across it. Four columns
        // and a hole: the hole is the reason it is barred.
        artArrow(23, 29, 42, 29, 0) +
        artCross(33, 29, 7.5) +
        back(48, 16, 9, 22) +
        back(59, 16, 9, 22) +
        gap(70, 16, 9, 22) +
        back(81, 16, 9, 22),
    },
  ],
};
