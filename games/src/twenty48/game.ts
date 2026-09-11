/**
 * 2048 game controller.
 *
 * Owns all state and persistence; knows nothing about the DOM.
 *
 * The saved move list is one integer per swipe — a direction, nothing more.
 * Because the tiles that arrive are a pure function of the move *number*,
 * replaying that list against `(seed, level)` reproduces the board exactly,
 * spawns included.
 *
 * **This game can be lost, and it is the only puzzle here besides the clock that
 * can.** A board with no legal move is a real dead end, and no amount of undo
 * changes what happened — it only lets you go back and try a different line,
 * which is exactly what the house rules are for. There are no lives, nothing
 * recharges, and the loss sheet offers Undo and Restart and nothing else.
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
  type Dir,
  type Position,
  type Spawn,
  emptyCells,
  hasReached,
  highestTile,
  isStuck,
  legalMoves,
  openingPosition,
  spawnAt,
  step,
} from './model';
import { bestMove } from './solve';

export { GAME_ID };

export type GamePhase = 'loading' | 'playing' | 'won' | 'lost';

export type Effect =
  | { kind: 'none' }
  | { kind: 'reset' }
  | { kind: 'move'; direction: Dir; merged: number[] }
  | { kind: 'reject'; direction: Dir }
  | { kind: 'hint'; direction: Dir };

export interface GameState {
  phase: GamePhase;
  /** True when the loss was the clock rather than a jammed board. */
  outOfTime: boolean;
  level: number;
  generated: GeneratedLevel | null;
  position: Position;
  /** The tile that will arrive after the next move. Shown before it is played. */
  nextSpawn: Spawn | null;
  /** Highest exponent on the board. */
  best: number;
  /** Directions that would change something. */
  options: Dir[];
  moveCount: number;
  canUndo: boolean;
  effect: Effect;
}

type Listener = (state: GameState) => void;

const EMPTY_POSITION: Position = {
  grid: [],
  moveIndex: 0,
  score: 0,
  lastSpawn: -1,
  movements: [],
};

export class Twenty48Game {
  /**
   * Seeded with a default rather than left undefined until `start()`, because
   * `subscribe` notifies synchronously and the first render happens before the
   * save has loaded. See `shared/first-render.test.ts`.
   */
  private save: SaveData<number> = defaultSave<number>(GAME_ID);
  private writer = createSaveWriter<number>(GAME_ID);
  private source!: LevelSource<GeneratedLevel>;

  private generated: GeneratedLevel | null = null;
  private position: Position = EMPTY_POSITION;
  private history: Dir[] = [];
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
    const generated = this.generated;
    const size = generated?.size ?? 0;

    return {
      phase: this.phase,
      outOfTime: this.outOfTime,
      level: this.save?.level ?? 1,
      generated,
      position: this.position,
      nextSpawn: generated ? spawnAt(this.save.seed, generated.level, this.position.moveIndex) : null,
      best: generated ? highestTile(this.position.grid) : 0,
      options: generated ? legalMoves(this.position.grid, size) : [],
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
    this.position = EMPTY_POSITION;
    this.history = [];
    this.notify({ kind: 'reset' });

    const generated = await this.source.get(level);

    this.generated = generated;
    this.position = openingPosition(this.save.seed, level, generated.size, generated.seeds);
    this.history = [];

    // Restore a level in progress. A swipe that no longer applies ends the
    // replay rather than throwing — a corrupt tail should cost the tail.
    for (const packed of replayMoves) {
      if (!Number.isInteger(packed) || packed < 0 || packed > 3) break;
      const direction = packed as Dir;
      const next = step(this.position, generated.size, direction, this.save.seed, level);
      if (!next) break;
      this.position = next;
      this.history.push(direction);
    }

    this.phase = this.phaseFor();

    this.source.prefetch(level + 1);
    this.persist();
    this.notify({ kind: 'reset' });
  }

  /** Won on reaching the target, lost on a board with nothing left to play. */
  private phaseFor(): GamePhase {
    const generated = this.generated;
    if (!generated) return 'loading';
    if (hasReached(this.position.grid, generated.target)) return 'won';
    if (isStuck(this.position.grid, generated.size)) return 'lost';
    return 'playing';
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
   * Swipes one way.
   *
   * A direction that changes nothing is refused rather than counted. On a phone
   * that is what a swipe into a wall looks like, and recording it would put an
   * entry in the undo list that nothing on screen accounts for.
   */
  move(direction: Dir): void {
    if (this.phase !== 'playing' || !this.generated) return;

    const next = step(this.position, this.generated.size, direction, this.save.seed, this.generated.level);
    if (!next) {
      this.notify({ kind: 'reject', direction });
      return;
    }

    const merged = next.movements.filter((m) => m.merged).map((m) => next.grid[m.to] as number);

    this.position = next;
    this.history.push(direction);
    this.phase = this.phaseFor();

    this.persist();
    this.notify({ kind: 'move', direction, merged: [...new Set(merged)] });
  }

  undo(): void {
    if (this.history.length === 0 || !this.generated) return;

    this.outOfTime = false;
    this.history.pop();

    // Replayed from the opening rather than inverted: a 2048 move is not
    // invertible at all — the merge destroyed which tiles went where, and a
    // spawn arrived on top of it.
    this.position = openingPosition(
      this.save.seed,
      this.generated.level,
      this.generated.size,
      this.generated.seeds,
    );
    for (const direction of this.history) {
      const next = step(
        this.position,
        this.generated.size,
        direction,
        this.save.seed,
        this.generated.level,
      );
      if (!next) break;
      this.position = next;
    }

    this.phase = this.phaseFor();
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
    this.position = openingPosition(
      this.save.seed,
      this.generated.level,
      this.generated.size,
      this.generated.seeds,
    );
    this.history = [];
    this.outOfTime = false;
    this.phase = 'playing';
    this.persist();
    this.notify({ kind: 'reset' });
  }

  /**
   * The best direction from here. Free and unlimited.
   *
   * No cached plan and no ping-pong to guard against: the search is a pure
   * function of the position, so two answers to the same question are the same
   * answer, and taking the advice always moves the game forward.
   */
  requestHint(): Dir | null {
    if (this.phase !== 'playing' || !this.generated) return null;

    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalHints: this.save.stats.totalHints + 1 },
    };
    this.persist();

    const direction = bestMove(
      this.position,
      this.generated.size,
      this.save.seed,
      this.generated.level,
      HINT_DEPTH,
    );
    if (direction === null) return null;

    this.notify({ kind: 'hint', direction });
    return direction;
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

  loseToTime(): void {
    if (this.phase !== 'playing') return;
    this.outOfTime = true;
    this.phase = 'lost';
    this.notify();
  }
}

/**
 * How far the hint looks ahead.
 *
 * Shallower than the verifier's five, because this runs on the main thread the
 * moment somebody taps the button and a visible pause there is worse than a
 * slightly weaker suggestion. Four is still a stronger player than anybody
 * asking for a hint.
 */
const HINT_DEPTH = 4;

/** Cells still free. Shown nowhere, used by the clock's sense of pressure. */
export function roomLeft(state: GameState): number {
  return state.generated ? emptyCells(state.position.grid).length : 0;
}
