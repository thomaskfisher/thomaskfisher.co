/**
 * Bus Jam rendering.
 *
 * The grid is a plain absolutely-positioned lattice of --cell sized tiles, with
 * passengers as buttons on top of them. Unlike Screw Land there is no occlusion
 * to express — everyone is visible all the time, and what varies is whether
 * they can get *out*. That is deliberately not signposted: reading the crowd is
 * the puzzle, so a blocked passenger looks exactly like a free one and says so
 * only when tapped.
 */

import { glyphSvg, paint } from '../shared/palette';
import type { GameState } from './game';
import { type Board, cellIndex, reachableIds } from './model';

export interface RenderOptions {
  showGlyphs: boolean;
  reducedMotion: boolean;
  onTapPassenger: (passengerId: number) => void;
}

/** The grid and the crowd standing on it. */
export class CrowdRenderer {
  private tileEls = new Map<number, HTMLElement>();
  private personEls = new Map<number, HTMLButtonElement>();
  /**
   * The board the current DOM was built from, by identity.
   *
   * Not a descriptive key: while the next level generates, the controller
   * publishes the new level *number* alongside the outgoing board, and any key
   * built from that pair sticks to the DOM. The next board then reuses it
   * whenever the two levels happen to agree on size and headcount — which they
   * do about two times in five — leaving the previous crowd on screen, wired to
   * the new level's ids. Identity cannot drift that way.
   */
  private builtBoard: Board | null = null;
  private hintTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly root: HTMLElement,
    private options: RenderOptions,
  ) {
    // One delegated listener, so rebuilding the board never leaks handlers.
    this.root.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest('[data-passenger]');
      if (!target) return;
      const id = Number((target as HTMLElement).dataset.passenger);
      if (Number.isInteger(id)) this.options.onTapPassenger(id);
    });
  }

  setOptions(patch: Partial<RenderOptions>): void {
    const glyphsChanged =
      patch.showGlyphs !== undefined && patch.showGlyphs !== this.options.showGlyphs;
    this.options = { ...this.options, ...patch };
    if (glyphsChanged) this.builtBoard = null;
  }

  render(state: GameState): void {
    if (!state.generated || !state.index) return;

    if (state.generated.board !== this.builtBoard) {
      this.build(state);
      this.builtBoard = state.generated.board;
    }

    this.paint(state);
    this.applyEffect(state);
  }

  private build(state: GameState): void {
    const board = state.generated?.board;
    if (!board) return;

    this.root.replaceChildren();
    this.tileEls.clear();
    this.personEls.clear();

    this.root.style.setProperty('--grid-w', String(board.width));
    this.root.style.setProperty('--grid-h', String(board.height));

    // Only open cells get a tile. The walls are simply absence, which is what
    // gives the board the ragged outline the original has.
    for (let y = 0; y < board.height; y++) {
      for (let x = 0; x < board.width; x++) {
        const cell = cellIndex(board, x, y);
        if (!board.open[cell]) continue;

        const tile = document.createElement('div');
        tile.className = 'tile';
        tile.style.setProperty('--cx', String(x));
        tile.style.setProperty('--cy', String(y));
        this.root.append(tile);
        this.tileEls.set(cell, tile);
      }
    }

    for (const passenger of board.passengers) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'person';
      el.dataset.passenger = String(passenger.id);
      el.style.setProperty('--cx', String(passenger.x));
      el.style.setProperty('--cy', String(passenger.y));
      el.innerHTML = personBody(passenger.color, this.options.showGlyphs);
      this.root.append(el);
      this.personEls.set(passenger.id, el);
    }
  }

  private paint(state: GameState): void {
    const board = state.generated?.board;
    if (!board) return;

    // Sighted players read blockage off the layout. A screen reader user cannot,
    // so the labels carry what the picture carries. One sweep for the whole
    // crowd rather than a search per person.
    const free = state.index
      ? new Set(reachableIds(board, state.index, state.board))
      : new Set<number>();

    for (const passenger of board.passengers) {
      const el = this.personEls.get(passenger.id);
      if (!el) continue;

      const gone = state.board.boarded[passenger.id] === true;
      el.classList.toggle('is-gone', gone);
      el.disabled = gone || state.phase === 'loading';
      if (gone) continue;

      const p = paint(passenger.color);
      el.setAttribute(
        'aria-label',
        `${p.name} passenger, row ${passenger.y + 1} column ${passenger.x + 1}` +
          (free.has(passenger.id) ? '' : ', blocked in'),
      );
    }
  }

  private applyEffect(state: GameState): void {
    const { effect } = state;
    if (this.options.reducedMotion) return;

    if (effect.kind === 'reject') {
      const el = this.personEls.get(effect.passengerId);
      if (el) {
        el.classList.remove('is-rejected');
        void el.offsetWidth;
        el.classList.add('is-rejected');
      }
    } else if (effect.kind === 'hint') {
      this.highlightHint(effect.passengerId);
    }
  }

  private highlightHint(passengerId: number): void {
    // Clear any highlight still fading, so two hints never glow at once and
    // leave the suggestion ambiguous.
    if (this.hintTimer) clearTimeout(this.hintTimer);
    for (const el of this.personEls.values()) el.classList.remove('is-hinted');

    const el = this.personEls.get(passengerId);
    if (!el) return;
    void el.offsetWidth;
    el.classList.add('is-hinted');
    this.hintTimer = setTimeout(() => {
      el.classList.remove('is-hinted');
      this.hintTimer = null;
    }, 1400);
  }

  /** Viewport position of a passenger, for the walk animation in main.ts. */
  personRect(passengerId: number): DOMRect | null {
    return this.personEls.get(passengerId)?.getBoundingClientRect() ?? null;
  }

  /** Viewport centre of a grid cell, for the walk animation. */
  cellCenter(cell: number, state: GameState): { x: number; y: number } | null {
    const board = state.generated?.board;
    if (!board) return null;
    const tile = this.tileEls.get(cell);
    if (!tile) return null;
    const rect = tile.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  /** Flashes the cells that are hemming a passenger in. */
  showBlockers(passengerId: number, state: GameState): void {
    if (this.options.reducedMotion) return;
    const board = state.generated?.board;
    if (!board) return;
    const passenger = board.passengers[passengerId];
    if (!passenger) return;

    for (const el of this.personEls.values()) el.classList.remove('is-blocking');

    const cell = cellIndex(board, passenger.x, passenger.y);
    for (const next of state.index?.neighbors[cell] ?? []) {
      const occupant = state.board.occupant[next];
      if (occupant === undefined || occupant === -1) continue;
      const el = this.personEls.get(occupant);
      if (!el) continue;
      el.classList.remove('is-blocking');
      void el.offsetWidth;
      el.classList.add('is-blocking');
      setTimeout(() => el.classList.remove('is-blocking'), 620);
    }
  }

  celebrate(): void {
    if (this.options.reducedMotion) return;
    this.root.classList.remove('is-celebrating');
    void this.root.offsetWidth;
    this.root.classList.add('is-celebrating');
    setTimeout(() => this.root.classList.remove('is-celebrating'), 1200);
  }
}

/** Head, shoulders, and an optional shape overlay. Shared by grid and bench. */
function personBody(color: number, showGlyphs: boolean): string {
  const p = paint(color);
  return (
    `<span class="person-art" style="--skin:${p.hex};--skin-edge:${p.shade}">` +
    '<span class="person-head"></span>' +
    `<span class="person-torso">${showGlyphs ? glyphSvg(color, 'person-glyph') : ''}</span>` +
    '</span>'
  );
}

/** How many "and more after that" dots to draw before giving up on the row. */
const PREVIEW_DOTS = 3;

/** Renders the buses at the stop, the queue behind them, and the bench. */
export class StopRenderer {
  constructor(
    private readonly busesEl: HTMLElement,
    private readonly queueEl: HTMLElement,
    private readonly benchEl: HTMLElement,
    private options: { showGlyphs: boolean },
  ) {}

  setOptions(patch: Partial<{ showGlyphs: boolean }>): void {
    this.options = { ...this.options, ...patch };
  }

  render(state: GameState): void {
    const generated = state.generated;
    if (!generated) return;
    const { sinkCapacity, bufferCapacity } = generated.config;

    this.busesEl.replaceChildren(
      ...state.sinks.sinks.map((sink, i) => this.buildBus(sink, i, sinkCapacity)),
    );

    this.renderQueue(state.sinks.queue, generated.shape.previewCount);

    const slots: HTMLElement[] = [];
    for (let i = 0; i < bufferCapacity; i++) {
      const color = state.sinks.buffer[i];
      const slot = document.createElement('div');
      slot.className = color === undefined ? 'bench-slot' : 'bench-slot is-filled';
      slot.dataset.benchSlot = String(i);
      if (color !== undefined) {
        slot.innerHTML = personBody(color, this.options.showGlyphs);
        slot.setAttribute('aria-label', `${paint(color).name} passenger waiting`);
      }
      slots.push(slot);
    }

    // Warn before the bench is actually full, not after.
    this.benchEl.classList.toggle(
      'is-critical',
      state.sinks.buffer.length >= bufferCapacity - 1 && state.sinks.buffer.length > 0,
    );
    this.benchEl.replaceChildren(...slots);
  }

  private buildBus(
    sink: GameState['sinks']['sinks'][number],
    busIndex: number,
    capacity: number,
  ): HTMLElement {
    const bus = document.createElement('div');
    bus.className = 'bus';
    bus.dataset.bus = String(busIndex);

    if (!sink) {
      bus.classList.add('is-gone');
      return bus;
    }

    const p = paint(sink.color);
    bus.style.setProperty('--bus', p.hex);
    bus.style.setProperty('--bus-edge', p.shade);
    bus.setAttribute('aria-label', `${p.name} bus, ${sink.filled} of ${capacity} seats taken`);

    const seats = document.createElement('div');
    seats.className = 'bus-seats';
    for (let i = 0; i < capacity; i++) {
      const seat = document.createElement('span');
      seat.className = i < sink.filled ? 'seat is-taken' : 'seat';
      seat.dataset.seat = String(i);
      if (i < sink.filled) seat.innerHTML = personBody(sink.color, this.options.showGlyphs);
      seats.append(seat);
    }

    const wheels = document.createElement('div');
    wheels.className = 'bus-wheels';
    wheels.append(document.createElement('span'), document.createElement('span'));

    bus.append(seats, wheels);
    return bus;
  }

  /**
   * The buses still to pull in, next first.
   *
   * Only the colours *not* at the stop are lethal: a passenger goes to the
   * bench when no bus wants them, and only gets off it when a bus of their
   * colour arrives later. Without this strip that gamble is blind, which reads
   * as bad luck rather than as a bad decision.
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
      chip.className = 'queue-bus';
      const p = paint(color);
      chip.style.setProperty('--bus', p.hex);
      chip.style.setProperty('--bus-edge', p.shade);
      // The nearer the front of the queue, the more it should draw the eye.
      chip.style.setProperty('--queue-rank', String(i));
      chip.innerHTML = this.options.showGlyphs ? glyphSvg(color, 'queue-glyph') : '';
      return chip;
    });

    for (let i = 0; i < Math.min(PREVIEW_DOTS, queue.length - shown.length); i++) {
      const dot = document.createElement('div');
      dot.className = 'queue-bus is-unknown';
      children.push(dot);
    }

    const names = shown.map((color) => paint(color).name).join(', then ');
    const rest = queue.length - shown.length;
    this.queueEl.setAttribute(
      'aria-label',
      `Buses coming next: ${names}${rest > 0 ? `, and ${rest} more` : ''}`,
    );
    this.queueEl.replaceChildren(...children);
  }

  /** Viewport position of a bus seat, for the walk animation. */
  busSeatRect(busIndex: number, seatIndex: number): DOMRect | null {
    const bus = this.busesEl.querySelector(`[data-bus="${busIndex}"]`);
    const seat = bus?.querySelectorAll('.seat')[seatIndex];
    return seat?.getBoundingClientRect() ?? null;
  }

  benchSlotRect(slot: number): DOMRect | null {
    return (
      this.benchEl.querySelector(`[data-bench-slot="${slot}"]`)?.getBoundingClientRect() ?? null
    );
  }
}

/** Describes the board for screen readers, since colour alone is useless here. */
export function describeProgress(state: GameState): string {
  if (!state.generated) return 'Loading';
  const left = state.board.boarded.filter((gone) => !gone).length;
  return `${left} waiting`;
}
