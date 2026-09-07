/**
 * Spider — the rules, and nothing else. No DOM, no randomness, no timers.
 *
 * Ten columns, two packs, and no foundations at all: a set finishes when king
 * down to ace of one suit is sitting in order on top of a column, and it lifts
 * off the board. Everything else follows from two rules that pull against each
 * other — **a card lands on anything one rank higher, but only a same-suit run
 * travels as one piece** — which is why a two-suit board is a different game
 * from a one-suit board rather than the same game with more colours in it.
 *
 * ## The stock is the clock
 *
 * Fifty cards in five rounds of ten, one to every column, and a round refuses
 * to deal if any column is empty. That refusal is the whole tension of Spider:
 * an empty column is the most valuable thing on the board and the stock is what
 * makes you spend it. There is no redeal — unlike Solitaire next door, this pack
 * really does run out, which is why losing here is an ordinary thing that
 * happens rather than the near-impossibility it is over there.
 *
 * ## One suit and two
 *
 * `generate.ts` deals one suit early and two later; the rules do not change
 * between them and nothing in this file knows which it is being handed. A
 * one-suit board is every run travelling as one piece, so the puzzle is only
 * ordering; a two-suit board is the same board where half the runs you build
 * are welded to the wrong partner and have to be taken apart again.
 */

import { rankOf, suitOf } from '../shared/cards';

export const COLUMNS = 10;
export const SETS = 8;
export const CARDS = 104;

/** How many cards each column is dealt. Four sixes and six fives is 54. */
export const DEAL_SIZES = [6, 6, 6, 6, 5, 5, 5, 5, 5, 5] as const;

/** One round of the stock is one card to every column. */
export const DEAL_ROUNDS = 5;

export interface Column {
  /** Bottom to top. The last entry is the exposed one. */
  cards: number[];
  /** How many of them, from the bottom, are still face down. */
  down: number;
}

export interface Spider {
  columns: Column[];
  /** Face down. The last ten are the next round. */
  stock: number[];
  /** Complete sets lifted off the board. Eight is the game. */
  completed: number;
}

export type Move = { kind: 'deal' } | { kind: 'move'; from: number; to: number; count: number };

export const DEAL_MOVE: Move = { kind: 'deal' };

/* ------------------------------------------------------------------ deal */

/** `cards` is a shuffled 104-card pack; shuffling is always the generator's. */
export function deal(cards: readonly number[]): Spider {
  const pack = cards.slice();
  const columns: Column[] = [];

  for (const size of DEAL_SIZES) {
    const taken = pack.splice(0, size);
    columns.push({ cards: taken, down: size - 1 });
  }

  const state: Spider = { columns, stock: pack, completed: 0 };
  harvest(state);
  return state;
}

export function cloneState(state: Spider): Spider {
  return {
    columns: state.columns.map((column) => ({ cards: column.cards.slice(), down: column.down })),
    stock: state.stock.slice(),
    completed: state.completed,
  };
}

/* -------------------------------------------------------------- the rules */

/**
 * A run travels as one piece when it descends by rank *and* holds one suit.
 *
 * The one-rank-down half is what you are allowed to build; the one-suit half is
 * what you are allowed to pick back up. Spider is the gap between them.
 */
export function isRun(cards: readonly number[], from: number): boolean {
  for (let i = from; i + 1 < cards.length; i++) {
    const upper = cards[i] as number;
    const lower = cards[i + 1] as number;
    if (rankOf(lower) !== rankOf(upper) - 1) return false;
    if (suitOf(lower) !== suitOf(upper)) return false;
  }
  return true;
}

/**
 * A card lands on one of the next rank *up*, of any suit — or on an empty
 * column, which takes anything.
 *
 * Suit is deliberately not checked here: landing ignores it and picking back up
 * does not, and that gap is the whole of Spider. See `isRun`.
 */
export function accepts(column: Column, card: number): boolean {
  const top = column.cards[column.cards.length - 1];
  if (top === undefined) return true;
  if (column.down === column.cards.length) return false;
  return rankOf(card) === rankOf(top) - 1;
}

/** Turn one over when a column's last face-up card leaves. */
function flipIfNeeded(column: Column): void {
  if (column.cards.length > 0 && column.down === column.cards.length) column.down--;
}

/**
 * Lifts every finished set off the board, over and over until none is left.
 *
 * Runs after every applied move, which makes "no completed set is sitting on
 * the board" an invariant of every reachable position rather than something a
 * caller has to remember. A set is never a decision — leaving one down cannot
 * help, because nothing can be built on an ace.
 */
export function harvest(state: Spider): number {
  let lifted = 0;

  for (let progress = true; progress; ) {
    progress = false;
    for (const column of state.columns) {
      const start = column.cards.length - 13;
      if (start < column.down) continue;
      if (rankOf(column.cards[start] as number) !== 13) continue;
      if (!isRun(column.cards, start)) continue;

      column.cards.length = start;
      flipIfNeeded(column);
      state.completed++;
      lifted++;
      progress = true;
    }
  }

  return lifted;
}

/* ------------------------------------------------------------------ moves */

/** The bottom card of what a move would carry, or -1 if it is malformed. */
export function headOf(state: Spider, move: Move): number {
  if (move.kind === 'deal') return -1;
  const { from, count } = move;
  if (count < 1 || from < 0 || from >= COLUMNS) return -1;

  const column = state.columns[from] as Column;
  const start = column.cards.length - count;
  if (start < column.down) return -1;
  if (!isRun(column.cards, start)) return -1;
  return column.cards[start] as number;
}

export function isLegal(state: Spider, move: Move): boolean {
  if (move.kind === 'deal') {
    if (state.stock.length === 0) return false;
    // The rule that makes an empty column cost something.
    return state.columns.every((column) => column.cards.length > 0);
  }

  const { from, to } = move;
  if (from === to || to < 0 || to >= COLUMNS) return false;

  const head = headOf(state, move);
  if (head < 0) return false;

  const target = state.columns[to] as Column;
  if (!accepts(target, head)) return false;

  // Shifting a whole face-up column into an empty one relabels the board and
  // changes nothing about it.
  const source = state.columns[from] as Column;
  if (target.cards.length === 0 && source.down === 0 && move.count === source.cards.length) {
    return false;
  }

  return true;
}

export function applyMove(state: Spider, move: Move): boolean {
  if (!isLegal(state, move)) return false;

  if (move.kind === 'deal') {
    for (const column of state.columns) column.cards.push(state.stock.pop() as number);
    harvest(state);
    return true;
  }

  const source = state.columns[move.from] as Column;
  const carried = source.cards.splice(source.cards.length - move.count, move.count);
  flipIfNeeded(source);
  (state.columns[move.to] as Column).cards.push(...carried);

  harvest(state);
  return true;
}

/**
 * Every legal move, best first.
 *
 * This ordering is most of the search. Spider branches enormously — ten columns
 * onto ten columns, times every length of run — and almost none of it matters:
 * a move that joins a run to its own suit is building something, and a move
 * that lands a run on a stranger is usually the same board rearranged.
 */
export function legalMoves(state: Spider): Move[] {
  const joins: Move[] = [];
  const flips: Move[] = [];
  const empties: Move[] = [];
  const others: Move[] = [];

  // Two empty columns are the same empty column. Offering both of them doubles
  // the branching factor for two positions no search can tell apart.
  const firstEmpty = state.columns.findIndex((column) => column.cards.length === 0);

  for (let from = 0; from < COLUMNS; from++) {
    const column = state.columns[from] as Column;
    const faceUp = column.cards.length - column.down;

    for (let count = 1; count <= faceUp; count++) {
      const start = column.cards.length - count;
      if (!isRun(column.cards, start)) break; // longer runs contain this one
      const head = column.cards[start] as number;

      for (let to = 0; to < COLUMNS; to++) {
        const target = state.columns[to] as Column;
        if (target.cards.length === 0 && to !== firstEmpty) continue;

        const move: Move = { kind: 'move', from, to, count };
        if (!isLegal(state, move)) continue;

        const landing = target.cards[target.cards.length - 1];
        if (landing !== undefined && suitOf(landing) === suitOf(head)) joins.push(move);
        else if (count === faceUp && column.down > 0) flips.push(move);
        else if (target.cards.length === 0) empties.push(move);
        else others.push(move);
      }
    }
  }

  const stock: Move[] = isLegal(state, DEAL_MOVE) ? [DEAL_MOVE] : [];
  return [...joins, ...flips, ...empties, ...stock, ...others];
}

/* ----------------------------------------------------------------- status */

export const isWon = (state: Spider): boolean => state.completed === SETS;

/**
 * Nothing legal left at all.
 *
 * Unlike Solitaire next door this really does happen: there is no redeal, so
 * once the stock is spent the board is all there is.
 */
export const isDead = (state: Spider): boolean => !isWon(state) && legalMoves(state).length === 0;

export const faceDownCount = (state: Spider): number =>
  state.columns.reduce((sum, column) => sum + column.down, 0);

/* ------------------------------------------------- save + transposition */

export function packMove(move: Move): number {
  if (move.kind === 'deal') return 0;
  return 1 + (move.from * COLUMNS + move.to) * 13 + (move.count - 1);
}

export function unpackMove(packed: number): Move {
  if (packed === 0) return DEAL_MOVE;
  const body = packed - 1;
  const count = (body % 13) + 1;
  const pair = Math.floor(body / 13);
  return { kind: 'move', from: Math.floor(pair / COLUMNS), to: pair % COLUMNS, count };
}

/** A key that is equal exactly when two positions are. */
export function stateKey(state: Spider): string {
  const parts: number[] = [state.completed + 1, state.stock.length + 1];
  for (const card of state.stock) parts.push(card + 1);
  for (const column of state.columns) {
    parts.push(0, column.down + 1);
    for (const card of column.cards) parts.push(card + 1);
  }
  return String.fromCharCode(...parts);
}
