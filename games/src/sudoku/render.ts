/**
 * Sudoku renderer.
 *
 * Draws the grid and the keypad from a GameState and decides nothing. Three
 * rules it keeps deliberately, all learned elsewhere in this collection:
 *
 *  - **No deferred DOM mutation.** Every flash is an `element.animate()` that
 *    returns the element to its base style on its own, rather than a class plus
 *    a `setTimeout` to take it off again. Undo is unlimited here, so any timer
 *    that commits something visual is a race the player can win.
 *
 *  - **Every class is recomputed from the state on every render.** Nothing is
 *    toggled incrementally, so a lingering `is-hinted` on two cells at once
 *    cannot happen — which is both a real ambiguity for the player and the thing
 *    that quietly breaks an automated playthrough.
 *
 *  - **The grid is its own stacking context.** Nothing here derives a z-index
 *    from game state, so there is currently nothing for `isolation` to contain;
 *    it is written in with the container anyway, because the property being
 *    protected is "no z-index in this game comes from the board" and a stacking
 *    context is what keeps that cheap to be wrong about later.
 */

import { el } from '../shared/ui';
import type { GameState } from './game';
import { BOX, CELLS, SIZE, boxOf, colOf, digitsOf, rowOf } from './model';

export interface RenderOptions {
  reducedMotion: boolean;
  onSelect: (cell: number) => void;
  onDigit: (digit: number) => void;
  onErase: () => void;
  onPencil: (on: boolean) => void;
}

export function describeProgress(state: GameState): string {
  if (state.phase === 'loading' || !state.generated) return 'Preparing…';
  if (state.phase === 'won') return 'Solved';

  const wrong = state.conflicts.size;
  if (wrong > 0) return `${state.remaining} left · ${wrong} clashing`;
  return `${state.remaining} left`;
}

export class BoardRenderer {
  private options: RenderOptions;

  private readonly gridEl: HTMLElement;
  private readonly padEl: HTMLElement;
  private readonly cells: HTMLButtonElement[] = [];
  private readonly digitKeys: HTMLButtonElement[] = [];
  private readonly pencilKey: HTMLButtonElement;
  private readonly eraseKey: HTMLButtonElement;

  private latest: GameState | null = null;

  constructor(
    private readonly root: HTMLElement,
    padRoot: HTMLElement,
    options: RenderOptions,
  ) {
    this.options = options;

    this.gridEl = el('div', { class: 'sudoku-grid', role: 'grid', 'aria-label': 'Sudoku grid' });
    this.root.append(this.gridEl);

    for (let cell = 0; cell < CELLS; cell++) {
      const square = el('button', {
        class: 'sq',
        type: 'button',
        role: 'gridcell',
        'data-cell': String(cell),
      }) as HTMLButtonElement;

      // The box rules are drawn as borders on the cells rather than as an
      // overlay, so the heavy lines never sit on top of a selection highlight.
      if (colOf(cell) % BOX === 0 && colOf(cell) !== 0) square.classList.add('edge-left');
      if (rowOf(cell) % BOX === 0 && rowOf(cell) !== 0) square.classList.add('edge-top');

      square.append(el('span', { class: 'sq-digit' }));
      square.append(el('span', { class: 'sq-ghost', 'aria-hidden': 'true' }));
      square.append(el('span', { class: 'sq-notes', 'aria-hidden': 'true' }));

      square.addEventListener('click', () => this.options.onSelect(cell));
      this.cells.push(square);
      this.gridEl.append(square);
    }

    /* ------------------------------------------------------------ keypad */

    this.padEl = el('div', { class: 'keypad' });
    padRoot.append(this.padEl);

    for (let digit = 1; digit <= SIZE; digit++) {
      const key = el('button', {
        class: 'key',
        type: 'button',
        'aria-label': `Enter ${digit}`,
      }) as HTMLButtonElement;
      key.append(el('span', { class: 'key-digit' }, String(digit)));
      key.append(el('span', { class: 'key-left' }));
      key.addEventListener('click', () => this.options.onDigit(digit));
      this.digitKeys.push(key);
      this.padEl.append(key);
    }

    this.pencilKey = el(
      'button',
      { class: 'key key--mode', type: 'button', 'aria-pressed': 'false' },
      `${PENCIL_ICON}<span>Notes</span>`,
    ) as HTMLButtonElement;
    this.pencilKey.addEventListener('click', () => {
      this.options.onPencil(!(this.latest?.pencilMode ?? false));
    });

    this.eraseKey = el(
      'button',
      { class: 'key key--mode', type: 'button', 'aria-label': 'Erase' },
      `${ERASE_ICON}<span>Erase</span>`,
    ) as HTMLButtonElement;
    this.eraseKey.addEventListener('click', () => this.options.onErase());

    this.padEl.append(this.pencilKey, this.eraseKey);
  }

  setOptions(patch: Partial<RenderOptions>): void {
    this.options = { ...this.options, ...patch };
  }

  /** Cell size in px, set by the fit pass before each render. */
  setCell(cell: number): void {
    this.gridEl.style.setProperty('--cell', `${cell}px`);
  }

  render(state: GameState): void {
    const previous = this.latest;
    this.latest = state;

    if (!state.generated) {
      this.gridEl.dataset.empty = 'true';
      return;
    }
    delete this.gridEl.dataset.empty;

    const { givens } = state.generated;
    const selected = state.selected;
    const selectedDigit = selected === null ? 0 : (state.sheet.grid[selected] as number);

    const hinted = state.effect.kind === 'hint' ? state.effect.cell : -1;
    const hintDigit = state.effect.kind === 'hint' ? state.effect.digit : 0;
    const because = state.effect.kind === 'hint' ? new Set(state.effect.because) : EMPTY;
    const mistake = state.effect.kind === 'mistake' ? state.effect.cell : -1;

    for (let cell = 0; cell < CELLS; cell++) {
      const square = this.cells[cell] as HTMLButtonElement;
      const digit = state.sheet.grid[cell] as number;
      const given = (givens[cell] as number) !== 0;

      const digitEl = square.children[0] as HTMLElement;
      const ghostEl = square.children[1] as HTMLElement;
      const notesEl = square.children[2] as HTMLElement;

      digitEl.textContent = digit ? String(digit) : '';

      /*
       * The digit the hint is offering, shown faintly in the cell it belongs in.
       *
       * Lighting the cell without naming the digit was the first version, and it
       * is not a hint — it is a smaller puzzle. Every other game here hands over
       * the actual move. The player still has to press the key, which keeps the
       * hint a suggestion rather than a button that plays the level.
       *
       * Also the one thing an automated playthrough can read, which is how this
       * game gets verified end to end.
       */
      if (cell === hinted && hintDigit) {
        ghostEl.textContent = String(hintDigit);
        square.dataset.hint = String(hintDigit);
      } else {
        ghostEl.textContent = '';
        delete square.dataset.hint;
      }

      // Notes only draw on an empty cell; a note under an answer is noise.
      const notes = digit ? 0 : (state.sheet.notes[cell] as number);
      const signature = String(notes);
      if (notesEl.dataset.notes !== signature) {
        notesEl.dataset.notes = signature;
        notesEl.innerHTML = notes
          ? digitsOf(notes)
              .map((note) => `<i style="grid-area:${noteArea(note)}">${note}</i>`)
              .join('')
          : '';
      }

      square.classList.toggle('is-given', given);
      square.classList.toggle('is-selected', cell === selected);
      square.classList.toggle('is-peer', selected !== null && cell !== selected && sees(cell, selected));
      square.classList.toggle(
        'is-same',
        selectedDigit !== 0 && digit === selectedDigit && cell !== selected,
      );
      square.classList.toggle('is-conflict', state.conflicts.has(cell));
      square.classList.toggle('is-hinted', cell === hinted);
      square.classList.toggle('is-because', because.has(cell));
      square.classList.toggle('is-mistake', cell === mistake);

      square.setAttribute(
        'aria-label',
        `Row ${rowOf(cell) + 1}, column ${colOf(cell) + 1}${digit ? `, ${digit}` : ', empty'}`,
      );
    }

    for (let digit = 1; digit <= SIZE; digit++) {
      const key = this.digitKeys[digit - 1] as HTMLButtonElement;
      const done = state.finishedDigits.has(digit);
      key.classList.toggle('is-done', done);
      // Never disabled: a finished digit still has to be removable from a cell
      // it was wrongly put in, and a dead key is how that becomes impossible.
      (key.lastElementChild as HTMLElement).textContent = done ? '' : String(9 - countOf(state, digit));
    }

    this.pencilKey.classList.toggle('is-on', state.pencilMode);
    this.pencilKey.setAttribute('aria-pressed', String(state.pencilMode));

    const playable = state.phase === 'playing';
    for (const key of this.digitKeys) key.disabled = !playable;
    this.eraseKey.disabled = !playable;
    this.pencilKey.disabled = !playable;

    this.playEffect(state, previous);
  }

  /* --------------------------------------------------------------- flash */

  private playEffect(state: GameState, previous: GameState | null): void {
    // Nothing to animate on the frame a level arrives, and animating 81 cells
    // at once would be a light show rather than feedback.
    if (state.effect.kind === 'reset' || state.effect === previous?.effect) return;
    if (this.options.reducedMotion) return;

    const { effect } = state;
    if (effect.kind === 'write') {
      const square = this.cells[effect.cell];
      square?.animate(
        [{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
        { duration: 160, easing: 'ease-out' },
      );
    } else if (effect.kind === 'reject') {
      this.shake(this.cells[effect.cell]);
    } else if (effect.kind === 'mistake') {
      this.shake(this.cells[effect.cell]);
    }
  }

  private shake(square: HTMLElement | undefined): void {
    square?.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-4px)' },
        { transform: 'translateX(4px)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 220, easing: 'ease-in-out' },
    );
  }

  /** A quiet sweep down the grid when it comes out. */
  celebrate(): void {
    if (this.options.reducedMotion) return;
    for (let cell = 0; cell < CELLS; cell++) {
      this.cells[cell]?.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.1)' }, { transform: 'scale(1)' }],
        { duration: 420, delay: (rowOf(cell) + colOf(cell)) * 26, easing: 'ease-in-out' },
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const EMPTY: ReadonlySet<number> = new Set<number>();

/** Do two cells share a row, column or box? Used only for the soft highlight. */
function sees(a: number, b: number): boolean {
  return rowOf(a) === rowOf(b) || colOf(a) === colOf(b) || boxOf(a) === boxOf(b);
}

/** Where note `digit` sits in the cell's little 3x3. */
function noteArea(digit: number): string {
  const index = digit - 1;
  return `${Math.floor(index / 3) + 1} / ${(index % 3) + 1}`;
}

function countOf(state: GameState, digit: number): number {
  let count = 0;
  for (let cell = 0; cell < CELLS; cell++) if (state.sheet.grid[cell] === digit) count++;
  return count;
}

const PENCIL_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16z"/>' +
  '<path d="M13.5 6.5l4 4"/></svg>';

const ERASE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 19h11"/>' +
  '<path d="M15.5 4.5l4 4a2 2 0 0 1 0 2.8l-7.2 7.2H7.4l-3-3a2 2 0 0 1 0-2.8l8.3-8.2a2 2 0 0 1 2.8 0z"/></svg>';
