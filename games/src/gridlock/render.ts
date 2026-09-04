/**
 * Gridlock renderer.
 *
 * Draws the car park and the vehicles in it, and nothing else — it reads a
 * GameState and never decides anything. The one piece of state it does own is
 * which vehicle is under the player's finger, because that is a property of the
 * gesture rather than of the game.
 *
 * Three rules it keeps deliberately:
 *
 *  - **No deferred DOM mutation.** Every flash is an `element.animate()` that
 *    returns the element to its base style on its own, rather than a class plus
 *    a `setTimeout` to take it off again. Undo is unlimited here, so any timer
 *    that commits something visual is a race the player can win: they revert
 *    the state inside its window and the timer fires against a position that no
 *    longer exists. Screw Land lost whole plates to exactly that.
 *
 *  - **The park is its own stacking context.** A vehicle being dragged has to
 *    lift above its neighbours, and `isolation: isolate` is what keeps that
 *    z-index from competing with the settings sheet. Cheap, and added when the
 *    container was written rather than after someone reported the board drawing
 *    over a menu.
 *
 *  - **Every vehicle's place is a pure function of the position.** Undo,
 *    restart and a fresh level all move the cars correctly without any of them
 *    needing to know a renderer exists.
 */

import { paint } from '../shared/palette';
import { el } from '../shared/ui';
import type { GameState } from './game';
import { type Board, type Vehicle, EXIT_ROW, SIZE, TARGET, slideRange } from './model';

export interface RenderOptions {
  reducedMotion: boolean;
  /** Commit a slide: the vehicle, and the offset its leading cell lands on. */
  onSlide: (id: number, to: number) => void;
}

/** Inset of a vehicle inside its bays, as a share of one cell. */
const INSET = 0.07;

/** A tap is a press that travelled less than this many pixels. */
const TAP_SLOP = 6;

export function describeProgress(state: GameState): string {
  if (state.phase === 'loading' || !state.generated) return 'Preparing…';
  if (state.phase === 'won') return 'Out';
  const par = state.generated.moves;
  const plural = state.moveCount === 1 ? 'move' : 'moves';
  return `${state.moveCount} ${plural} · best ${par}`;
}

/**
 * Colour is decoration here, not information — a vehicle is told apart by where
 * it is and which way it faces, and no rule in the game refers to colour at
 * all. So the palette is spread across the vehicles for legibility only, red is
 * reserved for the target, and the shape-on-colour overlay is switched off in
 * Settings rather than offered as a row that would change nothing.
 */
function paintFor(id: number): { hex: string; shade: string } {
  if (id === TARGET) return { hex: '#e6394a', shade: '#a81d2c' };
  // Skips palette slot 0, which is the red the target owns.
  const chosen = paint(1 + ((id * 5) % 13));
  return { hex: chosen.hex, shade: chosen.shade };
}

interface Drag {
  id: number;
  pointer: number;
  /** Where the press started, in client coordinates. */
  originX: number;
  originY: number;
  /** The vehicle's offset when the press started. */
  base: number;
  /** Pixel bounds of the drag, relative to the start. */
  min: number;
  max: number;
  moved: boolean;
  element: HTMLElement;
}

export class BoardRenderer {
  private options: RenderOptions;
  private readonly parkEl: HTMLElement;
  private readonly baysEl: HTMLElement;
  private readonly exitEl: HTMLElement;
  private cars: HTMLElement[] = [];
  private targets: HTMLElement[] = [];

  private signature = '';
  private cell = 48;
  private drag: Drag | null = null;
  /**
   * The drive-out animation, which is the one thing here that mutates a style
   * beyond its own duration (`fill: forwards` leaves the target car off-screen).
   * The handle is kept so it can be cancelled the moment the state it assumes
   * stops being true — an undo out of a won level, a restart, or a new board.
   */
  private driveOut: Animation | null = null;
  /** The vehicle a tap selected, whose reachable bays are on screen. */
  private selected: number | null = null;
  private latest: GameState | null = null;

  constructor(private readonly root: HTMLElement, options: RenderOptions) {
    this.options = options;

    // `--exit-row` is published so the kerb's gap in CSS is positioned from the
    // model's own constant rather than from a second copy of it in a stylesheet.
    this.parkEl = el('div', { class: 'park', style: `--exit-row: ${EXIT_ROW}` });
    this.baysEl = el('div', { class: 'bays', 'aria-hidden': 'true' });
    this.exitEl = el('div', { class: 'exit', 'aria-hidden': 'true' });
    this.parkEl.append(this.baysEl, this.exitEl);
    this.root.append(this.parkEl);

    // Tapping anything that is not a car or one of its destination markers puts
    // the selection away, so the markers never linger over a board the player
    // has moved on from.
    this.parkEl.addEventListener('pointerdown', (event) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('.car') && !target?.closest('.slot')) this.clearSelection();
    });
  }

  setOptions(patch: Partial<RenderOptions>): void {
    this.options = { ...this.options, ...patch };
  }

  /** Cell size in px, set by the fit pass before each render. */
  setCell(cell: number): void {
    this.cell = cell;
    this.parkEl.style.setProperty('--cell', `${cell}px`);
  }

  render(state: GameState): void {
    this.latest = state;
    const board = state.generated?.board;
    if (!board) {
      this.parkEl.dataset.empty = 'true';
      return;
    }
    delete this.parkEl.dataset.empty;

    // Cancelled before anything else, because it is the one mutation that
    // outlives its own animation. Undo out of a won level lands here.
    if (state.phase !== 'won') this.cancelDriveOut();

    const signature = `${state.level}:${board.vehicles.length}`;
    if (signature !== this.signature) {
      this.build(board);
      this.signature = signature;
      this.selected = null;
      this.drag = null;
    }

    this.place(state, board);
    this.paintSelection(state, board);
  }

  /* ---------------------------------------------------------------- build */

  private build(board: Board): void {
    this.cancelDriveOut();
    for (const car of this.cars) car.remove();
    for (const marker of this.targets) marker.remove();
    this.cars = [];
    this.targets = [];

    this.baysEl.innerHTML = '';
    for (let cell = 0; cell < SIZE * SIZE; cell++) {
      this.baysEl.append(el('span', { class: 'bay' }));
    }

    for (let id = 0; id < board.vehicles.length; id++) {
      const vehicle = board.vehicles[id] as Vehicle;
      const colour = paintFor(id);

      const car = el('div', {
        class: `car car--${vehicle.orientation}${id === TARGET ? ' car--target' : ''}`,
        role: 'button',
        tabindex: '0',
        'data-id': String(id),
        style: `--car: ${colour.hex}; --car-shade: ${colour.shade}`,
        'aria-label':
          id === TARGET
            ? 'Your car. Drag it right to the exit.'
            : `${vehicle.orientation === 'h' ? 'Sideways' : 'Upright'} vehicle, ${vehicle.length} long`,
      });

      // The windows are what make a rectangle read as a car at a glance, and
      // they are also the fastest way to see which way one is facing.
      car.innerHTML =
        '<span class="car-body"></span><span class="car-glass"></span>' +
        (id === TARGET ? '<span class="car-mark" aria-hidden="true"></span>' : '');

      this.bindDrag(car, id);
      this.parkEl.append(car);
      this.cars.push(car);
    }
  }

  /* ------------------------------------------------------------- geometry */

  private place(state: GameState, board: Board): void {
    for (let id = 0; id < board.vehicles.length; id++) {
      const car = this.cars[id];
      if (!car) continue;
      // The car under the finger is positioned by the drag, not by the state.
      if (this.drag?.id === id) continue;

      const vehicle = board.vehicles[id] as Vehicle;
      const at = state.position[id] as number;
      const row = vehicle.orientation === 'h' ? vehicle.cross : at;
      const column = vehicle.orientation === 'h' ? at : vehicle.cross;
      const long = vehicle.length;

      car.style.transform = '';
      car.style.left = `${(column + INSET) * this.cell}px`;
      car.style.top = `${(row + INSET) * this.cell}px`;
      car.style.width = `${((vehicle.orientation === 'h' ? long : 1) - INSET * 2) * this.cell}px`;
      car.style.height = `${((vehicle.orientation === 'h' ? 1 : long) - INSET * 2) * this.cell}px`;
      car.classList.toggle('is-blocking', state.blockers.includes(id));
    }

    this.exitEl.style.top = `${EXIT_ROW * this.cell}px`;
    this.exitEl.style.height = `${this.cell}px`;
    this.parkEl.classList.toggle('is-won', state.phase === 'won');
  }

  /* ------------------------------------------------------------ selection */

  /**
   * The bays the selected vehicle could slide to, as tappable markers.
   *
   * Dragging is the gesture this game wants, but a drag is a bad first guess if
   * you have not been told it is one — and a car that only responds to being
   * hauled reads as unresponsive to a tap. So a tap selects, and the markers
   * say both "this one is selected" and "here is exactly how far it goes".
   */
  private paintSelection(state: GameState, board: Board): void {
    for (const marker of this.targets) marker.remove();
    this.targets = [];

    for (const car of this.cars) car.classList.remove('is-selected');
    if (this.selected === null || state.phase !== 'playing') return;

    const id = this.selected;
    this.cars[id]?.classList.add('is-selected');

    const vehicle = board.vehicles[id] as Vehicle;
    const { from, to } = slideRange(board, state.position, id);
    const at = state.position[id] as number;

    for (let offset = from; offset <= to; offset++) {
      if (offset === at) continue;
      // The marker sits on the bay the *leading* cell would land on, which is
      // the cell the player is aiming the car at.
      const lead = offset < at ? offset : offset + vehicle.length - 1;
      const row = vehicle.orientation === 'h' ? vehicle.cross : lead;
      const column = vehicle.orientation === 'h' ? lead : vehicle.cross;

      const marker = el('button', {
        class: 'slot',
        type: 'button',
        'data-to': String(offset),
        'aria-label': 'Slide here',
        style: `left:${column * this.cell}px; top:${row * this.cell}px; ` +
          `width:${this.cell}px; height:${this.cell}px`,
      });
      const destination = offset;
      marker.addEventListener('click', (event) => {
        event.stopPropagation();
        this.clearSelection();
        this.options.onSlide(id, destination);
      });

      this.parkEl.append(marker);
      this.targets.push(marker);
    }
  }

  private clearSelection(): void {
    if (this.selected === null) return;
    this.selected = null;
    if (this.latest) this.render(this.latest);
  }

  /* ----------------------------------------------------------------- drag */

  private bindDrag(car: HTMLElement, id: number): void {
    car.addEventListener('pointerdown', (event: PointerEvent) => {
      const state = this.latest;
      if (!state || state.phase !== 'playing' || !state.generated) return;
      if (this.drag) return;

      const at = state.position[id] as number;
      const { from, to } = slideRange(state.generated.board, state.position, id);

      event.preventDefault();
      // Guarded: capture throws if the pointer is no longer active by the time
      // this runs, and a drag that cannot capture should still be a drag —
      // losing the gesture entirely because of a housekeeping call would be
      // worse than tracking it without capture.
      try {
        car.setPointerCapture(event.pointerId);
      } catch {
        /* tracked without capture */
      }

      this.drag = {
        id,
        pointer: event.pointerId,
        originX: event.clientX,
        originY: event.clientY,
        base: at,
        min: (from - at) * this.cell,
        max: (to - at) * this.cell,
        moved: false,
        element: car,
      };

      car.classList.add('is-dragging');
    });

    car.addEventListener('pointermove', (event: PointerEvent) => {
      const drag = this.drag;
      if (!drag || drag.pointer !== event.pointerId) return;
      const state = this.latest;
      if (!state?.generated) return;

      const vehicle = state.generated.board.vehicles[drag.id] as Vehicle;
      const rawX = event.clientX - drag.originX;
      const rawY = event.clientY - drag.originY;
      if (Math.abs(rawX) > TAP_SLOP || Math.abs(rawY) > TAP_SLOP) drag.moved = true;

      const along = vehicle.orientation === 'h' ? rawX : rawY;
      const clamped = Math.max(drag.min, Math.min(drag.max, along));
      drag.element.style.transform =
        vehicle.orientation === 'h' ? `translateX(${clamped}px)` : `translateY(${clamped}px)`;
    });

    const finish = (event: PointerEvent): void => {
      const drag = this.drag;
      if (!drag || drag.pointer !== event.pointerId) return;
      const state = this.latest;

      drag.element.classList.remove('is-dragging');
      drag.element.style.transform = '';
      this.drag = null;

      if (!state?.generated) return;

      if (!drag.moved) {
        // A press that went nowhere is a tap: select, or put the selection away
        // if this vehicle already had it.
        this.selected = this.selected === drag.id ? null : drag.id;
        this.render(state);
        return;
      }

      const vehicle = state.generated.board.vehicles[drag.id] as Vehicle;
      const along =
        vehicle.orientation === 'h' ? event.clientX - drag.originX : event.clientY - drag.originY;
      const clamped = Math.max(drag.min, Math.min(drag.max, along));
      const to = drag.base + Math.round(clamped / this.cell);

      this.selected = null;
      if (to === drag.base) this.render(state);
      else this.options.onSlide(drag.id, to);
    };

    car.addEventListener('pointerup', finish);
    car.addEventListener('pointercancel', finish);

    // Keyboard, which is also how the browser harness plays a level.
    car.addEventListener('keydown', (event: KeyboardEvent) => {
      const state = this.latest;
      if (!state?.generated || state.phase !== 'playing') return;
      const vehicle = state.generated.board.vehicles[id] as Vehicle;
      const back = vehicle.orientation === 'h' ? 'ArrowLeft' : 'ArrowUp';
      const forward = vehicle.orientation === 'h' ? 'ArrowRight' : 'ArrowDown';
      if (event.key !== back && event.key !== forward) return;

      event.preventDefault();
      const { from, to } = slideRange(state.generated.board, state.position, id);
      const at = state.position[id] as number;
      const wanted = event.key === back ? at - 1 : at + 1;
      if (wanted < from || wanted > to) return;
      this.options.onSlide(id, wanted);
    });
  }

  /* -------------------------------------------------------------- effects */

  /**
   * Marks the suggested vehicle and the bay it should go to.
   *
   * Selecting the car puts its reachable bays on screen, and the destination
   * one is marked too — so the hint is a complete instruction rather than half
   * of one, and an automated playthrough has something unambiguous to click.
   */
  showHint(board: Board, id: number, to: number): void {
    const car = this.cars[id];
    if (!car) return;

    // The selection has to be applied before the redraw, not after: the redraw
    // is what builds the markers, and setting it afterwards would leave the
    // hint pointing at bays that are not on screen yet.
    this.selected = id;
    if (this.latest) this.render(this.latest);

    // Every transient highlight is cleared before the new one goes on. A
    // lingering mark on two cars at once makes the suggestion ambiguous, and
    // quietly breaks anything driving the game by clicking what is lit.
    for (const other of this.cars) other.classList.remove('is-hinted');
    for (const marker of this.targets) marker.classList.remove('is-hinted');

    car.classList.add('is-hinted');
    this.targets.find((marker) => marker.dataset.to === String(to))?.classList.add('is-hinted');

    if (this.options.reducedMotion) return;

    const vehicle = board.vehicles[id] as Vehicle;
    const at = Number(car.style[vehicle.orientation === 'h' ? 'left' : 'top'].replace('px', ''));
    const wanted = (to + INSET) * this.cell;
    const axis = vehicle.orientation === 'h' ? 'translateX' : 'translateY';
    const nudge = Math.sign(wanted - at) * Math.min(this.cell * 0.3, Math.abs(wanted - at));

    car.animate(
      [
        { transform: `${axis}(0px)` },
        { transform: `${axis}(${nudge}px)` },
        { transform: `${axis}(0px)` },
      ],
      { duration: 620, easing: 'ease-in-out' },
    );
  }

  /** A slide that could not be taken. Nothing is committed, so nothing strands. */
  showReject(id: number): void {
    const car = this.cars[id];
    if (!car || this.options.reducedMotion) return;
    car.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-3px)' },
        { transform: 'translateX(3px)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 200, easing: 'ease-in-out' },
    );
  }

  private cancelDriveOut(): void {
    this.driveOut?.cancel();
    this.driveOut = null;
  }

  /** The target car driving out through the gap. */
  celebrate(): void {
    const car = this.cars[TARGET];
    if (!car || this.options.reducedMotion) return;
    this.cancelDriveOut();
    this.driveOut = car.animate(
      [
        { transform: 'translateX(0)', opacity: 1 },
        { transform: `translateX(${this.cell * 2.2}px)`, opacity: 0 },
      ],
      { duration: 620, easing: 'cubic-bezier(0.45, 0, 0.7, 1)', fill: 'forwards' },
    );
  }
}
