/**
 * Tetris's board: the well, the tray above it, and the pad below.
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
 * **This file owns the input repeat timers and nothing else.** Holding left
 * should walk the piece across, which is a timer, and it is presentation in the
 * sense that matters: it turns one gesture into a series of ordinary actions
 * the controller already understands. Every handle is in one set, `cancel()`
 * clears the lot, and the pad releases on `pointercancel` and `pointerleave` as
 * well as `pointerup` — a thumb that slides off a button has let go of it.
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

/** Milliseconds a finger must hold before a direction starts repeating. */
const REPEAT_DELAY_MS = 170;
/** And how fast it walks after that. */
const REPEAT_RATE_MS = 55;
/** How long the well flashes after a clear. */
const FLASH_MS = 220;

export interface RendererOptions {
  onPress: (action: Action) => void;
  onSoftDrop: (down: boolean) => void;
  /** The board was tapped while stopped — start, or carry on. */
  onResume: () => void;
}

/** One button on the pad. */
interface PadSpec {
  action: Action | 'resume';
  label: string;
  icon: string;
  /** Holding it repeats the action. */
  repeats?: boolean;
  /** Holding it is soft drop, which is a clock change rather than a repeat. */
  soft?: boolean;
  className?: string;
}

const arrow = (d: string): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

const PAD: PadSpec[] = [
  {
    action: 'ccw',
    label: 'Turn left',
    className: 'tt-key--ccw',
    icon: arrow('M7.5 9.5A6 6 0 1 1 6 14M7.5 4.5v5h5'),
  },
  {
    action: 'cw',
    label: 'Turn right',
    className: 'tt-key--cw',
    icon: arrow('M16.5 9.5A6 6 0 1 0 18 14M16.5 4.5v5h-5'),
  },
  {
    action: 'hold',
    label: 'Hold',
    className: 'tt-key--hold',
    icon: arrow('M6 5h5v14H6zM14 8.5h4v7h-4z'),
  },
  {
    action: 'hard',
    label: 'Drop',
    className: 'tt-key--drop',
    icon: arrow('M12 4v11M7 11l5 5 5-5M5.5 20h13'),
  },
  {
    action: 'left',
    label: 'Left',
    repeats: true,
    className: 'tt-key--left',
    icon: arrow('M14.5 6l-6 6 6 6'),
  },
  {
    action: 'soft',
    label: 'Down',
    soft: true,
    className: 'tt-key--down',
    icon: arrow('M12 5.5v11M7.5 12l4.5 4.5 4.5-4.5'),
  },
  {
    action: 'right',
    label: 'Right',
    repeats: true,
    className: 'tt-key--right',
    icon: arrow('M9.5 6l6 6-6 6'),
  },
];

export class BoardRenderer {
  private readonly well: HTMLDivElement;
  private readonly cells: HTMLDivElement[] = [];
  /** What each cell was last told to be, so a redraw writes only differences. */
  private readonly painted: string[] = [];

  private readonly holdSlot: HTMLDivElement;
  private readonly nextSlots: HTMLDivElement[] = [];
  private readonly resumeButton: HTMLButtonElement;
  private readonly keys = new Map<string, HTMLButtonElement>();

  private readonly timers = new Set<number>();
  /** The direction currently repeating, so a second finger cannot start a second. */
  private repeating: number | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly tray: HTMLElement,
    private readonly pad: HTMLElement,
    private readonly options: RendererOptions,
  ) {
    /* ------------------------------------------------------------ tray */

    this.holdSlot = el('div', { class: 'tt-slot tt-slot--hold' });
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

    this.buildPad();
  }

  /* -------------------------------------------------------------- input */

  private buildPad(): void {
    for (const spec of PAD) {
      const button = el('button', {
        class: `tt-key ${spec.className ?? ''}`,
        type: 'button',
        'aria-label': spec.label,
      }, spec.icon) as HTMLButtonElement;

      // pointerdown rather than click: this is played at speed, and click waits
      // for the finger to lift, which is a whole gravity step at level twelve.
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        if (button.disabled) return;
        if (spec.soft) {
          this.options.onSoftDrop(true);
          this.options.onPress('soft');
        } else if (spec.repeats) {
          this.startRepeat(spec.action as Action);
        } else {
          this.options.onPress(spec.action as Action);
        }
      });

      // Every way a finger can stop pressing. `pointerleave` matters most:
      // sliding off the button is the commonest way to let go of one on glass,
      // and without it the piece keeps walking after the thumb has moved on.
      for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
        button.addEventListener(type, () => {
          if (spec.soft) this.options.onSoftDrop(false);
          else if (spec.repeats) this.stopRepeat();
        });
      }

      this.keys.set(spec.label, button);
      this.pad.append(button);
    }
  }

  private startRepeat(action: Action): void {
    this.stopRepeat();
    this.options.onPress(action);
    const handle = this.later(() => {
      const tick = window.setInterval(() => this.options.onPress(action), REPEAT_RATE_MS);
      this.timers.add(tick);
      this.repeating = tick;
    }, REPEAT_DELAY_MS);
    this.repeating = handle;
  }

  private stopRepeat(): void {
    if (this.repeating === null) return;
    window.clearTimeout(this.repeating);
    window.clearInterval(this.repeating);
    this.timers.delete(this.repeating);
    this.repeating = null;
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

    const live = view.phase === 'playing';
    for (const key of this.keys.values()) key.disabled = !live;
  }

  /** One mini-piece in the tray. `spent` dims a hold that cannot be used again. */
  private paintSlot(slot: HTMLDivElement, type: number | null, spent: boolean): void {
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
   * Stops everything pending and lets go of every button.
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
    this.repeating = null;
    this.well.classList.remove('is-clearing');
    this.options.onSoftDrop(false);
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
