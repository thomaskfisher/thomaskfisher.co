/**
 * Marble Sort rendering.
 *
 * Everything sits in one absolutely positioned layer sized by `fit()`: pipes
 * across the top, the funnel under them, the belt, and the columns of blocks
 * hanging below the belt's bottom straight. Positions are computed here rather
 * than left to flex layout because the belt's slots and the columns' drop points
 * have to line up to the pixel, and only one piece of code can own that.
 *
 * **Motion comes from CSS, not from a frame loop.** Each belt cell is one
 * element for the whole level. A tick moves every element's transform to its
 * next slot, and a linear transition the length of a tick carries it there, so
 * the belt glides while the page does nothing between ticks but wait on the
 * clock. The belt turns for as long as the level is played; when the clock
 * stops — a sheet, a hidden tab, a win or a loss — so do the chevrons, whose
 * animation follows `is-running`.
 *
 * **Every deferred effect is decoration.** A marble flying into its hole, a
 * cleared block lifting away, a handful falling from a pipe — each is a
 * throwaway element animated with WAAPI and removed when it finishes. None of
 * them commits anything, so an undo landing mid-flight cannot be raced: the
 * board underneath is already drawn from the state the undo produced, and the
 * ghost finishes over it and disappears. `rebuild` removes any still in flight.
 */

import { glyphSvg, paint } from '../shared/palette';
import { el } from '../shared/ui';
import type { GameState } from './game';
import { TICK_MS } from './game';
import { CURVE_SLOTS, type Level, type Sim, type TickEvents, geometryFor, handfuls, pipeCounts, slotOf } from './model';

export interface RenderOptions {
  showGlyphs: boolean;
  reducedMotion: boolean;
  onTapPipe: (color: number) => void;
}

interface Point {
  x: number;
  y: number;
}

/** Measured once per size change; everything else is arithmetic on this. */
interface Layout {
  width: number;
  height: number;
  marble: number;
  slots: Point[];
  pipeTop: number;
  pipeHeight: number;
  pipeWidth: number;
  pipeXs: number[];
  funnelTop: number;
  funnelBottom: number;
  spout: Point;
  beltLeft: number;
  beltTop: number;
  beltWidth: number;
  beltHeight: number;
  columnTop: number;
  columnXs: number[];
  columnWidth: number;
  blockHeight: number;
  blockGap: number;
}

const BLOCK_GAP = 5;
const FLY_MS = 150;
const CLEAR_MS = 220;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export class MarbleRenderer {
  private options: RenderOptions;
  private layout: Layout | null = null;
  /** Which level the DOM was built for; a different one forces a rebuild. */
  private builtFor: Level | null = null;

  private readonly pipesEl = el('div', { class: 'ms-pipes' });
  private readonly funnelEl = el('div', { class: 'ms-funnel', 'aria-hidden': 'true' });
  private readonly pileEl = el('div', { class: 'ms-pile', 'aria-hidden': 'true' });
  private readonly beltEl = el('div', { class: 'ms-belt', 'aria-hidden': 'true' });
  private readonly railsEl = el('div', { class: 'ms-rails' });
  private readonly marblesEl = el('div', { class: 'ms-marbles' });
  private readonly columnsEl = el('div', { class: 'ms-columns', 'aria-label': 'Blocks' });
  private readonly fxEl = el('div', { class: 'ms-fx', 'aria-hidden': 'true' });

  private pipes: HTMLButtonElement[] = [];
  private marbles: HTMLElement[] = [];
  /** Colour each marble element is currently painted, so a repaint is rare. */
  private marbleColors: number[] = [];
  private columns: HTMLElement[] = [];
  private columnKeys: string[] = [];
  private pileKey = '';
  private pipeKeys: string[] = [];
  /** The fullest pipe's start, so every tube drains on the same scale. */
  private pipeScale = 1;
  private hinted = -1;

  constructor(
    private readonly root: HTMLElement,
    options: RenderOptions,
  ) {
    this.options = options;
    this.beltEl.append(this.railsEl, this.marblesEl);
    root.append(this.columnsEl, this.beltEl, this.funnelEl, this.pileEl, this.pipesEl, this.fxEl);
  }

  setOptions(patch: Partial<RenderOptions>): void {
    this.options = { ...this.options, ...patch };
    // Glyphs are baked into elements; forget what was painted so they repaint.
    this.marbleColors = this.marbleColors.map(() => -2);
    this.columnKeys = this.columnKeys.map(() => '');
    this.pileKey = '';
    this.builtFor = null;
  }

  /* ------------------------------------------------------------ layout */

  /**
   * Fits the whole machine to the board's box. Called on rebuild and on resize.
   *
   * The belt's radius is solved so that a slot on the curve is as far from its
   * neighbour as a slot on the straight — otherwise marbles bunch up at the
   * ends and the belt reads as two speeds.
   */
  private measure(level: Level): Layout | null {
    const width = this.root.clientWidth;
    const height = this.root.clientHeight;
    if (width <= 0 || height <= 0) return null;

    const straight = level.straightSlots;
    const beltWidth = Math.min(width - 16, 520);
    const beltLeft = (width - beltWidth) / 2;
    // The marbles ride a centre line inset half a marble (and a little) from
    // the belt's edge. Marble size depends on the slot spacing, which depends
    // on that inset, so it is solved twice — the second pass is exact enough.
    let marble = 30;
    let pad = 0;
    let radius = 0;
    let spacing = 0;
    for (let pass = 0; pass < 2; pass++) {
      pad = marble * 0.62;
      const line = beltWidth - 2 * pad;
      radius = (CURVE_SLOTS * line) / (Math.PI * straight + 2 * CURVE_SLOTS);
      spacing = (line - 2 * radius) / straight;
      marble = Math.min(spacing * 0.84, 34);
    }
    const beltHeight = 2 * (radius + pad);

    // Vertical budget, top to bottom. Pipes and the funnel give way first; the
    // columns need at least a few rows to be a puzzle rather than a guess.
    const columnsWanted = Math.max(height * 0.42, 190);
    const upper = Math.max(170, height - columnsWanted - beltHeight);
    const pipeHeight = clamp(upper * 0.5, 80, 150);
    const pipeTop = 4;
    const funnelTop = pipeTop + pipeHeight + 2;
    const beltTop = clamp(funnelTop + upper * 0.38, funnelTop + 50, height - beltHeight - 120);
    const funnelBottom = beltTop + marble * 0.2;

    const cy = beltTop + beltHeight / 2;
    const slots = slotPositions(straight, radius, spacing, beltLeft + pad + radius, cy);
    const geometry = geometryFor(level);

    const colors = level.colors;
    const pipeGap = 10;
    const pipeWidth = Math.min(64, (width - 24 - pipeGap * (colors - 1)) / colors);
    const pipeSpan = colors * pipeWidth + (colors - 1) * pipeGap;
    const pipeXs = Array.from(
      { length: colors },
      (_, i) => (width - pipeSpan) / 2 + i * (pipeWidth + pipeGap) + pipeWidth / 2,
    );

    // Columns hang under their drop slots. Width is whatever keeps neighbours
    // apart, and never wider than a column of three holes needs.
    const dropsX = geometry.drops.map((slot) => (slots[slot] as Point).x);
    let minGap = Number.POSITIVE_INFINITY;
    for (let i = 1; i < dropsX.length; i++) {
      minGap = Math.min(minGap, (dropsX[i] as number) - (dropsX[i - 1] as number));
    }
    if (!Number.isFinite(minGap)) minGap = beltWidth / 2;
    const columnWidth = Math.min(minGap - 6, marble * (level.blockSize + 0.9), 92);
    const blockHeight = Math.max(26, Math.min(columnWidth * 0.5, marble * 1.25));

    const entry = slots[geometry.entry] as Point;

    return {
      width,
      height,
      marble,
      slots,
      pipeTop,
      pipeHeight,
      pipeWidth,
      pipeXs,
      funnelTop,
      funnelBottom,
      spout: entry,
      beltLeft,
      beltTop,
      beltWidth,
      beltHeight,
      columnTop: beltTop + beltHeight + 6,
      columnXs: dropsX,
      columnWidth,
      blockHeight,
      blockGap: BLOCK_GAP,
    };
  }

  /** Re-measures without rebuilding, for a resize or rotation. */
  fit(state: GameState): void {
    this.builtFor = null;
    this.render(state);
  }

  /* ----------------------------------------------------------- render */

  render(state: GameState): void {
    const generated = state.generated;
    const sim = state.sim;
    if (!generated || !sim || state.phase === 'loading') {
      this.root.classList.add('is-loading');
      return;
    }
    this.root.classList.remove('is-loading');
    const level = generated.board;

    const rebuilt = this.builtFor !== level || state.effect.kind === 'reset';
    if (this.builtFor !== level) {
      this.layout = this.measure(level);
      if (!this.layout) return;
      this.build(level, this.layout);
      this.builtFor = level;
    }
    const layout = this.layout;
    if (!layout) return;

    if (state.effect.kind === 'drop' || state.effect.kind === 'reset') this.hinted = -1;
    if (state.effect.kind === 'hint') this.hinted = state.effect.color;

    this.renderPipes(level, sim, state);
    this.renderBelt(sim, layout, rebuilt, state);
    this.renderPile(sim, layout, state);
    this.renderColumns(level, sim, layout);

    if (!this.options.reducedMotion && !rebuilt) {
      if (state.effect.kind === 'tick') this.animateTick(level, sim, layout, state.effect.events);
      if (state.effect.kind === 'drop') this.animateDrop(state.effect.color, state.effect.count, layout);
    }

    this.root.classList.toggle('is-running', state.phase === 'playing');
    this.root.classList.toggle('is-lost', state.phase === 'lost');
  }

  private build(level: Level, layout: Layout): void {
    this.fxEl.replaceChildren();

    // Pipes.
    this.pipes = Array.from({ length: level.colors }, (_, color) => {
      const p = paint(color);
      const button = el('button', {
        class: 'ms-pipe',
        type: 'button',
        'data-pipe': String(color),
        style:
          `--c:${p.hex};--c-shade:${p.shade};left:${layout.pipeXs[color]! - layout.pipeWidth / 2}px;` +
          `top:${layout.pipeTop}px;width:${layout.pipeWidth}px;height:${layout.pipeHeight}px`,
      });
      button.innerHTML =
        '<span class="ms-pipe-tube"><span class="ms-pipe-load"></span></span>' +
        `<span class="ms-pipe-cap">${this.options.showGlyphs ? glyphSvg(color, 'glyph ms-glyph') : ''}` +
        '<span class="ms-pipe-total"></span></span>' +
        '<span class="ms-pipe-mouth"></span>';
      button.addEventListener('click', () => this.options.onTapPipe(color));
      return button;
    });
    this.pipesEl.replaceChildren(...this.pipes);
    this.pipeKeys = this.pipes.map(() => '');
    this.pipeScale = Math.max(1, ...pipeCounts(level));

    // Funnel: a wide mouth under the pipes narrowing to a spout over the entry
    // slot, which sits left of centre. Drawn as one SVG path.
    const mouthLeft = Math.max(8, (layout.pipeXs[0] ?? 0) - layout.pipeWidth / 2 - 8);
    const mouthRight = Math.min(
      layout.width - 8,
      (layout.pipeXs[level.colors - 1] ?? layout.width) + layout.pipeWidth / 2 + 8,
    );
    const neck = layout.marble * 0.75;
    const top = layout.funnelTop;
    const bottom = layout.funnelBottom;
    const throat = top + (bottom - top) * 0.62;
    const sx = layout.spout.x;
    this.funnelEl.innerHTML =
      `<svg width="${layout.width}" height="${bottom + 4}" viewBox="0 0 ${layout.width} ${bottom + 4}">` +
      `<path class="ms-funnel-body" d="M${mouthLeft} ${top} L${mouthRight} ${top} ` +
      `L${sx + neck} ${throat} L${sx + neck} ${bottom} L${sx - neck} ${bottom} L${sx - neck} ${throat} Z"/>` +
      '</svg>';

    // Belt.
    Object.assign(this.beltEl.style, {
      left: `${layout.beltLeft}px`,
      top: `${layout.beltTop}px`,
      width: `${layout.beltWidth}px`,
      height: `${layout.beltHeight}px`,
      borderRadius: `${layout.beltHeight / 2}px`,
    });
    this.beltEl.style.setProperty('--marble', `${layout.marble}px`);
    this.beltEl.style.setProperty('--tick', `${TICK_MS}ms`);
    this.root.style.setProperty('--marble', `${layout.marble}px`);

    this.marbles = layout.slots.map(() => {
      const marble = el('span', { class: 'ms-marble' });
      marble.append(el('i'));
      return marble;
    });
    this.marbleColors = this.marbles.map(() => -2);
    this.marblesEl.replaceChildren(...this.marbles);

    // Columns.
    this.columns = level.columns.map((_, c) => {
      const column = el('div', { class: 'ms-column', 'data-column': String(c) });
      Object.assign(column.style, {
        left: `${(layout.columnXs[c] as number) - layout.columnWidth / 2}px`,
        top: `${layout.columnTop}px`,
        width: `${layout.columnWidth}px`,
        bottom: '0px',
      });
      column.style.setProperty('--block-h', `${layout.blockHeight}px`);
      // Holes sized to the column.
      const hole = Math.min(layout.marble * 0.78, (layout.columnWidth * 0.84) / (level.blockSize * 1.22));
      column.style.setProperty('--hole', `${hole}px`);
      column.append(el('div', { class: 'ms-stack' }));
      return column;
    });
    this.columnKeys = this.columns.map(() => '');
    this.columnsEl.replaceChildren(...this.columns);
    this.pileKey = '';
  }

  private renderPipes(level: Level, sim: Sim, state: GameState): void {
    const playing = state.phase === 'playing';
    for (let color = 0; color < level.colors; color++) {
      const pipe = this.pipes[color];
      if (!pipe) continue;
      const left = sim.remaining[color] ?? 0;
      const bands = handfuls(left, level.dropSize);
      const key = bands.join('.');
      if (key !== this.pipeKeys[color]) {
        this.pipeKeys[color] = key;
        this.renderLoad(pipe, bands);
        (pipe.querySelector('.ms-pipe-total') as HTMLElement).textContent = String(left);
      }
      pipe.classList.toggle('is-empty', left === 0);
      pipe.disabled = !playing || left === 0;
      pipe.classList.toggle('is-hinted', this.hinted === color);
      pipe.setAttribute(
        'aria-label',
        left === 0 ? `${paint(color).name} pipe, empty` : `${paint(color).name} pipe, drops ${bands[0]}, ${left} left`,
      );
    }
  }

  /**
   * What is left in a pipe, drawn as the handfuls it will come out in: the next
   * one at the open end in full colour, later ones stacked above it. Heights
   * are shares of the fullest pipe, so a tube visibly drains — but never so
   * thin that a band's count no longer fits in it.
   */
  private renderLoad(pipe: HTMLButtonElement, bands: number[]): void {
    const load = pipe.querySelector('.ms-pipe-load') as HTMLElement;
    const gaps = (bands.length - 1) * 2;
    load.replaceChildren(
      ...bands.map((count, i) => {
        const band = el('span', { class: i === 0 ? 'ms-handful is-next' : 'ms-handful' });
        band.style.height = `calc((100% - ${gaps}px) * ${count / this.pipeScale})`;
        band.textContent = String(count);
        return band;
      }),
    );
  }

  private renderBelt(sim: Sim, layout: Layout, snap: boolean, state: GameState): void {
    const length = layout.slots.length;
    // A snap is any jump the belt did not travel — a rebuild, an undo, a
    // restart. Transitions are switched off for it, or every marble would
    // slide across the board to wherever the rewind put it.
    if (snap) this.marblesEl.classList.add('is-snapping');

    const entered = state.effect.kind === 'tick' ? state.effect.events.entered : -1;
    for (let cell = 0; cell < length; cell++) {
      const marble = this.marbles[cell];
      if (!marble) continue;
      const point = layout.slots[slotOf(sim, cell, length)] as Point;
      marble.style.transform = `translate(${point.x - layout.beltLeft}px, ${point.y - layout.beltTop}px)`;

      const color = sim.cells[cell] as number;
      if (color !== this.marbleColors[cell]) {
        this.marbleColors[cell] = color;
        if (color < 0) {
          marble.classList.remove('is-on');
        } else {
          const p = paint(color);
          marble.style.setProperty('--c', p.hex);
          marble.style.setProperty('--c-shade', p.shade);
          (marble.firstElementChild as HTMLElement).innerHTML = this.options.showGlyphs
            ? glyphSvg(color, 'glyph ms-glyph')
            : '';
          marble.classList.add('is-on');
        }
      }
      marble.classList.toggle('is-entering', cell === entered && !this.options.reducedMotion);
    }

    if (snap) {
      void this.marblesEl.offsetWidth; // commit the jump before transitions return
      this.marblesEl.classList.remove('is-snapping');
    }
  }

  /**
   * The funnel's queue, drawn as a pile: the next marble at the spout, rows
   * widening upward. Only as much as fits is drawn — past that the pile is
   * simply full, which is what a funnel looks like.
   */
  private renderPile(sim: Sim, layout: Layout, state: GameState): void {
    const key = sim.funnel.join('');
    if (key === this.pileKey) return;
    const grew = sim.funnel.length - this.pileKey.length;
    this.pileKey = key;

    const m = layout.marble * 0.92;
    const rowH = m * 0.86;
    const floor = layout.funnelBottom - m * 0.6;
    const maxRows = Math.max(1, Math.floor((floor - layout.funnelTop) / rowH));
    const mid = layout.width / 2;
    const items: HTMLElement[] = [];
    let index = 0;
    for (let row = 0; row < maxRows && index < sim.funnel.length; row++) {
      const across = Math.min(row + 1, Math.floor(layout.width / m) - 1);
      // Rows drift from the spout towards the middle of the mouth as they rise.
      const t = maxRows > 1 ? row / (maxRows - 1) : 0;
      const cx = layout.spout.x + (mid - layout.spout.x) * t;
      for (let i = 0; i < across && index < sim.funnel.length; i++, index++) {
        const color = sim.funnel[index] as number;
        const p = paint(color);
        const x = cx + (i - (across - 1) / 2) * m;
        const y = floor - row * rowH;
        const item = el('span', {
          class: 'ms-marble is-on is-static',
          style: `--c:${p.hex};--c-shade:${p.shade};transform:translate(${x - m / 2}px, ${y - m / 2}px);width:${m}px;height:${m}px`,
        });
        item.innerHTML = `<i>${this.options.showGlyphs ? glyphSvg(color, 'glyph ms-glyph') : ''}</i>`;
        if (state.effect.kind === 'drop' && grew > 0 && index >= sim.funnel.length - grew) {
          item.classList.add('is-falling');
        }
        items.push(item);
      }
    }
    this.pileEl.replaceChildren(...items);
  }

  private renderColumns(level: Level, sim: Sim, layout: Layout): void {
    for (let c = 0; c < level.columns.length; c++) {
      const column = this.columns[c];
      if (!column) continue;
      const blocks = level.columns[c] as number[];
      const depth = sim.depth[c] as number;
      const fill = sim.fill[c] as number;
      const key = `${depth}.${fill}.${this.options.showGlyphs ? 1 : 0}`;
      if (key === this.columnKeys[c]) continue;
      this.columnKeys[c] = key;

      const stack = column.firstElementChild as HTMLElement;
      // Only what can be seen: the column clips at the bottom of the board.
      const fits = Math.ceil((layout.height - layout.columnTop) / (layout.blockHeight + BLOCK_GAP)) + 1;
      const shown = blocks.slice(depth, depth + fits);
      stack.replaceChildren(
        ...shown.map((color, i) => this.block(level, color, i, i === 0 ? fill : 0)),
      );
      column.classList.toggle('is-done', depth >= blocks.length);
      column.setAttribute(
        'aria-label',
        depth >= blocks.length
          ? 'Column cleared'
          : `${paint(blocks[depth] as number).name} block, ${fill} of ${level.blockSize}`,
      );
    }
  }

  /** One block. `row` 0 is the open one; deeper ones may be hidden. */
  private block(level: Level, color: number, row: number, filled: number): HTMLElement {
    const hidden = row >= level.visibleRows;
    const p = paint(color);
    const block = el('div', {
      class: `ms-block${row === 0 ? ' is-top' : ''}${hidden ? ' is-hidden' : ''}`,
      style: hidden ? '' : `--c:${p.hex};--c-shade:${p.shade}`,
    });
    if (hidden) {
      block.innerHTML = '<span class="ms-unknown">?</span>';
      return block;
    }
    // With the shape overlay on, each empty hole shows the shape it wants —
    // no room is spent on a separate label, and it reads as the instruction.
    const want = this.options.showGlyphs ? glyphSvg(color, 'glyph ms-hole-glyph') : '';
    let holes = '';
    for (let h = 0; h < level.blockSize; h++) {
      holes +=
        h < filled ? '<span class="ms-hole is-filled"></span>' : `<span class="ms-hole">${want}</span>`;
    }
    block.innerHTML = `<span class="ms-holes">${holes}</span>`;
    return block;
  }

  /* --------------------------------------------------------- one-shots */

  private animateTick(level: Level, sim: Sim, layout: Layout, events: TickEvents): void {
    const length = layout.slots.length;
    for (const landing of events.landed) {
      // Where it was when it dropped: the slot over its column.
      const from = layout.slots[slotOf(sim, landing.cell, length)] as Point;
      const holeX =
        (layout.columnXs[landing.column] as number) +
        (landing.hole - (level.blockSize - 1) / 2) * (layout.columnWidth / level.blockSize);
      const holeY = layout.columnTop + layout.blockHeight / 2;
      this.ghostMarble(landing.color, from, { x: holeX, y: holeY }, layout.marble, FLY_MS);
    }

    for (const c of events.cleared) {
      const column = this.columns[c];
      const stack = column?.firstElementChild as HTMLElement | undefined;
      if (!column || !stack) continue;
      const blocks = level.columns[c] as number[];
      const color = blocks[(sim.depth[c] as number) - 1] as number;
      const ghost = this.block(level, color, 0, level.blockSize);
      ghost.classList.add('ms-clear-ghost');
      ghost.style.setProperty('--hole', column.style.getPropertyValue('--hole'));
      Object.assign(ghost.style, {
        left: column.style.left,
        top: `${layout.columnTop}px`,
        width: `${layout.columnWidth}px`,
        height: `${layout.blockHeight}px`,
      });
      this.fxEl.append(ghost);
      const pop = ghost.animate(
        [
          { transform: 'scale(1)', opacity: 1 },
          { transform: 'scale(1.12) translateY(-6px)', opacity: 0 },
        ],
        { duration: CLEAR_MS, easing: 'ease-out', fill: 'forwards' },
      );
      pop.finished.catch(() => undefined).finally(() => ghost.remove());

      stack.animate(
        [{ transform: `translateY(${layout.blockHeight + BLOCK_GAP}px)` }, { transform: 'none' }],
        { duration: CLEAR_MS, easing: 'cubic-bezier(0.3, 1.25, 0.5, 1)' },
      );
    }
  }

  /** A handful leaving the pipe for the funnel. Purely for the eye. */
  private animateDrop(color: number, count: number, layout: Layout): void {
    const x = layout.pipeXs[color];
    if (x === undefined) return;
    // Out of the open end, not from inside the glass.
    const from = { x, y: layout.pipeTop + layout.pipeHeight };
    const to = { x: (x + layout.spout.x) / 2, y: (layout.funnelTop + layout.funnelBottom) / 2 };
    // The whole handful falls, in rows of five, staggered so a big one still
    // lands inside half a second.
    const stagger = Math.min(35, 280 / count);
    for (let i = 0; i < count; i++) {
      const spread = ((i % 5) - 2) * layout.marble * 0.45;
      const lift = Math.floor(i / 5) * layout.marble * 0.4;
      this.ghostMarble(color, from, { x: to.x + spread, y: to.y - lift }, layout.marble * 0.92, 200 + i * stagger);
    }
  }

  private ghostMarble(color: number, from: Point, to: Point, size: number, ms: number): void {
    const p = paint(color);
    const ghost = el('span', {
      class: 'ms-marble is-on is-static ms-ghost',
      style: `--c:${p.hex};--c-shade:${p.shade};width:${size}px;height:${size}px`,
    });
    ghost.append(el('i'));
    this.fxEl.append(ghost);
    const half = size / 2;
    const flight = ghost.animate(
      [
        { transform: `translate(${from.x - half}px, ${from.y - half}px) scale(1)` },
        { transform: `translate(${to.x - half}px, ${to.y - half}px) scale(0.86)` },
      ],
      { duration: ms, easing: 'cubic-bezier(0.5, 0, 0.9, 0.6)', fill: 'forwards' },
    );
    flight.finished.catch(() => undefined).finally(() => ghost.remove());
  }

  /* ----------------------------------------------------------- queries */

  pipeElement(color: number): HTMLButtonElement | undefined {
    return this.pipes[color];
  }
}

/**
 * Slot centres around the stadium, in slot order. See `model.ts` for the
 * numbering: bottom straight left to right, right curve upward, top straight
 * right to left, left curve downward. Positions sit at half steps so the
 * spacing is even across the joins.
 */
export function slotPositions(
  straight: number,
  radius: number,
  spacing: number,
  leftCentreX: number,
  cy: number,
): Point[] {
  const points: Point[] = [];
  const rightCentreX = leftCentreX + straight * spacing;
  for (let j = 0; j < straight; j++) {
    points.push({ x: leftCentreX + (j + 0.5) * spacing, y: cy + radius });
  }
  for (let k = 0; k < CURVE_SLOTS; k++) {
    const phi = Math.PI / 2 - ((k + 0.5) * Math.PI) / CURVE_SLOTS;
    points.push({ x: rightCentreX + radius * Math.cos(phi), y: cy + radius * Math.sin(phi) });
  }
  for (let j = 0; j < straight; j++) {
    points.push({ x: rightCentreX - (j + 0.5) * spacing, y: cy - radius });
  }
  for (let k = 0; k < CURVE_SLOTS; k++) {
    const phi = -Math.PI / 2 - ((k + 0.5) * Math.PI) / CURVE_SLOTS;
    points.push({ x: leftCentreX + radius * Math.cos(phi), y: cy + radius * Math.sin(phi) });
  }
  return points;
}
