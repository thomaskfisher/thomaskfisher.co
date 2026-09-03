/**
 * Screw Land game controller.
 *
 * Owns all state and persistence; knows nothing about the DOM.
 *
 * The saved move list is a list of screw ids. Because generation is
 * deterministic, replaying that list reproduces both the board *and* the box
 * and tray state, so neither needs storing and the two can never drift apart.
 */

import { type SinkState, accept, createSinkState } from '../shared/buffer-sink';
import type { Outcome } from '../shared/difficulty';
import { LevelSource } from '../shared/levelSource';
import { type SaveData, completeLevel, createSaveWriter, loadSave } from '../shared/progress';
import { type GeneratedLevel, generateLevel } from './generate';
import {
  type BoardState,
  type Screw,
  type StructureIndex,
  accessibleScrewIds,
  allRemoved,
  createBoardState,
  indexStructure,
  isAccessible,
  removeScrew,
} from './model';
import { findSolution } from './solve';

export const GAME_ID = 'screwland';

export type GamePhase = 'loading' | 'playing' | 'won' | 'lost';

/**
 * Why the level ended.
 *
 * 'trayFull' is the real loss: a screw was tapped that no open box wants and
 * the tray had no slot left for it. 'noMoves' is the same dead end reached
 * passively — nothing still reachable can be placed, so the next tap would lose
 * whichever screw it was. Both end the level; only the wording differs.
 */
export type LossReason = 'trayFull' | 'noMoves';

/** What just happened, so the renderer can animate rather than snap. */
export type Effect =
  | { kind: 'none' }
  | { kind: 'take'; screwId: number; to: 'box'; boxIndex: number }
  | { kind: 'take'; screwId: number; to: 'tray'; traySlot: number }
  | { kind: 'reject'; screwId: number; reason: 'buried' }
  | { kind: 'overflow'; screwId: number }
  | { kind: 'reset' }
  | { kind: 'hint'; screwId: number };

export interface GameState {
  phase: GamePhase;
  /** Set only while `phase` is 'lost'. */
  lossReason: LossReason | null;
  level: number;
  generated: GeneratedLevel | null;
  board: BoardState;
  index: StructureIndex | null;
  sinks: SinkState;
  moveCount: number;
  canUndo: boolean;
  effect: Effect;
}

type Listener = (state: GameState) => void;

const EMPTY_SINKS: SinkState = { sinks: [], queue: [], buffer: [] };

export class ScrewLandGame {
  private save!: SaveData<number>;
  private writer = createSaveWriter<number>(GAME_ID);
  private source!: LevelSource<GeneratedLevel>;

  private generated: GeneratedLevel | null = null;
  private index: StructureIndex | null = null;
  private board: BoardState = { removed: [], remainingPerPlate: [] };
  private sinks: SinkState = EMPTY_SINKS;
  private moves: number[] = [];
  private phase: GamePhase = 'loading';
  private lossReason: LossReason | null = null;
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
    return {
      phase: this.phase,
      lossReason: this.lossReason,
      level: this.save?.level ?? 1,
      generated: this.generated,
      board: this.board,
      index: this.index,
      sinks: this.sinks,
      moveCount: this.moves.length,
      canUndo: this.moves.length > 0,
      effect: this.effect,
    };
  }

  get settings() {
    return this.save.settings;
  }

  get currentSave(): SaveData<number> {
    return this.save;
  }

  get screwsLeft(): number {
    return this.board.removed.reduce((n, gone) => (gone ? n : n + 1), 0);
  }

  private async loadLevel(level: number, replay: number[] = []): Promise<void> {
    this.phase = 'loading';
    this.notify({ kind: 'reset' });

    this.source.setDifficultyOffset(this.save.difficultyOffset);
    const generated = await this.source.get(level);

    this.generated = generated;
    this.index = indexStructure(generated.structure);
    this.board = createBoardState(generated.structure, this.index);
    this.sinks = createSinkState(generated.config, generated.queue);
    this.moves = [];
    this.hintPlan = null;
    this.usedUndo = false;
    this.usedHint = false;
    this.failedHere = false;

    // Restore a partly disassembled level. A move that no longer applies is
    // dropped rather than throwing — a corrupt tail should not cost the level.
    for (const id of replay) {
      if (!this.applyTake(id)) break;
    }

    this.phase = this.evaluatePhase();
    this.source.prefetch(level + 1);
    this.persist();
    this.notify({ kind: 'reset' });
  }

  /** Applies a take if it is legal. Returns false if it was not. */
  private applyTake(screwId: number): boolean {
    const generated = this.generated;
    const index = this.index;
    if (!generated || !index) return false;
    if (!isAccessible(index, this.board, screwId)) return false;

    const screw = generated.structure.screws[screwId] as Screw;
    const result = accept(this.sinks, generated.config, screw.color);
    if (result.placed === 'lost') return false;

    this.sinks = result.state;
    removeScrew(generated.structure, index, this.board, screwId);
    this.moves.push(screwId);
    return true;
  }

  /**
   * Recomputes the phase from board and tray. Sets `lossReason` as a side
   * effect so the two can never disagree.
   */
  private evaluatePhase(): GamePhase {
    if (allRemoved(this.board)) {
      this.lossReason = null;
      return 'won';
    }

    const generated = this.generated;
    const index = this.index;
    if (!generated || !index) {
      this.lossReason = null;
      return 'loading';
    }

    const reachable = accessibleScrewIds(generated.structure, index, this.board);
    const anyPlayable = reachable.some((id) => {
      const screw = generated.structure.screws[id] as Screw;
      return accept(this.sinks, generated.config, screw.color).placed !== 'lost';
    });

    if (anyPlayable) {
      this.lossReason = null;
      return 'playing';
    }

    // Nothing reachable can be placed. Waiting for the player to tap something
    // and lose on it would just be a slower way of arriving here.
    this.lossReason = 'noMoves';
    return 'lost';
  }

  private persist(): void {
    this.writer.schedule({
      ...this.save,
      inProgress: this.moves.length > 0 ? { level: this.save.level, moves: this.moves } : null,
    });
  }

  tapScrew(screwId: number): void {
    if (this.phase !== 'playing') return;
    const generated = this.generated;
    const index = this.index;
    if (!generated || !index) return;

    if (!isAccessible(index, this.board, screwId)) {
      this.notify({ kind: 'reject', screwId, reason: 'buried' });
      return;
    }

    const screw = generated.structure.screws[screwId] as Screw;
    const result = accept(this.sinks, generated.config, screw.color);

    // No box wants this colour and the tray is full: the level is over. The
    // screw stays on the board — there is nowhere for it to go, and leaving it
    // in place is what makes undo able to walk the position back.
    if (result.placed === 'lost') {
      this.failedHere = true;
      this.phase = 'lost';
      this.lossReason = 'trayFull';
      this.persist();
      this.notify({ kind: 'overflow', screwId });
      return;
    }

    // Work out where it lands before committing, so the renderer can fly the
    // screw to the right slot.
    const boxIndex = this.sinks.sinks.findIndex(
      (sink) =>
        sink !== null && sink.color === screw.color && sink.filled < generated.config.sinkCapacity,
    );
    const traySlot = this.sinks.buffer.length;

    this.sinks = result.state;
    removeScrew(generated.structure, index, this.board, screwId);
    this.moves.push(screwId);
    this.advanceHintPlan(screwId);

    this.phase = this.evaluatePhase();
    this.persist();

    this.notify(
      result.placed === 'sink'
        ? { kind: 'take', screwId, to: 'box', boxIndex }
        : { kind: 'take', screwId, to: 'tray', traySlot },
    );
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

  /** Rebuilds board and sink state from the move list. */
  private replayFromStart(): void {
    const generated = this.generated;
    const index = this.index;
    if (!generated || !index) return;

    const moves = this.moves;
    this.board = createBoardState(generated.structure, index);
    this.sinks = createSinkState(generated.config, generated.queue);
    this.moves = [];
    for (const id of moves) {
      if (!this.applyTake(id)) break;
    }
  }

  undo(): void {
    if (this.moves.length === 0) return;
    this.moves.pop();
    this.hintPlan = null;
    this.usedUndo = true;
    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalUndos: this.save.stats.totalUndos + 1 },
    };

    this.replayFromStart();
    this.phase = this.evaluatePhase();
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
    this.moves = [];
    this.hintPlan = null;
    this.replayFromStart();
    this.phase = this.evaluatePhase();
    this.persist();
    this.notify({ kind: 'reset' });
  }

  /**
   * The next screw on a winning line. Free and unlimited.
   *
   * A whole solution is computed once and then followed, rather than re-solving
   * after every take — two searches from adjacent positions can return
   * different winning lines, and the second one's opening move may undo the
   * first's, which makes repeated hints ping-pong forever.
   */
  requestHint(): number | null {
    if (this.phase !== 'playing' || !this.generated) return null;

    if (!this.hintPlan) {
      const spec = {
        structure: this.generated.structure,
        queue: this.generated.queue,
        config: this.generated.config,
      };
      this.hintPlan = findSolution(spec, this.moves);
    }

    const next = this.hintPlan?.[0];
    if (next === undefined) return null;

    this.usedHint = true;
    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalHints: this.save.stats.totalHints + 1 },
    };
    this.persist();
    this.notify({ kind: 'hint', screwId: next });
    return next;
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
