/**
 * Mexican Train renderer.
 *
 * **The board is a list of trains, not a picture of a table.** A real Mexican
 * Train layout is a star: the engine in the middle with a train running off it
 * in every direction. Drawn to scale on a phone that is four diagonal lines
 * three tiles long and then nothing, because a train of nine tiles is longer
 * than the screen whichever way it points. So each train gets a row of its own
 * with its open end pinned to the right-hand edge, and a row that has outgrown
 * the screen clips at the left — the far end of a train is history, and the end
 * you can play on is the only part anybody looks at.
 *
 * **The hand is withheld, not hidden.** While the curtain is down the view
 * carries no tiles at all (see `game.ts`), so there is nothing in the DOM for
 * the next player to find. What this file draws over the tray is a prompt, not
 * a lid.
 *
 * Nothing here is deferred. The DOM goes straight to the finished position and
 * the animations are decoration on top of it, so an undo during one cannot
 * leave a stranded element behind — the one bug class that has cost this
 * project real time.
 */

import { type Position, type Train, doubleOf, isDouble, pipsOf } from './model';
import { type GameView, seatName } from './game';

export interface RendererOptions {
  reducedMotion: boolean;
  onTapTile: (tile: number) => void;
  onTapTrain: (train: number) => void;
  onReveal: () => void;
}

/**
 * Which cells of a three-by-three grid a pip count fills.
 *
 * A double-nine set needs values a six-sided die never has, and there is no
 * traditional arrangement past six that everybody agrees on. These are the
 * common ones: seven is six with the middle filled, eight is six with the two
 * middles of the outer rows, nine is the full grid.
 */
const PIPS: readonly (readonly (readonly [number, number])[])[] = [
  [],
  [[2, 2]],
  [
    [1, 1],
    [3, 3],
  ],
  [
    [1, 1],
    [2, 2],
    [3, 3],
  ],
  [
    [1, 1],
    [1, 3],
    [3, 1],
    [3, 3],
  ],
  [
    [1, 1],
    [1, 3],
    [2, 2],
    [3, 1],
    [3, 3],
  ],
  [
    [1, 1],
    [1, 3],
    [2, 1],
    [2, 3],
    [3, 1],
    [3, 3],
  ],
  [
    [1, 1],
    [1, 3],
    [2, 1],
    [2, 2],
    [2, 3],
    [3, 1],
    [3, 3],
  ],
  [
    [1, 1],
    [1, 2],
    [1, 3],
    [2, 1],
    [2, 3],
    [3, 1],
    [3, 2],
    [3, 3],
  ],
  [
    [1, 1],
    [1, 2],
    [1, 3],
    [2, 1],
    [2, 2],
    [2, 3],
    [3, 1],
    [3, 2],
    [3, 3],
  ],
];

/** One half of a tile: a three-by-three grid with `value` of its cells filled. */
function half(value: number): string {
  const dots = (PIPS[value] ?? [])
    .map(([row, column]) => `<i style="grid-area:${row}/${column}"></i>`)
    .join('');
  return `<span class="dm-half" aria-hidden="true">${dots}</span>`;
}

/**
 * One tile, left half first.
 *
 * `lead` is the pip that faces back down the train, so a tile reads in the
 * direction it was laid — the whole point of a train being that the numbers
 * touch.
 */
export function tileHtml(tile: number, lead?: number): string {
  const [low, high] = pipsOf(tile);
  const left = lead === undefined ? low : lead;
  const right = lead === undefined ? high : lead === low ? high : low;
  const classes = `dm-tile${isDouble(tile) ? ' dm-tile--double' : ''}`;
  return `<span class="${classes}">${half(left)}${half(right)}</span>`;
}

const tileName = (tile: number): string => {
  const [low, high] = pipsOf(tile);
  return `${low}–${high}`;
};

export class BoardRenderer {
  private options: RendererOptions;

  private readonly frame: HTMLElement;
  private readonly engine: HTMLElement;
  private readonly trainList: HTMLElement;
  private readonly rows: HTMLButtonElement[] = [];
  private readonly hand: HTMLElement;
  private readonly curtain: HTMLElement;
  private readonly curtainName: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly tray: HTMLElement,
    options: RendererOptions,
  ) {
    this.options = options;

    this.frame = element('div', 'dm-frame');
    // Its own stacking context. The curtain and the selected tile both take a
    // z-index, and without this they compete with the settings sheet.
    this.frame.style.isolation = 'isolate';

    this.engine = element('div', 'dm-engine');
    this.trainList = element('div', 'dm-trains');
    this.frame.append(this.engine, this.trainList);
    this.root.append(this.frame);

    this.hand = element('div', 'dm-hand');
    this.hand.addEventListener('click', (event) => {
      const target = event.target;
      // `event.target` is the document itself when nothing was focused, and a
      // document has no `closest`. Narrowing here rather than trusting it has
      // cost this project a crash in three games already.
      if (!(target instanceof Element)) return;
      const button = target.closest('.dm-pick');
      if (!(button instanceof HTMLButtonElement)) return;
      const tile = Number(button.dataset.tile);
      if (Number.isFinite(tile)) this.options.onTapTile(tile);
    });

    this.curtainName = element('b', 'dm-curtain-name');
    const prompt = element('p', 'dm-curtain-line', 'Tap when you are the one holding the phone.');
    const lift = element('button', 'button button--full', 'Look at my tiles') as HTMLButtonElement;
    lift.type = 'button';
    lift.addEventListener('click', () => this.options.onReveal());

    this.curtain = element('div', 'dm-curtain');
    this.curtain.append(this.curtainName, prompt, lift);

    this.tray.append(this.hand, this.curtain);
  }

  setOptions(patch: Partial<RendererOptions>): void {
    this.options = { ...this.options, ...patch };
  }

  /* ---------------------------------------------------------------- draw */

  render(view: GameView): void {
    this.root.classList.toggle('is-loading', view.phase === 'loading');
    const position = view.position;
    if (!position) return;

    this.engine.innerHTML =
      `<span class="dm-engine-label">Engine</span>${tileHtml(doubleOf(position.engine))}` +
      `<span class="dm-engine-label dm-engine-label--right">${view.boneyard} left</span>`;

    this.paintTrains(view, position);
    this.paintHand(view);

    // `hidden` rather than a class: `shell.css` carries the `[hidden]` rule the
    // whole collection relies on, and one attribute cannot disagree with a
    // class the way two of them can.
    this.curtain.hidden = view.phase !== 'handover';
    this.curtainName.textContent = `${seatName(view.seat)} to play`;
  }

  private paintTrains(view: GameView, position: Position): void {
    while (this.rows.length < position.trains.length) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'dm-train';
      row.addEventListener('click', () => {
        const index = Number(row.dataset.train);
        if (Number.isFinite(index)) this.options.onTapTrain(index);
      });
      this.rows.push(row);
      this.trainList.append(row);
    }
    // A table that has shrunk leaves rows behind. Removed rather than hidden:
    // a hidden button is still in the tab order.
    while (this.rows.length > position.trains.length) {
      this.rows.pop()?.remove();
    }

    for (const [index, train] of position.trains.entries()) {
      const row = this.rows[index] as HTMLButtonElement;
      row.dataset.train = String(index);

      const mine = train.owner === position.turn;
      const pending = position.pending?.train === index;
      row.classList.toggle('is-mine', mine);
      row.classList.toggle('is-open', train.open && train.owner !== null);
      row.classList.toggle('is-mexican', train.owner === null);
      row.classList.toggle('is-target', view.targets.includes(index));
      row.classList.toggle('is-pending', pending);
      row.disabled = view.phase !== 'playing';

      row.innerHTML =
        `<span class="dm-train-head">${headFor(train, view, mine)}</span>` +
        `<span class="dm-train-line">${lineFor(train, position)}</span>`;
      row.setAttribute('aria-label', labelFor(train, index, view));
    }
  }

  private paintHand(view: GameView): void {
    this.hand.replaceChildren();
    if (view.hand.length === 0) return;

    for (const tile of view.hand) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dm-pick';
      button.dataset.tile = String(tile);
      button.innerHTML = tileHtml(tile);
      button.classList.toggle('can-play', view.playable.includes(tile));
      button.classList.toggle('is-selected', view.selected === tile);
      button.disabled = view.phase !== 'playing';
      button.setAttribute(
        'aria-label',
        `${tileName(tile)}${view.playable.includes(tile) ? ', playable' : ''}`,
      );
      this.hand.append(button);
    }
  }

  /** Wipes the transient classes. Called whenever the board is rebuilt. */
  reset(): void {
    for (const row of this.rows) {
      row.classList.remove('is-target', 'is-pending', 'is-open', 'is-mine');
    }
  }
}

/** The chip at the left of a train row: whose it is, and whether it is open. */
function headFor(train: Train, view: GameView, mine: boolean): string {
  if (train.owner === null) {
    return `<b>Mexican</b><span class="dm-train-note">anyone</span>`;
  }

  const held = view.handCounts[train.owner] ?? 0;
  const name = mine ? 'You' : seatName(train.owner);
  const note = train.open ? 'open' : `${held} left`;
  return `<b>${name}</b><span class="dm-train-note">${note}</span>`;
}

/**
 * The tiles on a train, newest first.
 *
 * **Written backwards on purpose.** The row is `row-reverse` in CSS, which is
 * what pins the open end to the right edge and throws the overflow off the left
 * (see `.dm-train-line`), and `row-reverse` lays the first child out rightmost.
 * So the last tile laid has to be written first, or the train renders in
 * reverse: the engine end pinned to the right, the end you can actually play on
 * clipped off the left, and — the thing you notice — every tile's open pip
 * against the *next* tile's open pip rather than against the one it matched.
 * Written this way the train reads left to right in the order it was laid and
 * each pair of touching halves carries the same number, which is the whole
 * point of a train.
 *
 * This always writes the whole train and lets the layout decide how much of it
 * fits. An empty train shows the end it would start from instead, which is the
 * engine.
 */
function lineFor(train: Train, position: Position): string {
  if (train.tiles.length === 0) {
    return `<span class="dm-empty">starts at ${position.engine}</span>`;
  }
  return train.tiles
    .map((placed) => tileHtml(placed.tile, placed.from))
    .reverse()
    .join('');
}

function labelFor(train: Train, index: number, view: GameView): string {
  const who = train.owner === null ? 'the Mexican train' : `${seatName(train.owner)}'s train`;
  const end = view.position?.trains[index]?.end ?? 0;
  const open = train.owner !== null && train.open ? ', open' : '';
  return `${who}, open end ${end}${open}`;
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
 * It carries whose turn it is and, where a rule has just bitten, the one short
 * sentence saying which. The double is the rule worth spelling out: a board
 * that has quietly narrowed to one legal square looks from the outside exactly
 * like a board on which nothing fits.
 */
export function describeTurn(view: GameView): string {
  if (view.phase === 'loading') return 'Dealing…';
  const position = view.position;
  if (!position) return '';

  if (view.phase === 'finished') {
    if (position.wentOut === null) return 'Blocked — nobody could play';
    return `${seatName(position.wentOut)} went out`;
  }

  // Nothing during the handover: the curtain underneath this line already
  // names the player and asks for the phone, and saying it twice in two
  // different ways reads as two different instructions.
  if (view.phase === 'handover') return '';
  if (view.effect.kind === 'reject' && view.effect.note) return view.effect.note;
  if (view.effect.kind === 'drew') return `Drew the ${tileName(view.effect.tile)}`;

  if (position.pending) {
    const train = position.trains[position.pending.train];
    const whose =
      train?.owner === null
        ? 'the Mexican train'
        : train?.owner === position.turn
          ? 'your train'
          : `${seatName(train?.owner ?? 0)}'s train`;
    return `Answer the double on ${whose}`;
  }

  if (view.canPass) return 'Nothing fits — your train opens';
  if (view.canDraw) return 'Nothing fits — take one from the boneyard';
  if (view.selected !== null) return 'Tap the train to lay it on';
  return 'Your turn';
}

/** The top bar's second line: the running score, which is all this game keeps. */
export function describeTotals(view: GameView): string {
  if (view.totals.every((total) => total === 0)) return 'First round';
  return view.totals.map((total, seat) => `P${seat + 1} ${total}`).join(' · ');
}
