/**
 * Solitaire — Klondike, and nothing else. No DOM, no randomness, no timers.
 *
 * Seven piles, four foundations, a stock you turn one card at a time, and no
 * limit on how often you turn it over. That last choice is the one that shapes
 * everything else here: with draw one and unlimited redeals the *rules* are
 * never the difficulty, so all of it has to come from the deal. See
 * `generate.ts`.
 *
 * ## Safe cards fly up on their own
 *
 * A card sitting in the tableau is only ever *useful* there for one thing:
 * holding the card one rank below it in the other colour. So once both
 * opposite-colour cards of that rank are already on the foundations, the card
 * can never be needed again, and leaving it on the board is busywork rather
 * than a decision. `autoPlay` sends every such card up after every move.
 *
 * That is a real rule, not a convenience, and it is the model's business rather
 * than the renderer's — because the solver and the difficulty rollouts have to
 * measure the game the player is actually playing. It also buys three things:
 * the endgame runs itself out instead of asking for forty taps, the search
 * space shrinks by a large constant, and every reachable state satisfies the
 * same invariant — **no exposed card is ever safe to play up**. `legalMoves`
 * refuses the one move that would break it (see `foundationToTableau`), so the
 * invariant holds everywhere and the transposition table can trust it.
 *
 * Playing a card up that is *not* safe stays the player's call, and is
 * sometimes the whole puzzle — banking a seven to empty the column under it is
 * a real decision, and the game lets you make it.
 *
 * ## What goes home stays home
 *
 * There is no move that takes a card back off a foundation, and that is a rule
 * rather than an omission. It cannot cost a solution: a line that banks a card
 * and later wants it back is the same line that never banked it. What it does
 * cost is a search that has to consider putting twenty-eight cards back on the
 * board at every position, and a rule where "safe" was computed against a
 * foundation row that then went backwards. Undo is what protects a bank made in
 * error, which is what undo is for everywhere else here too.
 */

import { isRed, rankOf, suitOf } from '../shared/cards';

export const PILES = 7;
export const SUIT_COUNT = 4;

/** Location ids, shared by moves, the renderer and the save's move list. */
export const WASTE = 7;
export const FOUNDATION_0 = 8;

export interface Pile {
  /** Bottom to top. The last entry is the exposed one. */
  cards: number[];
  /** How many of them, from the bottom, are still face down. */
  down: number;
}

export interface Klondike {
  /** Face down. The last entry is the next card turned. */
  stock: number[];
  /** Face up. The last entry is the one in play. */
  waste: number[];
  /** Highest rank placed per suit, 0 for an empty foundation. */
  foundations: number[];
  tableau: Pile[];
}

/**
 * A tap on the stock, or a card moving.
 *
 * The stock tap is one move rather than two because it is one tap: it turns a
 * card when there is one to turn, and turns the pile back over when there is
 * not. Which it does is a function of the position, so a replayed move list
 * cannot drift.
 */
export type Move = { kind: 'stock' } | { kind: 'move'; from: number; to: number; count: number };

export const STOCK_MOVE: Move = { kind: 'stock' };

/* ------------------------------------------------------------------ deal */

/** `cards` is a shuffled 52-card deck; shuffling is always the generator's. */
export function deal(cards: readonly number[]): Klondike {
  const deck = cards.slice();
  const tableau: Pile[] = [];

  for (let pile = 0; pile < PILES; pile++) {
    const taken = deck.splice(0, pile + 1);
    tableau.push({ cards: taken, down: pile });
  }

  const state: Klondike = {
    stock: deck,
    waste: [],
    foundations: [0, 0, 0, 0],
    tableau,
  };

  autoPlay(state);
  return state;
}

export function cloneState(state: Klondike): Klondike {
  return {
    stock: state.stock.slice(),
    waste: state.waste.slice(),
    foundations: state.foundations.slice(),
    tableau: state.tableau.map((pile) => ({ cards: pile.cards.slice(), down: pile.down })),
  };
}

/* -------------------------------------------------------------- the rules */

/** A run may move as one unit when it descends by rank and alternates colour. */
export function isRun(cards: readonly number[], from: number): boolean {
  for (let i = from; i + 1 < cards.length; i++) {
    const upper = cards[i] as number;
    const lower = cards[i + 1] as number;
    if (rankOf(lower) !== rankOf(upper) - 1) return false;
    if (isRed(lower) === isRed(upper)) return false;
  }
  return true;
}

/** Kings only, onto an empty column. */
export function acceptsOnTableau(pile: Pile, card: number): boolean {
  const top = pile.cards[pile.cards.length - 1];
  if (top === undefined) return rankOf(card) === 13;
  if (pile.down === pile.cards.length) return false; // nothing face up to build on
  return rankOf(card) === rankOf(top) - 1 && isRed(card) !== isRed(top);
}

export const acceptsOnFoundation = (state: Klondike, card: number): boolean =>
  (state.foundations[suitOf(card)] as number) === rankOf(card) - 1;

/**
 * True when this card can never be wanted in the tableau again.
 *
 * A card is only useful down there to hold the next rank down in the other
 * colour, so once both of those are already home, it is finished. Aces and twos
 * are unconditional: an ace is never held by anything, so nothing needs a two.
 */
export function isSafeToPlayUp(state: Klondike, card: number): boolean {
  return safeAgainst(state.foundations, card);
}

/**
 * The same question against a foundation row that is not a whole state.
 *
 * Allocation-free and hot: `legalMoves` asks it for every card that could come
 * back down off a foundation, and the solver walks hundreds of thousands of
 * those. An earlier version cloned the entire position to ask it, which was
 * twenty-eight clones per expanded node.
 */
export function safeAgainst(foundations: readonly number[], card: number): boolean {
  const rank = rankOf(card);
  if (rank <= 2) return true;
  if (isRed(card)) {
    return (foundations[0] as number) >= rank - 1 && (foundations[3] as number) >= rank - 1;
  }
  return (foundations[1] as number) >= rank - 1 && (foundations[2] as number) >= rank - 1;
}

/** Turn one over from the bottom when a pile's last face-up card leaves. */
function flipIfNeeded(pile: Pile): void {
  if (pile.cards.length > 0 && pile.down === pile.cards.length) pile.down--;
}

/**
 * Sends every finished card home, over and over until none is left.
 *
 * Runs after every applied move, which is what makes "no exposed card is safe"
 * an invariant of every reachable state rather than something the caller has to
 * remember. The scan order is fixed so that replaying a move list is exact.
 */
export function autoPlay(state: Klondike): number {
  let played = 0;

  for (let progress = true; progress; ) {
    progress = false;

    for (const pile of state.tableau) {
      const card = pile.cards[pile.cards.length - 1];
      if (card === undefined || pile.down === pile.cards.length) continue;
      if (!acceptsOnFoundation(state, card) || !isSafeToPlayUp(state, card)) continue;
      pile.cards.pop();
      flipIfNeeded(pile);
      state.foundations[suitOf(card)] = rankOf(card);
      played++;
      progress = true;
    }

    const top = state.waste[state.waste.length - 1];
    if (top !== undefined && acceptsOnFoundation(state, top) && isSafeToPlayUp(state, top)) {
      state.waste.pop();
      state.foundations[suitOf(top)] = rankOf(top);
      played++;
      progress = true;
    }
  }

  return played;
}

/* ------------------------------------------------------------------ moves */

const isTableau = (location: number): boolean => location >= 0 && location < PILES;
const isFoundation = (location: number): boolean => location >= FOUNDATION_0;

/**
 * The bottom card of what a move would carry, or -1 when the move is malformed.
 *
 * Allocation-free, which is why the rules below are written in terms of it
 * rather than of the cards themselves: everything that decides legality reads
 * the head, and the solver asks this question far more often than it asks for
 * an actual array.
 */
export function headOf(state: Klondike, move: Move): number {
  if (move.kind === 'stock') return -1;
  const { from, count } = move;
  if (count < 1) return -1;

  if (isTableau(from)) {
    const pile = state.tableau[from] as Pile;
    const start = pile.cards.length - count;
    if (start < pile.down) return -1;
    if (!isRun(pile.cards, start)) return -1;
    return pile.cards[start] as number;
  }

  if (count !== 1) return -1;

  if (from === WASTE) return state.waste[state.waste.length - 1] ?? -1;
  return -1;
}

/** The cards a move would carry, or null when the move is not legal in form. */
export function movingCards(state: Klondike, move: Move): number[] | null {
  const head = headOf(state, move);
  if (head < 0 || move.kind === 'stock') return null;
  if (!isTableau(move.from)) return [head];
  const pile = state.tableau[move.from] as Pile;
  return pile.cards.slice(pile.cards.length - move.count);
}

export function isLegal(state: Klondike, move: Move): boolean {
  if (move.kind === 'stock') return state.stock.length > 0 || state.waste.length > 0;

  const { from, to, count } = move;
  if (from === to) return false;

  const head = headOf(state, move);
  if (head < 0) return false;

  if (isFoundation(to)) {
    if (count !== 1) return false;
    if (to - FOUNDATION_0 !== suitOf(head)) return false;
    return acceptsOnFoundation(state, head);
  }

  if (!isTableau(to)) return false;
  const target = state.tableau[to] as Pile;
  if (!acceptsOnTableau(target, head)) return false;

  if (isTableau(from)) {
    const source = state.tableau[from] as Pile;
    // Shifting an entire face-up column into another empty column relabels the
    // board and changes nothing about it.
    if (target.cards.length === 0 && source.down === 0 && count === source.cards.length) {
      return false;
    }
  }

  return true;
}

/** Applies a move and runs the auto-play that follows it. False if illegal. */
export function applyMove(state: Klondike, move: Move): boolean {
  if (!isLegal(state, move)) return false;

  if (move.kind === 'stock') {
    if (state.stock.length === 0) {
      state.stock = state.waste.reverse();
      state.waste = [];
    } else {
      state.waste.push(state.stock.pop() as number);
    }
    autoPlay(state);
    return true;
  }

  const cards = movingCards(state, move) as number[];
  const { from, to } = move;

  if (isTableau(from)) {
    const pile = state.tableau[from] as Pile;
    pile.cards.length -= cards.length;
    flipIfNeeded(pile);
  } else {
    state.waste.pop();
  }

  if (isFoundation(to)) {
    state.foundations[to - FOUNDATION_0] = rankOf(cards[0] as number);
  } else {
    (state.tableau[to] as Pile).cards.push(...cards);
  }

  autoPlay(state);
  return true;
}

/**
 * Every legal move, best first.
 *
 * The order is the solver's move ordering as much as the renderer's list:
 * turning over a face-down card is the only thing in Klondike that reliably
 * makes progress, so it goes first, and shuffling face-up cards between columns
 * for its own sake goes last.
 */
export function legalMoves(state: Klondike): Move[] {
  const flips: Move[] = [];
  const fromWaste: Move[] = [];
  const empties: Move[] = [];
  const shuffles: Move[] = [];
  const upToFoundation: Move[] = [];

  // Two empty columns are the same empty column. Offering a king both of them
  // doubles the branching factor for two positions a search cannot tell apart,
  // and in the endgame — which is where empty columns live — it was tripling it.
  const firstEmpty = state.tableau.findIndex((pile) => pile.cards.length === 0);
  const skip = (to: number): boolean =>
    (state.tableau[to] as Pile).cards.length === 0 && to !== firstEmpty;

  for (let from = 0; from < PILES; from++) {
    const pile = state.tableau[from] as Pile;
    const faceUp = pile.cards.length - pile.down;

    for (let count = 1; count <= faceUp; count++) {
      const start = pile.cards.length - count;
      if (!isRun(pile.cards, start)) break; // longer runs contain this one
      for (let to = 0; to < PILES; to++) {
        if (skip(to)) continue;
        const move: Move = { kind: 'move', from, to, count };
        if (!isLegal(state, move)) continue;
        if (count === faceUp && pile.down > 0) flips.push(move);
        else if ((state.tableau[to] as Pile).cards.length === 0) empties.push(move);
        else shuffles.push(move);
      }
    }

    const top = pile.cards[pile.cards.length - 1];
    if (top !== undefined && faceUp > 0) {
      const move: Move = { kind: 'move', from, to: FOUNDATION_0 + suitOf(top), count: 1 };
      if (isLegal(state, move)) upToFoundation.push(move);
    }
  }

  const wasteTop = state.waste[state.waste.length - 1];
  if (wasteTop !== undefined) {
    for (let to = 0; to < PILES; to++) {
      if (skip(to)) continue;
      const move: Move = { kind: 'move', from: WASTE, to, count: 1 };
      if (isLegal(state, move)) fromWaste.push(move);
    }
    const up: Move = { kind: 'move', from: WASTE, to: FOUNDATION_0 + suitOf(wasteTop), count: 1 };
    if (isLegal(state, up)) upToFoundation.push(up);
  }

  const stock: Move[] = isLegal(state, STOCK_MOVE) ? [STOCK_MOVE] : [];
  return [...flips, ...fromWaste, ...stock, ...empties, ...shuffles, ...upToFoundation];
}

/* ----------------------------------------------------------------- status */

export const isWon = (state: Klondike): boolean =>
  state.foundations.reduce((sum, rank) => sum + rank, 0) === 52;

/**
 * Nothing left that is legal at all.
 *
 * This is a much rarer thing than being *stuck*, and deliberately so: with
 * unlimited redeals there is always the stock to turn, so it can only happen
 * once the stock and waste are empty. Being stuck in the ordinary sense — the
 * position is still legal but no longer winnable — is what the hint button
 * answers, because deciding it costs a whole search and nobody should pay that
 * after every tap. See `game.ts`.
 */
export const isDead = (state: Klondike): boolean => !isWon(state) && legalMoves(state).length === 0;

export const cardsHome = (state: Klondike): number =>
  state.foundations.reduce((sum, rank) => sum + rank, 0);

export const faceDownCount = (state: Klondike): number =>
  state.tableau.reduce((sum, pile) => sum + pile.down, 0);

/* ------------------------------------------------------- save + transposition */

/** Moves ride in the save as one small integer each. */
export function packMove(move: Move): number {
  if (move.kind === 'stock') return 0;
  return 1 + (move.from * 12 + move.to) * 13 + (move.count - 1);
}

export function unpackMove(packed: number): Move {
  if (packed === 0) return STOCK_MOVE;
  const body = packed - 1;
  const count = (body % 13) + 1;
  const pair = Math.floor(body / 13);
  return { kind: 'move', from: Math.floor(pair / 12), to: pair % 12, count };
}

/**
 * A key that is equal exactly when two positions are.
 *
 * The stock and the waste are one ordered sequence split at a point, so both
 * the sequence and the split have to be in here: turning the pile over
 * preserves the order, which is precisely why cycling the stock comes back to a
 * position the table has already seen.
 */
export function stateKey(state: Klondike): string {
  const parts: number[] = [state.stock.length];
  for (const card of state.stock) parts.push(card + 1);
  for (const card of state.waste) parts.push(card + 1);
  parts.push(0);
  for (const rank of state.foundations) parts.push(rank + 1);
  for (const pile of state.tableau) {
    parts.push(0, pile.down + 1);
    for (const card of pile.cards) parts.push(card + 1);
  }
  return String.fromCharCode(...parts);
}
