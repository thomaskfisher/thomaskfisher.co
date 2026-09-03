/**
 * Survival renderer.
 *
 * Draws the lane, the squad, and the horde, and nothing else — it reads a
 * GameState and never decides anything.
 *
 * Two rules it keeps deliberately:
 *
 *  - **No deferred DOM mutation.** Every flash is a `element.animate()` that
 *    returns the element to its base style on its own, rather than a class plus
 *    a `setTimeout` to remove it. Undo is unlimited here, so any timer that
 *    commits something visual is a race the player can win: they revert the
 *    state inside its window and the timer then fires against a position that
 *    no longer exists. An animation that mutates nothing cannot strand anything.
 *
 *  - **The squad's position is a pure function of the route.** It is a transform
 *    on one absolutely positioned chip, so undo, restart and a fresh level all
 *    move it correctly without any of them needing to know it exists.
 */

import { glyphSvg } from '../shared/palette';
import { el } from '../shared/ui';
import type { GameState } from './game';
import { type Board, type Node, nodeAt } from './model';

export interface RenderOptions {
  showGlyphs: boolean;
  reducedMotion: boolean;
  onTapCell: (row: number, lane: number) => void;
}

/** Palette slots, so the shape overlay matches the rest of the collection. */
const PAINT: Record<string, number> = {
  add: 2, // green
  mul: 1, // blue
  sub: 5, // orange
  div: 4, // purple
  barrier: 12, // slate
};

export const formatCount = (value: number): string => value.toLocaleString('en-US');

/** `x3`, `+1,240`, `-90`, `/2` — the operator carries the meaning, not the colour. */
export function nodeLabel(node: Node): string {
  if (node.kind === 'barrier') return formatCount(node.hp);
  const symbol = { add: '+', mul: '×', sub: '−', div: '÷' }[node.op];
  return `${symbol}${formatCount(node.value)}`;
}

function nodeKey(node: Node): string {
  return node.kind === 'barrier' ? 'barrier' : node.op;
}

function describeNode(node: Node): string {
  if (node.kind === 'barrier') return `Barrier, ${formatCount(node.hp)} strong`;
  const word = { add: 'plus', mul: 'times', sub: 'minus', div: 'divided by' }[node.op];
  return `Gate, ${word} ${formatCount(node.value)}`;
}

export function describeProgress(state: GameState): string {
  if (state.phase === 'loading' || !state.generated) return 'Preparing…';
  const { rows } = state.generated.board;
  if (state.phase === 'won') return 'Broke through';
  if (state.phase === 'lost') {
    return state.lossCause === 'overrun' ? 'Not enough of you' : 'Squad wiped out';
  }
  return `Row ${state.route.length + 1} of ${rows}`;
}

export class BoardRenderer {
  private options: RenderOptions;
  private readonly hordeEl: HTMLElement;
  private readonly gridEl: HTMLElement;
  private readonly squadEl: HTMLElement;
  private cells: HTMLButtonElement[] = [];

  /** Identifies the board currently built, so a redraw only rebuilds when it must. */
  private signature = '';
  /** Suppresses the squad's move transition for the frame a board is built in. */
  private freshBoard = true;

  constructor(private readonly root: HTMLElement, options: RenderOptions) {
    this.options = options;

    this.hordeEl = el('div', { class: 'horde', 'aria-live': 'polite' });
    this.gridEl = el('div', { class: 'grid' });
    this.squadEl = el('div', { class: 'squad', 'aria-hidden': 'true' });

    const field = el('div', { class: 'lane-view' });
    field.append(this.hordeEl, this.gridEl);
    this.gridEl.append(this.squadEl);
    this.root.append(field);
  }

  setOptions(patch: Partial<RenderOptions>): void {
    this.options = { ...this.options, ...patch };
  }

  render(state: GameState): void {
    const board = state.generated?.board;
    if (!board) {
      this.gridEl.dataset.empty = 'true';
      return;
    }
    delete this.gridEl.dataset.empty;

    const signature = `${state.level}:${board.rows}x${board.lanes}:${board.horde}:${this.options.showGlyphs}`;
    if (signature !== this.signature) {
      this.build(board);
      this.signature = signature;
      this.freshBoard = true;
    }

    this.paintHorde(state, board);
    this.paintCells(state, board);
    this.placeSquad(state, board);
  }

  /* ---------------------------------------------------------------- build */

  private build(board: Board): void {
    for (const cell of this.cells) cell.remove();
    this.cells = [];

    this.gridEl.style.setProperty('--lanes', String(board.lanes));
    this.gridEl.style.setProperty('--rows', String(board.rows));

    for (let row = 0; row < board.rows; row++) {
      for (let lane = 0; lane < board.lanes; lane++) {
        const node = nodeAt(board, row, lane);
        const key = nodeKey(node);
        const label = nodeLabel(node);

        // The numbers inflate on purpose, so the label has to give ground
        // rather than the lane. Bucketed by length so the type size steps down
        // predictably instead of every cell picking its own.
        const width = label.length > 7 ? ' cell--xwide' : label.length > 5 ? ' cell--wide' : '';

        const cell = el('button', {
          class: `cell cell--${key}${width}`,
          type: 'button',
          // Rows are drawn far-to-near, so row 0 sits at the bottom of the grid.
          style: `grid-row:${board.rows - row};grid-column:${lane + 1}`,
          'data-row': String(row),
          'data-lane': String(lane),
          'aria-label': `Row ${row + 1}, lane ${lane + 1}. ${describeNode(node)}`,
        }) as HTMLButtonElement;

        cell.innerHTML =
          `<span class="cell-face">${
            this.options.showGlyphs ? glyphSvg(PAINT[key] ?? 0, 'cell-glyph') : ''
          }<span class="cell-label">${label}</span></span>` +
          '<span class="cell-tally" aria-hidden="true"></span>';

        cell.addEventListener('click', () => this.options.onTapCell(row, lane));
        this.gridEl.append(cell);
        this.cells.push(cell);
      }
    }

    // The start line is where the squad stands before it has entered anything.
    const start = el('div', { class: 'startline', 'aria-hidden': 'true' });
    start.style.gridRow = String(board.rows + 1);
    start.style.gridColumn = '1 / -1';
    this.gridEl.append(start);
    this.cells.push(start as unknown as HTMLButtonElement);
  }

  private cellFor(board: Board, row: number, lane: number): HTMLElement | null {
    return this.cells[row * board.lanes + lane] ?? null;
  }

  /* ---------------------------------------------------------------- paint */

  private paintHorde(state: GameState, board: Board): void {
    const short = Math.max(0, board.horde + 1 - state.count);
    this.hordeEl.innerHTML =
      `<span class="horde-count">${formatCount(board.horde)}</span>` +
      `<span class="horde-label">${
        state.phase === 'won'
          ? 'broken through'
          : short > 0
            ? `${formatCount(short)} more needed`
            : 'you outnumber them'
      }</span>`;
    this.hordeEl.classList.toggle('is-outnumbered', short === 0);
  }

  private paintCells(state: GameState, board: Board): void {
    const legal = new Set(state.legal);
    const nextRow = state.route.length;

    for (let row = 0; row < board.rows; row++) {
      for (let lane = 0; lane < board.lanes; lane++) {
        const cell = this.cellFor(board, row, lane);
        if (!cell) continue;

        const taken = row < state.route.length && state.route[row] === lane;
        const reachable = row === nextRow && legal.has(lane);

        // Every transient class is cleared before the new one goes on. A
        // lingering highlight on two cells at once makes a hint ambiguous, and
        // quietly breaks anything driving the game by clicking what is lit.
        cell.classList.remove('is-hinted');
        cell.classList.toggle('is-taken', taken);
        cell.classList.toggle('is-reachable', reachable);
        // The lanes of the next row that reach has put out of the question.
        // Dimming only these keeps the rest of the board fully legible, which
        // it has to be — looking further up it is the entire game.
        cell.classList.toggle('is-blocked', row === nextRow && !legal.has(lane) && state.phase === 'playing');
        cell.classList.toggle('is-spent', row < state.route.length && !taken);
        (cell as HTMLButtonElement).disabled =
          state.phase !== 'playing' || (!reachable && row >= state.route.length);

        // The trail of running totals along the route, minus the cell the
        // squad is standing on — the chip there already says that number, and
        // printing it twice on one gate just reads as a mistake.
        const tally = cell.querySelector('.cell-tally');
        if (tally) {
          const isCurrent = row === state.route.length - 1;
          tally.textContent = taken && !isCurrent ? formatCount(state.counts[row] ?? 0) : '';
        }
      }
    }
  }

  /**
   * Puts the squad where the route says it is.
   *
   * Read off the target cell's own box rather than computed from the grid
   * template, so it stays correct whatever the fit logic did to the cell size.
   */
  private placeSquad(state: GameState, board: Board): void {
    const target =
      state.route.length === 0
        ? (this.cells[this.cells.length - 1] as HTMLElement | undefined)
        : this.cellFor(board, state.route.length - 1, state.route[state.route.length - 1] as number);

    if (!target) return;

    const x = target.offsetLeft + target.offsetWidth / 2;
    const y = target.offsetTop + target.offsetHeight / 2;

    if (this.freshBoard || this.options.reducedMotion) {
      this.squadEl.classList.add('is-placing');
      // Force the style to land before transitions are allowed again, so a new
      // board does not animate the squad in from wherever the last one left it.
      this.squadEl.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      void this.squadEl.offsetWidth;
      this.squadEl.classList.remove('is-placing');
      this.freshBoard = false;
    } else {
      this.squadEl.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    }

    this.squadEl.textContent = formatCount(state.count);
    this.squadEl.classList.toggle('is-dead', state.phase === 'lost' && state.count <= 0);
    this.squadEl.classList.toggle('is-won', state.phase === 'won');
  }

  /* ------------------------------------------------------------- effects */

  /** Marks the suggested cell. Cleared by the next paint, like every highlight. */
  showHint(board: Board, row: number, lane: number): void {
    for (const cell of this.cells) cell.classList.remove('is-hinted');
    const cell = this.cellFor(board, row, lane);
    if (!cell) return;
    cell.classList.add('is-hinted');
    this.pulse(cell, 1.06);
  }

  /** A tap that could not be taken. Nothing is committed, so nothing can strand. */
  showReject(board: Board, row: number, lane: number): void {
    const cell = this.cellFor(board, row, lane);
    if (!cell || this.options.reducedMotion) return;
    cell.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-4px)' },
        { transform: 'translateX(4px)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 220, easing: 'ease-in-out' },
    );
  }

  /** The gate the squad just ran through. */
  showAdvance(board: Board, row: number, lane: number): void {
    const cell = this.cellFor(board, row, lane);
    if (!cell || this.options.reducedMotion) return;
    this.pulse(cell, 1.1);
    this.squadEl.animate(
      [{ filter: 'brightness(1)' }, { filter: 'brightness(1.9)' }, { filter: 'brightness(1)' }],
      { duration: 280, easing: 'ease-out' },
    );
  }

  celebrate(): void {
    if (this.options.reducedMotion) return;
    this.squadEl.animate(
      [
        { transform: `${this.squadEl.style.transform} scale(1)` },
        { transform: `${this.squadEl.style.transform} scale(1.35)` },
        { transform: `${this.squadEl.style.transform} scale(1)` },
      ],
      { duration: 520, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' },
    );
  }

  private pulse(element: HTMLElement, scale: number): void {
    if (this.options.reducedMotion) return;
    element.animate(
      [{ transform: 'scale(1)' }, { transform: `scale(${scale})` }, { transform: 'scale(1)' }],
      { duration: 260, easing: 'ease-out' },
    );
  }
}
