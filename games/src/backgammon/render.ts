/**
 * Backgammon renderer.
 *
 * The board never changes shape — twenty-four points, a bar and two trays,
 * forever — so the whole thing is built once and updated in place. Only the
 * checkers are rebuilt, which is cheap at thirty spans and means there is no
 * per-checker identity to keep in step with the model.
 *
 * **The board is laid out in whichever player's numbering is on the move.** Each
 * of them numbers the points from their own home, so the same physical point is
 * 6 to one player and 19 to the other; the layout here follows the player whose
 * turn it is, which puts their home board bottom right and sends their checkers
 * right to left along the bottom, exactly as it would be if they were sitting
 * at the board. Two people sharing one phone therefore never have to read the
 * board upside down, and the whole thing turning over is also the clearest
 * possible signal that the turn has changed hands.
 *
 * Nothing here is deferred. There is no timer that commits a visual change
 * later, so there is no window in which an undo can leave a stranded animation
 * behind — the one bug class that has cost this project real time.
 */

import { type Player, BAR, OFF, OPPONENT, POINTS, countAt } from './board';
import { NAMES, type GameView } from './game';

export interface RendererOptions {
  reducedMotion: boolean;
  /** Mark each side with a glyph as well as a colour. */
  shapes: boolean;
  onTapPoint: (point: number) => void;
  onTapOff: () => void;
}

/** Pixel sizes, solved for by `fitBoard`. See `main.ts`. */
export interface Metrics {
  unit: number;
  half: number;
  checker: number;
}

/** Slots 0-11 are the top row, left to right; 12-23 the bottom row. */
const SLOTS = 24;
const DIE_PIPS = 9;
/** Checkers drawn before the stack starts overlapping itself. */
const FLAT_STACK = 5;

/**
 * Which absolute point a screen slot is showing.
 *
 * White's numbering is the one the board is stored in, so White's layout is the
 * literal one; Red's is the same board read from the other end, which is the
 * single reflection `i -> 23 - i`. Everything else about the two views —
 * trays, bar, direction of travel — falls out of this one line.
 */
export function pointForSlot(slot: number, view: Player): number {
  const white = slot < 12 ? 12 + slot : 11 - (slot - 12);
  return view === 'white' ? white : POINTS - 1 - white;
}

/** What the player looking at the board would call this point. */
export function labelForPoint(point: number, view: Player): number {
  return view === 'white' ? point + 1 : POINTS - point;
}

export class BoardRenderer {
  private options: RendererOptions;
  private metrics: Metrics = { unit: 26, half: 140, checker: 24 };

  private readonly frame: HTMLElement;
  private readonly points: HTMLButtonElement[] = [];
  private readonly stacks: HTMLElement[] = [];
  private readonly bar: HTMLButtonElement;
  private readonly barNear: HTMLElement;
  private readonly barFar: HTMLElement;
  private readonly dice: HTMLElement;
  private readonly trays: Record<'near' | 'far', HTMLElement> = {
    near: element('button', 'bg-tray bg-tray--near'),
    far: element('div', 'bg-tray bg-tray--far'),
  };

  constructor(private readonly root: HTMLElement, options: RendererOptions) {
    this.options = options;

    this.frame = element('div', 'bg-frame');
    // Its own stacking context. Checkers take a z-index from their position in
    // the stack, and without this they compete with the settings sheet.
    this.frame.style.isolation = 'isolate';

    this.frame.append(this.trays.far);

    for (let slot = 0; slot < SLOTS; slot++) {
      const point = document.createElement('button');
      point.type = 'button';
      point.className = `bg-point ${slot < 12 ? 'bg-point--top' : 'bg-point--bottom'}`;
      point.style.gridRow = slot < 12 ? '2' : '4';
      point.style.gridColumn = String(columnFor(slot));
      // Alternating light and dark, and offset between the two rows so a point
      // never sits directly under one of its own colour.
      const shade = (slot + (slot < 12 ? 0 : 1)) % 2 === 0 ? 'is-a' : 'is-b';
      point.append(element('span', `bg-tri ${shade}`));

      const stack = element('span', 'bg-stack');
      point.append(stack);
      point.addEventListener('click', () => {
        const target = Number(point.dataset.point);
        if (Number.isFinite(target)) this.options.onTapPoint(target);
      });

      this.points.push(point);
      this.stacks.push(stack);
      this.frame.append(point);
    }

    this.bar = document.createElement('button');
    this.bar.type = 'button';
    this.bar.className = 'bg-bar';
    this.barFar = element('span', 'bg-bar-zone bg-bar-zone--far');
    this.barNear = element('span', 'bg-bar-zone bg-bar-zone--near');
    this.bar.append(this.barFar, this.barNear);
    this.bar.addEventListener('click', () => this.options.onTapPoint(BAR));

    this.dice = element('div', 'bg-dice');
    this.trays.near.addEventListener('click', () => this.options.onTapOff());

    this.frame.append(this.bar, this.dice, this.trays.near);
    this.root.append(this.frame);
  }

  setOptions(patch: Partial<RendererOptions>): void {
    this.options = { ...this.options, ...patch };
  }

  setMetrics(metrics: Metrics): void {
    this.metrics = metrics;
  }

  /* ---------------------------------------------------------------- draw */

  render(view: GameView): void {
    this.root.classList.toggle('is-loading', view.phase === 'loading');
    this.frame.classList.toggle('is-white', view.view === 'white');
    this.frame.classList.toggle('is-red', view.view === 'red');
    this.frame.classList.toggle('is-over', view.phase === 'finished');

    const position = view.position;
    const opponent = OPPONENT[view.view];

    for (let slot = 0; slot < SLOTS; slot++) {
      const point = this.points[slot] as HTMLButtonElement;
      const stack = this.stacks[slot] as HTMLElement;
      const index = pointForSlot(slot, view.view);
      point.dataset.point = String(index);

      const white = position ? countAt(position.board, index, 'white') : 0;
      const red = position ? countAt(position.board, index, 'red') : 0;
      const owner: Player | null = white > 0 ? 'white' : red > 0 ? 'red' : null;
      const count = white + red;

      this.paintStack(stack, count, owner, slot < 12);

      point.classList.toggle('can-move', view.movable.includes(index));
      point.classList.toggle('is-selected', view.selected === index);
      point.classList.toggle('is-target', view.targets.includes(index));
      point.disabled = view.phase !== 'playing';

      const label = labelForPoint(index, view.view);
      point.setAttribute(
        'aria-label',
        count === 0
          ? `Point ${label}, empty`
          : `Point ${label}, ${count} ${NAMES[owner ?? 'white']}`,
      );
    }

    const barMine = position ? position.board.bar[view.view] : 0;
    const barTheirs = position ? position.board.bar[opponent] : 0;
    // Both halves of the bar fill towards the middle, so a checker waiting to
    // come back is always against the board it has to enter.
    this.paintStack(this.barNear, barMine, view.view, true);
    this.paintStack(this.barFar, barTheirs, opponent, false);
    this.bar.classList.toggle('can-move', view.movable.includes(BAR));
    this.bar.classList.toggle('is-selected', view.selected === BAR);
    this.bar.disabled = view.phase !== 'playing' || barMine === 0;
    this.bar.setAttribute(
      'aria-label',
      barMine === 0 ? 'The bar, empty' : `The bar, ${barMine} ${NAMES[view.view]} to enter`,
    );

    this.paintTray(this.trays.near, view, view.view, true);
    this.paintTray(this.trays.far, view, opponent, false);
    this.paintDice(view);
  }

  /** One point's worth of checkers, stacked in from the edge it hangs off. */
  private paintStack(
    stack: HTMLElement,
    count: number,
    owner: Player | null,
    fromTop: boolean,
  ): void {
    stack.replaceChildren();
    if (!owner || count === 0) return;

    const { half, checker } = this.metrics;
    // Past five, the stack folds in on itself rather than growing off the board:
    // every checker still shows an edge, and the count on the last one says how
    // deep it really is.
    const room = Math.max(0, half - checker);
    const step =
      count > 1 ? Math.min(checker * 0.96, room / (count - 1), room / (FLAT_STACK - 1)) : 0;

    for (let i = 0; i < count; i++) {
      const piece = element('span', `bg-checker bg-checker--${owner}`);
      piece.style[fromTop ? 'top' : 'bottom'] = `${(i * step).toFixed(1)}px`;
      piece.style.zIndex = String(i + 1);
      if (this.options.shapes) piece.classList.add('has-glyph');
      if (i === count - 1 && count > FLAT_STACK) {
        piece.append(element('span', 'bg-count', String(count)));
      }
      stack.append(piece);
    }
  }

  /**
   * A tray: the player's name, their pip count, and fifteen slots filling up.
   *
   * The slots are the honest scoreboard of a game of backgammon — a row that is
   * two thirds full against one that is empty says everything a running score
   * would, without a number that has to be explained. The near one is also the
   * tap target for bearing off.
   */
  private paintTray(tray: HTMLElement, view: GameView, player: Player, near: boolean): void {
    const off = view.position?.board.off[player] ?? 0;
    tray.classList.toggle('is-target', near && view.targets.includes(OFF));
    tray.classList.toggle('is-turn', view.view === player);
    // Whose tray this is, on the tray itself. Deriving it from the frame's
    // turn class instead would be one more thing to keep in step every time
    // the board turns over, for no gain.
    tray.classList.toggle('is-white', player === 'white');
    tray.classList.toggle('is-red', player === 'red');

    const slots = Array.from(
      { length: 15 },
      (_, i) => `<span class="bg-slot${i < off ? ' is-filled' : ''}"></span>`,
    ).join('');

    tray.innerHTML =
      `<span class="bg-tray-name bg-tray-name--${player}">${NAMES[player]}</span>` +
      `<span class="bg-tray-pips">${view.pips[player]}</span>` +
      `<span class="bg-slots">${slots}</span>` +
      `<span class="bg-tray-off">${off}</span>`;

    if (near) {
      (tray as HTMLButtonElement).disabled = view.phase !== 'playing';
      tray.setAttribute('aria-label', `${NAMES[player]} tray, ${off} borne off`);
    }
  }

  /** One die per move the roll is worth, with the spent ones greyed. */
  private paintDice(view: GameView): void {
    const position = view.position;
    this.dice.replaceChildren();
    if (!position || !position.rolled || view.phase === 'finished') return;

    for (const [index, pip] of position.pips.entries()) {
      const die = element('span', 'bg-die');
      die.dataset.face = String(pip);
      die.innerHTML = '<span class="bg-pip"></span>'.repeat(DIE_PIPS);
      if (view.spent[index]) die.classList.add('is-spent');
      this.dice.append(die);
    }
  }

  /** Wipes the transient classes. Called whenever the board is rebuilt. */
  reset(): void {
    for (const point of this.points) {
      point.classList.remove('can-move', 'is-selected', 'is-target');
    }
    this.bar.classList.remove('can-move', 'is-selected');
    this.trays.near.classList.remove('is-target');
  }
}

/** Slots 0-5 and 12-17 sit left of the bar, the rest right of it. */
function columnFor(slot: number): number {
  const within = slot % 12;
  return within < 6 ? within + 1 : within + 2;
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * The line above the controls.
 *
 * It carries two things and no more: whose turn it is, and — when a tap could
 * not be played — the one short reason why. Everything else a player needs is
 * already on the board.
 */
export function describeTurn(view: GameView): string {
  if (view.phase === 'loading') return 'Setting up…';
  if (view.effect.kind === 'reject' && view.effect.note) return view.effect.note;

  const position = view.position;
  if (!position) return '';
  if (view.winner) return `${NAMES[view.winner]} wins`;

  const name = NAMES[position.player];
  if (!position.rolled) return `${name} to roll`;
  if (view.legal.length === 0) {
    return view.isPass ? `Nothing to play — pass to ${NAMES[OPPONENT[position.player]]}` : 'Dice played';
  }
  if (view.selected !== null) return 'Tap where it lands';
  return `${name} to move`;
}

/** The top bar's second line: the running tally, which is all this game keeps. */
export function describeTally(view: GameView): string {
  const { games, white, red } = view.record;
  if (games === 0) return 'First game';
  return `White ${white} · Red ${red}`;
}
