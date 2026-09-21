/**
 * Battleship renderer.
 *
 * Draws the fleet list, the count gutters and the sea from a GameState and
 * decides nothing — except which squares a drag covers, which is a property of
 * the gesture rather than of the game.
 *
 * **A ship square is drawn as the piece it has to be, given its neighbours.**
 * Two ship squares side by side join up; a run closed off by water at one end
 * gets a rounded bow there; a lone square with water on all four sides becomes
 * a round single. A ship square whose shape is still open is a plain rounded
 * block. That is the feedback a paper grid cannot give, and it answers the
 * question a player keeps asking — "is this one finished?" — without a count.
 *
 * Input is Nonogram's: pick a brush, tap or drag, and a drag locks to the row
 * or column its first two squares set. Water is the mark placed in long runs,
 * which is where the drag earns its keep.
 *
 * The usual rules apply: every class is recomputed from the state on each
 * render, nothing is committed on a timer, and the board carries its own
 * stacking context.
 */

import { el } from '../shared/ui';
import type { GameState } from './game';
import { type Board, Mark, type Puzzle, Segment, sides } from './model';

export interface RenderOptions {
  reducedMotion: boolean;
  /** Commit a stroke: the squares covered, and the mark to write. */
  onPaint: (cells: number[], mark: Mark) => void;
  /** What a tap on this square would write, given the brush and what is there. */
  markFor: (cell: number) => Mark;
}

export function describeProgress(state: GameState): string {
  if (state.phase === 'loading' || !state.generated) return 'Preparing…';
  if (state.phase === 'won') return 'Complete';

  const size = state.generated.puzzle.size;
  if (state.mistakes > 0) return `${size}×${size} · ${state.mistakes} wrong`;
  return `${size}×${size} · ${state.remaining} left`;
}

/**
 * The shape to draw a ship square as, from what surrounds it on the board.
 *
 * `closed` is water or the edge. A ship with ship on one side draws a bow on
 * the other only once that side is closed; until then it could still grow
 * that way, and a bow would be a claim the player has not made.
 */
export type Shape = 'single' | 'up' | 'down' | 'left' | 'right' | 'mid-v' | 'mid-h' | 'open';

export function shapeOf(board: Board, size: number, cell: number): Shape {
  const [up, down, left, right] = sides(size, cell);
  const ship = (c: number): boolean => c >= 0 && board[c] === Mark.Ship;
  const closed = (c: number): boolean => c < 0 || board[c] === Mark.Water;

  const u = ship(up);
  const d = ship(down);
  const l = ship(left);
  const r = ship(right);

  if (u && d) return 'mid-v';
  if (l && r) return 'mid-h';
  if (u) return closed(down) ? 'up' : 'mid-v';
  if (d) return closed(up) ? 'down' : 'mid-v';
  if (l) return closed(right) ? 'left' : 'mid-h';
  if (r) return closed(left) ? 'right' : 'mid-h';
  if (closed(up) && closed(down) && closed(left) && closed(right)) return 'single';
  return 'open';
}

/** A given's own shape, which is fixed by the answer rather than the board. */
function givenShape(segment: Segment, board: Board, size: number, cell: number): Shape {
  switch (segment) {
    case Segment.Single:
      return 'single';
    case Segment.Up:
      return 'up';
    case Segment.Down:
      return 'down';
    case Segment.Left:
      return 'left';
    case Segment.Right:
      return 'right';
    default: {
      // A middle piece says nothing about its axis. Borrow it from the board
      // once the player has shown it, and stay a plain block until then.
      const [up, down, left, right] = sides(size, cell);
      const ship = (c: number): boolean => c >= 0 && board[c] === Mark.Ship;
      const water = (c: number): boolean => c < 0 || board[c] === Mark.Water;
      if (ship(up) || ship(down) || water(left) || water(right)) return 'mid-v';
      if (ship(left) || ship(right) || water(up) || water(down)) return 'mid-h';
      return 'open';
    }
  }
}

/** A ship of `length` drawn as a row of pieces, for the fleet list. */
function fleetShip(length: number): string {
  if (length === 1) return '<i data-shape="single"></i>';
  let out = '<i data-shape="right"></i>';
  for (let i = 1; i < length - 1; i++) out += '<i data-shape="mid-h"></i>';
  return out + '<i data-shape="left"></i>';
}

interface Stroke {
  pointer: number;
  mark: Mark;
  origin: number;
  /** Fixed by the second square the drag reaches. */
  axis: 'row' | 'col' | null;
  painted: Set<number>;
}

export class BoardRenderer {
  private options: RenderOptions;

  private readonly fleetEl: HTMLElement;
  private readonly frameEl: HTMLElement;
  private readonly colCountsEl: HTMLElement;
  private readonly rowCountsEl: HTMLElement;
  private readonly gridEl: HTMLElement;

  private cells: HTMLElement[] = [];
  private colCountEls: HTMLElement[] = [];
  private rowCountEls: HTMLElement[] = [];
  private shipEls: { length: number; node: HTMLElement }[] = [];

  private signature = '';
  private size = 1;
  private stroke: Stroke | null = null;

  constructor(
    private readonly root: HTMLElement,
    options: RenderOptions,
  ) {
    this.options = options;

    this.fleetEl = el('div', { class: 'fleet', 'aria-label': 'The fleet' });
    this.frameEl = el('div', { class: 'sea' });
    const corner = el('div', { class: 'sea-corner', 'aria-hidden': 'true' });
    this.colCountsEl = el('div', { class: 'sea-cols', 'aria-hidden': 'true' });
    this.rowCountsEl = el('div', { class: 'sea-rows', 'aria-hidden': 'true' });
    this.gridEl = el('div', { class: 'sea-grid', role: 'grid', 'aria-label': 'The sea' });

    this.frameEl.append(corner, this.colCountsEl, this.rowCountsEl, this.gridEl);
    this.root.append(this.fleetEl, this.frameEl);

    this.bindStrokes();
  }

  setCell(size: number): void {
    this.frameEl.style.setProperty('--cell', `${size}px`);
  }

  /** The fleet list's height, which the fit has to leave room for. */
  get fleetHeight(): number {
    return this.fleetEl.offsetHeight;
  }

  render(state: GameState): void {
    const generated = state.generated;
    if (!generated) {
      this.frameEl.dataset.empty = 'true';
      this.fleetEl.dataset.empty = 'true';
      return;
    }
    delete this.frameEl.dataset.empty;
    delete this.fleetEl.dataset.empty;

    const { puzzle } = generated;
    const signature = `${state.level}:${puzzle.size}`;
    if (signature !== this.signature) {
      this.build(puzzle);
      this.signature = signature;
      this.stroke = null;
    }

    const { size } = puzzle;
    const givenAt = new Map(puzzle.givens.map((given) => [given.cell, given]));

    const hinted = state.effect.kind === 'hint' ? state.effect.cell : -1;
    const hintMark = state.effect.kind === 'hint' ? state.effect.mark : Mark.Blank;
    const mistake = state.effect.kind === 'mistake' ? state.effect.cell : -1;
    const line = state.effect.kind === 'hint' ? state.effect.line : undefined;

    for (let cell = 0; cell < this.cells.length; cell++) {
      const node = this.cells[cell] as HTMLElement;
      const mark = state.board[cell] as Mark;
      const given = givenAt.get(cell);

      node.classList.toggle('is-ship', mark === Mark.Ship);
      node.classList.toggle('is-water', mark === Mark.Water);
      node.classList.toggle('is-given', given !== undefined);
      node.classList.toggle('is-hinted', cell === hinted);
      node.classList.toggle('is-mistake', cell === mistake);

      if (mark === Mark.Ship) {
        node.dataset.shape =
          given && given.kind !== 'water'
            ? givenShape(given.kind, state.board, size, cell)
            : shapeOf(state.board, size, cell);
      } else {
        delete node.dataset.shape;
      }

      /*
       * What the hint is asking for, previewed in the square — Nonogram's ghost.
       * Half of all deductions here are "this is water", and a ring alone does
       * not say which; the ghost does, and it is also the one thing an
       * automated playthrough can read.
       */
      if (cell === hinted && hintMark !== Mark.Blank) {
        node.dataset.hint = hintMark === Mark.Ship ? 'ship' : 'water';
      } else {
        delete node.dataset.hint;
      }
    }

    for (let i = 0; i < size; i++) {
      this.paintCount(
        this.rowCountEls[i] as HTMLElement,
        state.marked.rows[i] ?? 0,
        puzzle.rowCounts[i] as number,
        line?.kind === 'row' && line.index === i,
      );
      this.paintCount(
        this.colCountEls[i] as HTMLElement,
        state.marked.cols[i] ?? 0,
        puzzle.colCounts[i] as number,
        line?.kind === 'col' && line.index === i,
      );
    }

    // Tick off finished ships, longest first, as many of each length as the
    // board shows closed off. More than the fleet holds is the player's
    // mistake to find, not something the list should announce.
    const found = new Map<number, number>();
    for (const length of state.finished) found.set(length, (found.get(length) ?? 0) + 1);
    for (const { length, node } of this.shipEls) {
      const left = found.get(length) ?? 0;
      node.classList.toggle('is-found', left > 0);
      if (left > 0) found.set(length, left - 1);
    }

    this.frameEl.classList.toggle('is-over', state.phase !== 'playing');

    if (state.effect.kind === 'mistake') this.shake(this.cells[mistake]);
  }

  private paintCount(node: HTMLElement, marked: number, wanted: number, lit: boolean): void {
    node.classList.toggle('is-done', marked === wanted);
    node.classList.toggle('is-over', marked > wanted);
    node.classList.toggle('is-lit', lit);
  }

  /* ---------------------------------------------------------------- build */

  private build(puzzle: Puzzle): void {
    const { size } = puzzle;
    this.size = size;
    this.frameEl.style.setProperty('--size', String(size));

    this.fleetEl.innerHTML = '';
    this.shipEls = [];
    for (const length of puzzle.fleet) {
      const node = el('span', { class: 'fleet-ship' }, fleetShip(length));
      this.shipEls.push({ length, node });
      this.fleetEl.append(node);
    }

    this.colCountsEl.innerHTML = '';
    this.rowCountsEl.innerHTML = '';
    this.gridEl.innerHTML = '';
    this.cells = [];
    this.colCountEls = [];
    this.rowCountEls = [];

    for (let i = 0; i < size; i++) {
      const col = el('div', { class: 'sea-count' }, String(puzzle.colCounts[i]));
      this.colCountEls.push(col);
      this.colCountsEl.append(col);
      const row = el('div', { class: 'sea-count' }, String(puzzle.rowCounts[i]));
      this.rowCountEls.push(row);
      this.rowCountsEl.append(row);
    }

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const index = y * size + x;
        const node = el('div', {
          class: 'bc',
          role: 'gridcell',
          'data-cell': String(index),
          'aria-label': `Row ${y + 1}, column ${x + 1}`,
        });
        this.cells.push(node);
        this.gridEl.append(node);
      }
    }
  }

  /* -------------------------------------------------------------- strokes */

  private cellAt(x: number, y: number): number | null {
    const node = document.elementFromPoint(x, y)?.closest('.bc');
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
   * Adds a square to the stroke in progress, locking the axis on the way. The
   * `painted` set stops a jittery finger re-sending one square forty times,
   * each of which would otherwise be a move in the undo list.
   */
  private extend(cell: number): void {
    const stroke = this.stroke;
    if (!stroke || stroke.painted.has(cell)) return;

    const size = this.size;
    const sameRow = Math.floor(cell / size) === Math.floor(stroke.origin / size);

    if (cell !== stroke.origin && stroke.axis === null) {
      stroke.axis = sameRow ? 'row' : 'col';
    }
    if (stroke.axis === 'row' && !sameRow) return;
    if (stroke.axis === 'col' && cell % size !== stroke.origin % size) return;

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

  /** A ripple across the finished sea. */
  celebrate(): void {
    if (this.options.reducedMotion) return;
    const size = this.size;
    for (let cell = 0; cell < this.cells.length; cell++) {
      const node = this.cells[cell];
      if (!node?.classList.contains('is-ship')) continue;
      const x = cell % size;
      const y = Math.floor(cell / size);
      node.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.14)' }, { transform: 'scale(1)' }],
        { duration: 380, delay: (x + y) * 26, easing: 'ease-in-out' },
      );
    }
  }
}
