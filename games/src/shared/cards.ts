/**
 * A deck of cards, shared by Solitaire and Spider.
 *
 * A card is one small integer, `suit * 13 + (rank - 1)`, so a board is a flat
 * array of numbers and a saved move list stays a handful of bytes. Spider deals
 * eight half-decks, so the same integer can appear more than once — nothing
 * here treats a card value as an identity, and neither game needs it to.
 *
 * **Colour is information in both games**, which is the accessibility problem a
 * card game has and the shape overlay in the other games does not solve: the
 * suits are already four distinct shapes, and the thing that is hard to read is
 * red against black. So the CVD accommodation here is the four-colour deck —
 * diamonds blue, clubs green — carried on the same `colorBlindShapes` setting
 * the rest of the collection uses, because it is the same setting doing the
 * same job in the only way this game can do it.
 */

/** Spades, hearts, diamonds, clubs. Ordered so `suit % 2` is not the colour. */
export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
export type SuitName = (typeof SUITS)[number];

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;

export const SUIT_GLYPHS = ['♠', '♥', '♦', '♣'] as const;

export const CARDS_IN_DECK = 52;

/** Ace is 1, King is 13. */
export const rankOf = (card: number): number => (card % 13) + 1;
export const suitOf = (card: number): number => Math.floor(card / 13);
export const makeCard = (suit: number, rank: number): number => suit * 13 + (rank - 1);

/** True for hearts and diamonds. */
export const isRed = (card: number): boolean => {
  const suit = suitOf(card);
  return suit === 1 || suit === 2;
};

export const sameColor = (a: number, b: number): boolean => isRed(a) === isRed(b);

export const rankLabel = (card: number): string => RANKS[rankOf(card) - 1] as string;
export const suitGlyph = (card: number): string => SUIT_GLYPHS[suitOf(card)] as string;

/** For screen readers and test failures — "Q of hearts" beats "card 37". */
export const cardName = (card: number): string =>
  `${RANKS[rankOf(card) - 1]} of ${SUITS[suitOf(card)]}`;

/** An ordered deck. Shuffling is the caller's business, and is always seeded. */
export function orderedDeck(): number[] {
  return Array.from({ length: CARDS_IN_DECK }, (_, i) => i);
}

/**
 * Ink colour for a suit.
 *
 * Two-colour is the deck everybody knows; four-colour is what makes a red suit
 * distinguishable from the other red suit without relying on hue alone, which
 * is the whole point of offering it.
 */
export function suitInk(suit: number, fourColor: boolean): string {
  if (!fourColor) return suit === 1 || suit === 2 ? 'var(--card-red)' : 'var(--card-black)';
  return ['var(--card-black)', 'var(--card-red)', 'var(--card-blue)', 'var(--card-green)'][
    suit
  ] as string;
}
