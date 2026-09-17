/**
 * Simon's board: four quarter-circle pads round a hub.
 *
 * Built once and updated in place. The only things that change are which pad
 * is lit, whether the pads are live, and what the hub says — so there is
 * nothing to rebuild, and a lit pad is a class rather than a new element.
 *
 * **This file owns every timer in the game.** Showing the sequence is a chain
 * of them, a tapped pad lights for a moment, and a lost game flashes the pad
 * that was wanted. Every handle is kept in one set and `cancel()` clears the
 * lot, and the controller ignores a finished show whose id it no longer
 * recognises — so a new game, a restart or an opened sheet inside any of those
 * windows leaves nothing behind to fire against the state that replaced it.
 */

import { glyphSvg, paint } from '../shared/palette';
import { sfx } from '../shared/audio';
import { el } from '../shared/ui';
import { flashMs, gapMs } from './model';
import type { GameView } from './game';

/**
 * The classic board, clockwise from the top left, as palette indices.
 * Green, red, blue, yellow — the original's arrangement, which puts the two
 * warm and the two cool colours diagonally apart.
 */
const PAD_PAINTS = [2, 0, 1, 3] as const;

/**
 * The original's pitches, one per pad, low to high by the same order. Four
 * notes of a major chord rather than four arbitrary tones, which is why a
 * sequence is remembered as a tune as much as a picture.
 */
const PAD_NOTES = [329.63, 440, 554.37, 659.26] as const;
const NOTE_ORDER = [3, 2, 0, 1] as const;

/** Where each pad sits in the 2x2 grid, and which corner it rounds. */
const PAD_CORNERS = ['tl', 'tr', 'br', 'bl'] as const;

/** A beat before the next round, so the last tap and the first flash do not run together. */
const LEAD_MS = 850;
/** A beat before the very first flash after a tap on the hub. */
const START_MS = 450;
/** How long a tapped pad stays lit. */
const TAP_MS = 220;

export interface RendererOptions {
  onTapPad: (pad: number) => void;
  onTapHub: () => void;
  onShown: (showId: number) => void;
}

export class BoardRenderer {
  private readonly frame: HTMLDivElement;
  private readonly pads: HTMLButtonElement[] = [];
  private readonly hub: HTMLButtonElement;
  private readonly timers = new Set<number>();
  /** Per pad, so tapping the same pad twice quickly does not unlight the second tap early. */
  private readonly tapTimers = new Map<number, number>();
  private shapes = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly options: RendererOptions,
  ) {
    this.frame = el('div', { class: 'sm-frame' });

    PAD_PAINTS.forEach((paintIndex, pad) => {
      const colour = paint(paintIndex);
      const button = el('button', {
        class: `sm-pad sm-pad--${PAD_CORNERS[pad]}`,
        type: 'button',
        'aria-label': colour.name,
        style: `--pad:${colour.hex};--pad-shade:${colour.shade}`,
      });
      button.innerHTML = glyphSvg(paintIndex, 'sm-glyph');
      // pointerdown rather than click: Simon is played at speed, and click waits
      // for the finger to lift — long enough to fall a beat behind on round twenty.
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        if (!button.disabled) this.options.onTapPad(pad);
      });
      this.pads.push(button);
      this.frame.append(button);
    });

    this.hub = el('button', { class: 'sm-hub', type: 'button' });
    this.hub.addEventListener('click', () => this.options.onTapHub());
    this.frame.append(this.hub);

    this.root.append(this.frame);
  }

  setShapes(on: boolean): void {
    this.shapes = on;
    this.frame.classList.toggle('show-shapes', on);
  }

  render(view: GameView): void {
    this.root.classList.toggle('is-loading', view.phase === 'loading');
    this.frame.dataset.phase = view.phase;
    this.frame.classList.toggle('show-shapes', this.shapes);

    const live = view.phase === 'input';
    for (const pad of this.pads) pad.disabled = !live;

    this.hub.disabled = view.phase !== 'ready' && view.phase !== 'over';
    this.hub.innerHTML = hubText(view);
    this.hub.setAttribute('aria-label', hubLabel(view));
  }

  /**
   * Plays the round's sequence, then reports `showId` back.
   *
   * Each flash is scheduled from the start rather than chained from the last,
   * so timer drift does not accumulate over a long round, and every handle is
   * in `timers` for `cancel()` to find.
   */
  play(view: GameView, afterRound: boolean): void {
    // Straight after a round the only thing pending is the last tap's flash,
    // and cutting it off would swallow the one tap the player most wants to see
    // land. Nothing else can be pending: pads are not live while showing.
    if (!afterRound) this.cancel();
    const { sequence, round, showId } = view;
    const on = flashMs(round);
    const step = on + gapMs(round);
    const lead = afterRound ? LEAD_MS : START_MS;

    sequence.forEach((pad, index) => {
      this.later(() => this.light(pad, on), lead + index * step);
    });
    this.later(() => this.options.onShown(showId), lead + sequence.length * step - gapMs(round));
  }

  /** A pad the player has just tapped. */
  tapped(pad: number): void {
    const previous = this.tapTimers.get(pad);
    if (previous !== undefined) {
      window.clearTimeout(previous);
      this.timers.delete(previous);
    }
    this.pads[pad]?.classList.add('is-lit');
    sfx.note(noteFor(pad), TAP_MS / 1000 + 0.08);
    const handle = this.later(() => {
      this.pads[pad]?.classList.remove('is-lit');
      this.tapTimers.delete(pad);
    }, TAP_MS);
    this.tapTimers.set(pad, handle);
  }

  /**
   * The game is lost: the wrong pad is marked, and the right one flashes.
   *
   * The board says what happened, which is why the result sheet does not.
   * Calls `done` once the flashing has had time to be seen.
   */
  lost(pad: number, expected: number, done: () => void): void {
    this.cancel();
    this.pads[pad]?.classList.add('is-wrong');
    sfx.lose();
    for (let i = 0; i < 3; i++) this.later(() => this.light(expected, 240, false), 300 + i * 380);
    this.later(done, 1500);
  }

  /** Stops every pending flash, and puts every pad back to dark. */
  cancel(): void {
    for (const handle of this.timers) window.clearTimeout(handle);
    this.timers.clear();
    this.tapTimers.clear();
    for (const pad of this.pads) pad.classList.remove('is-lit', 'is-wrong');
  }

  private light(pad: number, ms: number, sound = true): void {
    const button = this.pads[pad];
    if (!button) return;
    button.classList.add('is-lit');
    if (sound) sfx.note(noteFor(pad), ms / 1000);
    this.later(() => button.classList.remove('is-lit'), ms);
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

const noteFor = (pad: number): number => PAD_NOTES[NOTE_ORDER[pad] ?? 0] ?? 440;

function hubText(view: GameView): string {
  switch (view.phase) {
    case 'loading':
      return '';
    case 'ready':
      return view.score > 0
        ? `<b>${view.round}</b><span>Tap to go on</span>`
        : `<b class="sm-hub-go">Start</b>`;
    case 'over':
      return `<b>${view.score}</b><span>New game</span>`;
    default:
      return `<b>${view.round}</b>`;
  }
}

function hubLabel(view: GameView): string {
  switch (view.phase) {
    case 'ready':
      return view.score > 0 ? `Continue round ${view.round}` : 'Start';
    case 'showing':
      return `Round ${view.round}, watch`;
    case 'input':
      return `Round ${view.round}, your turn`;
    case 'over':
      return 'New game';
    default:
      return '';
  }
}

/** The line under the board. Short: it is read at a glance mid-round. */
export function describeStatus(view: GameView): string {
  switch (view.phase) {
    case 'ready':
      return view.score > 0 ? `Round ${view.round}` : '';
    case 'showing':
      return 'Watch';
    case 'input':
      return 'Your turn';
    case 'over':
      return '';
    default:
      return '';
  }
}

export function describeRecord(view: GameView): string {
  return view.best > 0 ? `Best ${view.best}` : '';
}
