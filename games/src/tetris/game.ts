/**
 * Tetris game controller. Owns all state and persistence, and knows nothing
 * about the DOM.
 *
 * **It does own the clock, which is a departure, and here is the argument.**
 * Simon pushes every timer into its renderer, because Simon's timers are
 * presentation: a chain of flashes showing a sequence the model already knows.
 * Artillery puts its frame loop in its renderer for the same reason — it is a
 * camera following a shot the model has already resolved. Gravity is neither.
 * It is a rule, it changes the game state, and a player can lose to it. Putting
 * it in the renderer would mean the renderer deciding when a piece locks, which
 * is the thing this project has repeatedly learned not to let the view layer
 * do. So the clock lives here, and it is `clock.ts` — one timer, one handle,
 * one `stop()` — precisely because a real-time game is nothing but deferred
 * mutations and this codebase has been bitten by those twice.
 *
 * **Bends the house rules the way Simon does, and for the same reason.**
 *
 *  - **No undo.** Undo in a real-time game is a rewind of the clock. There is
 *    no move to take back — the piece fell.
 *  - **No hint.** A hint is where to put the piece, which is the only question
 *    the game asks.
 *  - **Losing ends the game.** What "never back to level 1" becomes here is
 *    that nothing is lost *by* losing: the best score is kept, every game is a
 *    fresh seeded stream rather than a replay of the one that beat you, and a
 *    game in progress survives the app being closed.
 *
 * What is kept: no ads, no clock beyond the one that *is* the game, nothing
 * locked, no currency, and a run that comes back exactly where it was left —
 * as a position rather than a history, see `snapshot.ts`.
 *
 * **Anything that interrupts play stops the clock and waits for a tap.** A
 * sheet opening, the app being backgrounded, a reload. Timers in a hidden tab
 * are throttled or stopped, so catching up on return would drop a piece into
 * whatever the well now contains — and a piece that fell while the phone was in
 * a pocket fell in a game nobody was playing.
 */

import {
  type SaveData,
  completeLevel,
  createSaveWriter,
  defaultSave,
  loadSave,
} from '../shared/progress';
import { GravityClock } from './clock';
import { LOCK_DELAY_MS, LOCK_RESETS, SOFT_DROP_MS, gravityMs, isResting } from './model';
import { decodeRun, encodeRun } from './snapshot';
import {
  type Action,
  type Run,
  type RunEvent,
  apply,
  levelIn,
  lockDown,
  previewOf,
  startRun,
} from './run';

export const GAME_ID = 'tetris';

/**
 * - `loading`: the save has not arrived. The board is blank.
 * - `ready`: a run is set up and the clock is stopped, waiting for a tap. A
 *   fresh game, a resumed one, and anything that interrupted play.
 * - `playing`: the clock is running.
 * - `over`: topped out.
 */
export type GamePhase = 'loading' | 'ready' | 'playing' | 'over';

export type Effect =
  | { kind: 'none' }
  /** The board was replaced wholesale. Cancel everything pending. */
  | { kind: 'reset' }
  | { kind: 'moved' }
  | { kind: 'rotated' }
  | { kind: 'held' }
  | { kind: 'refused' }
  /** A piece came down. `rows` are the well rows that cleared with it. */
  | { kind: 'locked'; lines: number; rows: number[] }
  | { kind: 'over' };

export interface GameView {
  phase: GamePhase;
  /** The game number. Named `level` because the shared chrome asks for it. */
  level: number;
  run: Run;
  /** The next three pieces, as they will actually arrive. */
  preview: number[];
  /** The difficulty level inside this run: speed, and how mean the bag is. */
  runLevel: number;
  score: number;
  lines: number;
  best: number;
  games: number;
  /** A new best, as of the game just lost. */
  isBest: boolean;
  effect: Effect;
}

type Listener = (view: GameView) => void;

export class TetrisGame {
  /**
   * Seeded with a default rather than left undefined until `start()`, because
   * `subscribe` notifies synchronously and the first render therefore happens
   * before the save has loaded. See `shared/first-render.test.ts`.
   */
  private save: SaveData<string> = defaultSave<string>(GAME_ID);
  private writer = createSaveWriter<string>(GAME_ID);

  private run: Run = startRun('boot', 1);
  private phase: GamePhase = 'loading';
  private effect: Effect = { kind: 'none' };
  private isBest = false;

  /** The piece is sitting on something and the lock delay is running. */
  private resting = false;
  /** Moves that have restarted the lock delay for this piece. See `LOCK_RESETS`. */
  private lockResets = 0;
  /** The down button is held. */
  private softDropping = false;

  private readonly clock = new GravityClock({ onTick: () => this.tick() });

  private listeners = new Set<Listener>();

  async start(): Promise<void> {
    this.save = await loadSave<string>(GAME_ID);
    const saved = this.save.inProgress;
    const snapshot = saved?.level === this.save.level ? saved.moves[0] : undefined;
    this.load(this.save.level, snapshot);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  private notify(effect: Effect = { kind: 'none' }): void {
    this.effect = effect;
    const view = this.snapshot();
    for (const listener of this.listeners) listener(view);
  }

  get settings() {
    return this.save.settings;
  }

  get currentSave(): SaveData<string> {
    return this.save;
  }

  /* ------------------------------------------------------------ state */

  private snapshot(): GameView {
    const stats = this.save.stats;
    return {
      phase: this.phase,
      level: this.save.level,
      run: this.run,
      preview: this.phase === 'loading' ? [] : previewOf(this.run),
      runLevel: levelIn(this.run),
      score: this.run.score,
      lines: this.run.lines,
      best: stats.bestScore ?? 0,
      games: stats.levelsCleared,
      isBest: this.isBest,
      effect: this.effect,
    };
  }

  /**
   * Opens a game, restoring a snapshot if one was left behind.
   *
   * A snapshot that does not decode — a hand-edited save code, a format that
   * has moved on — is not an error worth showing anybody. It starts a fresh
   * run of the same game number, which is deterministic, so the player gets
   * the opening they would have got had they never played it.
   */
  private load(game: number, snapshot?: string): void {
    this.clock.stop();
    this.phase = 'loading';
    this.isBest = false;
    this.softDropping = false;
    this.lockResets = 0;
    this.notify({ kind: 'reset' });

    const restored = snapshot ? decodeRun(snapshot, this.save.seed, game) : null;
    this.run = restored ?? startRun(this.save.seed, game);
    this.resting = this.run.piece ? isResting(this.run.well, this.run.piece) : false;
    this.phase = 'ready';
    this.persist();
    this.notify({ kind: 'reset' });
  }

  /**
   * Writes the run as a position.
   *
   * Called after every lock and whenever play stops, which between them mean
   * the most that can be lost to a crash is the piece currently in the air.
   * Writing on every move instead would be twenty writes a second for a saving
   * of one piece.
   */
  private persist(): void {
    this.save = {
      ...this.save,
      inProgress:
        this.run.over || this.phase === 'over'
          ? null
          : { level: this.run.game, moves: [encodeRun(this.run)] },
    };
    this.writer.schedule(this.save);
  }

  /* -------------------------------------------------------------- clock */

  /** Milliseconds until the next gravity step, given where the piece is. */
  private nextDelay(): number {
    if (this.phase !== 'playing' || this.run.over || !this.run.piece) return 0;
    this.resting = isResting(this.run.well, this.run.piece);
    if (this.resting) return LOCK_DELAY_MS;
    return this.softDropping ? SOFT_DROP_MS : gravityMs(levelIn(this.run));
  }

  /**
   * One gravity step.
   *
   * A resting piece locks; anything else falls a row. The lock delay is not a
   * second timer — it is this same timer scheduled further out, which is the
   * only reason there is one handle to cancel rather than two.
   */
  private tick(): number {
    if (this.phase !== 'playing' || this.run.over || !this.run.piece) return 0;

    const resting = isResting(this.run.well, this.run.piece);
    const { run, events } = resting ? lockDown(this.run) : apply(this.run, 'gravity');
    this.run = run;
    this.settle(events);

    return this.nextDelay();
  }

  /**
   * Restarts the clock after a player action.
   *
   * Three cases, and the middle one is the rule that makes a last-moment slide
   * possible. A piece that has just come to rest starts its lock delay; a piece
   * already resting restarts it, up to `LOCK_RESETS` times, because without a
   * cap a piece spun on the spot would never lock and the game could not be
   * lost; and a piece that has just slid off a ledge goes back to falling.
   *
   * A piece still in mid-air is left alone on purpose: restarting gravity on
   * every sideways nudge would be free hang time, and the original does not
   * offer it either.
   */
  private reschedule(): void {
    if (this.phase !== 'playing' || this.run.over || !this.run.piece) return;
    const resting = isResting(this.run.well, this.run.piece);

    if (resting && !this.resting) {
      this.resting = true;
      this.clock.start(LOCK_DELAY_MS);
    } else if (resting && this.lockResets < LOCK_RESETS) {
      this.lockResets++;
      this.clock.start(LOCK_DELAY_MS);
    } else if (!resting && this.resting) {
      this.resting = false;
      this.clock.start(this.softDropping ? SOFT_DROP_MS : gravityMs(levelIn(this.run)));
    }
  }

  /**
   * Everything that follows a change to the run: banking, saving, telling.
   *
   * Returns whether a new piece arrived, because a caller that goes on to
   * reschedule must not: the clock has already been restarted for the new
   * piece here, and doing it again would spend one of its lock-delay resets
   * before the player had touched it.
   */
  private settle(events: readonly RunEvent[]): boolean {
    const locked = events.find(
      (event): event is Extract<RunEvent, { kind: 'locked' }> => event.kind === 'locked',
    );
    const over = events.some((event) => event.kind === 'over');
    const held = events.some((event) => event.kind === 'held');

    if (locked || held) {
      // A new piece is in the air, so the lock-delay budget starts again.
      this.lockResets = 0;
      this.resting = false;
      // And it gets a whole interval to fall in. Without this, a hard drop
      // would hand the next piece whatever was left on the previous piece's
      // timer — nearly nothing if the drop landed just before a tick. Safe to
      // call from inside a tick: the clock declines to reschedule over a timer
      // its own handler has already set. See `GravityClock.schedule`.
      if (this.phase === 'playing' && !over) this.clock.start(this.nextDelay());
    }

    if (over) {
      this.clock.stop();
      this.phase = 'over';
      this.bank();
      this.notify({ kind: 'over' });
      return true;
    }

    if (locked) {
      this.persist();
      this.notify({ kind: 'locked', lines: locked.lines, rows: locked.rows });
      return true;
    }

    const first = events[0];
    if (first) this.notify({ kind: first.kind } as Effect);
    return held;
  }

  /* --------------------------------------------------------------- play */

  /** Starts, or restarts, the clock. From `ready`, on a tap. */
  begin(): void {
    if (this.phase !== 'ready' || this.run.over) return;
    this.phase = 'playing';
    this.clock.start(this.nextDelay());
    this.notify();
  }

  /**
   * Stops play and waits for a tap.
   *
   * Every interruption routes through here, and it is safe to call on a game
   * that is already stopped or finished — the callers are a sheet opening, the
   * tab being hidden and the page unloading, and at least two of those can
   * arrive together.
   */
  pause(): void {
    if (this.phase !== 'playing') return;
    this.clock.stop();
    this.softDropping = false;
    this.phase = 'ready';
    this.persist();
    this.writer.flush();
    this.notify();
  }

  /** A control was pressed. Ignored unless the clock is running. */
  press(action: Action): void {
    if (this.phase !== 'playing' || this.run.over) return;
    const { run, events } = apply(this.run, action);
    this.run = run;
    if (!this.settle(events)) this.reschedule();
  }

  /**
   * The down button is held, or has been let go.
   *
   * Separate from `press('soft')` because it changes the clock rather than the
   * board: a held button is a faster gravity, not a stream of taps, so it
   * survives the piece falling past a ledge and is cleared by anything that
   * stops play — including a finger sliding off the button.
   */
  setSoftDrop(on: boolean): void {
    if (this.softDropping === on) return;
    this.softDropping = on;
    if (this.phase !== 'playing' || this.run.over) return;
    if (!this.resting) this.clock.start(on ? SOFT_DROP_MS : gravityMs(levelIn(this.run)));
  }

  /* ------------------------------------------------------------- games */

  /**
   * Banks the game: counted, its score added up, the best kept.
   *
   * Done the moment it ends rather than when the sheet is tapped past, and
   * `inProgress` is cleared in the same breath, so closing the app on the
   * result sheet neither loses the game nor brings it back to be counted twice.
   */
  private bank(): void {
    const score = this.run.score;
    const advanced = completeLevel(this.save);
    const previousBest = advanced.stats.bestScore ?? 0;
    this.isBest = score > 0 && score > previousBest;

    this.save = {
      ...advanced,
      inProgress: null,
      stats: {
        ...advanced.stats,
        bestScore: Math.max(previousBest, score),
        scoreTotal: (advanced.stats.scoreTotal ?? 0) + score,
      },
    };
    this.writer.schedule(this.save);
    this.writer.flush();
  }

  /** From the result sheet: the next game, waiting for a tap. */
  advance(): void {
    if (this.phase !== 'over') return;
    this.load(this.save.level);
  }

  /**
   * Gives up on the run on screen and deals the next one.
   *
   * A run with a score on it is banked rather than thrown away — those lines
   * were genuinely cleared, and a best score should not depend on having lost a
   * run rather than walked away from it. A run that has scored nothing is
   * simply replaced, so tapping New game twice does not count two games.
   */
  newGame(): void {
    if (this.phase === 'loading') return;
    if (this.phase === 'over') {
      this.advance();
      return;
    }

    this.clock.stop();
    if (this.run.score > 0) this.bank();
    else {
      this.save = {
        ...this.save,
        level: this.save.level + 1,
        inProgress: null,
        stats: { ...this.save.stats, totalRestarts: this.save.stats.totalRestarts + 1 },
      };
      this.writer.schedule(this.save);
    }
    this.load(this.save.level);
  }

  goToGame(game: number): void {
    const target = Math.max(1, Math.floor(game));
    this.clock.stop();
    this.save = { ...this.save, level: target, inProgress: null };
    this.writer.schedule(this.save);
    this.load(target);
  }

  async replaceSave(save: SaveData<string>): Promise<void> {
    this.clock.stop();
    this.save = save;
    this.writer.schedule(save);
    this.writer.flush();
    this.load(save.level, save.inProgress?.level === save.level ? save.inProgress.moves[0] : undefined);
    return Promise.resolve();
  }

  /**
   * Notes that the rules sheet has been offered. Not routed through
   * `updateSettings`: it is not a preference, and it must not redraw the board
   * behind the sheet.
   */
  markHowToPlaySeen(): void {
    if (this.save.seenHowToPlay) return;
    this.save = { ...this.save, seenHowToPlay: true };
    this.writer.schedule(this.save);
  }

  updateSettings(patch: Partial<SaveData<string>['settings']>): void {
    this.save = { ...this.save, settings: { ...this.save.settings, ...patch } };
    this.writer.schedule(this.save);
    this.notify();
  }
}
