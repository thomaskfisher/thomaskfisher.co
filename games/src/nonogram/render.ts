/**
 * Nonogram renderer.
 *
 * Draws the clue gutters and the grid from a GameState and decides nothing —
 * except which cells a drag covers, which is a property of the gesture rather
 * than of the game.
 *
 * **Drag painting is the whole input scheme, and it is constrained to one
 * axis.** Every nonogram worth playing on a phone does this: the first two cells
 * of a drag fix whether it is a row stroke or a column stroke, and it stays on
 * that line until the finger comes up. Free-form dragging feels precise for
 * about four cells and then paints a diagonal smear through work you had
 * already done, on a grid where one wrong cell poisons everything downstream.
 *
 * The usual rules apply: every class is recomputed from the state on each
 * render, nothing is committed on a timer, and the board carries its own
 * stacking context.
 */

import { el } from '../shared/ui';
import type { GameState } from './game';
import { Mark, type Puzzle } from './model';

export interface RenderOptions {
  reducedMotion: boolean;
  /** Commit a stroke: the cells covered, and the mark to write. */
  onPaint: (cells: number[], mark: Mark) => void;
  /** What a tap on this cell would write, given the brush and what is there. */
  markFor: (cell: number) => Mark;
}

export function describeProgress(state: GameState): string {
  if (state.phase === 'loading' || !state.generated) return 'Preparing…';
  if (state.phase === 'won') return 'Complete';

  const size = state.generated.puzzle.width;
  if (state.mistakes > 0) return `${size}×${size} · ${state.mistakes} wrong`;
  return `${size}×${size} · ${state.remaining} left`;
}

interface Stroke {
  pointer: number;
  mark: Mark;
  origin: number;
  /** Fixed by the second cell the drag reaches. */
  axis: 'row' | 'col' | null;
  painted: Set<number>;
}

export class BoardRenderer {
  private options: RenderOptions;

  private readonly frameEl: HTMLElement;
  private readonly cornerEl: HTMLElement;
  private readonly colCluesEl: HTMLElement;
  private readonly rowCluesEl: HTMLElement;
  private readonly gridEl: HTMLElement;

  private cells: HTMLElement[] = [];
  private colClueEls: HTMLElement[] = [];
  private rowClueEls: HTMLElement[] = [];

  private signature = '';
  private stroke: Stroke | null = null;

  constructor(
    private readonly root: HTMLElement,
    options: RenderOptions,
  ) {
    this.options = options;

    this.frameEl = el('div', { class: 'nono' });
    this.cornerEl = el('div', { class: 'nono-corner', 'aria-hidden': 'true' });
    this.colCluesEl = el('div', { class: 'nono-cols', 'aria-hidden': 'true' });
    this.rowCluesEl = el('div', { class: 'nono-rows', 'aria-hidden': 'true' });
    this.gridEl = el('div', { class: 'nono-grid', role: 'grid', 'aria-label': 'The picture' });

    this.frameEl.append(this.cornerEl, this.colCluesEl, this.rowCluesEl, this.gridEl);
    this.root.append(this.frameEl);

    this.bindStrokes();
  }

  setOptions(patch: Partial<RenderOptions>): void {
    this.options = { ...this.options, ...patch };
  }

  setCell(size: number): void {
    this.frameEl.style.setProperty('--cell', `${size}px`);
  }

  render(state: GameState): void {
    const generated = state.generated;
    if (!generated) {
      this.frameEl.dataset.empty = 'true';
      return;
    }
    delete this.frameEl.dataset.empty;

    const { puzzle } = generated;
    const signature = `${state.level}:${puzzle.width}x${puzzle.height}`;
    if (signature !== this.signature) {
      this.build(puzzle);
      this.signature = signature;
      this.stroke = null;
    }

    const hinted = state.effect.kind === 'hint' ? state.effect.cell : -1;
    const hintMark = state.effect.kind === 'hint' ? state.effect.mark : Mark.Blank;
    const mistake = state.effect.kind === 'mistake' ? state.effect.cell : -1;
    const litRow =
      state.effect.kind === 'hint' && state.effect.line.kind === 'row'
        ? state.effect.line.index
        : -1;
    const litCol =
      state.effect.kind === 'hint' && state.effect.line.kind === 'col'
        ? state.effect.line.index
        : -1;

    for (let cell = 0; cell < this.cells.length; cell++) {
      const node = this.cells[cell] as HTMLElement;
      const mark = state.board[cell] as Mark;

      node.classList.toggle('is-filled', mark === Mark.Filled);
      node.classList.toggle('is-cross', mark === Mark.Cross);
      node.classList.toggle('is-hinted', cell === hinted);
      node.classList.toggle('is-mistake', cell === mistake);

      /*
       * What the hint is asking for, previewed in the cell.
       *
       * A ring alone was the first version and it is not a hint: half of every
       * nonogram's deductions are "this one is empty", so a ring with no mark in
       * it is as likely to be painted as crossed — and a hint the player acts on
       * wrongly is worse than none. The ghost states which, the brush switch
       * beside it makes acting on it one tap, and this is also the one thing an
       * automated playthrough can read.
       */
      if (cell === hinted && hintMark !== Mark.Blank) {
        node.dataset.hint = hintMark === Mark.Filled ? 'fill' : 'cross';
      } else {
        delete node.dataset.hint;
      }
    }

    for (let y = 0; y < puzzle.height; y++) {
      const node = this.rowClueEls[y] as HTMLElement;
      node.classList.toggle('is-done', state.done.rows.has(y));
      node.classList.toggle('is-lit', y === litRow);
    }
    for (let x = 0; x < puzzle.width; x++) {
      const node = this.colClueEls[x] as HTMLElement;
      node.classList.toggle('is-done', state.done.cols.has(x));
      node.classList.toggle('is-lit', x === litCol);
    }

    this.frameEl.classList.toggle('is-over', state.phase !== 'playing');

    if (state.effect.kind === 'mistake') this.shake(this.cells[mistake]);
  }

  /* ---------------------------------------------------------------- build */

  private build(puzzle: Puzzle): void {
    this.frameEl.style.setProperty('--cols', String(puzzle.width));
    this.frameEl.style.setProperty('--rows', String(puzzle.height));

    this.colCluesEl.innerHTML = '';
    this.rowCluesEl.innerHTML = '';
    this.gridEl.innerHTML = '';
    this.cells = [];
    this.colClueEls = [];
    this.rowClueEls = [];

    // The gutters are sized from the longest clue list, so a puzzle with one
    // four-number row does not give every row four numbers' worth of margin.
    const widestRow = Math.max(1, ...puzzle.rowClues.map((clues) => clues.length));
    const tallestCol = Math.max(1, ...puzzle.colClues.map((clues) => clues.length));
    this.frameEl.style.setProperty('--row-clues', String(widestRow));
    this.frameEl.style.setProperty('--col-clues', String(tallestCol));

    for (let x = 0; x < puzzle.width; x++) {
      const node = el('div', { class: 'nono-clue nono-clue--col' });
      // An empty line still gets a `0`, because a blank gutter reads as a
      // rendering fault rather than as information.
      const clues = puzzle.colClues[x] as number[];
      node.innerHTML = (clues.length ? clues : [0]).map((run) => `<i>${run}</i>`).join('');
      if (x % 5 === 4 && x !== puzzle.width - 1) node.classList.add('edge-right');
      this.colClueEls.push(node);
      this.colCluesEl.append(node);
    }

    for (let y = 0; y < puzzle.height; y++) {
      const node = el('div', { class: 'nono-clue nono-clue--row' });
      const clues = puzzle.rowClues[y] as number[];
      node.innerHTML = (clues.length ? clues : [0]).map((run) => `<i>${run}</i>`).join('');
      if (y % 5 === 4 && y !== puzzle.height - 1) node.classList.add('edge-bottom');
      this.rowClueEls.push(node);
      this.rowCluesEl.append(node);
    }

    for (let y = 0; y < puzzle.height; y++) {
      for (let x = 0; x < puzzle.width; x++) {
        const index = y * puzzle.width + x;
        const node = el('div', {
          class: 'nc',
          role: 'gridcell',
          'data-cell': String(index),
          'aria-label': `Row ${y + 1}, column ${x + 1}`,
        });
        // Every fifth line is heavier, which is what makes a 15-wide row
        // countable without a finger on the screen.
        if (x % 5 === 4 && x !== puzzle.width - 1) node.classList.add('edge-right');
        if (y % 5 === 4 && y !== puzzle.height - 1) node.classList.add('edge-bottom');
        this.cells.push(node);
        this.gridEl.append(node);
      }
    }
  }

  /* -------------------------------------------------------------- strokes */

  private cellAt(x: number, y: number): number | null {
    const node = document.elementFromPoint(x, y)?.closest('.nc');
    if (!(node instanceof HTMLElement)) return null;
    const index = Number(node.dataset.cell);
    return Number.isInteger(index) ? index : null;
  }

  private bindStrokes(): void {
    this.gridEl.addEventListener('pointerdown', (event) => {
      if (this.frameEl.classList.contains('is-over')) return;

      const cell = this.cellAt(event.clientX, event.clientY);
      if (cell === null) return;

      event.preventDefault();
      this.gridEl.setPointerCapture(event.pointerId);

      const mark = this.options.markFor(cell);
      this.stroke = { pointer: event.pointerId, mark, origin: cell, axis: null, painted: new Set() };
      this.extend(cell);
    });

    this.gridEl.addEventListener('pointermove', (event) => {
      const stroke = this.stroke;
      if (!stroke || stroke.pointer !== event.pointerId) return;

      const cell = this.cellAt(event.clientX, event.clientY);
      if (cell === null) return;
      this.extend(cell);
    });

    const end = (event: PointerEvent): void => {
      if (this.stroke?.pointer !== event.pointerId) return;
      this.stroke = null;
    };

    this.gridEl.addEventListener('pointerup', end);
    this.gridEl.addEventListener('pointercancel', end);
  }

  /**
   * Adds a cell to the stroke in progress, locking the axis on the way.
   *
   * Painting happens one cell at a time rather than as a run at the end, so the
   * board keeps up with the finger. The `painted` set is what stops a jittery
   * finger re-sending the same cell forty times — each one would otherwise be a
   * move in the undo list.
   */
  private extend(cell: number): void {
    const stroke = this.stroke;
    if (!stroke || stroke.painted.has(cell)) return;

    const width = Number(this.frameEl.style.getPropertyValue('--cols')) || 1;

    if (cell !== stroke.origin && stroke.axis === null) {
      const sameRow = Math.floor(cell / width) === Math.floor(stroke.origin / width);
      stroke.axis = sameRow ? 'row' : 'col';
    }

    if (stroke.axis === 'row' && Math.floor(cell / width) !== Math.floor(stroke.origin / width)) {
      return;
    }
    if (stroke.axis === 'col' && cell % width !== stroke.origin % width) return;

    stroke.painted.add(cell);
    this.options.onPaint([cell], stroke.mark);
  }

  private shake(node: HTMLElement | undefined): void {
    if (this.options.reducedMotion) return;
    node?.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-4px)' },
        { transform: 'translateX(4px)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 220, easing: 'ease-in-out' },
    );
  }

  /** A sweep across the finished picture. */
  celebrate(): void {
    if (this.options.reducedMotion) return;
    const width = Number(this.frameEl.style.getPropertyValue('--cols')) || 1;
    for (let cell = 0; cell < this.cells.length; cell++) {
      const x = cell % width;
      const y = Math.floor(cell / width);
      this.cells[cell]?.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
        { duration: 380, delay: (x + y) * 22, easing: 'ease-in-out' },
      );
    }
  }
}
