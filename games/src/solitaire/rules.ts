/**
 * Solitaire's rules sheet. See `shared/how-to-play.ts`.
 *
 * Three rules, and only one of them is really about Klondike: everybody knows
 * how the columns build. The two worth the space are the ones this version
 * decides for itself — a card that goes home stays home, and the pack goes
 * round as many times as you want it to. The first is the only thing here you
 * can lose a level to; the second is the thing that stops somebody putting the
 * phone down thinking they already have.
 *
 * What is deliberately *not* on the sheet is the auto-play. Finished cards
 * flying home on their own is a nice surprise and nobody has ever lost a game
 * of solitaire for not expecting it, which is the bar for this sheet.
 */

import { type GameRules, artArrow, artCross, artTap } from '../shared/how-to-play';

const BLACK = '#1d2b45';
const RED = '#cf2f3f';

const CARD_W = 15;
const CARD_H = 21;

/**
 * A card face, drawn the way the game draws one: rank top left, suit big.
 *
 * The ink arrives as `style` rather than as a `fill` attribute on purpose.
 * `ha-label` sets `fill: currentColor`, and a class beats a presentation
 * attribute — so a `fill="#cf2f3f"` here loses, and every card in the sheet
 * comes out drawn in the dim body colour on a white background.
 */
function card(x: number, y: number, rank: string, suit: string, ink: string): string {
  return (
    `<rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="2.5" ` +
    `fill="#fbfaf7" stroke="rgba(20,32,55,0.28)" stroke-width="1"/>` +
    `<text class="ha-label ha-label--sm" style="fill:${ink}" x="${x + 5}" y="${y + 6.5}">` +
    `${rank}</text>` +
    `<text class="ha-label" style="fill:${ink}" x="${x + 7.5}" y="${y + 14.5}">${suit}</text>`
  );
}

/** The back of a card. */
function back(x: number, y: number): string {
  return (
    `<rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="2.5" ` +
    `fill="#2f4f86" stroke="rgba(10,20,40,0.4)" stroke-width="1"/>`
  );
}

/** An empty slot: where a card goes, drawn as the game draws one. */
function slot(x: number, y: number): string {
  return (
    `<rect class="ha-dim" x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="2.5" ` +
    `stroke-width="1.4" stroke-dasharray="3 2.5"/>`
  );
}

export const RULES: GameRules = {
  gameName: 'Solitaire',
  goal: 'Send every card home, ace to king.',
  steps: [
    {
      title: 'Tap a card, then tap where',
      text: 'Columns build downwards in colours that alternate.',
      art:
        card(8, 5, '9', '♠', BLACK) +
        slot(8, 30) +
        card(60, 5, '8', '♥', RED) +
        artTap(67.5, 15.5, 12) +
        artArrow(58, 26, 26, 34, 10),
    },
    {
      title: 'Tap again to send it home',
      text: 'A card that goes home does not come back.',
      art:
        slot(6, 5) +
        card(26, 5, 'A', '♦', RED) +
        card(26, 37, '2', '♦', RED) +
        artTap(33.5, 47.5, 11) +
        artArrow(42, 42, 43, 15, 8) +
        // The way back, barred. The rule is the bar.
        `<path class="ha-strike" d="M72 14 v24 M68 34 l4 4 l4 -4" stroke-width="2" ` +
        `stroke-linecap="round" stroke-linejoin="round"/>` +
        artCross(72, 26, 7.5),
    },
    {
      title: 'The pack never runs out',
      text: 'Turn it over as often as you like.',
      art:
        back(10, 14) +
        back(12.5, 16) +
        back(15, 18) +
        artTap(22.5, 28.5, 13) +
        card(54, 18, '4', '♣', BLACK) +
        artArrow(52, 20, 32, 14, 8) +
        artArrow(58, 44, 20, 46, -11),
    },
  ],
};
