/**
 * Screw Land rendering.
 *
 * Plates are absolutely positioned divs stacked by z-index, screws are buttons
 * layered just above their own plate. That single z-index scheme does the
 * occlusion for free: a plate at layer L+1 sits above both plate L and its
 * screws, so a buried screw is genuinely hidden and genuinely unclickable
 * without any extra hit-testing.
 */

import { glyphSvg, paint } from '../shared/palette';
import type { GameState } from './game';
import { type Plate, type Screw, type Structure, isAccessible, structureBounds } from './model';

/** Kept in step with the fall animation in screwland.css. */
const FALL_MS = 460;

export interface RenderOptions {
  showGlyphs: boolean;
  reducedMotion: boolean;
  onTapScrew: (screwId: number) => void;
}

export class StructureRenderer {
  private plateEls = new Map<number, HTMLElement>();
  private screwEls = new Map<number, HTMLButtonElement>();
  /**
   * The structure the current DOM was built from, by identity.
   *
   * Deliberately not a descriptive key: while the next level generates, the
   * controller publishes the new level *number* alongside the outgoing
   * structure, so any key mixing the two sticks to the DOM and is then matched
   * by the incoming level whenever the plate and screw counts happen to agree —
   * leaving last level's structure on screen, wired to this level's ids.
   */
  private builtStructure: Structure | null = null;
  private fallen = new Set<number>();
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Pending "the plate has finished falling" timers, by plate id.
   *
   * A plate is hidden 460ms after it starts to fall, and an undo inside that
   * window puts the plate back. Untracked, the timer still fires and hides a
   * plate whose screws have returned — and because nothing ever clears it
   * again, that plate stays gone for the rest of the level.
   */
  private fallTimers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly root: HTMLElement,
    private options: RenderOptions,
  ) {
    // One delegated listener, so rebuilding the board never leaks handlers.
    this.root.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest('[data-screw]');
      if (!target) return;
      const id = Number((target as HTMLElement).dataset.screw);
      if (Number.isInteger(id)) this.options.onTapScrew(id);
    });
  }

  setOptions(patch: Partial<RenderOptions>): void {
    const glyphsChanged =
      patch.showGlyphs !== undefined && patch.showGlyphs !== this.options.showGlyphs;
    this.options = { ...this.options, ...patch };
    if (glyphsChanged) this.builtStructure = null;
  }

  render(state: GameState): void {
    if (!state.generated || !state.index) return;

    if (state.generated.structure !== this.builtStructure) {
      this.build(state);
      this.builtStructure = state.generated.structure;
    }

    this.paint(state);
    this.applyEffect(state);
  }

  private build(state: GameState): void {
    const structure = state.generated?.structure;
    if (!structure) return;

    this.root.replaceChildren();
    this.plateEls.clear();
    this.screwEls.clear();
    this.fallen.clear();
    this.clearFallTimers();

    // Position everything relative to the plates' own bounding box, so the
    // object fills the board rather than floating inside the nominal grid.
    const bounds = structureBounds(structure);
    this.root.style.setProperty('--grid-w', String(bounds.w));
    this.root.style.setProperty('--grid-h', String(bounds.h));

    for (const plate of structure.plates) {
      const el = document.createElement('div');
      el.className = 'plate';
      el.style.setProperty('--px', String(plate.x - bounds.x));
      el.style.setProperty('--py', String(plate.y - bounds.y));
      el.style.setProperty('--pw', String(plate.w));
      el.style.setProperty('--ph', String(plate.h));
      el.style.zIndex = String(plate.layer * 10);
      // Alternate the grain so a deep stack stays legible as separate pieces.
      el.dataset.tone = String(plate.layer % 4);
      this.root.append(el);
      this.plateEls.set(plate.id, el);
    }

    for (const screw of structure.screws) {
      const plate = structure.plates.find((p) => p.id === screw.plateId) as Plate;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'screw';
      el.dataset.screw = String(screw.id);
      el.style.setProperty('--sx', String(screw.x - bounds.x));
      el.style.setProperty('--sy', String(screw.y - bounds.y));
      el.style.zIndex = String(plate.layer * 10 + 1);
      this.root.append(el);
      this.screwEls.set(screw.id, el);
    }
  }

  private paint(state: GameState): void {
    const structure = state.generated?.structure;
    const index = state.index;
    if (!structure || !index) return;

    for (const screw of structure.screws) {
      const el = this.screwEls.get(screw.id);
      if (!el) continue;

      const gone = state.board.removed[screw.id] === true;
      el.classList.toggle('is-gone', gone);
      if (gone) {
        el.disabled = true;
        continue;
      }

      const p = paint(screw.color);
      el.style.setProperty('--head', p.hex);
      el.style.setProperty('--head-edge', p.shade);
      el.innerHTML = this.options.showGlyphs
        ? glyphSvg(screw.color, 'screw-glyph')
        : '<span class="screw-slot"></span>';

      const reachable = isAccessible(index, state.board, screw.id);
      el.classList.toggle('is-buried', !reachable);
      el.disabled = state.phase === 'loading';
      el.setAttribute(
        'aria-label',
        `${p.name} screw${reachable ? '' : ', covered'}`,
      );
    }

    for (const plate of structure.plates) {
      const el = this.plateEls.get(plate.id);
      if (!el) continue;
      const plateIndex = index.plateIndexById.get(plate.id);
      if (plateIndex === undefined) continue;

      const down = state.board.remainingPerPlate[plateIndex] === 0;
      if (down && !this.fallen.has(plate.id)) {
        this.fallen.add(plate.id);
        this.dropPlate(plate.id, el);
      } else if (!down && this.fallen.has(plate.id)) {
        // An undo put it back. Cancel the hide still queued behind the fall,
        // or it lands after the plate is standing again.
        this.fallen.delete(plate.id);
        this.cancelFallTimer(plate.id);
        el.classList.remove('is-falling', 'is-down');
      }
    }
  }

  private cancelFallTimer(plateId: number): void {
    const timer = this.fallTimers.get(plateId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.fallTimers.delete(plateId);
  }

  private clearFallTimers(): void {
    for (const timer of this.fallTimers.values()) clearTimeout(timer);
    this.fallTimers.clear();
  }

  private dropPlate(plateId: number, el: HTMLElement): void {
    if (this.options.reducedMotion) {
      el.classList.add('is-down');
      return;
    }
    // Tumble off in a direction that depends on where it sits, so a board
    // clearing does not look like everything sliding the same way.
    el.style.setProperty('--fall-spin', `${(Math.random() * 2 - 1) * 40}deg`);
    el.style.setProperty('--fall-drift', `${(Math.random() * 2 - 1) * 60}px`);
    el.classList.add('is-falling');
    this.cancelFallTimer(plateId);
    this.fallTimers.set(
      plateId,
      setTimeout(() => {
        this.fallTimers.delete(plateId);
        el.classList.add('is-down');
      }, FALL_MS),
    );
  }

  private applyEffect(state: GameState): void {
    const { effect } = state;
    if (this.options.reducedMotion) return;

    if (effect.kind === 'reject') {
      const el = this.screwEls.get(effect.screwId);
      if (el) {
        el.classList.remove('is-rejected');
        void el.offsetWidth;
        el.classList.add('is-rejected');
      }
    } else if (effect.kind === 'hint') {
      this.highlightHint(effect.screwId);
    }
  }

  private highlightHint(screwId: number): void {
    // Clear any highlight still fading, so two hints never glow at once and
    // leave the suggestion ambiguous.
    if (this.hintTimer) clearTimeout(this.hintTimer);
    for (const el of this.screwEls.values()) el.classList.remove('is-hinted');

    const el = this.screwEls.get(screwId);
    if (!el) return;
    void el.offsetWidth;
    el.classList.add('is-hinted');
    this.hintTimer = setTimeout(() => {
      el.classList.remove('is-hinted');
      this.hintTimer = null;
    }, 1400);
  }

  /** Viewport position of a screw, for the flight animation in main.ts. */
  screwRect(screwId: number): DOMRect | null {
    return this.screwEls.get(screwId)?.getBoundingClientRect() ?? null;
  }

  celebrate(): void {
    if (this.options.reducedMotion) return;
    this.root.classList.remove('is-celebrating');
    void this.root.offsetWidth;
    this.root.classList.add('is-celebrating');
    setTimeout(() => this.root.classList.remove('is-celebrating'), 1200);
  }
}

/** How many "and more after that" dots to draw before giving up on the row. */
const PREVIEW_DOTS = 3;

/** Renders the boxes, the queue preview, and the tray. */
export class SinkRenderer {
  constructor(
    private readonly boxesEl: HTMLElement,
    private readonly queueEl: HTMLElement,
    private readonly trayEl: HTMLElement,
    private options: { showGlyphs: boolean },
  ) {}

  setOptions(patch: Partial<{ showGlyphs: boolean }>): void {
    this.options = { ...this.options, ...patch };
  }

  render(state: GameState): void {
    const generated = state.generated;
    if (!generated) return;
    const { sinkCapacity, bufferCapacity } = generated.config;

    this.boxesEl.replaceChildren(
      ...state.sinks.sinks.map((sink, i) => this.buildBox(sink, i, sinkCapacity)),
    );

    this.renderQueue(state.sinks.queue, generated.shape.previewCount);

    const slots: HTMLElement[] = [];
    for (let i = 0; i < bufferCapacity; i++) {
      const color = state.sinks.buffer[i];
      const slot = document.createElement('div');
      slot.className = color === undefined ? 'tray-slot' : 'tray-slot is-filled';
      slot.dataset.traySlot = String(i);
      if (color !== undefined) {
        const p = paint(color);
        slot.style.setProperty('--head', p.hex);
        slot.style.setProperty('--head-edge', p.shade);
        slot.innerHTML = this.options.showGlyphs ? glyphSvg(color, 'screw-glyph') : '';
        slot.setAttribute('aria-label', `${p.name} screw waiting`);
      }
      slots.push(slot);
    }

    // Warn before the tray is actually full, not after.
    this.trayEl.classList.toggle(
      'is-critical',
      state.sinks.buffer.length >= bufferCapacity - 1 && state.sinks.buffer.length > 0,
    );
    this.trayEl.replaceChildren(...slots);
  }

  private buildBox(
    sink: GameState['sinks']['sinks'][number],
    boxIndex: number,
    capacity: number,
  ): HTMLElement {
    const box = document.createElement('div');
    box.className = 'box';
    box.dataset.box = String(boxIndex);

    if (!sink) {
      box.classList.add('is-closed');
      return box;
    }

    const p = paint(sink.color);
    box.style.setProperty('--box', p.hex);
    box.style.setProperty('--box-edge', p.shade);
    box.setAttribute('aria-label', `${p.name} box, ${sink.filled} of ${capacity}`);

    for (let i = 0; i < capacity; i++) {
      const hole = document.createElement('span');
      hole.className = i < sink.filled ? 'hole is-filled' : 'hole';
      hole.dataset.hole = String(i);
      if (i < sink.filled) {
        hole.innerHTML = this.options.showGlyphs
          ? glyphSvg(sink.color, 'screw-glyph')
          : '<span class="screw-slot"></span>';
      }
      box.append(hole);
    }

    return box;
  }

  /**
   * The colours waiting to open, next first.
   *
   * Only closed boxes are lethal: a screw goes to the tray when nothing open
   * wants it, and it only comes back out when a box of that colour opens later.
   * Without this strip that gamble is blind, which reads as bad luck rather
   * than a bad decision — and the fewer boxes a level opens, the more of the
   * game is that gamble.
   */
  private renderQueue(queue: readonly number[], previewCount: number): void {
    if (queue.length === 0) {
      this.queueEl.replaceChildren();
      this.queueEl.hidden = true;
      return;
    }
    this.queueEl.hidden = false;

    const shown = queue.slice(0, Math.max(0, previewCount));
    const children: HTMLElement[] = shown.map((color, i) => {
      const chip = document.createElement('div');
      chip.className = 'queue-chip';
      const p = paint(color);
      chip.style.setProperty('--head', p.hex);
      chip.style.setProperty('--head-edge', p.shade);
      // The nearer the front of the queue, the more it should draw the eye.
      chip.style.setProperty('--queue-rank', String(i));
      chip.innerHTML = this.options.showGlyphs
        ? glyphSvg(color, 'screw-glyph')
        : '<span class="screw-slot"></span>';
      return chip;
    });

    for (let i = 0; i < Math.min(PREVIEW_DOTS, queue.length - shown.length); i++) {
      const dot = document.createElement('div');
      dot.className = 'queue-chip is-unknown';
      children.push(dot);
    }

    const names = shown.map((color) => paint(color).name).join(', then ');
    const rest = queue.length - shown.length;
    this.queueEl.setAttribute(
      'aria-label',
      `Boxes coming next: ${names}${rest > 0 ? `, and ${rest} more` : ''}`,
    );
    this.queueEl.replaceChildren(...children);
  }

  /** Viewport position of a target slot, for the flight animation. */
  boxHoleRect(boxIndex: number, holeIndex: number): DOMRect | null {
    const box = this.boxesEl.querySelector(`[data-box="${boxIndex}"]`);
    const hole = box?.querySelectorAll('.hole')[holeIndex];
    return hole?.getBoundingClientRect() ?? null;
  }

  traySlotRect(slot: number): DOMRect | null {
    return this.trayEl.querySelector(`[data-tray-slot="${slot}"]`)?.getBoundingClientRect() ?? null;
  }
}

/** Describes the board for screen readers, since colour alone is useless here. */
export function describeProgress(state: GameState): string {
  if (!state.generated) return 'Loading';
  const left = state.board.removed.filter((gone) => !gone).length;
  return `${left} screw${left === 1 ? '' : 's'} left`;
}

export type { Screw };
