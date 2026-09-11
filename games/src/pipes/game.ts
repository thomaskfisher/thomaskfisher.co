/**
 * Pipes game controller.
 *
 * Owns all state and persistence; knows nothing about the DOM.
 *
 * The saved move list is one integer per tap — the cell that was turned, and
 * nothing else, because a quarter turn clockwise is the only move in the game.
 * Because generation is deterministic, replaying that list against
 * `(seed, level)` reproduces the board exactly.
 *
 * **There is no losing phase in the rules.** Every turn is reversible by three
 * more, so a player can always work back out of wherever they have got to;
 * `lost` here only ever means the optional clock ran out.
 */

import { LevelSource } from '../shared/levelSource';
import {
  type SaveData,
  completeLevel,
  createSaveWriter,
  defaultSave,
  loadSave,
} from '../shared/progress';
import { GAME_ID, type GeneratedLevel, generateLevel } from './generate';
import {
  type Move,
  type Tiles,
  applyMove,
  isSolved,
  leakCount,
  wetCells,
  wetCount,
} from './model';
import { nextTurn, turnsRemaining } from './solve';

export { GAME_ID };

export type GamePhase = 'loading' | 'playing' | 'won' | 'lost';

export type Effect =
  | { kind: 'none' }
  | { kind: 'reset' }
  | { kind: 'turn'; cell: number; joined: boolean }
  | { kind: 'hint'; cell: number; to: number };

export interface GameState {
  phase: GamePhase;
  outOfTime: boolean;
  level: number;
  generated: GeneratedLevel | null;
  tiles: Tiles;
  /** Which tiles the water reaches right now. */
  wet: boolean[];
  wetTiles: number;
  /** Stubs leading nowhere. */
  leaks: number;
  /** Quarter turns still needed, following the board's own answer. */
  remaining: number;
  moveCount: number;
  canUndo: boolean;
  effect: Effect;
}

type Listener = (state: GameState) => void;

const EMPTY: number[] = [];

export class PipesGame {
  /**
   * Seeded with a default rather than left undefined until `start()`, because
   * `subscribe` notifies synchronously and the first render happens before the
   * save has loaded. See `shared/first-render.test.ts`.
   */
  private save: SaveData<number> = defaultSave<number>(GAME_ID);
  private writer = createSaveWriter<number>(GAME_ID);
  private source!: LevelSource<GeneratedLevel>;

  private generated: GeneratedLevel | null = null;
  private tiles: Tiles = EMPTY;
  private history: Move[] = [];
  private phase: GamePhase = 'loading';
  private outOfTime = false;
  private effect: Effect = { kind: 'none' };

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
      tiles: this.tiles,
      wet: board ? wetCells(board, this.tiles) : [],
      wetTiles: board ? wetCount(board, this.tiles) : 0,
      leaks: board ? leakCount(board, this.tiles) : 0,
      remaining: board ? turnsRemaining(board, this.tiles) : 0,
      moveCount: this.history.length,
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

  private async loadLevel(level: number, replayMoves: number[] = []): Promise<void> {
    this.phase = 'loading';
    this.outOfTime = false;
    this.generated = null;
    this.tiles = EMPTY;
    this.history = [];
    this.notify({ kind: 'reset' });

    const generated = await this.source.get(level);

    this.generated = generated;
    this.tiles = generated.start.slice();
    this.history = [];

    // Restore a level in progress. A turn that no longer applies is dropped
    // rather than throwing — a corrupt tail should cost the tail, not the level.
    for (const cell of replayMoves) {
      if (!Number.isInteger(cell) || cell < 0 || cell >= this.tiles.length) break;
      this.tiles = applyMove(this.tiles, cell);
      this.history.push(cell);
    }

    this.phase = isSolved(generated.board, this.tiles) ? 'won' : 'playing';

    this.source.prefetch(level + 1);
    this.persist();
    this.notify({ kind: 'reset' });
  }

  private persist(): void {
    this.writer.schedule({
      ...this.save,
      inProgress:
        this.history.length > 0 ? { level: this.save.level, moves: this.history.slice() } : null,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Input                                                               */
  /* ------------------------------------------------------------------ */

  /**
   * Turns a tile one quarter clockwise. The only move in the game.
   *
   * A cross is refused rather than counted: it looks identical afterwards, so a
   * turn on one would be an entry in the undo list that nothing on screen
   * accounts for — the player taps undo, watches nothing happen, and taps again.
   */
  turn(cell: number): void {
    if (this.phase !== 'playing' || !this.generated) return;
    if (cell < 0 || cell >= this.tiles.length) return;

    const before = this.tiles[cell] as number;
    const next = applyMove(this.tiles, cell);
    if (next[cell] === before) return;

    const wasWet = wetCount(this.generated.board, this.tiles);
    this.tiles = next;
    this.history.push(cell);

    const solved = isSolved(this.generated.board, this.tiles);
    if (solved) this.phase = 'won';

    const nowWet = wetCount(this.generated.board, this.tiles);

    this.persist();
    this.notify({ kind: 'turn', cell, joined: nowWet > wasWet });
  }

  undo(): void {
    if (this.history.length === 0 || !this.generated) return;

    this.outOfTime = false;
    this.history.pop();

    // Replayed from the opening scramble rather than inverted. Inverting a
    // quarter turn is three more quarter turns and would be easy enough; replay
    // cannot drift, and these lists are a few hundred entries at the very most.
    this.tiles = this.generated.start.slice();
    for (const cell of this.history) this.tiles = applyMove(this.tiles, cell);

    this.phase = isSolved(this.generated.board, this.tiles) ? 'won' : 'playing';
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
    this.tiles = this.generated.start.slice();
    this.history = [];
    this.outOfTime = false;
    this.phase = 'playing';
    this.persist();
    this.notify({ kind: 'reset' });
  }

  /**
   * The next tile to turn. Free and unlimited.
   *
   * No cached plan and no ping-pong to guard against. The advice follows the
   * board's own answer outward from the source, which makes it a pure function
   * of the position — two answers to the same question are the same answer — and
   * means every hint the player takes lights something up rather than fixing a
   * tile in a corner where nothing visibly happens.
   */
  requestHint(): { cell: number; to: number } | null {
    if (this.phase !== 'playing' || !this.generated) return null;

    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalHints: this.save.stats.totalHints + 1 },
    };
    this.persist();

    const advice = nextTurn(this.generated.board, this.tiles);
    if (!advice) return null;

    this.notify({ kind: 'hint', cell: advice.cell, to: advice.to });
    return advice;
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
   * is still a legal, partly-turned board.
   */
  loseToTime(): void {
    if (this.phase !== 'playing') return;
    this.outOfTime = true;
    this.phase = 'lost';
    this.notify();
  }
}
