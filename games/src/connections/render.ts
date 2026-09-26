/**
 * Connections renderer.
 *
 * Draws the board from a GameState and decides nothing. Four rows, always:
 * solved groups as coloured bars at the top in the order they were found, the
 * words still in play as a four-wide grid under them.
 *
 * The board is rebuilt on every state change — sixteen buttons is nothing —
 * and every piece of theatre is `element.animate()` on the fresh nodes rather
 * than a class plus a timer. Undo is unlimited, and a timer that commits
 * something visual is a race an undo can win.
 */

import { el } from '../shared/ui';
import type { GameState } from './game';
import { GROUP_SIZE, MAX_MISTAKES, type Group, indicesOf } from './model';

export interface RenderOptions {
  reducedMotion: boolean;
  onTile: (index: number) => void;
}

/** One shape per colour, for the colour-vision overlay. */
const SHAPES = ['●', '▲', '■', '◆'];

export function describeProgress(state: GameState): string {
  if (state.phase === 'loading' || !state.generated) return 'Preparing…';
  if (state.phase === 'won') return 'Solved';
  if (state.phase === 'lost') return 'Out of mistakes';
  const found = state.progress.solved.length;
  return `${found} of 4 groups`;
}

export class BoardRenderer {
  private readonly gridEl: HTMLElement;
  private readonly dotsEl: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    dotsRoot: HTMLElement,
    private options: RenderOptions,
  ) {
    this.gridEl = el('div', { class: 'cn-grid', role: 'grid', 'aria-label': 'Words' });
    this.root.append(this.gridEl);

    this.gridEl.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const tile = target.closest<HTMLElement>('.cn-tile');
      if (!tile || tile.dataset.index === undefined) return;
      this.options.onTile(Number(tile.dataset.index));
    });

    this.dotsEl = el('div', { class: 'cn-mistakes', 'aria-live': 'polite' });
    dotsRoot.append(this.dotsEl);
  }

  /** Tile width and row height, in px, from the fit in main.ts. */
  setSize(width: number, row: number): void {
    this.gridEl.style.setProperty('--tile-w', `${width}px`);
    this.gridEl.style.setProperty('--row', `${row}px`);
  }

  render(state: GameState): void {
    const generated = state.generated;
    if (!generated) {
      this.gridEl.dataset.empty = 'true';
      this.gridEl.innerHTML = '';
      this.renderDots(0);
      return;
    }
    delete this.gridEl.dataset.empty;
    this.gridEl.innerHTML = '';

    const { progress } = state;
    let newest: HTMLElement | null = null;

    // A lost puzzle shows every group, found or not, so the loss is worth
    // something: you see what you were up against.
    const shown = progress.solved.slice();
    if (state.phase === 'lost') {
      generated.groups.forEach((_group, index) => {
        if (!shown.includes(index)) shown.push(index);
      });
    }

    for (const [position, groupIndex] of shown.entries()) {
      const group = generated.groups[groupIndex] as Group;
      const bar = this.bar(state, group, !progress.solved.includes(groupIndex));
      this.gridEl.append(bar);
      if (position === progress.solved.length - 1) newest = bar;
    }

    if (state.phase !== 'lost') {
      for (const index of state.order) {
        if (!(progress.remaining & (1 << index))) continue;
        this.gridEl.append(this.tile(state, index));
      }
    }

    this.renderDots(MAX_MISTAKES - progress.mistakes);

    const { effect } = state;
    if (effect.kind === 'guess' && !this.options.reducedMotion) {
      if (effect.verdict.kind === 'correct' && newest) this.pop(newest);
      else if (effect.verdict.kind === 'wrong' || effect.verdict.kind === 'one-away') {
        this.shake(effect.mask);
      }
    }
  }

  private tile(state: GameState, index: number): HTMLElement {
    const word = state.generated?.words[index] ?? '';
    const selected = state.selected.has(index);
    const tile = el(
      'button',
      {
        class: 'cn-tile',
        type: 'button',
        role: 'gridcell',
        'data-index': String(index),
        'aria-pressed': String(selected),
      },
      word,
    );
    tile.style.setProperty('--len', String(Math.max(5, word.length)));
    // One class change at a time, cleared first: a stale `is-hinted` on a word
    // the hint has moved past would make the suggestion ambiguous.
    tile.classList.toggle('is-selected', selected);
    tile.classList.toggle('is-hinted', state.hinted.has(index) && !selected);
    return tile;
  }

  private bar(state: GameState, group: Group, revealed: boolean): HTMLElement {
    const words = indicesOf(group.mask)
      .map((index) => state.generated?.words[index] ?? '')
      .join(', ');
    const bar = el('div', {
      class: `cn-bar cn-bar--${group.color}${revealed ? ' is-revealed' : ''}`,
      role: 'row',
    });
    bar.append(
      el('span', { class: 'cn-shape', 'aria-hidden': 'true' }, SHAPES[group.color] ?? ''),
      el('b', { class: 'cn-bar-name' }, escapeHtml(group.name)),
      el('span', { class: 'cn-bar-words' }, escapeHtml(words)),
    );
    return bar;
  }

  private renderDots(left: number): void {
    const dots = Array.from(
      { length: MAX_MISTAKES },
      (_value, index) => `<i class="cn-dot${index < left ? '' : ' is-spent'}"></i>`,
    ).join('');
    this.dotsEl.innerHTML = `<span>Mistakes left</span>${dots}`;
    this.dotsEl.setAttribute('aria-label', `${left} mistakes left`);
  }

  /* ------------------------------------------------------------ theatre */

  private pop(bar: HTMLElement): void {
    bar.animate(
      [
        { transform: 'scale(0.9)', opacity: 0.4 },
        { transform: 'scale(1.03)', opacity: 1 },
        { transform: 'scale(1)' },
      ],
      { duration: 360, easing: 'ease-out' },
    );
  }

  private shake(mask: number): void {
    for (const index of indicesOf(mask)) {
      const tile = this.gridEl.querySelector<HTMLElement>(`.cn-tile[data-index="${index}"]`);
      tile?.animate(
        [
          { transform: 'translateX(0)' },
          { transform: 'translateX(-6px)' },
          { transform: 'translateX(6px)' },
          { transform: 'translateX(-3px)' },
          { transform: 'translateX(0)' },
        ],
        { duration: 320, easing: 'ease-in-out' },
      );
    }
  }

  /** A little lift down the last bar, on the win. */
  celebrate(): void {
    if (this.options.reducedMotion) return;
    this.gridEl.querySelectorAll<HTMLElement>('.cn-bar').forEach((bar, index) => {
      bar.animate(
        [{ transform: 'translateY(0)' }, { transform: 'translateY(-8px)' }, { transform: 'translateY(0)' }],
        { duration: 380, delay: 300 + index * 90, easing: 'ease-out' },
      );
    });
  }
}

export const TILES_PER_ROW = GROUP_SIZE;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}
