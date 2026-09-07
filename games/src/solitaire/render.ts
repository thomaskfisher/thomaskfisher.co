/**
 * Solitaire renderer.
 *
 * Reads a GameState and draws it; it decides nothing. Three rules it keeps,
 * all of them learned expensively elsewhere in this repo:
 *
 *  - **Nothing is deferred.** Undo is unlimited, so a timer that commits
 *    something visual is a race the player can win. There is no `setTimeout`
 *    in this file at all, which is the cheapest way to be sure.
 *
 *  - **The table is its own stacking context.** A fanned column stacks its
 *    cards by index, which is a number that climbs with the pile; `isolation:
 *    isolate` on the table is what stops the twentieth card in a column
 *    painting over the settings sheet.
 *
 *  - **Every transient class is cleared by the rebuild that precedes it.** The
 *    whole table is redrawn from state on each change, so a held card or a
 *    hinted card cannot survive into a position it no longer belongs to.
 *
 * The fan spacing is recomputed on every draw rather than fixed, because a
 * column that is four cards deep at the start can be nineteen deep in the
 * endgame and the board still has to fit on the phone without scrolling.
 */

import { rankLabel, suitGlyph, suitInk, suitOf } from '../shared/cards';
import { el } from '../shared/ui';
import { type GameState, type Target, legalTargets } from './game';
import { type Klondike, type Pile, FOUNDATION_0, PILES, WASTE } from './model';

export interface RenderOptions {
  reducedMotion: boolean;
  /** Diamonds blue, clubs green. See `shared/cards.ts`. */
  fourColor: boolean;
  onTap: (target: Target) => void;
}

/** Face-down cards are fanned tighter — there is nothing on them to read. */
const DOWN_RATIO = 0.42;

/**
 * How far apart a column would like its cards, as a share of card height.
 *
 * Seven columns across a phone leaves cards about 48px wide, and the strip of a
 * buried card that this leaves showing is the *only* part of it anybody can
 * read. Tighter than this and the rank in the corner starts being clipped by
 * the card in front of it.
 */
const PREFERRED_FAN = 0.42;

const MIN_FAN = 7;

export function describeProgress(state: GameState): string {
  if (state.phase === 'loading' || !state.board) return 'Preparing…';
  if (state.phase === 'won') return 'Out';
  return `${state.home} home`;
}

export class TableRenderer {
  private options: RenderOptions;
  private readonly reserveEl: HTMLElement;
  private readonly tableauEl: HTMLElement;

  /** Card box, set by the fit pass in `main.ts` before each render. */
  private cardHeight = 65;
  /** Vertical room the columns have to live in, in px. */
  private tableauHeight = 320;

  constructor(private readonly root: HTMLElement, options: RenderOptions) {
    this.options = options;

    this.reserveEl = el('div', { class: 'reserve' });
    this.tableauEl = el('div', { class: 'tableau' });
    this.root.append(this.reserveEl, this.tableauEl);

    // One listener for fifty-two cards. Delegation also means a rebuild cannot
    // leave a stale handler pointing at a card that has moved.
    this.root.addEventListener('click', (event) => {
      const node = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tap]');
      if (!node) return;
      const target = readTarget(node);
      if (target) this.options.onTap(target);
    });
  }

  setOptions(patch: Partial<RenderOptions>): void {
    this.options = { ...this.options, ...patch };
  }

  setMetrics(cardWidth: number, cardHeight: number, tableauHeight: number): void {
    this.cardHeight = cardHeight;
    this.tableauHeight = tableauHeight;
    this.root.style.setProperty('--card-w', `${cardWidth}px`);
    this.root.style.setProperty('--card-h', `${cardHeight}px`);
  }

  render(state: GameState): void {
    const board = state.board;
    if (!board) {
      this.reserveEl.replaceChildren();
      this.tableauEl.replaceChildren();
      return;
    }

    const held = state.selection ? new Set(legalTargets(board, state.selection)) : null;
    this.drawReserve(state, board, held);
    this.drawTableau(state, board, held);
  }

  /* ------------------------------------------------------------- reserve */

  private drawReserve(state: GameState, board: Klondike, held: Set<number> | null): void {
    const row: HTMLElement[] = [];

    // A hint that says "turn a card" has to light the stock, or the hint button
    // silently does nothing on the commonest move in the game.
    const stock = el('button', {
      class:
        `slot slot--stock${board.stock.length === 0 ? ' is-empty' : ''}` +
        `${state.hint?.kind === 'stock' ? ' is-hinted' : ''}`,
      type: 'button',
      'data-tap': 'stock',
      'aria-label': board.stock.length > 0 ? 'Turn a card' : 'Turn the pack over',
    });
    if (board.stock.length > 0) stock.append(this.cardBack());
    else stock.append(el('span', { class: 'recycle', 'aria-hidden': 'true' }, '↻'));
    row.push(stock);

    const waste = el('div', { class: 'slot slot--waste' });
    const top = board.waste[board.waste.length - 1];
    if (top !== undefined) {
      const isHeld = state.selection?.from === WASTE;
      const hinted = state.hint?.kind === 'move' && state.hint.from === WASTE && !state.selection;
      waste.append(this.cardFace(top, { held: isHeld, hinted, tap: { kind: 'waste' } }));
    }
    row.push(waste);

    row.push(el('div', { class: 'slot slot--spacer', 'aria-hidden': 'true' }));

    for (let suit = 0; suit < 4; suit++) {
      const rank = board.foundations[suit] as number;
      const target = held?.has(FOUNDATION_0 + suit) ?? false;
      const hinted =
        state.hint?.kind === 'move' &&
        state.hint.to === FOUNDATION_0 + suit &&
        this.hintTargetIsLit(state);

      const slot = el('button', {
        class:
          `slot slot--foundation${target ? ' is-target' : ''}` +
          `${hinted ? ' is-hinted' : ''}${rank === 0 ? ' is-empty' : ''}`,
        type: 'button',
        'data-tap': 'foundation',
        'data-suit': String(suit),
        'aria-label': `${['spades', 'hearts', 'diamonds', 'clubs'][suit]} foundation`,
      });
      if (rank === 0) {
        // Drawn in the dim text colour rather than the suit's own ink: a black
        // suit painted in card-black on the dark table is invisible, and the
        // glyph's shape is what names the pile anyway.
        slot.append(el('span', { class: 'ghost-suit' }, ['♠', '♥', '♦', '♣'][suit] as string));
      } else {
        slot.append(this.cardFace(suit * 13 + rank - 1, {}));
      }
      row.push(slot);
    }

    this.reserveEl.replaceChildren(...row);
  }

  /**
   * Once the hinted card is in hand, the hint moves to where it is going.
   *
   * That is the whole loop the hint is for — light the card, then light the
   * place — and it is also what lets anything driving the game by clicking what
   * is lit actually finish a level.
   */
  private hintTargetIsLit(state: GameState): boolean {
    const hint = state.hint;
    if (!hint || hint.kind !== 'move' || !state.selection) return false;
    return state.selection.from === hint.from && state.selection.count === hint.count;
  }

  /* ------------------------------------------------------------- tableau */

  private drawTableau(state: GameState, board: Klondike, held: Set<number> | null): void {
    const fan = this.fanFor(board);
    const columns: HTMLElement[] = [];

    for (let index = 0; index < PILES; index++) {
      const pile = board.tableau[index] as Pile;
      const target = held?.has(index) ?? false;
      const hinted =
        state.hint?.kind === 'move' && state.hint.to === index && this.hintTargetIsLit(state);

      // A legal destination is marked on the *card the run would land on*, not
      // on the column. A column is a grid item stretched to the full height of
      // the tableau, so an outline on it is a tall thin box drawn mostly around
      // empty space, and it does not say which card is being built on. Only an
      // empty column — which is a place rather than a card — is marked itself.
      const empty = pile.cards.length === 0;
      const column = el('div', {
        class:
          `column${target && empty ? ' is-target' : ''}` +
          `${hinted && empty ? ' is-hinted' : ''}`,
        'data-tap': 'pile',
        'data-pile': String(index),
      });

      let offset = 0;
      for (let position = 0; position < pile.cards.length; position++) {
        const card = pile.cards[position] as number;
        const faceDown = position < pile.down;
        const inHand =
          state.selection?.from === index &&
          position >= pile.cards.length - state.selection.count;
        const isHintSource =
          !state.selection &&
          state.hint?.kind === 'move' &&
          state.hint.from === index &&
          position === pile.cards.length - state.hint.count;

        const node = faceDown
          ? this.cardBack()
          : this.cardFace(card, {
              held: inHand,
              hinted: isHintSource,
              tap: { kind: 'pile', pile: index, index: position },
            });
        const landing = position === pile.cards.length - 1;
        if (landing && target) node.classList.add('is-target');
        if (landing && hinted) node.classList.add('is-hinted');

        node.style.top = `${Math.round(offset)}px`;
        node.style.zIndex = String(position + 1);
        column.append(node);

        offset += faceDown ? fan * DOWN_RATIO : fan;
      }

      columns.push(column);
    }

    this.tableauEl.replaceChildren(...columns);
  }

  /**
   * The tightest fan any column needs, so the longest one still fits.
   *
   * One spacing for the whole table rather than one per column: columns of
   * different pitches read as different objects, and the eye loses the row.
   */
  private fanFor(board: Klondike): number {
    let worst = Number.POSITIVE_INFINITY;

    for (const pile of board.tableau) {
      const down = pile.down;
      const up = Math.max(0, pile.cards.length - down - 1);
      const steps = down * DOWN_RATIO + up;
      if (steps <= 0) continue;
      worst = Math.min(worst, (this.tableauHeight - this.cardHeight) / steps);
    }

    const preferred = this.cardHeight * PREFERRED_FAN;
    if (!Number.isFinite(worst)) return preferred;
    return Math.max(MIN_FAN, Math.min(preferred, worst));
  }

  /* --------------------------------------------------------------- cards */

  private cardBack(): HTMLElement {
    return el('div', { class: 'card card--down', 'aria-hidden': 'true' });
  }

  private cardFace(
    card: number,
    options: { held?: boolean; hinted?: boolean; tap?: Target },
  ): HTMLElement {
    const suit = suitOf(card);
    const ink = suitInk(suit, this.options.fourColor);
    const label = `${rankLabel(card)}${suitGlyph(card)}`;

    const attrs: Record<string, string> = {
      class: `card${options.held ? ' is-held' : ''}${options.hinted ? ' is-hinted' : ''}`,
      style: `color:${ink}`,
    };

    if (options.tap) {
      attrs['data-tap'] = options.tap.kind === 'waste' ? 'waste' : 'card';
      if (options.tap.kind === 'pile') {
        attrs['data-pile'] = String(options.tap.pile);
        attrs['data-index'] = String(options.tap.index);
      }
      attrs.type = 'button';
      attrs['aria-label'] = label;
    }

    const node = el(options.tap ? 'button' : 'div', attrs);
    node.append(
      el('span', { class: 'rank' }, `${rankLabel(card)}<i>${suitGlyph(card)}</i>`),
      el('span', { class: 'pip', 'aria-hidden': 'true' }, suitGlyph(card)),
    );
    return node;
  }

  /** A flourish on the foundations when the last card goes home. */
  celebrate(): void {
    if (this.options.reducedMotion) return;
    for (const slot of this.reserveEl.querySelectorAll('.slot--foundation')) {
      slot.classList.remove('is-won');
      // Reading the layout is what makes the class re-trigger the animation.
      void (slot as HTMLElement).offsetWidth;
      slot.classList.add('is-won');
    }
  }
}

function readTarget(node: HTMLElement): Target | null {
  const kind = node.dataset.tap;
  if (kind === 'stock') return { kind: 'stock' };
  if (kind === 'waste') return { kind: 'waste' };
  if (kind === 'foundation') return { kind: 'foundation', suit: Number(node.dataset.suit) };
  if (kind === 'card') {
    return { kind: 'pile', pile: Number(node.dataset.pile), index: Number(node.dataset.index) };
  }
  if (kind === 'pile') {
    // An empty column, or the strip below the last card in one. Index past the
    // end is what the controller reads as "the column itself".
    return { kind: 'pile', pile: Number(node.dataset.pile), index: -1 };
  }
  return null;
}
