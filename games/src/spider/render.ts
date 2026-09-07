/**
 * Spider renderer.
 *
 * Reads a GameState and draws it; it decides nothing. Three rules it keeps,
 * all of them learned expensively elsewhere in this repo:
 *
 *  - **Nothing is deferred.** Undo is unlimited, so a timer that commits
 *    something visual is a race the player can win. There is no `setTimeout`
 *    in this file at all, which is the cheapest way to be sure.
 *
 *  - **The table is its own stacking context.** A column stacks its cards by
 *    index, and a Spider column can be thirty deep; `isolation: isolate` on the
 *    table is what stops those numbers competing with the settings sheet.
 *
 *  - **Every transient class is cleared by the rebuild that precedes it**, so a
 *    held or hinted card cannot survive into a position it no longer belongs to.
 *
 * Ten columns across a phone is a hard constraint and it decides the rest: a
 * card is about 35px wide, so the corner is the *only* part of a buried card
 * anybody can read, and the fan spacing exists to keep that corner clear.
 */

import { rankLabel, suitGlyph, suitInk, suitOf } from '../shared/cards';
import { el } from '../shared/ui';
import { type GameState, type Target, legalTargets } from './game';
import { type Column, COLUMNS, SETS, type Spider } from './model';

export interface RenderOptions {
  reducedMotion: boolean;
  /** Diamonds blue, clubs green — here, hearts red against black spades. */
  fourColor: boolean;
  onTap: (target: Target) => void;
}

/** Face-down cards are fanned tighter — there is nothing on them to read. */
const DOWN_RATIO = 0.4;

/** How far apart a column would like its cards, as a share of card height. */
const PREFERRED_FAN = 0.36;

const MIN_FAN = 6;

export function describeProgress(state: GameState): string {
  if (state.phase === 'loading' || !state.board) return 'Preparing…';
  if (state.phase === 'won') return 'Cleared';
  const suits = state.generated?.suits ?? 1;
  return `${state.completed} of ${SETS} · ${suits === 1 ? 'one suit' : 'two suits'}`;
}

export class TableRenderer {
  private options: RenderOptions;
  private readonly reserveEl: HTMLElement;
  private readonly tableauEl: HTMLElement;

  private cardHeight = 48;
  private tableauHeight = 300;

  constructor(private readonly root: HTMLElement, options: RenderOptions) {
    this.options = options;

    this.reserveEl = el('div', { class: 'reserve' });
    this.tableauEl = el('div', { class: 'tableau' });
    this.root.append(this.reserveEl, this.tableauEl);

    // One listener for a hundred and four cards. Delegation also means a
    // rebuild cannot leave a stale handler pointing at a card that has moved.
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
    this.drawReserve(state, board);
    this.drawTableau(state, board, held);
  }

  /* ------------------------------------------------------------- reserve */

  /**
   * The stock on the left and the finished sets on the right.
   *
   * Both are counts a player has to be able to read at a glance — how many
   * rounds are left is the clock this game runs on — so both are drawn as the
   * things they count rather than as numbers.
   */
  private drawReserve(state: GameState, board: Spider): void {
    const rounds = Math.ceil(board.stock.length / COLUMNS);

    const stock = el('button', {
      class:
        `stock${rounds === 0 ? ' is-empty' : ''}` +
        `${state.hint?.kind === 'deal' ? ' is-hinted' : ''}`,
      type: 'button',
      'data-tap': 'stock',
      'aria-label': rounds > 0 ? `Deal a row — ${rounds} left` : 'The stock is spent',
    });
    for (let i = 0; i < rounds; i++) {
      const back = el('span', { class: 'deal-back', 'aria-hidden': 'true' });
      back.style.left = `${i * 7}px`;
      stock.append(back);
    }

    const done = el('div', { class: 'sets', 'aria-label': `${board.completed} of ${SETS} sets` });
    for (let i = 0; i < SETS; i++) {
      done.append(el('span', { class: `set${i < board.completed ? ' is-done' : ''}` }));
    }

    this.reserveEl.replaceChildren(stock, done);
  }

  /* ------------------------------------------------------------- tableau */

  private drawTableau(state: GameState, board: Spider, held: Set<number> | null): void {
    const fan = this.fanFor(board);
    const columns: HTMLElement[] = [];

    for (let index = 0; index < COLUMNS; index++) {
      const pile = board.columns[index] as Column;
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
          state.selection?.from === index && position >= pile.cards.length - state.selection.count;
        const isHintSource =
          !state.selection &&
          state.hint?.kind === 'move' &&
          state.hint.from === index &&
          position === pile.cards.length - state.hint.count;

        const node = faceDown
          ? el('div', { class: 'card card--down', 'aria-hidden': 'true' })
          : this.cardFace(card, index, position, inHand, isHintSource);
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
   * Once the hinted run is in hand, the hint moves to where it is going.
   *
   * That is the whole loop the hint is for — light the cards, then light the
   * column — and it is also what lets anything driving the game by clicking
   * what is lit actually finish a level.
   */
  private hintTargetIsLit(state: GameState): boolean {
    const hint = state.hint;
    if (!hint || hint.kind !== 'move' || !state.selection) return false;
    return state.selection.from === hint.from && state.selection.count === hint.count;
  }

  /**
   * The tightest fan any column needs, so the longest one still fits.
   *
   * One spacing for the whole table rather than one per column: columns of
   * different pitches read as different objects, and the eye loses the row.
   */
  private fanFor(board: Spider): number {
    let worst = Number.POSITIVE_INFINITY;

    for (const column of board.columns) {
      const down = column.down;
      const up = Math.max(0, column.cards.length - down - 1);
      const steps = down * DOWN_RATIO + up;
      if (steps <= 0) continue;
      worst = Math.min(worst, (this.tableauHeight - this.cardHeight) / steps);
    }

    const preferred = this.cardHeight * PREFERRED_FAN;
    if (!Number.isFinite(worst)) return preferred;
    return Math.max(MIN_FAN, Math.min(preferred, worst));
  }

  /* --------------------------------------------------------------- cards */

  private cardFace(
    card: number,
    pile: number,
    index: number,
    held: boolean,
    hinted: boolean,
  ): HTMLElement {
    const node = el('button', {
      class: `card${held ? ' is-held' : ''}${hinted ? ' is-hinted' : ''}`,
      style: `color:${suitInk(suitOf(card), this.options.fourColor)}`,
      type: 'button',
      'data-tap': 'card',
      'data-pile': String(pile),
      'data-index': String(index),
      'aria-label': `${rankLabel(card)}${suitGlyph(card)}`,
    });
    node.append(
      el('span', { class: 'rank' }, `${rankLabel(card)}<i>${suitGlyph(card)}</i>`),
      el('span', { class: 'pip', 'aria-hidden': 'true' }, suitGlyph(card)),
    );
    return node;
  }

  /** A flourish on the finished sets when the last one lifts off. */
  celebrate(): void {
    if (this.options.reducedMotion) return;
    for (const set of this.reserveEl.querySelectorAll('.set')) {
      set.classList.remove('is-won');
      // Reading the layout is what makes the class re-trigger the animation.
      void (set as HTMLElement).offsetWidth;
      set.classList.add('is-won');
    }
  }
}

function readTarget(node: HTMLElement): Target | null {
  const kind = node.dataset.tap;
  if (kind === 'stock') return { kind: 'stock' };
  if (kind === 'card') {
    return { kind: 'pile', pile: Number(node.dataset.pile), index: Number(node.dataset.index) };
  }
  if (kind === 'pile') {
    // An empty column, or the strip below the last card in one. An index past
    // the end is what the controller reads as "the column itself".
    return { kind: 'pile', pile: Number(node.dataset.pile), index: -1 };
  }
  return null;
}
