/**
 * Spider game controller.
 *
 * Owns all state and persistence; knows nothing about the DOM.
 *
 * The saved move list is one small integer per move, and because the deal is a
 * pure function of `(seed, level)` the whole board replays from it — ten
 * columns, the stock and the finished sets, none of which is stored and none of
 * which can therefore drift out of step with the others.
 *
 * Unlike Solitaire next door there is no hint-as-oracle here. Spider has no
 * redeal, so running out produces a position with no legal move in it at all,
 * and `isDead` catches that exactly and for nothing. The hint is only ever a
 * hint; when the search cannot find a line it says so by saying nothing.
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
  type Column,
  type Move,
  type Spider,
  COLUMNS,
  DEAL_MOVE,
  applyMove,
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

export const GAME_ID = 'spider';

export type GamePhase = 'loading' | 'playing' | 'won' | 'lost';

/** What the player has picked up: a run of `count` cards from column `from`. */
export interface Selection {
  from: number;
  count: number;
}

export type Target = { kind: 'stock' } | { kind: 'pile'; pile: number; index: number };

export type Effect =
  | { kind: 'none' }
  | { kind: 'reset' }
  | { kind: 'play'; lifted: number }
  | { kind: 'deal' }
  | { kind: 'select' }
  | { kind: 'reject' }
  | { kind: 'hint' };

export interface GameState {
  phase: GamePhase;
  level: number;
  generated: GeneratedLevel | null;
  board: Spider | null;
  selection: Selection | null;
  /** The move the hint is pointing at, kept on screen until it is played. */
  hint: Move | null;
  moveCount: number;
  completed: number;
  faceDown: number;
  canUndo: boolean;
  effect: Effect;
}

/**
 * Search budget for the hint.
 *
 * A third of what the generator spends. This one runs on the main thread with a
 * finger still on the screen, and a hint that takes a second to arrive is worse
 * than one that occasionally admits it has not found anything.
 */
const HINT_BUDGET = 22_000;

type Listener = (state: GameState) => void;

const sameMove = (a: Move, b: Move): boolean =>
  a.kind === b.kind &&
  (a.kind !== 'move' ||
    (b.kind === 'move' && a.from === b.from && a.to === b.to && a.count === b.count));

export class SpiderGame {
  /** Seeded rather than left undefined: the first render happens before the
      save has loaded. See `shared/first-render.test.ts`. */
  private save: SaveData<number> = defaultSave<number>(GAME_ID);
  private writer = createSaveWriter<number>(GAME_ID);
  private source!: LevelSource<GeneratedLevel>;

  private generated: GeneratedLevel | null = null;
  private board: Spider | null = null;
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
      completed: this.board?.completed ?? 0,
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
    const board = deal(generated.pack);

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

  /** Two taps make a move: pick a run up, then put it down. */
  tap(target: Target): void {
    const board = this.board;
    if (this.phase !== 'playing' || !board) return;

    if (target.kind === 'stock') {
      this.selection = null;
      if (!isLegal(board, DEAL_MOVE)) {
        this.notify({ kind: 'reject' });
        return;
      }
      this.play(DEAL_MOVE, { kind: 'deal' });
      return;
    }

    const selection = this.selection;

    if (selection) {
      // Tapping what is already in hand puts it back down.
      if (this.targetIsSelection(target, selection)) {
        this.selection = null;
        this.notify({ kind: 'select' });
        return;
      }

      const move: Move = { kind: 'move', from: selection.from, to: target.pile, count: selection.count };
      if (isLegal(board, move)) {
        this.selection = null;
        this.play(move, { kind: 'play', lifted: 0 });
        return;
      }
    }

    this.pickUp(target.pile, target.index);
  }

  private targetIsSelection(target: Target, selection: Selection): boolean {
    if (target.kind !== 'pile') return false;
    const column = (this.board as Spider).columns[target.pile] as Column;
    return selection.from === target.pile && column.cards.length - target.index === selection.count;
  }

  private pickUp(pile: number, index: number): void {
    const column = (this.board as Spider).columns[pile] as Column;
    if (index < column.down || index >= column.cards.length) {
      this.notify({ kind: 'reject' });
      return;
    }
    if (!isRun(column.cards, index)) {
      this.notify({ kind: 'reject' });
      return;
    }

    this.selection = { from: pile, count: column.cards.length - index };
    this.notify({ kind: 'select' });
  }

  private play(move: Move, effect: Effect): void {
    const board = this.board as Spider;
    const before = board.completed;

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
      effect.kind === 'play' ? { kind: 'play', lifted: board.completed - before } : effect,
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
    // every set it lifted and every card it turned over; replaying cannot drift.
    this.board = deal(generated.pack);
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
    this.board = deal(generated.pack);
    this.history = [];
    this.selection = null;
    this.hint = null;
    this.hintPlan = generated.solution.map(unpackMove);
    this.phase = 'playing';
    this.persist();
    this.notify({ kind: 'reset' });
  }

  /** The next move on a winning line, or null when none was found. */
  requestHint(): Move | null {
    const board = this.board;
    if (this.phase !== 'playing' || !board) return null;

    if (!this.hintPlan) {
      const result = solve(board, { budget: HINT_BUDGET, seed: this.history.length + 1 });
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

/** Which columns a run picked up from here could legally be put down on. */
export function legalTargets(board: Spider, selection: Selection): number[] {
  const targets: number[] = [];
  for (let to = 0; to < COLUMNS; to++) {
    if (isLegal(board, { kind: 'move', from: selection.from, to, count: selection.count })) {
      targets.push(to);
    }
  }
  return targets;
}
