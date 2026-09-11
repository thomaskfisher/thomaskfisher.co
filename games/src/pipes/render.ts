/**
 * Pipes renderer.
 *
 * Draws the grid from a GameState and decides nothing.
 *
 * **The one piece of state it owns is a spin counter per tile, and it is there
 * for a reason worth stating.** A tile's shape is drawn once, from the mask the
 * level opened on, and every turn after that is a CSS `rotate` — so the pipe
 * visibly spins instead of snapping to a new picture. But an angle derived from
 * the *current* mask would go 270° → 0° on the fourth turn and the tile would
 * whip backwards three quarters of a turn. So the counter only ever climbs, and
 * it is rebuilt from the board on a reset, undo or new level.
 *
 * That counter is also the only thing here that could drift, which is why it is
 * recomputed from `turnsTo` on every rebuild rather than trusted.
 */

import { el } from '../shared/ui';
import type { GameState } from './game';
import { SIDES, type Tiles, popcount, turnsTo } from './model';

export interface RenderOptions {
  reducedMotion: boolean;
  onTurn: (cell: number) => void;
}

export function describeProgress(state: GameState): string {
  if (state.phase === 'loading' || !state.generated) return 'Preparing…';
  if (state.phase === 'won') return 'Flowing';

  const total = state.generated.board.solution.length;
  return `${state.wetTiles}/${total} wet · ${state.leaks} dripping`;
}

export class BoardRenderer {
  private options: RenderOptions;

  private readonly gridEl: HTMLElement;
  private cells: HTMLElement[] = [];
  private pipes: HTMLElement[] = [];
  /** Quarter turns applied to each tile since the level opened. Climbs only. */
  private spin: number[] = [];
  private base: Tiles = [];

  private signature = '';

  constructor(
    private readonly root: HTMLElement,
    options: RenderOptions,
  ) {
    this.options = options;

    this.gridEl = el('div', { class: 'pipe-grid', role: 'grid', 'aria-label': 'The pipework' });
    this.root.append(this.gridEl);
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

    const { board } = generated;
    const signature = `${state.level}:${board.width}x${board.height}`;
    if (signature !== this.signature) {
      this.build(state);
      this.signature = signature;
    }

    // A reset — undo, restart, a level arriving — is the one time the spin
    // counters can be out of step with the board, so they are rebuilt from it
    // rather than adjusted.
    if (state.effect.kind === 'reset') this.resync(state);
    if (state.effect.kind === 'turn') {
      this.spin[state.effect.cell] = (this.spin[state.effect.cell] as number) + 1;
    }

    const hinted = state.effect.kind === 'hint' ? state.effect.cell : -1;

    for (let cell = 0; cell < this.cells.length; cell++) {
      const node = this.cells[cell] as HTMLElement;
      const pipe = this.pipes[cell] as HTMLElement;

      pipe.style.setProperty('--spin', `${(this.spin[cell] as number) * 90}deg`);

      node.classList.toggle('is-wet', state.wet[cell] === true);
      node.classList.toggle('is-hinted', cell === hinted);
    }

    this.gridEl.classList.toggle('is-over', state.phase !== 'playing');
  }

  /* ---------------------------------------------------------------- build */

  private build(state: GameState): void {
    const generated = state.generated;
    if (!generated) return;
    const { board } = generated;

    this.gridEl.innerHTML = '';
    this.cells = [];
    this.pipes = [];
    this.base = generated.start.slice();
    this.spin = new Array<number>(board.solution.length).fill(0);

    this.gridEl.style.setProperty('--cols', String(board.width));
    this.gridEl.style.setProperty('--rows', String(board.height));

    for (let cell = 0; cell < board.solution.length; cell++) {
      const mask = this.base[cell] as number;
      const stubs = popcount(mask);

      const node = el('button', {
        class: 'pipe-cell',
        type: 'button',
        'data-cell': String(cell),
        'aria-label': `Turn tile ${cell + 1}`,
      });

      if (cell === board.source) node.classList.add('is-source');
      // A tile with one stub is an end of the run — a tap. Marked so it can
      // light up when the water gets there, which is the payoff of the level.
      if (stubs === 1 && cell !== board.source) node.classList.add('is-tap');

      const pipe = el('span', { class: 'pipe' }, pipeSvg(mask, cell === board.source, stubs === 1));
      node.append(pipe);

      node.addEventListener('click', () => this.options.onTurn(cell));

      this.cells.push(node);
      this.pipes.push(pipe);
      this.gridEl.append(node);
    }
  }

  /** Recomputes each tile's angle from the board, for undo, restart and reload. */
  private resync(state: GameState): void {
    for (let cell = 0; cell < this.cells.length; cell++) {
      this.spin[cell] = turnsTo(this.base[cell] as number, state.tiles[cell] as number);
    }
  }

  /** A quiet pulse through the finished network. */
  celebrate(): void {
    if (this.options.reducedMotion) return;
    const width = Number(this.gridEl.style.getPropertyValue('--cols')) || 1;

    for (let cell = 0; cell < this.cells.length; cell++) {
      const x = cell % width;
      const y = Math.floor(cell / width);
      this.cells[cell]?.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.1)' }, { transform: 'scale(1)' }],
        { duration: 400, delay: (x + y) * 26, easing: 'ease-in-out' },
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

/** Where each side's stub ends, in the 0-100 tile box. */
const ENDS: readonly (readonly [number, number])[] = [
  [50, 0],
  [100, 50],
  [50, 100],
  [0, 50],
];

/**
 * One tile's pipework, as a stub from the middle to each side it has.
 *
 * Drawn once per tile and then only rotated, so this runs `width * height`
 * times per level rather than on every tap.
 */
function pipeSvg(mask: number, isSource: boolean, isTap: boolean): string {
  let body = '';

  for (let sideIndex = 0; sideIndex < 4; sideIndex++) {
    const side = SIDES[sideIndex] as number;
    if (!(mask & side)) continue;
    const [x, y] = ENDS[sideIndex] as readonly [number, number];
    body += `<path class="pipe-line" d="M50 50 L${x} ${y}" />`;
  }

  if (isSource) {
    // The well. Bigger than the hub and drawn over it, so the eye lands on
    // where the water is coming from before anything else on the board.
    body +=
      '<circle class="pipe-hub" cx="50" cy="50" r="26" />' +
      '<circle class="pipe-source" cx="50" cy="50" r="15" />';
  } else if (isTap) {
    body += '<rect class="pipe-hub" x="32" y="32" width="36" height="36" rx="9" />';
  } else {
    body += '<circle class="pipe-hub" cx="50" cy="50" r="15" />';
  }

  return `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">${body}</svg>`;
}
