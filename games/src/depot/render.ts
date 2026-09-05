/**
 * Depot renderer.
 *
 * Reads a GameState and draws it; it decides nothing. Three rules it keeps
 * deliberately, all of them learned the expensive way elsewhere in this repo:
 *
 *  - **No deferred DOM mutation that touches game state.** Undo is unlimited,
 *    so any timer that commits something visual is a race the player can win.
 *    The one thing here that outlives its own frame is the bus driving off the
 *    lot, and it is a *ghost*: an element that is not part of the board, whose
 *    handle is kept and cancelled on every rebuild.
 *
 *  - **The lot is its own stacking context.** A bus lifts above its neighbours
 *    while it is being tapped, and `isolation: isolate` is what stops that
 *    z-index competing with the settings sheet.
 *
 *  - **Every transient highlight is cleared before a new one goes on.** A
 *    lingering `is-hinted` on two buses at once makes the suggestion ambiguous
 *    and quietly breaks anything driving the game by clicking what is lit.
 */

import { glyphSvg, paint } from '../shared/palette';
import { el } from '../shared/ui';
import { type GameState, shownColor } from './game';
import { type Board, type Bus, isVertical } from './model';

export interface RenderOptions {
  reducedMotion: boolean;
  colorBlindShapes: boolean;
  onTap: (id: number) => void;
}

/** Inset of a bus inside its bays, as a share of one cell. */
const INSET = 0.06;

/**
 * How far down the queue is drawn before it is summarised.
 *
 * The whole queue is public information and the player is meant to plan from
 * it, but nobody plans thirty-six people ahead, and a wall of eighty dots is
 * less readable than a wall of thirty-six and a number.
 */
const QUEUE_SHOWN = 36;

const ARROWS: Record<string, string> = {
  up: 'M12 5 L12 19 M12 5 L7 10 M12 5 L17 10',
  down: 'M12 19 L12 5 M12 19 L7 14 M12 19 L17 14',
  left: 'M5 12 L19 12 M5 12 L10 7 M5 12 L10 17',
  right: 'M19 12 L5 12 M19 12 L14 7 M19 12 L14 17',
};

export function describeProgress(state: GameState): string {
  if (state.phase === 'loading' || !state.core || !state.generated) return 'Preparing…';
  const left = state.generated.queue.length - state.core.boarded;
  if (state.phase === 'won') return 'All aboard';
  return `${left} waiting`;
}

export class BoardRenderer {
  private options: RenderOptions;
  private readonly queueEl: HTMLElement;
  private readonly kerbEl: HTMLElement;
  private readonly lotEl: HTMLElement;
  private readonly bedEl: HTMLElement;

  private busEls: HTMLButtonElement[] = [];
  /** Drive-out animations. Not board state — see the header. */
  private ghosts: { node: HTMLElement; animation: Animation }[] = [];

  private signature = '';
  private cell = 44;

  constructor(private readonly root: HTMLElement, options: RenderOptions) {
    this.options = options;

    this.queueEl = el('div', { class: 'queue', 'aria-label': 'The queue' });
    this.kerbEl = el('div', { class: 'kerb', 'aria-label': 'Loading bays' });
    this.lotEl = el('div', { class: 'lot' });
    this.bedEl = el('div', { class: 'lot-bed', 'aria-hidden': 'true' });
    this.lotEl.append(this.bedEl);

    this.root.append(this.queueEl, this.kerbEl, this.lotEl);
  }

  setOptions(patch: Partial<RenderOptions>): void {
    this.options = { ...this.options, ...patch };
  }

  /** Cell size in px, set by the fit pass before each render. */
  setCell(cell: number): void {
    this.cell = cell;
    this.lotEl.style.setProperty('--cell', `${cell}px`);
  }

  render(state: GameState): void {
    const board = state.generated?.board;
    if (!board || !state.core) {
      this.lotEl.dataset.empty = 'true';
      this.queueEl.innerHTML = '';
      this.kerbEl.innerHTML = '';
      return;
    }
    delete this.lotEl.dataset.empty;

    const signature = `${state.level}:${board.buses.length}:${board.width}x${board.height}`;
    if (signature !== this.signature) {
      this.build(board);
      this.signature = signature;
    }

    this.paintLot(state, board);
    this.paintKerb(state);
    this.paintQueue(state);
  }

  /* ---------------------------------------------------------------- build */

  private build(board: Board): void {
    this.clearGhosts();
    for (const node of this.busEls) node.remove();
    this.busEls = [];

    this.lotEl.style.setProperty('--cols', String(board.width));
    this.lotEl.style.setProperty('--rows', String(board.height));

    this.bedEl.innerHTML = '';
    for (let cell = 0; cell < board.width * board.height; cell++) {
      this.bedEl.append(el('span', { class: 'bed-cell' }));
    }

    for (let id = 0; id < board.buses.length; id++) {
      const bus = board.buses[id] as Bus;
      const node: HTMLButtonElement = el('button', {
        class: `bus bus--${isVertical(bus.facing) ? 'v' : 'h'}`,
        type: 'button',
        'data-id': String(id),
      });
      node.innerHTML =
        '<span class="bus-body"></span>' +
        `<svg class="bus-arrow" viewBox="0 0 24 24" aria-hidden="true">` +
        `<path d="${ARROWS[bus.facing] as string}"/></svg>` +
        '<span class="bus-seats"></span>' +
        '<span class="bus-glyph"></span>';

      node.addEventListener('click', () => this.options.onTap(id));
      this.lotEl.append(node);
      this.busEls.push(node);
    }
  }

  /* ------------------------------------------------------------------ lot */

  private paintLot(state: GameState, board: Board): void {
    const drivable = new Set(state.drivable);

    for (let id = 0; id < board.buses.length; id++) {
      const node = this.busEls[id];
      if (!node) continue;
      const bus = board.buses[id] as Bus;
      const parked = state.core?.parked[id] === true;

      // Cleared for *every* bus, before the early return for one that has
      // left. A departed bus is only `hidden`, not gone, so a highlight left on
      // it still matches `.bus.is-hinted` — invisible on screen and ambiguous
      // to anything reading the DOM. `showHint` re-applies it afterwards for
      // the one bus it names.
      node.classList.remove('is-hinted');

      node.hidden = !parked;
      if (!parked) continue;

      const vertical = isVertical(bus.facing);
      node.style.left = `${(bus.x + INSET) * this.cell}px`;
      node.style.top = `${(bus.y + INSET) * this.cell}px`;
      node.style.width = `${((vertical ? 1 : bus.length) - INSET * 2) * this.cell}px`;
      node.style.height = `${((vertical ? bus.length : 1) - INSET * 2) * this.cell}px`;

      const color = shownColor(bus, state.revealed[id] === true, parked);
      this.dressBus(node, bus, color);

      node.classList.toggle('is-drivable', drivable.has(id));
      node.disabled = state.phase !== 'playing';
      node.setAttribute('aria-label', this.describeBus(bus, color, drivable.has(id)));
    }
  }

  private dressBus(node: HTMLElement, bus: Bus, color: number | null): void {
    const seats = node.querySelector('.bus-seats') as HTMLElement;
    const glyph = node.querySelector('.bus-glyph') as HTMLElement;

    // The seat count is never hidden. Only the *colour* of a `?` bus is
    // unknown — how many it holds and which way it faces are as readable as on
    // any other bus, and blanking them would turn a decision with one unknown
    // in it into a decision with three.
    seats.textContent = String(bus.capacity);

    if (color === null) {
      node.classList.add('is-unknown');
      node.style.removeProperty('--bus');
      node.style.removeProperty('--bus-shade');
      glyph.textContent = '?';
      return;
    }

    node.classList.remove('is-unknown');
    const shade = paint(color);
    node.style.setProperty('--bus', shade.hex);
    node.style.setProperty('--bus-shade', shade.shade);
    glyph.innerHTML = this.options.colorBlindShapes ? glyphSvg(color, 'glyph') : '';
  }

  private describeBus(bus: Bus, color: number | null, drivable: boolean): string {
    const name = color === null ? 'Hidden colour' : paint(color).name;
    const way = drivable ? 'clear to leave' : 'blocked in';
    return `${name} bus, ${bus.capacity} seats, facing ${bus.facing}, ${way}`;
  }

  /* ----------------------------------------------------------------- kerb */

  private paintKerb(state: GameState): void {
    const bays = state.core?.bays ?? [];
    this.kerbEl.innerHTML = '';

    for (let index = 0; index < bays.length; index++) {
      const bay = bays[index];
      const slot = el('div', { class: 'bay' });

      if (!bay) {
        slot.classList.add('is-empty');
        slot.setAttribute('aria-label', `Bay ${index + 1}, free`);
        this.kerbEl.append(slot);
        continue;
      }

      const shade = paint(bay.color);
      slot.style.setProperty('--bus', shade.hex);
      slot.style.setProperty('--bus-shade', shade.shade);
      slot.setAttribute(
        'aria-label',
        `Bay ${index + 1}, ${shade.name} bus, ${bay.loaded} of ${bay.capacity} aboard`,
      );

      const seats = el('span', { class: 'bay-seats' });
      for (let seat = 0; seat < bay.capacity; seat++) {
        seats.append(el('i', { class: seat < bay.loaded ? 'seat is-taken' : 'seat' }));
      }

      slot.append(
        el('span', { class: 'bay-bus' }, this.options.colorBlindShapes ? glyphSvg(bay.color, 'glyph') : ''),
        seats,
      );
      this.kerbEl.append(slot);
    }
  }

  /* ---------------------------------------------------------------- queue */

  private paintQueue(state: GameState): void {
    const level = state.generated;
    const core = state.core;
    this.queueEl.innerHTML = '';
    if (!level || !core) return;

    const remaining = level.queue.slice(core.boarded);
    const shown = remaining.slice(0, QUEUE_SHOWN);

    for (let i = 0; i < shown.length; i++) {
      const color = shown[i] as number;
      const pip = el('span', {
        class: i === 0 ? 'pip is-front' : 'pip',
        style: `--pip: ${paint(color).hex}`,
        title: paint(color).name,
      });
      if (this.options.colorBlindShapes) pip.innerHTML = glyphSvg(color, 'glyph');
      this.queueEl.append(pip);
    }

    if (remaining.length > shown.length) {
      this.queueEl.append(el('span', { class: 'pip-more' }, `+${remaining.length - shown.length}`));
    }
    if (remaining.length === 0) {
      this.queueEl.append(el('span', { class: 'pip-more' }, 'Queue clear'));
    }
  }

  /* -------------------------------------------------------------- effects */

  /**
   * The bus driving off the lot.
   *
   * Drawn as a ghost rather than by animating the bus itself, because the state
   * change that triggers this render has already taken the bus off the board.
   * The ghost is decoration with no state behind it, so an undo landing inside
   * its window simply clears it — there is nothing for a stale timer to commit.
   */
  showDeparture(board: Board, id: number): void {
    if (this.options.reducedMotion) return;
    const source = this.busEls[id];
    const bus = board.buses[id];
    if (!source || !bus) return;

    // A clone carries the original's classes, and `is-hinted` among them was
    // enough to make two elements match `.bus.is-hinted` for the 460ms this
    // lives — one of them a bus that had already left. The ghost is decoration,
    // so it is stripped of everything that identifies a bus to anything else:
    // its id, its state classes, the focus order and the accessibility tree.
    const node = source.cloneNode(true) as HTMLElement;
    node.className = 'bus bus--ghost';
    if (source.classList.contains('bus--v')) node.classList.add('bus--v');
    else node.classList.add('bus--h');
    if (source.classList.contains('is-unknown')) node.classList.add('is-unknown');
    node.hidden = false;
    node.removeAttribute('data-id');
    node.setAttribute('aria-hidden', 'true');
    node.setAttribute('tabindex', '-1');
    (node as HTMLButtonElement).disabled = true;
    this.lotEl.append(node);

    const distance = Math.max(board.width, board.height) * this.cell;
    const shift =
      bus.facing === 'up'
        ? `translateY(${-distance}px)`
        : bus.facing === 'down'
          ? `translateY(${distance}px)`
          : bus.facing === 'left'
            ? `translateX(${-distance}px)`
            : `translateX(${distance}px)`;

    const animation = node.animate(
      [
        { transform: 'translate(0, 0)', opacity: 1 },
        { transform: shift, opacity: 0 },
      ],
      { duration: 460, easing: 'cubic-bezier(0.4, 0, 0.75, 1)' },
    );

    const entry = { node, animation };
    this.ghosts.push(entry);
    const drop = (): void => {
      node.remove();
      this.ghosts = this.ghosts.filter((ghost) => ghost !== entry);
    };
    animation.finished.then(drop, drop);
  }

  /** Cancels and removes every drive-out. Called on any rebuild of the board. */
  clearGhosts(): void {
    for (const ghost of this.ghosts) {
      ghost.animation.cancel();
      ghost.node.remove();
    }
    this.ghosts = [];
  }

  /** A tap that could not be taken. Nothing is committed, so nothing strands. */
  showReject(id: number): void {
    const node = this.busEls[id];
    if (!node || this.options.reducedMotion) return;
    node.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-3px)' },
        { transform: 'translateX(3px)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 200, easing: 'ease-in-out' },
    );
  }

  /** Marks the suggested bus. Exactly one is ever lit. */
  showHint(id: number): void {
    for (const node of this.busEls) node.classList.remove('is-hinted');
    const node = this.busEls[id];
    if (!node) return;
    node.classList.add('is-hinted');

    if (this.options.reducedMotion) return;
    node.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }],
      { duration: 620, easing: 'ease-in-out' },
    );
  }

  /** The kerb clearing. Purely decorative and self-cancelling. */
  celebrate(): void {
    if (this.options.reducedMotion) return;
    this.kerbEl.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }],
      { duration: 520, easing: 'ease-out' },
    );
  }
}
