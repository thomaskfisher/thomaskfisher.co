/**
 * Gridlock game controller.
 *
 * Owns all state and persistence; knows nothing about the DOM.
 *
 * The saved move list is one packed integer per slide. Because generation is
 * deterministic, replaying that list reproduces the park exactly, so neither the
 * board nor the current position needs storing and neither can drift out of
 * step with the other. A whole save is a few dozen small numbers.
 *
 * **There is no losing phase in the rules.** Every slide is reversible, so a
 * player can always work back out of wherever they have got to — `lost` here
 * only ever means the optional clock ran out, and even then the move list on
 * disk is still a legal, partly-solved board.
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
  type Move,
  SIZE,
  TARGET,
  TARGET_LENGTH,
  applyMove,
  blockersAhead,
  isLegalMove,
  isSolved,
  packMove,
  slideRange,
  unpackMove,
} from './model';
import { findSolution } from './solve';

export const GAME_ID = 'gridlock';

export type GamePhase = 'loading' | 'playing' | 'won' | 'lost';

/** What just happened, so the renderer can animate rather than snap. */
export type Effect =
  | { kind: 'none' }
  | { kind: 'reset' }
  | { kind: 'slide'; id: number; from: number; to: number; solved: boolean }
  | { kind: 'reject'; id: number }
  | { kind: 'hint'; id: number; to: number };

export interface GameState {
  phase: GamePhase;
  /** Set only while `phase` is 'lost', which is the only way it can be. */
  outOfTime: boolean;
  level: number;
  generated: GeneratedLevel | null;
  /** Where every vehicle is right now, parallel to `generated.board.vehicles`. */
  position: number[];
  /** Slides taken so far. */
  moveCount: number;
  /** Vehicles standing between the target and the exit. */
  blockers: number[];
  /**
   * How far the target has ever got this level, as a column offset. Monotonic
   * on purpose — the clock pays out on it, and a metric that could fall would
   * let an undo-and-redo cycle mint time out of nothing.
   */
  reached: number;
  canUndo: boolean;
  effect: Effect;
}

type Listener = (state: GameState) => void;

export class GridlockGame {
  /**
   * Seeded with a default rather than left undefined until `start()`, because
   * `subscribe` notifies synchronously and the first render happens before the
   * save has loaded. See `shared/first-render.test.ts`.
   */
  private save: SaveData<number> = defaultSave<number>(GAME_ID);
  private writer = createSaveWriter<number>(GAME_ID);
  private source!: LevelSource<GeneratedLevel>;

  private generated: GeneratedLevel | null = null;
  private position: number[] = [];
  private history: Move[] = [];
  private phase: GamePhase = 'loading';
  private outOfTime = false;
  private effect: Effect = { kind: 'none' };
  private reached = 0;

  /** A winning line to follow. See `requestHint`. */
  private hintPlan: Move[] | null = null;

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
    const board = this.generated?.board;

    return {
      phase: this.phase,
      outOfTime: this.outOfTime,
      level: this.save?.level ?? 1,
      generated: this.generated,
      position: this.position,
      moveCount: this.history.length,
      blockers: board ? blockersAhead(board, this.position) : [],
      reached: this.reached,
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

  /** The span `id` may be dragged through right now. Empty once the level is over. */
  slideSpan(id: number): { from: number; to: number } | null {
    if (this.phase !== 'playing' || !this.generated) return null;
    return slideRange(this.generated.board, this.position, id);
  }

  private async loadLevel(level: number, replay: number[] = []): Promise<void> {
    this.phase = 'loading';
    this.outOfTime = false;
    this.generated = null;
    this.position = [];
    this.history = [];
    this.notify({ kind: 'reset' });

    const generated = await this.source.get(level);

    this.generated = generated;
    this.position = generated.start.slice();
    this.history = [];
    this.hintPlan = null;

    // Restore a level in progress. A slide that no longer applies is dropped
    // rather than throwing — a corrupt tail should cost the tail, not the level.
    for (const packed of replay) {
      const move = unpackMove(packed);
      if (!isLegalMove(generated.board, this.position, move)) break;
      this.position = applyMove(this.position, move);
      this.history.push(move);
      if (isSolved(generated.board, this.position)) break;
    }

    this.phase = isSolved(generated.board, this.position) ? 'won' : 'playing';
    this.reached = this.position[TARGET] as number;

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

  /**
   * Slides a vehicle. Any distance counts as one move.
   *
   * Sliding a vehicle back to where it already is is not a move and is silently
   * ignored rather than rejected — on a touch screen it is what a tap that
   * missed looks like, and buzzing at someone for putting a car back where they
   * found it would be wrong.
   */
  slide(id: number, to: number): void {
    if (this.phase !== 'playing' || !this.generated) return;
    if (this.position[id] === to) return;

    const move: Move = { id, to };
    if (!isLegalMove(this.generated.board, this.position, move)) {
      this.notify({ kind: 'reject', id });
      return;
    }

    const from = this.position[id] as number;
    this.position = applyMove(this.position, move);
    this.history.push(move);
    this.advanceHintPlan(move);

    const solved = isSolved(this.generated.board, this.position);
    if (solved) this.phase = 'won';
    this.reached = Math.max(this.reached, this.position[TARGET] as number);

    this.persist();
    this.notify({ kind: 'slide', id, from, to, solved });
  }

  /**
   * Keeps the cached winning line in step: consume the head when the player
   * plays it, discard the plan when they go their own way.
   */
  private advanceHintPlan(played: Move): void {
    const head = this.hintPlan?.[0];
    if (!head || head.id !== played.id || head.to !== played.to) {
      this.hintPlan = null;
      return;
    }
    this.hintPlan = this.hintPlan && this.hintPlan.length > 1 ? this.hintPlan.slice(1) : null;
  }

  undo(): void {
    if (this.history.length === 0 || !this.generated) return;

    this.outOfTime = false;
    this.history.pop();
    this.hintPlan = null;

    // Replayed from the start rather than inverted. The inverse of a slide is
    // another slide and would be easy enough to apply, but replaying cannot
    // drift, and these lists are at most a few dozen entries long.
    this.position = this.generated.start.slice();
    for (const move of this.history) this.position = applyMove(this.position, move);

    this.phase = isSolved(this.generated.board, this.position) ? 'won' : 'playing';
    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalUndos: this.save.stats.totalUndos + 1 },
    };
    this.persist();
    this.notify({ kind: 'reset' });
  }

  restart(): void {
    if (!this.generated) return;
    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalRestarts: this.save.stats.totalRestarts + 1 },
    };
    this.position = this.generated.start.slice();
    this.history = [];
    this.hintPlan = null;
    this.outOfTime = false;
    this.reached = this.position[TARGET] as number;
    this.phase = 'playing';
    this.persist();
    this.notify({ kind: 'reset' });
  }

  /**
   * The next slide on a shortest solution. Free and unlimited.
   *
   * A whole line is computed once and then followed, rather than re-solved after
   * every move. Two searches from adjacent positions can return different
   * shortest solutions whose opening moves disagree, and the hint button then
   * ping-pongs between two cars forever.
   */
  requestHint(): Move | null {
    if (this.phase !== 'playing' || !this.generated) return null;

    if (!this.hintPlan) this.hintPlan = findSolution(this.generated.board, this.position);

    const move = this.hintPlan?.[0];
    if (!move) return null;

    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalHints: this.save.stats.totalHints + 1 },
    };
    this.persist();
    this.notify({ kind: 'hint', id: move.id, to: move.to });
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

  /**
   * Notes that the rules sheet has been offered. Not routed through
   * `updateSettings`: it is not a preference, and it must not fire a redraw of
   * the board behind the sheet.
   */
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

  /**
   * Ends the level because the clock ran out — the only way this game can be
   * lost. Deliberately not persisted as anything special: the move list on disk
   * is still a legal, partly-solved board, so reopening the app puts the player
   * back where they were rather than on a fresh loss.
   */
  loseToTime(): void {
    if (this.phase !== 'playing') return;
    this.outOfTime = true;
    this.phase = 'lost';
    this.notify();
  }
}

/** How far the target can still travel this level, for the clock's payout. */
export const MAX_ADVANCE = SIZE - TARGET_LENGTH;
