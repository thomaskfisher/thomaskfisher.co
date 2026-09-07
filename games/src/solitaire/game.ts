/**
 * Solitaire game controller.
 *
 * Owns all state and persistence; knows nothing about the DOM.
 *
 * The saved move list is one small integer per move, and because the deal is a
 * pure function of `(seed, level)` the whole board replays from it. A save is a
 * few hundred bytes with a game in the middle of it.
 *
 * ## Being stuck is a question, not a state
 *
 * With unlimited redeals there is nearly always *something* legal to do, so
 * `isDead` — no legal move at all — almost never fires. What actually happens
 * is that the position stops being winnable while still being playable, and
 * deciding that costs a whole search. Running one after every tap would be
 * absurd; running one when the player asks is exactly right. So the hint button
 * is also the "am I stuck?" button: it answers with a move, or with the loss
 * sheet, or — when the search ran out of budget rather than out of positions —
 * with nothing, because a maybe is not worth showing anybody.
 */

import { LevelSource } from '../shared/levelSource';
import {
  type SaveData,
  completeLevel,
  createSaveWriter,
  defaultSave,
  loadSave,
} from '../shared/progress';
import { type GeneratedLevel, generateLevel } from './generate';
import {
  type Klondike,
  type Move,
  type Pile,
  FOUNDATION_0,
  PILES,
  STOCK_MOVE,
  WASTE,
  applyMove,
  cardsHome,
  deal,
  faceDownCount,
  isDead,
  isLegal,
  isRun,
  isWon,
  packMove,
  unpackMove,
} from './model';
import { solve } from './solve';

export const GAME_ID = 'solitaire';

export type GamePhase = 'loading' | 'playing' | 'won' | 'lost';

/** What the player has picked up: a run of `count` cards from `from`. */
export interface Selection {
  from: number;
  count: number;
}

/** Where a tap landed. The renderer translates a card into one of these. */
export type Target =
  | { kind: 'stock' }
  | { kind: 'waste' }
  | { kind: 'foundation'; suit: number }
  | { kind: 'pile'; pile: number; index: number };

export type Effect =
  | { kind: 'none' }
  | { kind: 'reset' }
  | { kind: 'play'; home: number }
  | { kind: 'turn' }
  | { kind: 'select' }
  | { kind: 'reject' }
  | { kind: 'hint' };

export interface GameState {
  phase: GamePhase;
  level: number;
  generated: GeneratedLevel | null;
  board: Klondike | null;
  selection: Selection | null;
  /** The move the hint is pointing at, kept on screen until it is played. */
  hint: Move | null;
  moveCount: number;
  home: number;
  faceDown: number;
  canUndo: boolean;
  effect: Effect;
}

/**
 * Search budget for the hint.
 *
 * A fifth of what the generator spends. This one runs on the main thread with a
 * finger still on the screen, and a hint that takes a second to arrive is worse
 * than one that occasionally admits it does not know.
 */
const HINT_BUDGET = 12_000;

type Listener = (state: GameState) => void;

const sameMove = (a: Move, b: Move): boolean =>
  a.kind === b.kind &&
  (a.kind !== 'move' || (b.kind === 'move' && a.from === b.from && a.to === b.to && a.count === b.count));

export class SolitaireGame {
  /** Seeded rather than left undefined: the first render happens before the
      save has loaded. See `shared/first-render.test.ts`. */
  private save: SaveData<number> = defaultSave<number>(GAME_ID);
  private writer = createSaveWriter<number>(GAME_ID);
  private source!: LevelSource<GeneratedLevel>;

  private generated: GeneratedLevel | null = null;
  private board: Klondike | null = null;
  private history: Move[] = [];
  private selection: Selection | null = null;
  private phase: GamePhase = 'loading';
  private effect: Effect = { kind: 'none' };

  /** One winning line, followed rather than re-derived. See `requestHint`. */
  private hintPlan: Move[] | null = null;
  private hint: Move | null = null;

  private listeners = new Set<Listener>();

  async start(): Promise<void> {
    this.save = await loadSave<number>(GAME_ID);
    this.source = this.createSource();
    await this.loadLevel(this.save.level, this.save.inProgress?.moves ?? []);
  }

  private createSource(): LevelSource<GeneratedLevel> {
    return new LevelSource<GeneratedLevel>({
      seed: this.save.seed,
      createWorker: () =>
        new Worker(new URL('./generate.worker.ts', import.meta.url), { type: 'module' }),
      generate: generateLevel,
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  private notify(effect: Effect = { kind: 'none' }): void {
    this.effect = effect;
    const state = this.snapshot();
    for (const listener of this.listeners) listener(state);
  }

  private snapshot(): GameState {
    return {
      phase: this.phase,
      level: this.save?.level ?? 1,
      generated: this.generated,
      board: this.board,
      selection: this.selection,
      hint: this.hint,
      moveCount: this.history.length,
      home: this.board ? cardsHome(this.board) : 0,
      faceDown: this.board ? faceDownCount(this.board) : 0,
      canUndo: this.history.length > 0,
      effect: this.effect,
    };
  }

  get settings() {
    return this.save.settings;
  }

  get currentSave(): SaveData<number> {
    return this.save;
  }

  private async loadLevel(level: number, replay: number[] = []): Promise<void> {
    this.phase = 'loading';
    this.generated = null;
    this.board = null;
    this.history = [];
    this.selection = null;
    this.hint = null;
    this.hintPlan = null;
    this.notify({ kind: 'reset' });

    const generated = await this.source.get(level);
    const board = deal(generated.deck);

    this.generated = generated;
    this.board = board;
    // The generator already paid for a winning line, so the first hint on a
    // fresh level is free and is one the player can follow to the end.
    this.hintPlan = generated.solution.map(unpackMove);

    // A move that no longer applies ends the replay rather than throwing: a
    // corrupt tail should cost the tail, not the level.
    for (const packed of replay) {
      const move = unpackMove(packed);
      if (!applyMove(board, move)) break;
      this.history.push(move);
      this.advanceHintPlan(move);
      if (isWon(board)) break;
    }

    this.phase = isWon(board) ? 'won' : isDead(board) ? 'lost' : 'playing';
    this.source.prefetch(level + 1);
    this.persist();
    this.notify({ kind: 'reset' });
  }

  private persist(): void {
    this.writer.schedule({
      ...this.save,
      inProgress:
        this.history.length > 0
          ? { level: this.save.level, moves: this.history.map(packMove) }
          : null,
    });
  }

  /* ---------------------------------------------------------------- input */

  /**
   * One tap, wherever it landed.
   *
   * Two taps make a move: pick a card up, then put it down. Tapping the card
   * you are already holding sends it home instead, which is the one shortcut
   * worth having — it is the move you make forty times a game.
   */
  tap(target: Target): void {
    const board = this.board;
    if (this.phase !== 'playing' || !board) return;

    if (target.kind === 'stock') {
      this.selection = null;
      this.play(STOCK_MOVE, { kind: 'turn' });
      return;
    }

    const selection = this.selection;

    if (selection) {
      // Tapping what is already in hand: home if it will go, down if it will not.
      if (this.targetIsSelection(target, selection)) {
        const suit = this.selectedSuit(selection);
        const up: Move = { kind: 'move', from: selection.from, to: FOUNDATION_0 + suit, count: 1 };
        this.selection = null;
        if (selection.count === 1 && isLegal(board, up)) this.play(up, { kind: 'play', home: 1 });
        else this.notify({ kind: 'select' });
        return;
      }

      // The waste is never a destination, so a tap on it can only mean "pick
      // this up instead".
      const to =
        target.kind === 'foundation'
          ? FOUNDATION_0 + target.suit
          : target.kind === 'pile'
            ? target.pile
            : -1;
      const move: Move = { kind: 'move', from: selection.from, to, count: selection.count };
      if (to >= 0 && isLegal(board, move)) {
        this.selection = null;
        this.play(move, { kind: 'play', home: 0 });
        return;
      }
    }

    this.pickUp(target);
  }

  private targetIsSelection(target: Target, selection: Selection): boolean {
    if (target.kind === 'waste') return selection.from === WASTE;
    if (target.kind !== 'pile') return false;
    const pile = (this.board as Klondike).tableau[target.pile] as Pile;
    return selection.from === target.pile && pile.cards.length - target.index === selection.count;
  }

  private selectedSuit(selection: Selection): number {
    const board = this.board as Klondike;
    const card =
      selection.from === WASTE
        ? (board.waste[board.waste.length - 1] as number)
        : ((board.tableau[selection.from] as Pile).cards.slice(-selection.count)[0] as number);
    return Math.floor(card / 13);
  }

  /** Picks a card up, if it is one that can be picked up. */
  private pickUp(target: Target): void {
    const board = this.board as Klondike;

    if (target.kind === 'waste') {
      if (board.waste.length === 0) return this.notify({ kind: 'reject' });
      this.selection = { from: WASTE, count: 1 };
      return this.notify({ kind: 'select' });
    }

    if (target.kind !== 'pile') {
      this.selection = null;
      return this.notify({ kind: 'select' });
    }

    const pile = board.tableau[target.pile] as Pile;
    if (target.index < pile.down || target.index >= pile.cards.length) {
      return this.notify({ kind: 'reject' });
    }
    if (!isRun(pile.cards, target.index)) return this.notify({ kind: 'reject' });

    this.selection = { from: target.pile, count: pile.cards.length - target.index };
    this.notify({ kind: 'select' });
  }

  private play(move: Move, effect: Effect): void {
    const board = this.board as Klondike;
    const before = cardsHome(board);

    if (!applyMove(board, move)) {
      this.notify({ kind: 'reject' });
      return;
    }

    this.history.push(move);
    this.advanceHintPlan(move);
    if (this.hint && sameMove(this.hint, move)) this.hint = null;

    if (isWon(board)) this.phase = 'won';
    else if (isDead(board)) this.phase = 'lost';

    this.persist();
    this.notify(
      effect.kind === 'play' ? { kind: 'play', home: cardsHome(board) - before } : effect,
    );
  }

  /**
   * Keeps the cached line in step: consume the head when the player plays it,
   * throw the plan away when they go their own way.
   */
  private advanceHintPlan(played: Move): void {
    const head = this.hintPlan?.[0];
    if (!head || !sameMove(head, played)) {
      this.hintPlan = null;
      return;
    }
    this.hintPlan = this.hintPlan && this.hintPlan.length > 1 ? this.hintPlan.slice(1) : null;
  }

  /* -------------------------------------------------------------- controls */

  undo(): void {
    const generated = this.generated;
    if (this.history.length === 0 || !generated) return;

    this.history.pop();
    this.hintPlan = null;
    this.hint = null;
    this.selection = null;

    // Replayed from the deal rather than unwound. Undoing a move means undoing
    // every card that flew home because of it and every card it turned over;
    // replaying cannot drift, and a full game is a few hundred small steps.
    this.board = deal(generated.deck);
    for (const move of this.history) applyMove(this.board, move);

    this.phase = isWon(this.board) ? 'won' : 'playing';
    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalUndos: this.save.stats.totalUndos + 1 },
    };
    this.persist();
    this.notify({ kind: 'reset' });
  }

  restart(): void {
    const generated = this.generated;
    if (!generated) return;
    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalRestarts: this.save.stats.totalRestarts + 1 },
    };
    this.board = deal(generated.deck);
    this.history = [];
    this.selection = null;
    this.hint = null;
    this.hintPlan = generated.solution.map(unpackMove);
    this.phase = 'playing';
    this.persist();
    this.notify({ kind: 'reset' });
  }

  /**
   * The next move on a winning line — or the news that there is not one.
   *
   * Returns 'stuck' when the search walked the whole space without finding a
   * win, and null when it merely ran out of budget. The difference matters: the
   * first is worth a loss sheet, the second is worth nothing at all.
   */
  requestHint(): Move | 'stuck' | null {
    const board = this.board;
    if (this.phase !== 'playing' || !board) return null;

    if (!this.hintPlan) {
      const result = solve(board, { budget: HINT_BUDGET });
      if (result.status === 'unsolvable') {
        this.phase = 'lost';
        this.notify({ kind: 'reset' });
        return 'stuck';
      }
      if (result.status !== 'solved') return null;
      this.hintPlan = result.moves;
    }

    const move = this.hintPlan[0];
    if (!move) return null;

    this.hint = move;
    this.selection = null;
    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalHints: this.save.stats.totalHints + 1 },
    };
    this.persist();
    this.notify({ kind: 'hint' });
    return move;
  }

  async advance(): Promise<void> {
    if (this.phase !== 'won') return;
    this.save = completeLevel(this.save);
    this.writer.schedule(this.save);
    await this.loadLevel(this.save.level);
  }

  async replaceSave(save: SaveData<number>): Promise<void> {
    this.save = save;
    this.writer.schedule(save);
    this.writer.flush();
    this.source.dispose();
    this.source = this.createSource();
    await this.loadLevel(save.level, save.inProgress?.moves ?? []);
  }

  /** Notes that the rules sheet has been offered. Not a preference, and it must
      not redraw the board behind the sheet. */
  markHowToPlaySeen(): void {
    if (this.save.seenHowToPlay) return;
    this.save = { ...this.save, seenHowToPlay: true };
    this.writer.schedule(this.save);
  }

  updateSettings(patch: Partial<SaveData<number>['settings']>): void {
    this.save = { ...this.save, settings: { ...this.save.settings, ...patch } };
    this.writer.schedule(this.save);
    this.notify();
  }

  async goToLevel(level: number): Promise<void> {
    const target = Math.max(1, Math.floor(level));
    this.save = { ...this.save, level: target, inProgress: null };
    this.writer.schedule(this.save);
    await this.loadLevel(target);
  }
}

/** Where a run picked up from this pile could legally be put down. */
export function legalTargets(board: Klondike, selection: Selection): number[] {
  const targets: number[] = [];
  for (let to = 0; to < PILES; to++) {
    if (isLegal(board, { kind: 'move', from: selection.from, to, count: selection.count })) {
      targets.push(to);
    }
  }
  for (let suit = 0; suit < 4; suit++) {
    const move: Move = { kind: 'move', from: selection.from, to: FOUNDATION_0 + suit, count: 1 };
    if (selection.count === 1 && isLegal(board, move)) targets.push(FOUNDATION_0 + suit);
  }
  return targets;
}
