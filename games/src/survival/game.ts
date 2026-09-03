/**
 * Survival game controller.
 *
 * Owns all state and persistence; knows nothing about the DOM.
 *
 * The saved move list is one lane index per row entered. Because generation is
 * deterministic, replaying that list reproduces the board, the soldier count and
 * the phase, so none of them need storing and none of them can drift apart. A
 * whole save is a handful of digits.
 */

import type { Outcome } from '../shared/difficulty';
import { LevelSource } from '../shared/levelSource';
import { type SaveData, completeLevel, createSaveWriter, loadSave } from '../shared/progress';
import { type GeneratedLevel, generateLevel } from './generate';
import { type LossCause, type Phase, evaluate, isLegalStep, legalLanes } from './model';
import { findSolution } from './solve';

export const GAME_ID = 'survival';

export type GamePhase = 'loading' | Phase;

/** What just happened, so the renderer can animate rather than snap. */
export type Effect =
  | { kind: 'none' }
  | { kind: 'reset' }
  | { kind: 'advance'; row: number; fromLane: number | null; toLane: number; before: number; after: number }
  | { kind: 'reject'; row: number; lane: number }
  | { kind: 'hint'; row: number; lane: number };

export interface GameState {
  phase: GamePhase;
  /** Set only while `phase` is 'lost'. */
  lossCause: LossCause | null;
  level: number;
  generated: GeneratedLevel | null;
  /** Lane entered at each row so far. */
  route: number[];
  /** Soldier count after each row entered, parallel to `route`. */
  counts: number[];
  /** Soldiers right now. */
  count: number;
  /** Lanes the next step may enter. Empty once the run is over. */
  legal: number[];
  moveCount: number;
  canUndo: boolean;
  effect: Effect;
}

type Listener = (state: GameState) => void;

export class SurvivalGame {
  private save!: SaveData<number>;
  private writer = createSaveWriter<number>(GAME_ID);
  private source!: LevelSource<GeneratedLevel>;

  private generated: GeneratedLevel | null = null;
  private route: number[] = [];
  private phase: GamePhase = 'loading';
  private effect: Effect = { kind: 'none' };

  /** Per-level flags feeding the hidden difficulty adjustment. */
  private usedUndo = false;
  private usedHint = false;
  private failedHere = false;

  /** A winning line to follow. See `requestHint`. */
  private hintPlan: number[] | null = null;

  private listeners = new Set<Listener>();

  async start(): Promise<void> {
    this.save = await loadSave<number>(GAME_ID);
    this.source = this.createSource();
    await this.loadLevel(this.save.level, this.save.inProgress?.moves ?? []);
  }

  private createSource(): LevelSource<GeneratedLevel> {
    return new LevelSource<GeneratedLevel>({
      seed: this.save.seed,
      difficultyOffset: this.save.difficultyOffset,
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
    const evaluation = board
      ? evaluate(board, this.route)
      : { phase: 'playing' as Phase, cause: null, count: 0, counts: [], death: null };

    return {
      phase: this.phase,
      lossCause: this.phase === 'lost' ? evaluation.cause : null,
      level: this.save?.level ?? 1,
      generated: this.generated,
      route: this.route,
      counts: evaluation.counts,
      count: evaluation.count,
      legal: board && this.phase === 'playing' ? legalLanes(board, this.route) : [],
      moveCount: this.route.length,
      canUndo: this.route.length > 0,
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
    this.notify({ kind: 'reset' });

    this.source.setDifficultyOffset(this.save.difficultyOffset);
    const generated = await this.source.get(level);

    this.generated = generated;
    this.route = [];
    this.hintPlan = null;
    this.usedUndo = false;
    this.usedHint = false;
    this.failedHere = false;

    // Restore a run in progress. A step that no longer applies is dropped
    // rather than throwing — a corrupt tail should cost the tail, not the level.
    for (const lane of replay) {
      if (!isLegalStep(generated.board, this.route, lane)) break;
      this.route.push(lane);
      if (evaluate(generated.board, this.route).phase !== 'playing') break;
    }

    this.phase = evaluate(generated.board, this.route).phase;
    if (this.phase === 'lost') this.failedHere = true;

    this.source.prefetch(level + 1);
    this.persist();
    this.notify({ kind: 'reset' });
  }

  private persist(): void {
    this.writer.schedule({
      ...this.save,
      inProgress: this.route.length > 0 ? { level: this.save.level, moves: this.route } : null,
    });
  }

  /**
   * Taps a cell.
   *
   * Tapping the row the squad is about to enter takes the step. Tapping a row
   * already behind them rewinds to it and takes that step instead — the board is
   * fully visible, so re-routing from a decision three rows back is a normal
   * thing to want, and making the player press Undo three times to do it would
   * be busywork. It counts as an undo either way.
   */
  tapCell(row: number, lane: number): void {
    if (this.phase === 'loading' || !this.generated) return;
    const { board } = this.generated;

    if (row < this.route.length) {
      this.rewindTo(row);
      // Fall through: the rewind put the squad below `row`, so the tap can now
      // be taken as an ordinary step.
    }

    if (row !== this.route.length) return;

    if (!isLegalStep(board, this.route, lane)) {
      this.notify({ kind: 'reject', row, lane });
      return;
    }

    const before = evaluate(board, this.route).count;
    const fromLane = this.route.length === 0 ? null : (this.route[this.route.length - 1] as number);

    this.route.push(lane);
    this.advanceHintPlan(lane);

    const after = evaluate(board, this.route);
    this.phase = after.phase;
    if (this.phase === 'lost') this.failedHere = true;

    this.persist();
    this.notify({ kind: 'advance', row, fromLane, toLane: lane, before, after: after.count });
  }

  /** Drops every step from `row` onwards. */
  private rewindTo(row: number): void {
    if (row >= this.route.length) return;
    this.route = this.route.slice(0, row);
    this.hintPlan = null;
    this.usedUndo = true;
    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalUndos: this.save.stats.totalUndos + 1 },
    };
    this.phase = this.generated ? evaluate(this.generated.board, this.route).phase : 'loading';
  }

  /**
   * Keeps the cached winning line in step: consume the head when the player
   * plays it, discard the plan when they go their own way.
   */
  private advanceHintPlan(played: number): void {
    if (!this.hintPlan || this.hintPlan[0] !== played) {
      this.hintPlan = null;
      return;
    }
    this.hintPlan = this.hintPlan.length > 1 ? this.hintPlan.slice(1) : null;
  }

  undo(): void {
    if (this.route.length === 0) return;
    this.rewindTo(this.route.length - 1);
    this.persist();
    this.notify({ kind: 'reset' });
  }

  restart(): void {
    if (!this.generated) return;
    this.failedHere = true;
    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalRestarts: this.save.stats.totalRestarts + 1 },
    };
    this.route = [];
    this.hintPlan = null;
    this.phase = evaluate(this.generated.board, this.route).phase;
    this.persist();
    this.notify({ kind: 'reset' });
  }

  /**
   * The next lane on a winning line. Free and unlimited.
   *
   * A whole route is computed once and then followed, rather than re-solved
   * after every step. Two searches from adjacent positions can return different
   * winning lines whose openings disagree, and the hint button then ping-pongs
   * between two lanes forever.
   */
  requestHint(): { row: number; lane: number } | null {
    if (this.phase !== 'playing' || !this.generated) return null;

    if (!this.hintPlan) this.hintPlan = findSolution(this.generated.board, this.route);

    const lane = this.hintPlan?.[0];
    if (lane === undefined) return null;

    this.usedHint = true;
    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalHints: this.save.stats.totalHints + 1 },
    };
    this.persist();

    const row = this.route.length;
    this.notify({ kind: 'hint', row, lane });
    return { row, lane };
  }

  private outcome(): Outcome {
    if (this.failedHere) return 'failed';
    return this.usedUndo || this.usedHint ? 'assisted' : 'clean';
  }

  async advance(): Promise<void> {
    if (this.phase !== 'won') return;
    this.save = completeLevel(this.save, this.outcome());
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
