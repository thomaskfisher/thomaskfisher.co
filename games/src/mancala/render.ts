/**
 * Mancala renderer.
 *
 * **The board is drawn on its end.** A mancala board is eight pits wide and two
 * deep, which on a portrait phone leaves six pits sharing 300 pixels and seeds
 * too small to count — and counting seeds by eye is most of what playing this
 * game consists of. Turned ninety degrees it is two pits wide and eight deep,
 * which is the shape of the screen: a pit is then wide enough to hold thirty
 * seeds you can actually see.
 *
 * The turn costs nothing, because the loop survives it. Sowing runs down the
 * right column, across into south's store at the bottom, up the left column and
 * across into north's store at the top — one continuous lap, with each player's
 * store nearest them. It also puts the two pits of a capture side by side in
 * the same row, which is the one geometric relationship in the rules that a
 * player has to be able to see.
 *
 * **Seed positions are fixed per pit and per index.** Seed 7 is always in the
 * same place in pit 3, so dropping an eighth seed moves nothing that was
 * already there. A scatter that reshuffled itself on every sowing would make
 * the board impossible to count during the move it most matters.
 *
 * Nothing here is deferred. The DOM goes straight to the finished position and
 * the animations are decoration on top of it, so an undo during one cannot
 * leave a stranded element behind — the one bug class that has cost this
 * project real time.
 */

import { NORTH_STORE, SOUTH_STORE, type Move, type Seat, isStore, pitsOf } from './model';
import { NAMES, type GameView } from './game';

export interface RendererOptions {
  reducedMotion: boolean;
  onTapPit: (pit: Move) => void;
}

/**
 * How seeds are arranged in a bowl.
 *
 * A pit is about twice as wide as it is tall and a store about six times, so
 * they cannot share one arrangement. Both are grids rather than the scatter
 * this started as: a scatter placed on rings looked like seeds in a bowl and
 * then sliced a third of them in half against the edge, because a ring wide
 * enough to spread eight seeds across a pit is taller than the pit is.
 *
 * `max` is where the dots stop and the numeral carries it alone. Past two dozen
 * in a store the dots are a texture rather than a count, and the number beside
 * them was always the thing being read.
 */
const PIT_GRID = { columns: 6, rows: 3, stride: 7, max: 18, left: 0.06, right: 0.86 } as const;
/*
 * The store's grid stops short at both ends, because the store is the one bowl
 * with writing on it: the seat's name sits at the left and the count at the
 * right, and a seed under either is a seed nobody can see.
 */
const STORE_GRID = { columns: 11, rows: 2, stride: 7, max: 22, left: 0.14, right: 0.86 } as const;

/**
 * Where seed `index` sits inside a bowl, as a fraction of it.
 *
 * **Seed `index` never moves.** The grid slot is `index * stride` around the
 * whole grid, and a stride coprime with the slot count visits every slot
 * exactly once — so seeds spread out as they arrive instead of filling a corner
 * first, and adding one moves nothing that was already there. That last part is
 * the whole requirement: a bowl that reshuffled itself every time a seed landed
 * would be impossible to count during the move it most matters.
 *
 * The jitter is a cheap integer hash rather than a random number generator: it
 * has to give the same answer on every render, in every tab, forever, and that
 * is not worth an import.
 */
function seedSpot(
  bowl: number,
  index: number,
  grid: typeof PIT_GRID | typeof STORE_GRID,
): { x: number; y: number } {
  const slots = grid.columns * grid.rows;
  const slot = (index * grid.stride) % slots;
  const column = slot % grid.columns;
  const row = Math.floor(slot / grid.columns);

  const jitter = (n: number): number => {
    let value = (bowl * 73_856_093) ^ (index * 19_349_663) ^ (n * 83_492_791);
    value = Math.imul(value ^ (value >>> 15), 2_246_822_519);
    value = Math.imul(value ^ (value >>> 13), 3_266_489_917);
    return (((value ^ (value >>> 16)) >>> 0) / 4_294_967_296 - 0.5) * 0.34;
  };

  return {
    x: grid.left + ((column + 0.5 + jitter(1)) / grid.columns) * (grid.right - grid.left),
    y: (row + 0.5 + jitter(2)) / grid.rows,
  };
}

export class BoardRenderer {
  private options: RendererOptions;

  private readonly frame: HTMLElement;
  private readonly pits = new Map<number, HTMLButtonElement>();
  private readonly bowls = new Map<number, HTMLElement>();
  private readonly counts = new Map<number, HTMLElement>();
  /**
   * The sowing already animated.
   *
   * `render` is also called on a resize, with whatever view was last seen, so
   * without this a rotation would replay the light running down a move played
   * a minute ago. Identity rather than a flag: every sowing is a fresh object.
   */
  private animated: object | null = null;

  constructor(
    private readonly root: HTMLElement,
    options: RendererOptions,
  ) {
    this.options = options;

    this.frame = document.createElement('div');
    this.frame.className = 'mc-frame';
    // Its own stacking context. Seeds and the marks that say where to look both
    // take a z-index, and without this they compete with the settings sheet.
    this.frame.style.isolation = 'isolate';

    this.frame.append(this.buildStore('north'));
    for (const pit of pitsOf('south')) this.frame.append(this.buildPit(pit, 'south'));
    for (const pit of pitsOf('north')) this.frame.append(this.buildPit(pit, 'north'));
    this.frame.append(this.buildStore('south'));

    this.root.append(this.frame);
  }

  /**
   * One pit.
   *
   * South's six run down the right column, north's six up the left, which puts
   * the pair joined by the capture rule side by side in the same row. See the
   * file header.
   */
  private buildPit(pit: number, seat: Seat): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `mc-pit mc-pit--${seat}`;
    button.dataset.pit = String(pit);

    const index = seat === 'south' ? pit : 12 - pit;
    button.style.gridColumn = seat === 'south' ? '2' : '1';
    button.style.gridRow = String(2 + index);

    const bowl = element('span', 'mc-bowl');
    const count = element('span', 'mc-count');
    button.append(bowl, count);

    button.addEventListener('click', () => this.options.onTapPit(pit));

    this.pits.set(pit, button);
    this.bowls.set(pit, bowl);
    this.counts.set(pit, count);
    return button;
  }

  /** A store. Not a button: there is never anything to do to one. */
  private buildStore(seat: Seat): HTMLElement {
    const index = seat === 'south' ? SOUTH_STORE : NORTH_STORE;
    const store = element('div', `mc-store mc-store--${seat}`);
    store.style.gridRow = seat === 'north' ? '1' : '8';

    const bowl = element('span', 'mc-bowl mc-bowl--store');
    const count = element('span', 'mc-count mc-count--store');
    const name = element('span', 'mc-store-name', NAMES[seat]);
    store.append(bowl, count, name);

    this.bowls.set(index, bowl);
    this.counts.set(index, count);
    return store;
  }

  setOptions(patch: Partial<RendererOptions>): void {
    this.options = { ...this.options, ...patch };
  }

  /* ---------------------------------------------------------------- draw */

  render(view: GameView): void {
    this.root.classList.toggle('is-loading', view.phase === 'loading');
    this.frame.classList.toggle('is-over', view.phase === 'finished');
    this.frame.dataset.turn = view.turn;

    for (const [pit, button] of this.pits) {
      const seeds = view.board[pit] as number;
      this.paint(pit, seeds);

      const playable = view.legal.includes(pit);
      button.classList.toggle('can-play', playable);
      button.disabled = view.phase !== 'playing';
      button.setAttribute(
        'aria-label',
        `${ownerName(pit)} pit ${labelFor(pit)}, ${seeds} ${seeds === 1 ? 'seed' : 'seeds'}` +
          (playable ? ', playable' : ''),
      );
    }

    for (const store of [SOUTH_STORE, NORTH_STORE]) {
      this.paint(store, view.board[store] as number);
    }

    if (view.effect.kind === 'sown' && view.effect.result !== this.animated) {
      this.animated = view.effect.result;
      this.animateSow(view.effect.result.path);
    }
  }

  /** Seeds and the numeral. The numeral is not a fallback — players count. */
  private paint(index: number, seeds: number): void {
    const bowl = this.bowls.get(index);
    const count = this.counts.get(index);
    if (!bowl || !count) return;

    count.textContent = String(seeds);
    count.classList.toggle('is-zero', seeds === 0);

    // Rebuilt rather than diffed. Fourteen bowls of at most two dozen spans is
    // a few hundred elements at the very worst, once per tap.
    bowl.replaceChildren();
    const grid = isStore(index) ? STORE_GRID : PIT_GRID;
    const drawn = Math.min(seeds, grid.max);
    for (let i = 0; i < drawn; i++) {
      const spot = seedSpot(index, i, grid);
      const seed = element('span', 'mc-seed');
      seed.style.left = `${(spot.x * 100).toFixed(1)}%`;
      seed.style.top = `${(spot.y * 100).toFixed(1)}%`;
      seed.dataset.tint = String(i % 4);
      bowl.append(seed);
    }
  }

  /**
   * Runs a light down the path the seeds took.
   *
   * Decoration only: the board is already showing the finished position by the
   * time this starts, so an undo mid-animation costs an animation and nothing
   * else. `element.animate` rather than a class and a timeout for exactly that
   * reason — there is no deferred mutation to strand.
   */
  private animateSow(path: readonly number[]): void {
    if (this.options.reducedMotion) return;

    const step = path.length > 14 ? 34 : 62;
    for (const [order, index] of path.entries()) {
      const bowl = this.bowls.get(index);
      if (!bowl) continue;
      bowl.animate(
        [
          { transform: 'scale(1)', filter: 'brightness(1)' },
          { transform: 'scale(1.07)', filter: 'brightness(1.45)' },
          { transform: 'scale(1)', filter: 'brightness(1)' },
        ],
        { duration: 260, delay: order * step, easing: 'ease-out' },
      );
    }
  }

  /** Wipes the transient classes. Called whenever the board is rebuilt. */
  reset(): void {
    this.animated = null;
    for (const button of this.pits.values()) button.classList.remove('can-play');
  }
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const ownerName = (pit: number): string => (pit <= 5 ? NAMES.south : NAMES.north);

/** What the player would call this pit: 1 to 6, counting towards their store. */
const labelFor = (pit: number): number => (pit <= 5 ? pit + 1 : pit - 6);

/**
 * The line above the controls.
 *
 * Whose turn it is, why a tap did nothing, and — the one thing this game has to
 * say out loud — that the last move earned another turn. Landing in your own
 * store not passing the board on is the rule new players miss, and the board
 * alone cannot tell them: it looks exactly like the turn not having changed.
 */
export function describeTurn(view: GameView): string {
  if (view.phase === 'loading') return 'Setting up…';
  if (view.effect.kind === 'reject' && view.effect.note) return view.effect.note;

  if (view.phase === 'finished') {
    if (!view.winner) return `Drawn at ${view.scores.south} each`;
    return `${NAMES[view.winner]} wins ${Math.max(view.scores.south, view.scores.north)}–${Math.min(
      view.scores.south,
      view.scores.north,
    )}`;
  }

  const name = NAMES[view.turn];
  if (view.effect.kind === 'sown' && view.effect.result.extraTurn) {
    return `Landed in the store — ${name} goes again`;
  }
  if (view.effect.kind === 'sown' && view.effect.result.capture) {
    return `Captured ${view.effect.result.capture.seeds} — ${name} to play`;
  }
  return `${name} to play`;
}

/** The top bar's second line: the running tally, which is all this game keeps. */
export function describeTally(view: GameView): string {
  const { games, south, north } = view.record;
  if (games === 0) return 'First game';
  return `South ${south} · North ${north}`;
}
