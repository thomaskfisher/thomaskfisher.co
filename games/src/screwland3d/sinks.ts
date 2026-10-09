/**
 * The boxes, the queue preview and the tray. A copy of Screw Land's
 * `SinkRenderer`, kept separate so neither game can break the other.
 */

import { glyphSvg, paint } from '../shared/palette';
import type { GameState } from './game';

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

