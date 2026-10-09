/**
 * Marble Sort game controller.
 *
 * Owns all state, the clock and persistence; knows nothing about the DOM.
 *
 * **The saved move list is a list of (tick, pipe) taps.** The belt is integer
 * arithmetic stepped by a fixed tick, so replaying the taps at the ticks they
 * were made reproduces the belt, the funnel and every block exactly — a save is
 * still a few dozen numbers, and the board can never drift from its history.
 *
 * **Undo rewinds the clock to the moment of the last tap.** Not to the last
 * settled position: a tap made while marbles were still landing is taken back
 * to the tick it was made on, with those marbles still in the air, which is the
 * only reading of "undo that" that does not also quietly undo something else.
 *
 * **One timer, and it runs for as long as the level is being played.** The belt
 * never stops, as in the original: a pause whenever nothing could land told
 * the player exactly when it was safe to tap, and made the game easier than it
 * should be. The clock is `shared/clock.ts`; it stops for a sheet, a hidden
 * tab, a win or a loss, and nothing here schedules anything else.
 *
 * A save is the taps, not the tick the player left on: reopening the app puts
 * the belt back where it was at the last tap and turns it on from there. Idle
 * turns change nothing but where the marbles are on the loop.
 */

import { GravityClock } from '../shared/clock';
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
  type Geometry,
  type Sim,
  type Status,
  type TickEvents,
  canTap,
  createSim,
  emptyEvents,
  encodeMove,
  geometryFor,
  isOver,
  moveTick,
  replay,
  statusOf,
  step,
  tap,
} from './model';
import { findSolution } from './solve';

export const GAME_ID = 'marblesort';

/** One slot of belt travel. Slow enough to follow a marble, quick enough to keep up. */
export const TICK_MS = 95;

export type GamePhase = 'loading' | 'playing' | 'won' | 'lost';

/** What just happened, so the renderer can animate rather than snap. */
export type Effect =
  | { kind: 'none' }
  | { kind: 'reset' }
  | { kind: 'tick'; events: TickEvents }
  | { kind: 'drop'; color: number; count: number }
  | { kind: 'hint'; color: number }
  | { kind: 'reject' };

export interface GameState {
  phase: GamePhase;
  level: number;
  generated: GeneratedLevel | null;
  geometry: Geometry | null;
  sim: Sim | null;
  /** Whether anything will still land ('moving') or the belt is only circling ('settled'). */
  status: Status;
  moveCount: number;
  canUndo: boolean;
  /** A hint was asked for while marbles were landing; it shows once they finish. */
  hintPending: boolean;
  effect: Effect;
}

type Listener = (state: GameState) => void;

export class MarbleSortGame {
  /** Seeded with a default for the same reason as Bus Jam: see its controller. */
  private save: SaveData<number> = defaultSave<number>(GAME_ID);
  private writer = createSaveWriter<number>(GAME_ID);
  private source!: LevelSource<GeneratedLevel>;

  private generated: GeneratedLevel | null = null;
  private geometry: Geometry | null = null;
  private sim: Sim | null = null;
  private moves: number[] = [];
  private phase: GamePhase = 'loading';
  private status: Status = 'settled';
  private effect: Effect = { kind: 'none' };

  /** Interruptions holding the clock. Play resumes when the last one lifts. */
  private holds = new Set<string>();
  private clock = new GravityClock({ onTick: () => this.tick() });

  /**
   * The line the last hint came from, as pipe colours, consumed as the player
   * taps along it. The hint searches again every time — the belt has turned
   * since, so the position is never quite the one this was found from — but it
   * tries this line's next tap first, so it does not flip between two winning
   * lines whose first taps undo each other.
   */
  private hintPlan: number[] | null = null;
  private hintPending = false;

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
      geometry: this.geometry,
      sim: this.sim,
      status: this.status,
      moveCount: this.moves.length,
      canUndo: this.moves.length > 0,
      hintPending: this.hintPending,
      effect: this.effect,
    };
  }

  get settings() {
    return this.save.settings;
  }

  get currentSave(): SaveData<number> {
    return this.save;
  }

  /* ------------------------------------------------------------- clock */

  private tick(): number {
    const generated = this.generated;
    const geometry = this.geometry;
    const sim = this.sim;
    if (!generated || !geometry || !sim || this.phase !== 'playing') return 0;

    const events = emptyEvents();
    step(generated.board, sim, geometry, events);
    this.status = statusOf(generated.board, sim, geometry);
    this.phase = this.phaseFor(this.status);
    this.notify({ kind: 'tick', events });

    if (this.status === 'settled' && this.hintPending) this.showHint();
    return this.phase === 'playing' ? TICK_MS : 0;
  }

  /** Starts the belt unless the level is over or something is holding it. */
  private run(): void {
    if (this.phase !== 'playing') return;
    if (this.holds.size > 0 || this.clock.running) return;
    this.clock.start(TICK_MS);
  }

  /**
   * Holds the clock — a sheet is open, the tab is hidden. Reasons are named so
   * that closing Settings does not restart a belt the hidden tab is holding.
   */
  pause(reason: string): void {
    this.holds.add(reason);
    this.clock.stop();
  }

  resume(reason: string): void {
    this.holds.delete(reason);
    this.run();
  }

  private phaseFor(status: Status): GamePhase {
    if (status === 'won') return 'won';
    if (status === 'lost') return 'lost';
    return 'playing';
  }

  /* ------------------------------------------------------------ levels */

  private async loadLevel(level: number, moves: number[] = []): Promise<void> {
    this.clock.stop();
    this.phase = 'loading';
    this.notify({ kind: 'reset' });
    const generated = await this.source.get(level);

    this.generated = generated;
    this.geometry = geometryFor(generated.board);
    this.hintPlan = null;
    this.hintPending = false;

    // A move that no longer applies is dropped with everything after it, rather
    // than throwing — a corrupt tail should not cost the level.
    const restored = replay(generated.board, moves, this.geometry);
    this.moves = moves.slice(0, restored.applied);
    this.sim = restored.sim;
    this.status = statusOf(generated.board, this.sim, this.geometry);
    this.phase = this.phaseFor(this.status);

    this.source.prefetch(level + 1);
    this.persist();
    this.notify({ kind: 'reset' });
    this.run();
  }

  /**
   * Rebuilds the position as it stood just before the move at `index` — the
   * earlier taps replayed, then the belt run on to that move's tick.
   */
  private rewindTo(index: number): void {
    const generated = this.generated;
    const geometry = this.geometry;
    if (!generated || !geometry) return;

    const target = this.moves[index];
    this.moves = this.moves.slice(0, index);
    const { sim } = replay(generated.board, this.moves, geometry);
    if (target !== undefined) {
      const tick = moveTick(target);
      while (sim.tick < tick && !isOver(statusOf(generated.board, sim, geometry))) {
        step(generated.board, sim, geometry);
      }
    }
    this.sim = sim;
    this.status = statusOf(generated.board, sim, geometry);
    this.phase = this.phaseFor(this.status);
  }

  private persist(): void {
    this.writer.schedule({
      ...this.save,
      inProgress: this.moves.length > 0 ? { level: this.save.level, moves: this.moves } : null,
    });
  }

  /* ----------------------------------------------------------- actions */

  tapPipe(color: number): void {
    const generated = this.generated;
    const sim = this.sim;
    if (this.phase !== 'playing' || !generated || !sim) return;
    if (!canTap(sim, color)) {
      this.notify({ kind: 'reject' });
      return;
    }

    this.moves.push(encodeMove(sim.tick, color));
    const count = tap(generated.board, sim, color);
    this.advanceHintPlan(color);
    this.status = 'moving';
    this.persist();
    this.notify({ kind: 'drop', color, count });
    this.run();
  }

  /** Keeps the line the hint is following in step with the taps actually made. */
  private advanceHintPlan(color: number): void {
    this.hintPending = false;
    if (!this.hintPlan || this.hintPlan[0] !== color) {
      this.hintPlan = null;
      return;
    }
    this.hintPlan = this.hintPlan.length > 1 ? this.hintPlan.slice(1) : null;
  }

  undo(): void {
    if (this.moves.length === 0 || this.phase === 'loading') return;
    this.clock.stop();
    this.hintPlan = null;
    this.hintPending = false;
    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalUndos: this.save.stats.totalUndos + 1 },
    };
    this.rewindTo(this.moves.length - 1);
    this.persist();
    this.notify({ kind: 'reset' });
    this.run();
  }

  restart(): void {
    const generated = this.generated;
    if (!generated || this.phase === 'loading') return;
    this.clock.stop();
    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalRestarts: this.save.stats.totalRestarts + 1 },
    };
    this.moves = [];
    this.hintPlan = null;
    this.hintPending = false;
    this.sim = createSim(generated.board);
    this.status = 'settled';
    this.phase = 'playing';
    this.persist();
    this.notify({ kind: 'reset' });
    this.run();
  }

  /**
   * The next pipe on a winning line. Free and unlimited.
   *
   * Asked for while marbles are still landing, it waits until they have — the
   * line is a line of taps made once things settle, and pointing at a pipe
   * mid-landing would be advice about a position that is about to change.
   */
  requestHint(): boolean {
    if (this.phase !== 'playing' || !this.generated || !this.sim) return false;
    if (this.status === 'moving') {
      this.hintPending = true;
      this.notify();
      return true;
    }
    return this.showHint();
  }

  private showHint(): boolean {
    this.hintPending = false;
    const generated = this.generated;
    const sim = this.sim;
    if (!generated || !sim) return false;

    this.hintPlan = findSolution(generated.board, sim, this.hintPlan?.[0]);
    const next = this.hintPlan?.[0];
    if (next === undefined) {
      this.notify({ kind: 'reject' });
      return false;
    }

    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalHints: this.save.stats.totalHints + 1 },
    };
    this.persist();
    this.notify({ kind: 'hint', color: next });
    return true;
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

  /** See Bus Jam's controller: a note, not a preference, so no redraw. */
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

  /** Writes now rather than on the debounce — the page is going away. */
  flush(): void {
    this.writer.flush();
  }
}
