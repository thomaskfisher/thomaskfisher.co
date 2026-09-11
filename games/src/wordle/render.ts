/**
 * Wordle renderer.
 *
 * Draws the board and the keyboard from a GameState and decides nothing.
 *
 * The one thing worth explaining is the **flip**. A submitted row turns its
 * tiles over one at a time to reveal the colours, which is the piece of theatre
 * the whole game runs on — and it is done entirely with `element.animate()`
 * rather than a class plus a timer. Undo is unlimited here, so a `setTimeout`
 * that paints a colour is a race the player can win: they take the row back
 * inside its window and the timer colours a row that no longer exists.
 *
 * The colours are therefore applied *immediately* and the animation only hides
 * them for a moment. Getting that the other way round is what makes a reverted
 * row keep its colours forever.
 */

import { el } from '../shared/ui';
import type { GameState } from './game';
import { ALPHABET, Mark, type Row } from './model';

export interface RenderOptions {
  reducedMotion: boolean;
  onKey: (key: string) => void;
}

/** The three rows of a phone keyboard, with the two action keys in place. */
const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', '↵zxcvbnm⌫'] as const;

export function describeProgress(state: GameState): string {
  if (state.phase === 'loading' || !state.generated) return 'Preparing…';
  if (state.phase === 'won') return 'Got it';
  if (state.phase === 'lost') return state.outOfTime ? 'Out of time' : 'Out of rows';

  const rows = state.rowsLeft;
  return `${state.generated.length} letters · ${rows} ${rows === 1 ? 'row' : 'rows'} left`;
}

export class BoardRenderer {
  private options: RenderOptions;

  private readonly gridEl: HTMLElement;
  private readonly padEl: HTMLElement;
  private readonly keys = new Map<string, HTMLElement>();

  private cells: HTMLElement[][] = [];
  private signature = '';
  /** Rows whose flip has already played, so a re-render does not replay it. */
  private revealed = new Set<number>();

  constructor(
    private readonly root: HTMLElement,
    padRoot: HTMLElement,
    options: RenderOptions,
  ) {
    this.options = options;

    this.gridEl = el('div', { class: 'wd-grid', role: 'grid', 'aria-label': 'Guesses' });
    this.root.append(this.gridEl);

    this.padEl = el('div', { class: 'wd-pad' });
    padRoot.append(this.padEl);
    this.buildKeyboard();
  }

  setOptions(patch: Partial<RenderOptions>): void {
    this.options = { ...this.options, ...patch };
  }

  setCell(size: number): void {
    this.gridEl.style.setProperty('--cell', `${size}px`);
  }

  render(state: GameState): void {
    const generated = state.generated;
    if (!generated) {
      this.gridEl.dataset.empty = 'true';
      return;
    }
    delete this.gridEl.dataset.empty;

    const signature = `${state.level}:${generated.length}x${generated.tries}`;
    if (signature !== this.signature) {
      this.build(generated.length, generated.tries);
      this.signature = signature;
      this.revealed.clear();
    }

    // A reset — undo, restart, a level arriving — means whatever was on screen
    // is no longer what happened, so the flip bookkeeping starts again from the
    // rows that are actually on the board.
    if (state.effect.kind === 'reset') {
      this.revealed = new Set(state.rows.map((_row, index) => index));
    }

    for (let row = 0; row < generated.tries; row++) {
      const cells = this.cells[row] as HTMLElement[];
      const submitted = state.rows[row] as Row | undefined;
      const isDraftRow = row === state.rows.length;

      for (let column = 0; column < generated.length; column++) {
        const cell = cells[column] as HTMLElement;

        if (submitted) {
          cell.textContent = (submitted.word[column] as string).toUpperCase();
          this.paint(cell, submitted.marks[column] as Mark);
          cell.classList.remove('is-typed');
        } else if (isDraftRow) {
          const letter = state.draft[column];
          cell.textContent = letter ? letter.toUpperCase() : '';
          this.paint(cell, null);
          cell.classList.toggle('is-typed', Boolean(letter));
        } else {
          cell.textContent = '';
          this.paint(cell, null);
          cell.classList.remove('is-typed');
        }
      }

      if (submitted && !this.revealed.has(row)) {
        this.revealed.add(row);
        this.flip(cells);
      }
    }

    for (const letter of ALPHABET) {
      const key = this.keys.get(letter);
      if (!key) continue;
      this.paint(key, state.keys.get(letter) ?? null);
    }

    this.padEl.classList.toggle('is-over', state.phase !== 'playing');

    if (state.effect.kind === 'reject') this.shake(state.rows.length);
  }

  /** Sets the colour classes from one mark, clearing the others first. */
  private paint(node: HTMLElement, mark: Mark | null): void {
    node.classList.toggle('is-correct', mark === Mark.Correct);
    node.classList.toggle('is-present', mark === Mark.Present);
    node.classList.toggle('is-absent', mark === Mark.Absent);
  }

  /* ---------------------------------------------------------------- build */

  private build(length: number, tries: number): void {
    this.gridEl.innerHTML = '';
    this.gridEl.style.setProperty('--cols', String(length));
    this.cells = [];

    for (let row = 0; row < tries; row++) {
      const rowEl = el('div', { class: 'wd-row', role: 'row' });
      const cells: HTMLElement[] = [];

      for (let column = 0; column < length; column++) {
        const cell = el('div', { class: 'wd-cell', role: 'gridcell' });
        cells.push(cell);
        rowEl.append(cell);
      }

      this.cells.push(cells);
      this.gridEl.append(rowEl);
    }
  }

  private buildKeyboard(): void {
    for (const row of KEY_ROWS) {
      const rowEl = el('div', { class: 'wd-keyrow' });

      for (const key of row) {
        const wide = key === '↵' || key === '⌫';
        const node = el('button', {
          class: `wd-key${wide ? ' wd-key--wide' : ''}`,
          type: 'button',
          'aria-label': key === '↵' ? 'Enter' : key === '⌫' ? 'Backspace' : key,
        }, key === '↵' ? 'Enter' : key === '⌫' ? BACKSPACE_ICON : key.toUpperCase());

        node.addEventListener('click', () => {
          this.options.onKey(key === '↵' ? 'Enter' : key === '⌫' ? 'Backspace' : key);
        });

        if (!wide) this.keys.set(key, node);
        rowEl.append(node);
      }

      this.padEl.append(rowEl);
    }
  }

  /* ------------------------------------------------------------ theatre */

  /**
   * Turns a row over, one tile at a time.
   *
   * The colours are already on the tiles before this runs — all the animation
   * does is scale each one to nothing and back, so the change appears to happen
   * at the midpoint. That ordering is the important part: if the animation were
   * responsible for *applying* the colour, an undo mid-flip would leave a row
   * that is gone still painting itself.
   */
  private flip(cells: readonly HTMLElement[]): void {
    if (this.options.reducedMotion) return;

    cells.forEach((cell, index) => {
      cell.animate(
        [
          { transform: 'rotateX(0deg)' },
          { transform: 'rotateX(90deg)' },
          { transform: 'rotateX(0deg)' },
        ],
        { duration: 320, delay: index * 110, easing: 'ease-in-out' },
      );
    });
  }

  private shake(row: number): void {
    if (this.options.reducedMotion) return;
    const cells = this.cells[row];
    if (!cells) return;

    for (const cell of cells) {
      cell.animate(
        [
          { transform: 'translateX(0)' },
          { transform: 'translateX(-5px)' },
          { transform: 'translateX(5px)' },
          { transform: 'translateX(0)' },
        ],
        { duration: 240, easing: 'ease-in-out' },
      );
    }
  }

  /** A bounce down the winning row. */
  celebrate(row: number): void {
    if (this.options.reducedMotion) return;
    const cells = this.cells[row];
    if (!cells) return;

    cells.forEach((cell, index) => {
      cell.animate(
        [
          { transform: 'translateY(0)' },
          { transform: 'translateY(-16px)' },
          { transform: 'translateY(0)' },
        ],
        { duration: 420, delay: 600 + index * 90, easing: 'ease-out' },
      );
    });
  }
}

const BACKSPACE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 5H9l-6 7 6 7h12z"/>' +
  '<path d="M13.5 9.5l5 5M18.5 9.5l-5 5"/></svg>';
