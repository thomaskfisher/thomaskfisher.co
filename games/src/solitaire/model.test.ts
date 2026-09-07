import { describe, expect, it } from 'vitest';

import { cardName, isRed, makeCard, orderedDeck, rankOf, suitOf } from '../shared/cards';
import { createRng, hashSeed } from '../shared/rng';
import {
  type Klondike,
  type Move,
  FOUNDATION_0,
  PILES,
  STOCK_MOVE,
  WASTE,
  applyMove,
  autoPlay,
  cardsHome,
  cloneState,
  deal,
  isLegal,
  isRun,
  isSafeToPlayUp,
  isWon,
  legalMoves,
  packMove,
  stateKey,
  unpackMove,
} from './model';

const SPADES = 0;
const HEARTS = 1;
const DIAMONDS = 2;
const CLUBS = 3;

const shuffled = (seed: string): number[] => createRng(hashSeed(seed)).shuffle(orderedDeck());

/** Every card on the table exactly once, wherever it is. */
function census(state: Klondike): number[] {
  const all = [...state.stock, ...state.waste];
  for (const pile of state.tableau) all.push(...pile.cards);
  for (let suit = 0; suit < 4; suit++) {
    for (let rank = 1; rank <= (state.foundations[suit] as number); rank++) {
      all.push(makeCard(suit, rank));
    }
  }
  return all.sort((a, b) => a - b);
}

describe('the deal', () => {
  it('lays out seven piles and keeps the rest in the stock', () => {
    const state = deal(shuffled('deal'));
    expect(state.tableau).toHaveLength(PILES);
    for (let pile = 0; pile < PILES; pile++) {
      // An ace on top flies straight up, so a pile can be one card lighter than
      // it was dealt — but never lighter than its face-down half.
      expect((state.tableau[pile] as { down: number }).down).toBeLessThanOrEqual(pile);
    }
    expect(census(state)).toEqual(orderedDeck());
  });

  it('is a pure function of the deck it is handed', () => {
    const deck = shuffled('pure');
    expect(stateKey(deal(deck))).toBe(stateKey(deal(deck)));
  });
});

describe('runs', () => {
  it('descend by one and alternate colour', () => {
    const good = [makeCard(SPADES, 8), makeCard(HEARTS, 7), makeCard(CLUBS, 6)];
    expect(isRun(good, 0)).toBe(true);

    const sameColor = [makeCard(SPADES, 8), makeCard(CLUBS, 7)];
    expect(isRun(sameColor, 0)).toBe(false);

    const gap = [makeCard(SPADES, 8), makeCard(HEARTS, 6)];
    expect(isRun(gap, 0)).toBe(false);
  });
});

describe('cards that can never be wanted again', () => {
  const base = (): Klondike => ({
    stock: [],
    waste: [],
    foundations: [0, 0, 0, 0],
    tableau: Array.from({ length: PILES }, () => ({ cards: [], down: 0 })),
  });

  it('always sends an ace or a two home', () => {
    const state = base();
    expect(isSafeToPlayUp(state, makeCard(HEARTS, 1))).toBe(true);
    expect(isSafeToPlayUp(state, makeCard(HEARTS, 2))).toBe(true);
  });

  /**
   * A black five is only ever useful holding a red four. Once both red fours
   * are home there is no red four left to hold, and the five is finished.
   */
  it('waits for both cards of the other colour that could sit on it', () => {
    const state = base();
    const five = makeCard(SPADES, 5);

    state.foundations = [0, 4, 0, 0];
    expect(isSafeToPlayUp(state, five), 'only one red four home').toBe(false);

    state.foundations = [0, 4, 4, 0];
    expect(isSafeToPlayUp(state, five), 'both red fours home').toBe(true);
  });

  it('leaves no safe card exposed after any move', () => {
    const state = deal(shuffled('invariant'));
    const rng = createRng(hashSeed('invariant', 'walk'));

    for (let step = 0; step < 300 && !isWon(state); step++) {
      const moves = legalMoves(state);
      if (moves.length === 0) break;
      applyMove(state, rng.pick(moves));

      for (const pile of state.tableau) {
        const top = pile.cards[pile.cards.length - 1];
        if (top === undefined || pile.down === pile.cards.length) continue;
        const playable =
          (state.foundations[suitOf(top)] as number) === rankOf(top) - 1 &&
          isSafeToPlayUp(state, top);
        expect(playable, `${cardName(top)} was left sitting on the table`).toBe(false);
      }
    }
  });
});

describe('the stock', () => {
  it('turns one card at a time and comes back round in the same order', () => {
    const state = deal(shuffled('stock'));
    const before = state.stock.slice();

    for (let i = 0; i < before.length; i++) applyMove(state, STOCK_MOVE);
    expect(state.stock, 'the pack should be spent').toHaveLength(0);

    // Everything that got played on the way out is gone from the pack; what is
    // left has to come back in the order it started in.
    const survivors = before.filter((card) => state.waste.includes(card));
    applyMove(state, STOCK_MOVE);
    expect(state.waste).toHaveLength(0);
    expect(state.stock).toEqual(survivors);
  });

  it('is the only move left when there is nothing else', () => {
    const state: Klondike = {
      stock: [makeCard(CLUBS, 9)],
      waste: [],
      foundations: [0, 0, 0, 0],
      tableau: Array.from({ length: PILES }, () => ({ cards: [], down: 0 })),
    };
    expect(legalMoves(state)).toEqual([STOCK_MOVE]);
  });
});

describe('what is legal', () => {
  const withPiles = (cards: number[][]): Klondike => ({
    stock: [],
    waste: [],
    foundations: [0, 0, 0, 0],
    tableau: Array.from({ length: PILES }, (_, i) => ({ cards: cards[i] ?? [], down: 0 })),
  });

  it('builds down in alternating colours, and takes only kings into a gap', () => {
    const state = withPiles([[makeCard(SPADES, 8)], [makeCard(HEARTS, 7)], [makeCard(CLUBS, 7)]]);

    expect(isLegal(state, { kind: 'move', from: 1, to: 0, count: 1 }), 'red on black').toBe(true);
    expect(isLegal(state, { kind: 'move', from: 2, to: 0, count: 1 }), 'black on black').toBe(false);
    expect(isLegal(state, { kind: 'move', from: 1, to: 3, count: 1 }), 'seven into a gap').toBe(
      false,
    );

    const kings = withPiles([[makeCard(DIAMONDS, 13)], []]);
    kings.tableau[0] = { cards: [makeCard(SPADES, 4), makeCard(DIAMONDS, 13)], down: 1 };
    expect(isLegal(kings, { kind: 'move', from: 0, to: 1, count: 1 })).toBe(true);
  });

  /** Two empty columns are the same empty column, and one of them is enough. */
  it('offers a gap once however many there are', () => {
    const state = withPiles([[makeCard(SPADES, 4), makeCard(DIAMONDS, 13)]]);
    (state.tableau[0] as { down: number }).down = 1;

    const intoGaps = legalMoves(state).filter(
      (move) => move.kind === 'move' && move.from === 0 && move.to !== 0,
    );
    expect(intoGaps).toHaveLength(1);
  });

  it('will not shuffle a whole face-up column into an empty one', () => {
    const state = withPiles([[makeCard(DIAMONDS, 13), makeCard(SPADES, 12)]]);
    expect(isLegal(state, { kind: 'move', from: 0, to: 1, count: 2 })).toBe(false);
  });

  /** What goes home stays home — see the header of `model.ts`. */
  it('never takes a card back off a foundation', () => {
    const state = withPiles([[makeCard(SPADES, 3)]]);
    state.foundations = [0, 2, 0, 0];
    const recall: Move = { kind: 'move', from: FOUNDATION_0 + HEARTS, to: 0, count: 1 };
    expect(isLegal(state, recall)).toBe(false);
    expect(legalMoves(state).some((move) => move.kind === 'move' && move.from >= FOUNDATION_0)).toBe(
      false,
    );
  });

  it('lets a card be banked on a foundation before it is safe', () => {
    const state = withPiles([[makeCard(SPADES, 1)], [makeCard(SPADES, 2)]]);
    // The ace flies up on its own; the two follows it, unconditionally safe.
    autoPlay(state);
    expect(state.foundations[SPADES]).toBe(2);

    const three = withPiles([[makeCard(SPADES, 9), makeCard(SPADES, 3)]]);
    (three.tableau[0] as { down: number }).down = 1;
    three.foundations = [2, 0, 0, 0];
    const bank: Move = { kind: 'move', from: 0, to: FOUNDATION_0 + SPADES, count: 1 };
    expect(isLegal(three, bank), 'a three with no red twos home is a real choice').toBe(true);
    expect(applyMove(three, bank)).toBe(true);
    expect(three.foundations[SPADES]).toBe(3);
  });
});

describe('the save format', () => {
  it('survives a round trip for every shape of move', () => {
    const moves: Move[] = [STOCK_MOVE];
    for (const from of [0, 3, 6, WASTE]) {
      for (const to of [0, 6, FOUNDATION_0, FOUNDATION_0 + 3]) {
        for (const count of [1, 7, 13]) moves.push({ kind: 'move', from, to, count });
      }
    }
    for (const move of moves) expect(unpackMove(packMove(move))).toEqual(move);
  });
});

describe('the transposition key', () => {
  it('tells apart two positions holding the same cards', () => {
    const drawn = deal(shuffled('key'));
    const same = cloneState(drawn);
    expect(stateKey(same)).toBe(stateKey(drawn));

    applyMove(same, STOCK_MOVE);
    expect(stateKey(same)).not.toBe(stateKey(drawn));
  });

  /**
   * This is the property the solver's whole termination argument rests on:
   * turning the pile over preserves its order, so a lap with nothing played on
   * the way round arrives at a position already in the table.
   *
   * The stock here is deliberately all high cards. An ace or a two would fly
   * home as it was turned, which is a lap that *did* something.
   */
  it('comes back to itself after a full lap of the stock', () => {
    const parked: Klondike = {
      stock: [makeCard(SPADES, 13), makeCard(HEARTS, 9), makeCard(CLUBS, 6)],
      waste: [],
      foundations: [0, 0, 0, 0],
      tableau: Array.from({ length: PILES }, () => ({ cards: [], down: 0 })),
    };
    const start = stateKey(parked);

    const lap = parked.stock.length + 1;
    for (let i = 0; i < lap; i++) applyMove(parked, STOCK_MOVE);
    expect(stateKey(parked)).toBe(start);
  });
});

describe('winning', () => {
  it('is every card home and nothing less', () => {
    const state: Klondike = {
      stock: [],
      waste: [],
      foundations: [13, 13, 13, 12],
      tableau: Array.from({ length: PILES }, () => ({ cards: [], down: 0 })),
    };
    expect(isWon(state)).toBe(false);
    expect(cardsHome(state)).toBe(51);

    state.tableau[0] = { cards: [makeCard(CLUBS, 13)], down: 0 };
    autoPlay(state);
    expect(isWon(state)).toBe(true);
  });

  it('keeps the colours straight', () => {
    expect(isRed(makeCard(HEARTS, 5))).toBe(true);
    expect(isRed(makeCard(DIAMONDS, 5))).toBe(true);
    expect(isRed(makeCard(SPADES, 5))).toBe(false);
    expect(isRed(makeCard(CLUBS, 5))).toBe(false);
  });
});
