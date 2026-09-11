/**
 * 2048 renderer.
 *
 * Draws the board from a GameState and owns the swipe gesture, which is a
 * property of the finger rather than of the game.
 *
 * **Tiles slide, and they do it without the renderer keeping any tile
 * identities.** The model reports where every tile came from
 * (`Position.movements`), so each tile is drawn where it *ended up* and then
 * animated from where it started — same picture as moving it, none of the
 * bookkeeping, and nothing left over to go stale on an undo.
 *
 * Every animation is a `element.animate()` that returns the element to its own
 * base style. Undo is unlimited here, so any `setTimeout` that commits
 * something visual is a race the player can win.
 */

import { el } from '../shared/ui';
import type { GameState } from './game';
import { Dir, faceOf } from './model';

export interface RenderOptions {
  reducedMotion: boolean;
  onSwipe: (direction: Dir) => void;
}

export function describeProgress(state: GameState): string {
  if (state.phase === 'loading' || !state.generated) return 'Preparing…';

  const target = faceOf(state.generated.target);
  if (state.phase === 'won') return `Reached ${target}`;
  if (state.phase === 'lost' && !state.outOfTime) return 'No moves left';
  return `reach ${target} · ${state.position.score}`;
}

/** A swipe has to travel this far before it counts as one. */
const SWIPE_SLOP = 24;

export class BoardRenderer {
  private options: RenderOptions;

  private readonly frameEl: HTMLElement;
  private readonly cellsEl: HTMLElement;
  private readonly tilesEl: HTMLElement;

  private size = 4;
  private signature = '';
  /**
   * The hint arrow currently on screen.
   *
   * Kept so a second hint replaces the first rather than stacking on top of it.
   * Letting them pile up is not just untidy: two arrows pointing different ways
   * is an ambiguous suggestion, and it silently breaks any automated
   * playthrough, which is how this was found — a hint-driven run read the stale
   * arrow every time and drove a level to a jammed board in a thousand moves.
   */
  private hintEl: HTMLElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    options: RenderOptions,
  ) {
    this.options = options;

    this.frameEl = el('div', { class: 'tf-board', 'aria-label': 'The board' });
    this.cellsEl = el('div', { class: 'tf-cells', 'aria-hidden': 'true' });
    this.tilesEl = el('div', { class: 'tf-tiles' });
    this.frameEl.append(this.cellsEl, this.tilesEl);
    this.root.append(this.frameEl);

    this.bindSwipes();
  }

  setOptions(patch: Partial<RenderOptions>): void {
    this.options = { ...this.options, ...patch };
  }

  setCell(size: number): void {
    this.frameEl.style.setProperty('--cell', `${size}px`);
  }

  render(state: GameState): void {
    const generated = state.generated;
    if (!generated) {
      this.frameEl.dataset.empty = 'true';
      return;
    }
    delete this.frameEl.dataset.empty;

    const signature = `${state.level}:${generated.size}`;
    if (signature !== this.signature) {
      this.build(generated.size);
      this.signature = signature;
    }

    // Any state change that is not itself a hint retires the arrow: it was
    // advice about a board that has moved on.
    if (state.effect.kind !== 'hint') this.clearHint();

    // Where each tile came from, so it can be animated in from there. A cell
    // with no entry did not move — it is the tile that just spawned.
    const cameFrom = new Map<number, { from: number; merged: boolean }>();
    if (state.effect.kind === 'move') {
      for (const movement of state.position.movements) {
        // Two tiles share a destination on a merge; either origin will do for
        // the slide, and the pop is what sells the merge anyway.
        if (!cameFrom.has(movement.to)) {
          cameFrom.set(movement.to, { from: movement.from, merged: movement.merged });
        }
      }
    }

    this.tilesEl.innerHTML = '';

    for (let cell = 0; cell < state.position.grid.length; cell++) {
      const exponent = state.position.grid[cell] as number;
      if (exponent === 0) continue;

      const tile = el(
        'div',
        {
          class: `tf-tile tf-tile--${Math.min(exponent, 12)}`,
          style: `--x:${cell % this.size};--y:${Math.floor(cell / this.size)}`,
        },
        String(faceOf(exponent)),
      );
      this.tilesEl.append(tile);

      if (this.options.reducedMotion) continue;

      const journey = cameFrom.get(cell);
      if (journey) {
        this.slideIn(tile, journey.from, cell, journey.merged);
      } else if (cell === state.position.lastSpawn && state.effect.kind === 'move') {
        tile.animate([{ transform: 'scale(0)' }, { transform: 'scale(1)' }], {
          duration: 150,
          delay: 90,
          easing: 'ease-out',
          fill: 'backwards',
        });
      }
    }

    this.frameEl.classList.toggle('is-over', state.phase !== 'playing');
  }

  /** Animates a tile from where it started to where it now is. */
  private slideIn(tile: HTMLElement, from: number, to: number, merged: boolean): void {
    const dx = (from % this.size) - (to % this.size);
    const dy = Math.floor(from / this.size) - Math.floor(to / this.size);

    if (dx !== 0 || dy !== 0) {
      tile.animate(
        [
          { transform: `translate(calc(${dx} * (var(--cell) + var(--gap))), calc(${dy} * (var(--cell) + var(--gap))))` },
          { transform: 'translate(0, 0)' },
        ],
        { duration: 110, easing: 'ease-out' },
      );
    }

    if (merged) {
      tile.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
        { duration: 160, delay: 100, easing: 'ease-out' },
      );
    }
  }

  /* ---------------------------------------------------------------- build */

  private build(size: number): void {
    this.size = size;
    this.frameEl.style.setProperty('--n', String(size));

    this.cellsEl.innerHTML = '';
    for (let cell = 0; cell < size * size; cell++) {
      this.cellsEl.append(el('span', { class: 'tf-cell' }));
    }
    this.tilesEl.innerHTML = '';
  }

  /* -------------------------------------------------------------- swipes */

  /**
   * Reads a swipe, and refuses to read anything else.
   *
   * The gesture is committed on release rather than as soon as it passes the
   * threshold, so a finger that wanders and comes back does not fire twice —
   * and the direction is whichever axis moved further, which is what makes a
   * sloppy diagonal do the obvious thing instead of nothing.
   */
  private bindSwipes(): void {
    let startX = 0;
    let startY = 0;
    let pointer: number | null = null;

    this.frameEl.addEventListener('pointerdown', (event) => {
      pointer = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      this.frameEl.setPointerCapture(event.pointerId);
    });

    const finish = (event: PointerEvent): void => {
      if (pointer !== event.pointerId) return;
      pointer = null;

      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.abs(dx) < SWIPE_SLOP && Math.abs(dy) < SWIPE_SLOP) return;

      if (Math.abs(dx) > Math.abs(dy)) {
        this.options.onSwipe(dx > 0 ? Dir.Right : Dir.Left);
      } else {
        this.options.onSwipe(dy > 0 ? Dir.Down : Dir.Up);
      }
    };

    this.frameEl.addEventListener('pointerup', finish);
    this.frameEl.addEventListener('pointercancel', () => {
      pointer = null;
    });
  }

  /** Nudges the board the way a refused swipe went, so the wall is felt. */
  showReject(direction: Dir): void {
    if (this.options.reducedMotion) return;
    const dx = direction === Dir.Left ? -6 : direction === Dir.Right ? 6 : 0;
    const dy = direction === Dir.Up ? -6 : direction === Dir.Down ? 6 : 0;

    this.frameEl.animate(
      [
        { transform: 'translate(0, 0)' },
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: 'translate(0, 0)' },
      ],
      { duration: 160, easing: 'ease-out' },
    );
  }

  /** Points the hint's direction out with an arrow across the board. */
  showHint(direction: Dir): void {
    this.clearHint();

    const arrow = el('div', { class: `tf-hint tf-hint--${direction}` }, HINT_ARROW);
    this.hintEl = arrow;
    this.frameEl.append(arrow);

    // `element.animate()` rather than a class plus a timer, and the element is
    // removed by the animation's own `finished` — so an undo mid-flight cannot
    // strand it.
    const animation = arrow.animate(
      [
        { opacity: 0, transform: 'scale(0.7)' },
        { opacity: 1, transform: 'scale(1)' },
        { opacity: 1, transform: 'scale(1)' },
        { opacity: 0, transform: 'scale(1.1)' },
      ],
      { duration: this.options.reducedMotion ? 900 : 1100, easing: 'ease-out' },
    );
    const drop = (): void => {
      arrow.remove();
      if (this.hintEl === arrow) this.hintEl = null;
    };
    void animation.finished.then(drop).catch(drop);
  }

  /** Takes the arrow down now, whatever its animation was going to do. */
  clearHint(): void {
    this.hintEl?.remove();
    this.hintEl = null;
  }

  celebrate(): void {
    if (this.options.reducedMotion) return;
    this.frameEl.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }],
      { duration: 420, easing: 'ease-in-out' },
    );
  }
}

const HINT_ARROW =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
