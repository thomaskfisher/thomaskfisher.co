import { describe, expect, it } from 'vitest';

import { makeCard, rankOf, suitOf } from '../shared/cards';
import { createRng, hashSeed } from '../shared/rng';
import {
  type Move,
  type Spider,
  CARDS,
  COLUMNS,
  DEAL_MOVE,
  DEAL_SIZES,
  SETS,
  applyMove,
  cloneState,
  deal,
  faceDownCount,
  harvest,
  isDead,
  isLegal,
  isRun,
  isWon,
  legalMoves,
  packMove,
  stateKey,
  unpackMove,
} from './model';
import { packFor } from './generate';

const SPADES = 0;
const HEARTS = 1;

const shuffled = (seed: string, suits = 2): number[] =>
  createRng(hashSeed(seed)).shuffle(packFor(suits));

/** Every card on the table exactly once, wherever it is. */
function census(state: Spider): number {
  let count = state.stock.length + state.completed * 13;
  for (const column of state.columns) count += column.cards.length;
  return count;
}

const bare = (): Spider => ({
  columns: Array.from({ length: COLUMNS }, () => ({ cards: [], down: 0 })),
  stock: [],
  completed: 0,
});

describe('the pack', () => {
  it('is eight sets of thirteen, split evenly between the suits', () => {
    for (const suits of [1, 2]) {
      const pack = packFor(suits);
      expect(pack).toHaveLength(CARDS);
      expect(new Set(pack.map(suitOf)).size).toBe(suits);
      for (let rank = 1; rank <= 13; rank++) {
        expect(pack.filter((card) => rankOf(card) === rank)).toHaveLength(SETS);
      }
    }
  });
});

describe('the deal', () => {
  it('lays out ten columns and keeps five rounds in the stock', () => {
    const state = deal(shuffled('deal'));
    expect(state.columns).toHaveLength(COLUMNS);
    expect(state.columns.map((column) => column.cards.length)).toEqual([...DEAL_SIZES]);
    // One card face up per column, and the stock is five rounds of ten.
    expect(faceDownCount(state)).toBe(54 - COLUMNS);
    expect(state.stock).toHaveLength(50);
    expect(census(state)).toBe(CARDS);
  });

  it('is a pure function of the pack it is handed', () => {
    const pack = shuffled('pure');
    expect(stateKey(deal(pack))).toBe(stateKey(deal(pack)));
  });
});

describe('runs', () => {
  /** The gap between what lands and what travels is the whole of Spider. */
  it('travel as one piece only in one suit', () => {
    const oneSuit = [makeCard(SPADES, 8), makeCard(SPADES, 7), makeCard(SPADES, 6)];
    expect(isRun(oneSuit, 0)).toBe(true);

    const mixed = [makeCard(SPADES, 8), makeCard(HEARTS, 7)];
    expect(isRun(mixed, 0)).toBe(false);

    const gap = [makeCard(SPADES, 8), makeCard(SPADES, 6)];
    expect(isRun(gap, 0)).toBe(false);
  });

  it('land on any suit one rank higher', () => {
    const state = bare();
    state.columns[0] = { cards: [makeCard(SPADES, 8)], down: 0 };
    state.columns[1] = { cards: [makeCard(HEARTS, 7)], down: 0 };
    state.columns[2] = { cards: [makeCard(HEARTS, 9)], down: 0 };

    expect(isLegal(state, { kind: 'move', from: 1, to: 0, count: 1 }), 'seven onto eight').toBe(
      true,
    );
    expect(isLegal(state, { kind: 'move', from: 2, to: 0, count: 1 }), 'nine onto eight').toBe(
      false,
    );
  });

  it('will not shuffle a whole face-up column into an empty one', () => {
    const state = bare();
    state.columns[0] = { cards: [makeCard(SPADES, 5), makeCard(SPADES, 4)], down: 0 };
    expect(isLegal(state, { kind: 'move', from: 0, to: 1, count: 2 })).toBe(false);
  });

  it('offers a gap once however many there are', () => {
    const state = bare();
    state.columns[0] = { cards: [makeCard(SPADES, 9), makeCard(HEARTS, 4)], down: 1 };
    const intoGaps = legalMoves(state).filter((move) => move.kind === 'move' && move.to !== 0);
    expect(intoGaps).toHaveLength(1);
  });
});

describe('the stock', () => {
  it('deals one card to every column', () => {
    const state = deal(shuffled('stock'));
    const before = state.columns.map((column) => column.cards.length);
    expect(applyMove(state, DEAL_MOVE)).toBe(true);
    expect(state.columns.map((column) => column.cards.length)).toEqual(
      before.map((size) => size + 1),
    );
    expect(state.stock).toHaveLength(40);
  });

  /** The rule that makes an empty column cost something. */
  it('refuses to deal onto an empty column', () => {
    const state = deal(shuffled('refuse'));
    state.columns[3] = { cards: [], down: 0 };
    expect(isLegal(state, DEAL_MOVE)).toBe(false);
  });

  it('runs out — there is no redeal', () => {
    const state = deal(shuffled('spend'));
    for (let round = 0; round < 5; round++) expect(applyMove(state, DEAL_MOVE)).toBe(true);
    expect(state.stock).toHaveLength(0);
    expect(isLegal(state, DEAL_MOVE)).toBe(false);
  });
});

describe('finishing a set', () => {
  const kingToAce = (suit: number): number[] =>
    Array.from({ length: 13 }, (_, i) => makeCard(suit, 13 - i));

  it('lifts king down to ace off the board on its own', () => {
    const state = bare();
    state.columns[0] = { cards: [makeCard(HEARTS, 4), ...kingToAce(SPADES)], down: 1 };
    expect(harvest(state)).toBe(1);
    expect(state.completed).toBe(1);
    expect(state.columns[0]?.cards).toHaveLength(1);
    // The card underneath is turned over by the set leaving.
    expect(state.columns[0]?.down).toBe(0);
  });

  it('leaves a run of thirteen alone when it is not all one suit', () => {
    const mixed = kingToAce(SPADES);
    mixed[5] = makeCard(HEARTS, 8);
    const state = bare();
    state.columns[0] = { cards: mixed, down: 0 };
    expect(harvest(state)).toBe(0);
  });

  it('is the game, eight times over', () => {
    const state = bare();
    state.completed = SETS;
    expect(isWon(state)).toBe(true);
    expect(isDead(state)).toBe(false);
  });
});

describe('being stuck', () => {
  /** No redeal, so unlike Solitaire next door this really does happen. */
  it('is an empty stock and nothing legal on the board', () => {
    const state = bare();
    state.columns[0] = { cards: [makeCard(SPADES, 3)], down: 0 };
    state.columns[1] = { cards: [makeCard(HEARTS, 3)], down: 0 };
    expect(legalMoves(state)).toEqual([]);
    expect(isDead(state)).toBe(true);
  });
});

describe('the save format', () => {
  it('survives a round trip for every shape of move', () => {
    const moves: Move[] = [DEAL_MOVE];
    for (const from of [0, 4, 9]) {
      for (const to of [0, 5, 9]) {
        for (const count of [1, 7, 13]) moves.push({ kind: 'move', from, to, count });
      }
    }
    for (const move of moves) expect(unpackMove(packMove(move))).toEqual(move);
  });
});

describe('the transposition key', () => {
  it('tells apart two positions holding the same cards', () => {
    const state = deal(shuffled('key'));
    const same = cloneState(state);
    expect(stateKey(same)).toBe(stateKey(state));
    applyMove(same, DEAL_MOVE);
    expect(stateKey(same)).not.toBe(stateKey(state));
  });
});
