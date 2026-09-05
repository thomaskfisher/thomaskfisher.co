/**
 * Depot game controller.
 *
 * Owns all state and persistence; knows nothing about the DOM.
 *
 * The saved move list is one bus id per pull. Because generation is
 * deterministic, replaying that list reproduces the lot, the kerb and the queue
 * exactly, so none of the three is stored and none of them can drift out of
 * step with the others. A whole save is a few dozen small numbers.
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
  type Bus,
  type GameStateCore,
  type Level,
  type PullResult,
  createState,
  drivableIds,
  isLost,
  isWon,
  packMove,
  pull,
  unpackMove,
} from './model';
import { findSolution } from './solve';

export const GAME_ID = 'depot';

export type GamePhase = 'loading' | 'playing' | 'won' | 'lost';

/** What just happened, so the renderer can animate rather than snap. */
export type Effect =
  | { kind: 'none' }
  | { kind: 'reset' }
  | { kind: 'pull'; id: number; bay: number; boarded: number; won: boolean }
  | { kind: 'reject'; id: number; reason: PullResult }
  | { kind: 'hint'; id: number };

export interface GameState {
  phase: GamePhase;
  /** Set only while `phase` is 'lost' because the optional clock ran out. */
  outOfTime: boolean;
  level: number;
  generated: GeneratedLevel | null;
  /** The lot, the kerb and the queue position. Null until a level has loaded. */
  core: GameStateCore | null;
  /** Buses that could be tapped right now. The renderer dims the rest. */
  drivable: number[];
  /**
   * Hidden buses whose colour the player has been shown.
   *
   * Kept for the whole level once seen, including through undo and restart.
   * Undo exists here so that a wrong move is not a punishment; re-hiding a
   * colour the player is sitting there looking at would make it one, and would
   * turn a `?` from "spend a move to find out" into a coin toss. It is not
   * persisted — a reload re-hides — because that would mean putting something
   * in the save that the move list cannot rebuild.
   */
  revealed: boolean[];
  moveCount: number;
  /** Buses filled and driven off. What the optional clock pays out on. */
  departed: number;
  canUndo: boolean;
  effect: Effect;
}

type Listener = (state: GameState) => void;

export class DepotGame {
  /**
   * Seeded with a default rather than left undefined until `start()`, because
   * `subscribe` notifies synchronously and the first render happens before the
   * save has loaded. See `shared/first-render.test.ts`.
   */
  private save: SaveData<number> = defaultSave<number>(GAME_ID);
  private writer = createSaveWriter<number>(GAME_ID);
  private source!: LevelSource<GeneratedLevel>;

  private generated: GeneratedLevel | null = null;
  private spec: Level | null = null;
  private core: GameStateCore | null = null;
  private history: number[] = [];
  private seen = new Set<number>();
  private phase: GamePhase = 'loading';
  private outOfTime = false;
  private effect: Effect = { kind: 'none' };

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
    const buses = this.generated?.board.buses ?? [];
    return {
      phase: this.phase,
      outOfTime: this.outOfTime,
      level: this.save?.level ?? 1,
      generated: this.generated,
      core: this.core,
      drivable:
        this.generated && this.core && this.phase === 'playing'
          ? drivableIds(this.generated.board, this.core)
          : [],
      revealed: buses.map((_, id) => this.seen.has(id)),
      moveCount: this.history.length,
      departed: this.core?.departed ?? 0,
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
    this.outOfTime = false;
    this.generated = null;
    this.spec = null;
    this.core = null;
    this.history = [];
    this.seen = new Set();
    this.notify({ kind: 'reset' });

    const generated = await this.source.get(level);
    const spec: Level = { board: generated.board, queue: generated.queue };

    this.generated = generated;
    this.spec = spec;
    this.core = createState(generated.board);
    this.history = [];
    this.hintPlan = null;

    // Restore a level in progress. A pull that no longer applies ends the
    // replay rather than throwing: a corrupt tail should cost the tail, not the
    // level, and a half-replayed board is still a legal position.
    for (const packed of replay) {
      const id = unpackMove(packed);
      if (pull(spec, this.core, id) !== 'ok') break;
      this.history.push(id);
      this.seen.add(id);
      if (isWon(spec, this.core)) break;
    }

    this.phase = isWon(spec, this.core)
      ? 'won'
      : isLost(spec, this.core)
        ? 'lost'
        : 'playing';

    this.source.prefetch(level + 1);
    this.persist();
    this.notify({ kind: 'reset' });
  }

  private persist(): void {
    this.writer.schedule({
      ...this.save,
      inProgress:
        this.history.length > 0 ? { level: this.save.level, moves: this.history.map(packMove) } : null,
    });
  }

  /** Drives a bus out of the lot and onto the kerb. */
  tap(id: number): void {
    const spec = this.spec;
    const core = this.core;
    if (this.phase !== 'playing' || !spec || !core) return;

    const before = core.boarded;
    const result = pull(spec, core, id);
    if (result !== 'ok') {
      this.notify({ kind: 'reject', id, reason: result });
      return;
    }

    this.history.push(id);
    this.seen.add(id);
    this.advanceHintPlan(id);

    const bay = core.bays.findIndex((slot) => slot?.id === id);
    const won = isWon(spec, core);
    if (won) this.phase = 'won';
    else if (isLost(spec, core)) this.phase = 'lost';

    this.persist();
    this.notify({ kind: 'pull', id, bay, boarded: core.boarded - before, won });
  }

  /**
   * Keeps the cached winning line in step: consume the head when the player
   * plays it, discard the plan when they go their own way.
   */
  private advanceHintPlan(played: number): void {
    if (this.hintPlan?.[0] !== played) {
      this.hintPlan = null;
      return;
    }
    this.hintPlan = this.hintPlan.length > 1 ? this.hintPlan.slice(1) : null;
  }

  undo(): void {
    const spec = this.spec;
    if (this.history.length === 0 || !spec) return;

    this.outOfTime = false;
    this.history.pop();
    this.hintPlan = null;

    // Replayed from the start rather than unwound. Undoing a pull means undoing
    // every passenger who boarded because of it, and every bus that filled and
    // left as a result; replaying cannot drift, and these lists are at most a
    // couple of dozen entries long.
    this.core = createState(spec.board);
    for (const id of this.history) pull(spec, this.core, id);

    this.phase = isWon(spec, this.core) ? 'won' : 'playing';
    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalUndos: this.save.stats.totalUndos + 1 },
    };
    this.persist();
    this.notify({ kind: 'reset' });
  }

  restart(): void {
    const spec = this.spec;
    if (!spec) return;
    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalRestarts: this.save.stats.totalRestarts + 1 },
    };
    this.core = createState(spec.board);
    this.history = [];
    this.hintPlan = null;
    this.outOfTime = false;
    this.phase = 'playing';
    this.persist();
    this.notify({ kind: 'reset' });
  }

  /**
   * The next bus on a winning line. Free and unlimited.
   *
   * A whole line is computed once and then followed, rather than re-solved after
   * every tap. Two searches from adjacent positions can return different winning
   * orders, and the second one's opening move may undo the first's — which is
   * how a hint button ends up ping-ponging between two buses forever.
   */
  requestHint(): number | null {
    const spec = this.spec;
    if (this.phase !== 'playing' || !spec) return null;

    if (!this.hintPlan) this.hintPlan = findSolution(spec, this.history);

    const id = this.hintPlan?.[0];
    if (id === undefined) return null;

    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalHints: this.save.stats.totalHints + 1 },
    };
    this.persist();
    this.notify({ kind: 'hint', id });
    return id;
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
   * Ends the level because the clock ran out. Deliberately not persisted as
   * anything special: the move list on disk is still a legal, partly-played
   * board, so reopening the app puts the player back where they were rather
   * than on a fresh loss.
   */
  loseToTime(): void {
    if (this.phase !== 'playing') return;
    this.outOfTime = true;
    this.phase = 'lost';
    this.notify();
  }
}

/** The colour to draw a bus in, or null when it is still a `?`. */
export function shownColor(bus: Bus, revealed: boolean, parked: boolean): number | null {
  if (!bus.unknown || revealed || !parked) return bus.color;
  return null;
}
