/**
 * Bus Jam game controller.
 *
 * Owns all state and persistence; knows nothing about the DOM.
 *
 * The saved move list is a list of passenger ids. Because generation is
 * deterministic, replaying that list reproduces both the crowd *and* the bus
 * and bench state, so neither needs storing and the two can never drift apart.
 */

import { type SinkState, accept, createSinkState } from '../shared/buffer-sink';
import type { Outcome } from '../shared/difficulty';
import { LevelSource } from '../shared/levelSource';
import { type SaveData, completeLevel, createSaveWriter, loadSave } from '../shared/progress';
import { type GeneratedLevel, generateLevel } from './generate';
import {
  type BoardState,
  type GridIndex,
  type Passenger,
  allBoarded,
  boardPassenger,
  createBoardState,
  indexBoard,
  isReachable,
  pathToExit,
  reachableIds,
} from './model';
import { findSolution } from './solve';

export const GAME_ID = 'busjam';

export type GamePhase = 'loading' | 'playing' | 'won' | 'lost';

/**
 * Why the level ended.
 *
 * 'benchFull' is the real loss: someone was tapped that no bus at the stop
 * wants and the bench had no seat left. 'noMoves' is the same dead end reached
 * passively — nobody still reachable can be placed, so the next tap would lose
 * whoever it was. Both end the level; only the wording differs.
 */
export type LossReason = 'benchFull' | 'noMoves';

/** What just happened, so the renderer can animate rather than snap. */
export type Effect =
  | { kind: 'none' }
  | { kind: 'walk'; passengerId: number; path: number[]; to: 'bus'; busIndex: number }
  | { kind: 'walk'; passengerId: number; path: number[]; to: 'bench'; benchSlot: number }
  | { kind: 'reject'; passengerId: number; reason: 'blocked' }
  | { kind: 'overflow'; passengerId: number }
  | { kind: 'reset' }
  | { kind: 'hint'; passengerId: number };

export interface GameState {
  phase: GamePhase;
  /** Set only while `phase` is 'lost'. */
  lossReason: LossReason | null;
  level: number;
  generated: GeneratedLevel | null;
  board: BoardState;
  index: GridIndex | null;
  sinks: SinkState;
  moveCount: number;
  canUndo: boolean;
  effect: Effect;
}

type Listener = (state: GameState) => void;

const EMPTY_SINKS: SinkState = { sinks: [], queue: [], buffer: [] };

export class BusJamGame {
  private save!: SaveData<number>;
  private writer = createSaveWriter<number>(GAME_ID);
  private source!: LevelSource<GeneratedLevel>;

  private generated: GeneratedLevel | null = null;
  private index: GridIndex | null = null;
  private board: BoardState = { boarded: [], occupant: [] };
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

  private async loadLevel(level: number, replay: number[] = []): Promise<void> {
    this.phase = 'loading';
    this.notify({ kind: 'reset' });

    this.source.setDifficultyOffset(this.save.difficultyOffset);
    const generated = await this.source.get(level);

    this.generated = generated;
    this.index = indexBoard(generated.board);
    this.board = createBoardState(generated.board);
    this.sinks = createSinkState(generated.config, generated.queue);
    this.moves = [];
    this.hintPlan = null;
    this.usedUndo = false;
    this.usedHint = false;
    this.failedHere = false;

    // Restore a partly cleared level. A move that no longer applies is dropped
    // rather than throwing — a corrupt tail should not cost the level.
    for (const id of replay) {
      if (!this.applyBoarding(id)) break;
    }

    this.phase = this.evaluatePhase();
    this.source.prefetch(level + 1);
    this.persist();
    this.notify({ kind: 'reset' });
  }

  /** Applies a boarding if it is legal. Returns false if it was not. */
  private applyBoarding(passengerId: number): boolean {
    const generated = this.generated;
    const index = this.index;
    if (!generated || !index) return false;
    if (!isReachable(generated.board, index, this.board, passengerId)) return false;

    const passenger = generated.board.passengers[passengerId] as Passenger;
    const result = accept(this.sinks, generated.config, passenger.color);
    if (result.placed === 'lost') return false;

    this.sinks = result.state;
    boardPassenger(generated.board, this.board, passengerId);
    this.moves.push(passengerId);
    return true;
  }

  /**
   * Recomputes the phase from the crowd and the bench. Sets `lossReason` as a
   * side effect so the two can never disagree.
   */
  private evaluatePhase(): GamePhase {
    if (allBoarded(this.board)) {
      this.lossReason = null;
      return 'won';
    }

    const generated = this.generated;
    const index = this.index;
    if (!generated || !index) {
      this.lossReason = null;
      return 'loading';
    }

    const reachable = reachableIds(generated.board, index, this.board);
    const anyPlayable = reachable.some((id) => {
      const passenger = generated.board.passengers[id] as Passenger;
      return accept(this.sinks, generated.config, passenger.color).placed !== 'lost';
    });

    if (anyPlayable) {
      this.lossReason = null;
      return 'playing';
    }

    // Nobody reachable can be placed. Waiting for the player to tap someone and
    // lose on it would just be a slower way of arriving here.
    this.lossReason = 'noMoves';
    return 'lost';
  }

  private persist(): void {
    this.writer.schedule({
      ...this.save,
      inProgress: this.moves.length > 0 ? { level: this.save.level, moves: this.moves } : null,
    });
  }

  tapPassenger(passengerId: number): void {
    if (this.phase !== 'playing') return;
    const generated = this.generated;
    const index = this.index;
    if (!generated || !index) return;

    // The route is taken before anything changes, because it is what the
    // renderer walks them along and it is only well defined while they are
    // still standing on the board.
    const path = pathToExit(generated.board, index, this.board, passengerId);
    if (!path) {
      this.notify({ kind: 'reject', passengerId, reason: 'blocked' });
      return;
    }

    const passenger = generated.board.passengers[passengerId] as Passenger;
    const result = accept(this.sinks, generated.config, passenger.color);

    // No bus wants this colour and the bench is full: the level is over. They
    // stay on the board — there is nowhere for them to go, and leaving them in
    // place is what makes undo able to walk the position back.
    if (result.placed === 'lost') {
      this.failedHere = true;
      this.phase = 'lost';
      this.lossReason = 'benchFull';
      this.persist();
      this.notify({ kind: 'overflow', passengerId });
      return;
    }

    // Work out where they land before committing, so the renderer can walk them
    // to the right seat.
    const busIndex = this.sinks.sinks.findIndex(
      (sink) =>
        sink !== null &&
        sink.color === passenger.color &&
        sink.filled < generated.config.sinkCapacity,
    );
    const benchSlot = this.sinks.buffer.length;

    this.sinks = result.state;
    boardPassenger(generated.board, this.board, passengerId);
    this.moves.push(passengerId);
    this.advanceHintPlan(passengerId);

    this.phase = this.evaluatePhase();
    this.persist();

    this.notify(
      result.placed === 'sink'
        ? { kind: 'walk', passengerId, path, to: 'bus', busIndex }
        : { kind: 'walk', passengerId, path, to: 'bench', benchSlot },
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

  /** Rebuilds crowd and bus state from the move list. */
  private replayFromStart(): void {
    const generated = this.generated;
    if (!generated) return;

    const moves = this.moves;
    this.board = createBoardState(generated.board);
    this.sinks = createSinkState(generated.config, generated.queue);
    this.moves = [];
    for (const id of moves) {
      if (!this.applyBoarding(id)) break;
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
   * The next passenger on a winning line. Free and unlimited.
   *
   * A whole solution is computed once and then followed, rather than re-solving
   * after every boarding — two searches from adjacent positions can return
   * different winning lines, and the second one's opening move may undo the
   * first's, which makes repeated hints ping-pong forever.
   */
  requestHint(): number | null {
    if (this.phase !== 'playing' || !this.generated) return null;

    if (!this.hintPlan) {
      const spec = {
        board: this.generated.board,
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
    this.notify({ kind: 'hint', passengerId: next });
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
