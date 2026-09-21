/**
 * Castle renderer.
 *
 * Reads a GameState and draws it; it decides nothing. The map is drawn once per
 * level as SVG in cell units, the plots are buttons laid over it, and the wave
 * is a stack of absolutely placed tokens that the playback moves.
 *
 * Rules kept deliberately, all learned the expensive way elsewhere:
 *
 *  - **The wave is shown, not simulated.** `simulate` already produced every
 *    frame before the first token moved; playback walks that list on a single
 *    timer and decides nothing. Skip it, drop frames, background the tab — the
 *    outcome is identical, because it was settled when Go was pressed.
 *
 *  - **One timer, one handle, cancelled on every reset.** Undo is available
 *    during the show. An undo that lands mid-wave must stop the show dead, or a
 *    stale tick keeps moving tokens across a map that is back in planning and
 *    eventually reports a finish for a wave nobody launched.
 *
 *  - **There is still no frame loop.** Tokens move one tick at a time, and a
 *    CSS transition of exactly one tick eases them between positions. The
 *    browser does the in-between; nothing here runs unless a tick is due.
 *
 *  - **The field is its own stacking context**, and every transient highlight
 *    is cleared before a new one goes on.
 */

import { el } from '../shared/ui';
import {
  FOE_RADIUS,
  TOWER_COLORS,
  castle,
  foeIcon,
  foeShape,
  towerIcon,
} from './art';
import type { GameState, HintTarget } from './game';
import type { GeneratedLevel } from './generate';
import {
  type Frame,
  type Level,
  type Outcome,
  type TowerKind,
  EMPTY,
  FOES,
  FROST,
  SUB,
  TOWERS,
  TOWER_KINDS,
  geometry,
} from './model';

export interface RenderOptions {
  reducedMotion: boolean;
  onPlot: (plot: number) => void;
  onSelect: (kind: TowerKind) => void;
  onGo: () => void;
}

/** One tick of the wave on screen. Fast enough to be a show, not a wait. */
export const TICK_MS = 45;

const TRAY_LABELS = ['Arrow', 'Cannon', 'Frost'];

export function describeProgress(state: GameState): string {
  if (state.phase === 'loading' || !state.generated) return 'Preparing…';
  if (state.phase === 'watching') return 'Here they come';
  if (state.phase === 'won') return 'Held';
  if (state.phase === 'lost') return 'Breached';
  const left = state.left.reduce((a, b) => a + b, 0);
  if (left === 0) return 'Ready';
  return `${left} ${left === 1 ? 'tower' : 'towers'} to place`;
}

export class BoardRenderer {
  private options: RenderOptions;
  private readonly waveEl: HTMLElement;
  private readonly fieldEl: HTMLElement;
  private readonly artEl: SVGSVGElement;
  private readonly rangeEl: SVGSVGElement;
  private readonly foesEl: HTMLElement;
  private readonly fxEl: SVGSVGElement;
  private readonly trayEl: HTMLElement;
  private readonly goButton: HTMLButtonElement;
  private trayButtons: HTMLButtonElement[] = [];
  private plotEls: HTMLButtonElement[] = [];

  private signature = '';
  private cell = 44;
  private level: GeneratedLevel | null = null;

  /* Playback. See the header: one handle, and `stopWave` owns it. */
  private timer: number | null = null;
  private frames: readonly Frame[] = [];
  private frameIndex = 0;
  private onWaveDone: (() => void) | null = null;
  private foeEls = new Map<number, HTMLElement>();

  constructor(private readonly root: HTMLElement, options: RenderOptions) {
    this.options = options;

    this.waveEl = el('div', { class: 'wave', 'aria-label': 'The wave' });

    this.fieldEl = el('div', { class: 'field' });
    this.artEl = svg('field-art');
    this.rangeEl = svg('field-ranges');
    this.foesEl = el('div', { class: 'field-foes', 'aria-hidden': 'true' });
    this.fxEl = svg('field-fx');
    this.fieldEl.append(this.artEl, this.rangeEl, this.foesEl, this.fxEl);

    this.trayEl = el('div', { class: 'tray' });
    for (let kind = 0; kind < TOWER_KINDS; kind++) {
      const button = el(
        'button',
        { class: 'tray-tower', type: 'button', 'data-kind': String(kind) },
        `${towerIcon(kind as TowerKind)}<span class="tray-count"></span>`,
      );
      button.addEventListener('click', () => this.options.onSelect(kind as TowerKind));
      this.trayButtons.push(button);
      this.trayEl.append(button);
    }
    this.goButton = el('button', { class: 'go', type: 'button' }, 'Go');
    this.goButton.addEventListener('click', () => this.options.onGo());
    this.trayEl.append(this.goButton);

    this.root.append(this.waveEl, this.fieldEl, this.trayEl);
  }

  setOptions(patch: Partial<RenderOptions>): void {
    this.options = { ...this.options, ...patch };
  }

  /** Cell size in px, set by the fit pass before each render. */
  setCell(cell: number): void {
    this.cell = cell;
    this.fieldEl.style.setProperty('--cell', `${cell}px`);
  }

  render(state: GameState): void {
    const level = state.generated;
    if (!level) {
      this.fieldEl.dataset.empty = 'true';
      this.waveEl.innerHTML = '';
      this.trayEl.hidden = true;
      return;
    }
    delete this.fieldEl.dataset.empty;
    this.trayEl.hidden = false;

    const signature = `${state.level}:${level.path.join('.')}:${level.plots.join('.')}`;
    if (signature !== this.signature) {
      this.build(level);
      this.signature = signature;
    }

    this.paintPlots(state);
    this.paintRanges(state, level);
    this.paintTray(state, level);
    this.fieldEl.dataset.phase = state.phase;

    // A settled wave leaves its last frame on the map, so a loss shows the
    // enemy standing in the gate behind the sheet. Anything else clears it.
    if (state.phase === 'planning' || state.phase === 'loading') this.clearFoes();
  }

  /* ---------------------------------------------------------------- build */

  private build(level: GeneratedLevel): void {
    this.stopWave();
    this.level = level;
    const { width: w, height: h } = level;

    this.fieldEl.style.setProperty('--cols', String(w));
    this.fieldEl.style.setProperty('--rows', String(h));
    for (const node of [this.artEl, this.rangeEl, this.fxEl]) {
      node.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }

    this.artEl.innerHTML = drawMap(level);

    for (const node of this.plotEls) node.remove();
    this.plotEls = level.plots.map((cell, plot) => {
      const node = el('button', {
        class: 'plot',
        type: 'button',
        'data-plot': String(plot),
        style: `--x: ${cell % w}; --y: ${Math.floor(cell / w)}`,
      });
      node.addEventListener('click', () => this.options.onPlot(plot));
      this.fieldEl.insertBefore(node, this.foesEl);
      return node;
    });

    this.waveEl.innerHTML = '';
    for (const group of groups(level)) {
      this.waveEl.append(
        el(
          'span',
          { class: 'wave-group', title: `${group.count} ${FOES[group.kind]?.name}` },
          `${foeIcon(group.kind as 0 | 1 | 2)}<b>${group.count}</b>`,
        ),
      );
    }
  }

  /* ---------------------------------------------------------------- plots */

  private paintPlots(state: GameState): void {
    const planning = state.phase === 'planning';
    for (let plot = 0; plot < this.plotEls.length; plot++) {
      const node = this.plotEls[plot] as HTMLButtonElement;
      node.classList.remove('is-hinted', 'is-hinted-remove');
      const kind = state.layout[plot] ?? EMPTY;
      const had = node.dataset.kind ?? String(EMPTY);
      if (had !== String(kind)) {
        node.innerHTML = kind === EMPTY ? '' : towerIcon(kind as TowerKind);
        node.dataset.kind = String(kind);
      }
      node.classList.toggle('is-built', kind !== EMPTY);
      node.disabled = !planning;
      const label =
        kind === EMPTY
          ? `Empty plot ${plot + 1}`
          : `${TOWERS[kind]?.name} tower on plot ${plot + 1}, tap to take back`;
      node.setAttribute('aria-label', label);
    }
  }

  /**
   * Reach circles for every tower on the map.
   *
   * Shown while planning because they are the whole decision — where the
   * circles overlap the road is where the damage happens. Frost's stays up
   * during the wave too: it is the one tower that does nothing visible except
   * be there, and a token visibly slowing inside a blue circle is how the
   * player learns what frost is for.
   */
  private paintRanges(state: GameState, level: Level): void {
    const { width: w } = level;
    let out = '';
    for (let plot = 0; plot < level.plots.length; plot++) {
      const kind = state.layout[plot] ?? EMPTY;
      if (kind === EMPTY) continue;
      if (state.phase !== 'planning' && kind !== FROST) continue;
      const cell = level.plots[plot] as number;
      const r = Math.sqrt((TOWERS[kind] as { rangeSq: number }).rangeSq) / SUB;
      out +=
        `<circle class="range range--${kind}" cx="${(cell % w) + 0.5}" cy="${Math.floor(cell / w) + 0.5}" ` +
        `r="${r.toFixed(3)}" style="--tower: ${TOWER_COLORS[kind]}"/>`;
    }
    this.rangeEl.innerHTML = out;
  }

  /* ----------------------------------------------------------------- tray */

  private paintTray(state: GameState, level: Level): void {
    for (let kind = 0; kind < TOWER_KINDS; kind++) {
      const node = this.trayButtons[kind] as HTMLButtonElement;
      node.classList.remove('is-hinted');
      const given = level.towers[kind] ?? 0;
      node.hidden = given === 0;
      const left = state.left[kind] ?? 0;
      (node.querySelector('.tray-count') as HTMLElement).textContent = String(left);
      const selected = state.selected === kind && state.phase === 'planning';
      node.setAttribute('aria-pressed', String(selected));
      node.disabled = state.phase !== 'planning' || left === 0;
      node.setAttribute('aria-label', `${TRAY_LABELS[kind]}, ${left} left`);
    }

    this.goButton.classList.remove('is-hinted');
    const watching = state.phase === 'watching';
    this.goButton.textContent = watching ? 'Skip' : 'Go';
    this.goButton.disabled = !(state.phase === 'planning' || watching);
    this.goButton.classList.toggle('is-ready', state.phase === 'planning' && state.left.every((n) => n === 0));
  }

  /* ------------------------------------------------------------- the wave */

  /**
   * Plays a launched wave, then calls `onDone`.
   *
   * With reduced motion it jumps straight to the last frame: the show is
   * decoration, and the result is the same either way.
   */
  playWave(outcome: Outcome, onDone: () => void): void {
    this.stopWave();
    this.frames = outcome.frames ?? [];
    this.frameIndex = 0;
    this.onWaveDone = onDone;
    this.fieldEl.style.setProperty('--tick', `${TICK_MS}ms`);

    if (this.options.reducedMotion || this.frames.length === 0) {
      this.skipWave();
      return;
    }
    this.schedule();
  }

  private schedule(): void {
    this.timer = window.setTimeout(() => {
      this.timer = null;
      const frame = this.frames[this.frameIndex];
      if (!frame) {
        this.finish();
        return;
      }
      this.drawFrame(frame, true);
      this.frameIndex++;
      this.schedule();
    }, TICK_MS);
  }

  /** Jumps to the end of the show. What the Skip button and a hidden tab do. */
  skipWave(): void {
    if (this.onWaveDone === null) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    const last = this.frames[this.frames.length - 1];
    if (last) this.drawFrame(last, false);
    this.fxEl.innerHTML = '';
    this.finish();
  }

  private finish(): void {
    const done = this.onWaveDone;
    this.onWaveDone = null;
    this.frames = [];
    const leaked = this.fieldEl.querySelector('.foe.is-through');
    this.fieldEl.classList.toggle('is-breached', leaked !== null);
    done?.();
  }

  get watching(): boolean {
    return this.onWaveDone !== null;
  }

  /** Stops the show without finishing it. Every reset comes through here. */
  stopWave(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.onWaveDone = null;
    this.frames = [];
    this.clearFoes();
  }

  private clearFoes(): void {
    for (const node of this.foeEls.values()) node.remove();
    this.foeEls.clear();
    this.fxEl.innerHTML = '';
    this.fieldEl.classList.remove('is-breached');
  }

  private drawFrame(frame: Frame, animate: boolean): void {
    const level = this.level;
    if (!level) return;
    const geo = geometry(level);
    const cell = this.cell;
    const seen = new Set<number>();

    for (const foe of frame.foes) {
      seen.add(foe.id);
      const spec = level.wave[foe.id];
      if (!spec) continue;
      let node = this.foeEls.get(foe.id);
      const x = ((geo.x[foe.pos] as number) / SUB) * cell;
      const y = ((geo.y[foe.pos] as number) / SUB) * cell;
      if (!node) {
        node = el('div', { class: `foe foe--${spec.kind}` });
        const size = (FOE_RADIUS[spec.kind] as number) * 2 * cell;
        node.innerHTML =
          `<svg viewBox="-12 -12 24 24">${foeShape(spec.kind, 0, 0, 10.5)}</svg>` +
          '<i class="foe-hp"><i></i></i>';
        node.style.setProperty('--size', `${size}px`);
        // Placed before it is shown, with no transition, so a new enemy
        // appears at the entrance rather than sliding in from the corner.
        node.style.transition = 'none';
        node.style.transform = `translate(${x}px, ${y}px)`;
        this.foesEl.append(node);
        this.foeEls.set(foe.id, node);
        void node.offsetWidth;
        node.style.transition = '';
      } else {
        node.style.transition = animate ? '' : 'none';
        node.style.transform = `translate(${x}px, ${y}px)`;
      }
      node.classList.toggle('is-slowed', foe.slowed);
      node.classList.toggle('is-dead', foe.hp <= 0);
      node.classList.toggle('is-through', foe.hp > 0 && foe.pos >= geo.end);
      const share = Math.max(0, foe.hp) / spec.hp;
      (node.querySelector('.foe-hp > i') as HTMLElement).style.width = `${(share * 100).toFixed(0)}%`;
    }

    // An enemy missing from this frame died in the last one.
    for (const [id, node] of this.foeEls) {
      if (seen.has(id)) continue;
      node.remove();
      this.foeEls.delete(id);
    }

    this.drawShots(frame, level, animate);
  }

  private drawShots(frame: Frame, level: Level, animate: boolean): void {
    if (!animate) {
      this.fxEl.innerHTML = '';
      return;
    }
    const geo = geometry(level);
    const w = level.width;
    let out = '';
    for (const shot of frame.shots) {
      const cell = level.plots[shot.plot] as number;
      const x1 = (cell % w) + 0.5;
      const y1 = Math.floor(cell / w) + 0.5;
      const x2 = (geo.x[shot.pos] as number) / SUB;
      const y2 = (geo.y[shot.pos] as number) / SUB;
      if (shot.kind === 1) {
        const r = Math.sqrt((TOWERS[1] as { splashSq: number }).splashSq) / SUB;
        out += `<circle class="boom" cx="${x2.toFixed(3)}" cy="${y2.toFixed(3)}" r="${r.toFixed(3)}"/>`;
      } else {
        out +=
          `<line class="bolt" x1="${x1}" y1="${y1}" x2="${x2.toFixed(3)}" y2="${y2.toFixed(3)}"/>`;
      }
    }
    // Replaced wholesale each tick: each shot lives for one tick and its CSS
    // animation, so there is never a list of old shots to tidy up.
    this.fxEl.innerHTML = out;
  }

  /* -------------------------------------------------------------- effects */

  /** Marks the next step. Exactly one thing on the board is ever lit. */
  showHint(target: HintTarget): void {
    this.clearHint();
    if (target.kind === 'go') {
      this.goButton.classList.add('is-hinted');
      return;
    }
    const node = this.plotEls[target.plot];
    if (!node) return;
    node.classList.add(target.kind === 'remove' ? 'is-hinted-remove' : 'is-hinted');
    // Only the plot carries `is-hinted`: the tray has already been switched to
    // the right tower by the controller, and lighting both would leave two
    // things for a finger — or a test — to wonder about.
    if (!this.options.reducedMotion) {
      node.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
        { duration: 620, easing: 'ease-in-out' },
      );
    }
  }

  clearHint(): void {
    for (const node of this.plotEls) node.classList.remove('is-hinted', 'is-hinted-remove');
    this.goButton.classList.remove('is-hinted');
    for (const node of this.trayButtons) node.classList.remove('is-hinted');
  }

  /** A tap that could not be taken. Nothing is committed, so nothing strands. */
  showReject(plot: number | null): void {
    if (this.options.reducedMotion) return;
    const node = plot === null ? this.trayEl : this.plotEls[plot];
    node?.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-3px)' },
        { transform: 'translateX(3px)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 200, easing: 'ease-in-out' },
    );
  }

  /** A tower going down. Decorative and self-cancelling. */
  showPlaced(plot: number): void {
    const node = this.plotEls[plot];
    if (!node || this.options.reducedMotion) return;
    node.animate(
      [{ transform: 'scale(0.6)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }],
      { duration: 240, easing: 'ease-out' },
    );
  }
}

/* ------------------------------------------------------------------ helpers */

function svg(className: string): SVGSVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('class', className);
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('preserveAspectRatio', 'none');
  return node;
}

/** Runs of one kind, in order — what the preview strip shows. */
export function groups(level: Level): { kind: number; count: number }[] {
  const out: { kind: number; count: number }[] = [];
  let lastSpawn = -Infinity;
  for (const foe of level.wave) {
    const prev = out[out.length - 1];
    // A new group starts when the kind changes or there is a real gap.
    if (prev && prev.kind === foe.kind && foe.spawn - lastSpawn <= 6) prev.count++;
    else out.push({ kind: foe.kind, count: 1 });
    lastSpawn = foe.spawn;
  }
  return out;
}

/** Cheap, stable per-cell noise for scenery. */
const noise = (cell: number, salt: number): number => {
  let h = (cell * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * The map: grass, scenery, the road, the entrance and the castle.
 *
 * Drawn once per level. The road is a thick round-jointed polyline through the
 * cell centres, which is also exactly the line the enemies walk, so what the
 * player sees and what the simulation measures are the same shape.
 */
function drawMap(level: Level): string {
  const { width: w, height: h, path, plots } = level;
  const pts = path.map((cell) => `${(cell % w) + 0.5},${Math.floor(cell / w) + 0.5}`);
  const first = path[0] as number;
  const last = path[path.length - 1] as number;
  const entry = `${(first % w) + 0.5},-0.2`;
  const line = [entry, ...pts].join(' ');

  const busy = new Set<number>([...path, ...plots]);
  let scenery = '';
  for (let cell = 0; cell < w * h; cell++) {
    if (busy.has(cell)) continue;
    const roll = noise(cell, 1);
    const cx = (cell % w) + 0.3 + noise(cell, 2) * 0.4;
    const cy = Math.floor(cell / w) + 0.3 + noise(cell, 3) * 0.4;
    if (roll < 0.26) {
      scenery +=
        `<circle class="tree" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="0.2"/>` +
        `<circle class="tree tree--light" cx="${(cx - 0.12).toFixed(2)}" cy="${(cy - 0.1).toFixed(2)}" r="0.13"/>`;
    } else if (roll < 0.36) {
      scenery += `<ellipse class="rock" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" rx="0.14" ry="0.1"/>`;
    }
  }

  const gx = last % w;
  const gy = Math.floor(last / w);

  return (
    `<rect class="grass" x="0" y="0" width="${w}" height="${h}"/>` +
    scenery +
    `<polyline class="road-edge" points="${line}"/>` +
    `<polyline class="road" points="${line}"/>` +
    `<path class="entrance" d="M${(first % w) + 0.14} 0 a0.36 0.36 0 0 0 0.72 0 z"/>` +
    // Kept inside the map when the gate is in a corner column.
    castle(Math.min(Math.max(gx - 0.1, 0), w - 1.2), gy - 0.2, 1.2)
  );
}
