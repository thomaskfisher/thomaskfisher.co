/**
 * Tetris's board: the well and the tray above it. The well is the controller.
 *
 * Built once and updated in place. A redraw walks the 200 visible cells and
 * writes only the ones whose contents actually changed — at a hundred
 * milliseconds a row that is usually four cells and their ghosts, which is the
 * difference between this and a frame loop as far as a battery is concerned.
 *
 * **The board sizes itself in CSS and nothing here measures anything.** The
 * well is a fixed ten by twenty whatever the level, so there is no content
 * bound to fit to: `.tt-board` is a size container and the well takes the
 * smaller of its width and half its height. That is the whole of it, and it
 * cannot go stale the way a hardcoded copy of a padding value does.
 *
 * **Input is gestures on the well, turned into ordinary actions** the
 * controller already understands — see `listen`. There are no repeat timers:
 * one swipe is one step, so the only deferred thing here is the clear flash,
 * and `cancel()` clears it.
 */

import { paint } from '../shared/palette';
import { sfx } from '../shared/audio';
import { el } from '../shared/ui';
import type { Action } from './run';
import type { Effect, GameView } from './game';
import {
  CELLS,
  EMPTY,
  PIECE_NAMES,
  SPAWN_H,
  WELL_H,
  WELL_W,
  cellsOf,
  ghostOf,
} from './model';

/**
 * The classic colours, as palette indices: I cyan, O yellow, T purple, S green,
 * Z red, J blue, L orange. Anyone who has played the original reads the piece
 * before they read the shape, and changing them for the sake of it costs that.
 */
const PIECE_PAINTS = [6, 3, 4, 2, 0, 1, 5] as const;

/** How far a finger must travel, in pixels, before a touch is a swipe. */
const SWIPE_PX = 24;
/** A touch that lasts longer than this and goes nowhere is not a tap. */
const TAP_MS = 350;
/** How long the well flashes after a clear. */
const FLASH_MS = 220;

export interface RendererOptions {
  onPress: (action: Action) => void;
  /** The board was tapped while stopped — start, or carry on. */
  onResume: () => void;
}

/** A finger on the well, from the moment it lands. */
interface Gesture {
  pointer: number;
  x: number;
  y: number;
  at: number;
  /** It has already been read as a swipe, and does nothing more until lifted. */
  spent: boolean;
}

export class BoardRenderer {
  private readonly well: HTMLDivElement;
  private readonly cells: HTMLDivElement[] = [];
  /** What each cell was last told to be, so a redraw writes only differences. */
  private readonly painted: string[] = [];

  private readonly holdSlot: HTMLButtonElement;
  private readonly nextSlots: HTMLDivElement[] = [];
  private readonly resumeButton: HTMLButtonElement;

  private readonly timers = new Set<number>();
  /** The finger currently on the well. One at a time: a second is ignored. */
  private gesture: Gesture | null = null;
  /** The clock is running, so gestures act. Set by `render`. */
  private live = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly tray: HTMLElement,
    private readonly options: RendererOptions,
  ) {
    /* ------------------------------------------------------------ tray */

    // The hold slot is itself the hold control, as well as swiping up. A
    // button, so it is the one control a player can find by looking.
    this.holdSlot = el('button', {
      class: 'tt-slot tt-slot--hold',
      type: 'button',
    }) as HTMLButtonElement;
    this.holdSlot.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (this.live) this.options.onPress('hold');
    });
    const holdWrap = el('div', { class: 'tt-tray-group' });
    holdWrap.append(el('span', { class: 'tt-tray-label' }, 'Hold'), this.holdSlot);

    const nextWrap = el('div', { class: 'tt-tray-group tt-tray-group--next' });
    const nextRow = el('div', { class: 'tt-next-row' });
    for (let i = 0; i < 3; i++) {
      const slot = el('div', { class: 'tt-slot' });
      this.nextSlots.push(slot);
      nextRow.append(slot);
    }
    nextWrap.append(el('span', { class: 'tt-tray-label' }, 'Next'), nextRow);
    this.tray.append(holdWrap, nextWrap);

    /* ------------------------------------------------------------ well */

    this.well = el('div', { class: 'tt-well', 'aria-hidden': 'true' });
    for (let i = 0; i < WELL_H * WELL_W; i++) {
      const cell = el('div', { class: 'tt-cell' });
      this.cells.push(cell);
      this.painted.push('');
      this.well.append(cell);
    }

    // Covers the well when the clock is stopped. A button rather than an
    // overlay with a handler, so it is reachable from a keyboard and announces
    // itself — and because the whole well being the tap target is the point.
    this.resumeButton = el('button', { class: 'tt-resume', type: 'button' }, '');
    this.resumeButton.addEventListener('click', () => this.options.onResume());

    const frame = el('div', { class: 'tt-frame' });
    frame.append(this.well, this.resumeButton);
    this.root.append(frame);

    this.listen(this.root);
  }

  /* -------------------------------------------------------------- input */

  /**
   * Tap to turn, swipe to slide, swipe down to drop, swipe up to hold.
   *
   * Listened for on the whole board area rather than the well, so a thumb
   * that lands in the gutter beside a narrow well still counts. A tap anywhere
   * turns the piece rather than only a tap on it: the piece is four cells of a
   * few millimetres each, and missing it would read as the game ignoring you.
   *
   * **One swipe is one step.** A swipe is read the moment it has travelled
   * `SWIPE_PX`, not when the finger lifts, because at speed the lift is a
   * gravity step late — and after that the gesture is spent until the finger
   * comes up. Crossing the well is several flicks, never one long drag that
   * overshoots. Down is the hard drop rather than a soft one, because a single
   * flick of soft drop moves the piece one row and nobody means that.
   */
  private listen(target: HTMLElement): void {
    target.addEventListener('pointerdown', (event) => {
      if (!this.live || this.gesture) return;
      event.preventDefault();
      this.gesture = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        at: event.timeStamp,
        spent: false,
      };
      // Guarded: capture throws if the pointer has already gone by the time
      // this runs, which a very fast flick can manage.
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        /* the move and up events still arrive while the finger is over the board */
      }
    });

    target.addEventListener('pointermove', (event) => {
      const gesture = this.gesture;
      if (!gesture || gesture.pointer !== event.pointerId || gesture.spent) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;

      gesture.spent = true;
      if (!this.live) return;
      if (Math.abs(dx) > Math.abs(dy)) this.options.onPress(dx < 0 ? 'left' : 'right');
      else this.options.onPress(dy > 0 ? 'hard' : 'hold');
    });

    target.addEventListener('pointerup', (event) => {
      const gesture = this.gesture;
      if (!gesture || gesture.pointer !== event.pointerId) return;
      this.gesture = null;
      if (gesture.spent || !this.live) return;
      if (event.timeStamp - gesture.at <= TAP_MS) this.options.onPress('cw');
    });

    target.addEventListener('pointercancel', (event) => {
      if (this.gesture?.pointer === event.pointerId) this.gesture = null;
    });
  }

  /* ------------------------------------------------------------- drawing */

  render(view: GameView): void {
    const loading = view.phase === 'loading';
    this.root.classList.toggle('is-loading', loading);
    this.well.dataset.phase = view.phase;

    const wanted: string[] = new Array(WELL_H * WELL_W).fill('');

    if (!loading) {
      const run = view.run;
      for (let y = SPAWN_H; y < SPAWN_H + WELL_H; y++) {
        for (let x = 0; x < WELL_W; x++) {
          const value = run.well[y * WELL_W + x] ?? EMPTY;
          if (value !== EMPTY) wanted[(y - SPAWN_H) * WELL_W + x] = String(value);
        }
      }

      if (run.piece && !run.over) {
        // Ghost first, so a piece resting on the floor paints over its own
        // ghost rather than the other way round.
        for (const [x, y] of cellsOf(ghostOf(run.well, run.piece))) {
          const at = (y - SPAWN_H) * WELL_W + x;
          if (y >= SPAWN_H && at < wanted.length && wanted[at] === '') {
            wanted[at] = `g${run.piece.type}`;
          }
        }
      }
      if (run.piece) {
        for (const [x, y] of cellsOf(run.piece)) {
          const at = (y - SPAWN_H) * WELL_W + x;
          if (y >= SPAWN_H && at >= 0 && at < wanted.length) wanted[at] = String(run.piece.type);
        }
      }
    }

    for (let i = 0; i < wanted.length; i++) {
      const value = wanted[i]!;
      if (this.painted[i] === value) continue;
      this.painted[i] = value;
      const cell = this.cells[i]!;
      if (value === '') delete cell.dataset.cell;
      else cell.dataset.cell = value;
    }

    this.paintSlot(this.holdSlot, view.run.hold, view.run.holdUsed);
    this.nextSlots.forEach((slot, index) => {
      this.paintSlot(slot, view.preview[index] ?? null, false);
    });

    const stopped = view.phase === 'ready';
    this.resumeButton.hidden = !stopped;
    this.resumeButton.textContent = view.run.placed > 0 || view.run.score > 0 ? 'Tap to go on' : 'Start';

    this.live = view.phase === 'playing';
    if (!this.live) this.gesture = null;
    this.holdSlot.disabled = !this.live;
  }

  /** One mini-piece in the tray. `spent` dims a hold that cannot be used again. */
  private paintSlot(slot: HTMLElement, type: number | null, spent: boolean): void {
    const token = type === null ? 'empty' : `${type}${spent ? 's' : ''}`;
    if (slot.dataset.piece === token) return;
    slot.dataset.piece = token;
    slot.classList.toggle('is-spent', spent);
    slot.innerHTML = type === null ? '' : miniPiece(type);
    slot.setAttribute('aria-label', type === null ? 'empty' : `${PIECE_NAMES[type]} piece`);
  }

  /** The sounds and the flash for whatever just happened. */
  play(effect: Effect): void {
    switch (effect.kind) {
      case 'moved':
        sfx.select();
        break;
      case 'rotated':
        sfx.note(440, 0.05);
        break;
      case 'held':
        sfx.note(330, 0.09);
        break;
      case 'refused':
        sfx.reject();
        break;
      case 'locked':
        if (effect.lines === 0) {
          sfx.pour(1);
          return;
        }
        if (effect.lines === 4) sfx.win();
        else sfx.complete();
        this.flash(effect.lines);
        break;
      case 'over':
        sfx.lose();
        break;
      default:
        break;
    }
  }

  /**
   * A brief flash across the whole well when rows clear.
   *
   * Deliberately not a per-row animation. The rows are already gone by the time
   * this is called — the state changed, which is what triggered the redraw — so
   * showing them would mean cloning elements out of the board and hiding them
   * later, which is the exact shape of the bug that has cost this project the
   * most time. One class on one element, one handle, cleared on `cancel()`.
   */
  private flash(lines: number): void {
    this.well.classList.remove('is-clearing');
    this.well.dataset.clear = String(lines);
    // Reading `offsetWidth` restarts the animation when two clears land close
    // together; without it the class is already present and nothing replays.
    void this.well.offsetWidth;
    this.well.classList.add('is-clearing');
    this.later(() => this.well.classList.remove('is-clearing'), FLASH_MS);
  }

  /**
   * Stops everything pending and forgets any finger on the well.
   *
   * Called on any reset. Anything deferred here assumes the board it was
   * started against, and a new game replaces that board.
   */
  cancel(): void {
    for (const handle of this.timers) {
      window.clearTimeout(handle);
      window.clearInterval(handle);
    }
    this.timers.clear();
    this.gesture = null;
    this.well.classList.remove('is-clearing');
  }

  private later(fn: () => void, ms: number): number {
    const handle = window.setTimeout(() => {
      this.timers.delete(handle);
      fn();
    }, ms);
    this.timers.add(handle);
    return handle;
  }
}

/** A piece drawn small, for the hold and next slots. */
function miniPiece(type: number): string {
  const cells = CELLS[type]?.[0] ?? [];
  const xs = cells.map(([x]) => x);
  const ys = cells.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(...xs) - minX + 1;
  const height = Math.max(...ys) - minY + 1;
  const colour = paint(PIECE_PAINTS[type] ?? 0);

  const blocks = cells
    .map(
      ([x, y]) =>
        `<div class="tt-mini-cell" style="grid-area:${y - minY + 1}/${x - minX + 1}"></div>`,
    )
    .join('');

  return (
    `<div class="tt-mini" style="--mini-cols:${width};--mini-rows:${height};` +
    `--p:${colour.hex};--p-shade:${colour.shade}">${blocks}</div>`
  );
}

/** The palette entries the stylesheet needs, as a block of custom properties. */
export function pieceColourVars(): string {
  return PIECE_PAINTS.map((index, type) => {
    const colour = paint(index);
    return `--tt-p${type}:${colour.hex};--tt-p${type}-shade:${colour.shade};`;
  }).join('');
}
