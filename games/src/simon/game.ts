/**
 * Simon game controller.
 *
 * Owns all state and persistence; knows nothing about the DOM, and nothing
 * about time either. Showing the sequence is a run of timers, and timers are
 * the renderer's business — see `main.ts`. What this file hands out instead is
 * a `showId`: the renderer plays the sequence and reports back with the id it
 * was given, and a report carrying any other id is from a show that has since
 * been abandoned and is ignored. That is the whole defence against the
 * deferred-mutation race every game here has had to learn about: a restart,
 * a new game or an opened sheet inside a playback cannot be finished by the
 * playback it interrupted.
 *
 * **Bends the house rules on purpose, like Yahtzee.**
 *
 *  - **No undo.** The game is one question — do you remember the order — and
 *    taking a tap back is answering it for you.
 *  - **No hint.** A hint is the next pad, which is the same thing.
 *  - **Losing ends the game.** That is what Simon is. What "never back to level
 *    1" becomes here is that nothing is lost *by* losing: the best run is kept,
 *    and every game is a new sequence rather than a replay of the one that just
 *    beat you.
 *
 * What is kept: no clock, no lives, nothing locked, and a game in progress
 * survives the app being closed — it comes back at the start of the round it
 * was on, waiting for a tap, because a sequence shown to a phone in a pocket
 * was not shown to anybody.
 */

import {
  DEFAULT_PADS,
  type PressResult,
  type Run,
  newRun,
  press,
  resume,
  scoreOf,
  sequenceFor,
} from './model';
import {
  type SaveData,
  completeLevel,
  createSaveWriter,
  defaultSave,
  loadSave,
} from '../shared/progress';

export const GAME_ID = 'simon';

/**
 * - `ready`: waiting for a tap before showing the round. On a fresh open, a
 *   resumed game, and after a sheet interrupted a round.
 * - `showing`: the sequence is being played. Pads are not live.
 * - `input`: the player is repeating it.
 * - `over`: a wrong pad.
 */
export type GamePhase = 'loading' | 'ready' | 'showing' | 'input' | 'over';

export type Effect =
  | { kind: 'none' }
  | { kind: 'reset' }
  /** A new showing has started. `lead` is true straight after a finished round. */
  | { kind: 'show'; lead: boolean }
  | { kind: 'pressed'; pad: number; result: PressResult }
  /** The wrong pad, and the one that was wanted. */
  | { kind: 'lost'; pad: number; expected: number };

export interface GameView {
  phase: GamePhase;
  /** The game being played. Named `level` because the shared chrome asks for it. */
  level: number;
  pads: number;
  round: number;
  /** Pads already repeated this round. */
  entered: number;
  /** Rounds finished this game. */
  score: number;
  /**
   * The pads to show. Only filled while showing: there is no reason for the
   * answer to sit in the view while the player is being asked for it.
   */
  sequence: number[];
  showId: number;
  best: number;
  games: number;
  /** A new best, as of the game just lost. */
  isBest: boolean;
  effect: Effect;
}

type Listener = (view: GameView) => void;

export class SimonGame {
  /**
   * Seeded with a default rather than left undefined until `start()`, because
   * `subscribe` notifies synchronously and the first render therefore happens
   * before the save has loaded. See `shared/first-render.test.ts`.
   */
  private save: SaveData<number> = defaultSave<number>(GAME_ID);
  private writer = createSaveWriter<number>(GAME_ID);

  private readonly pads = DEFAULT_PADS;
  private displayGame = 1;
  private run: Run = newRun();
  private phase: GamePhase = 'loading';
  private showId = 0;
  private isBest = false;
  private effect: Effect = { kind: 'none' };

  private listeners = new Set<Listener>();

  async start(): Promise<void> {
    this.save = await loadSave<number>(GAME_ID);
    const saved = this.save.inProgress;
    this.load(this.save.level, saved?.level === this.save.level ? saved.moves : []);
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

  get currentSave(): SaveData<number> {
    return this.save;
  }

  /* ------------------------------------------------------------ state */

  private sequence(length: number): number[] {
    return sequenceFor(this.save.seed, this.displayGame, length, this.pads);
  }

  private snapshot(): GameView {
    const stats = this.save.stats;
    return {
      phase: this.phase,
      level: this.displayGame,
      pads: this.pads,
      round: this.run.round,
      entered: this.run.entered,
      score: scoreOf(this.run),
      sequence: this.phase === 'showing' ? this.sequence(this.run.round) : [],
      showId: this.showId,
      best: stats.bestScore ?? 0,
      games: stats.levelsCleared,
      isBest: this.isBest,
      effect: this.effect,
    };
  }

  private load(game: number, saved: readonly number[] = []): void {
    this.displayGame = game;
    this.phase = 'loading';
    this.showId++;
    this.isBest = false;
    this.notify({ kind: 'reset' });

    this.run = resume(this.sequence(saved.length), saved);
    this.phase = 'ready';
    this.persist();
    this.notify({ kind: 'reset' });
  }

  /** Writes the rounds finished so far, as the pads of the last one. */
  private persist(): void {
    const done = scoreOf(this.run);
    // Kept on `this.save` rather than only written, so a later write of the
    // save for some other reason — a setting, the rules sheet being seen —
    // does not quietly put an older game on disk over this one.
    this.save = {
      ...this.save,
      inProgress: done > 0 ? { level: this.displayGame, moves: this.sequence(done) } : null,
    };
    this.writer.schedule(this.save);
  }

  /* -------------------------------------------------------------- play */

  /** Shows the round. From `ready`, on a tap. */
  begin(): void {
    if (this.phase !== 'ready') return;
    this.show(false);
  }

  private show(lead: boolean): void {
    this.phase = 'showing';
    this.showId++;
    this.notify({ kind: 'show', lead });
  }

  /** The renderer has finished showing `showId`. Stale ids are ignored. */
  shown(showId: number): void {
    if (this.phase !== 'showing' || showId !== this.showId) return;
    this.phase = 'input';
    this.notify();
  }

  tapPad(pad: number): void {
    if (this.phase !== 'input') return;
    if (!Number.isInteger(pad) || pad < 0 || pad >= this.pads) return;

    const sequence = this.sequence(this.run.round);
    const expected = sequence[this.run.entered]!;
    const { run, result } = press(this.run, sequence, pad);
    if (!result) return;
    this.run = run;

    if (result === 'wrong') {
      this.phase = 'over';
      this.bank();
      this.notify({ kind: 'lost', pad, expected });
      return;
    }

    this.notify({ kind: 'pressed', pad, result });

    if (result === 'round') {
      this.persist();
      this.show(true);
    }
  }

  /**
   * Stops a round that is being shown or repeated, back to `ready`.
   *
   * Called when a sheet opens over the board. The round starts again from its
   * first pad, which costs nothing: the rounds already finished are kept, and a
   * sequence half-shown behind a menu was never really shown.
   */
  pause(): void {
    if (this.phase !== 'showing' && this.phase !== 'input') return;
    this.run = { ...this.run, entered: 0 };
    this.phase = 'ready';
    this.showId++;
    this.notify();
  }

  /* ------------------------------------------------------------ games */

  /**
   * Banks the game: counted, its score added up, the best kept.
   *
   * Done the moment it ends rather than when the sheet is tapped past, and
   * `inProgress` is cleared in the same breath, so closing the app on the result
   * sheet neither loses the game nor brings it back to be counted twice.
   */
  private bank(): void {
    const score = scoreOf(this.run);
    const advanced = completeLevel(this.save);
    const previousBest = advanced.stats.bestScore ?? 0;
    this.isBest = score > 0 && score > previousBest;

    this.save = {
      ...advanced,
      stats: {
        ...advanced.stats,
        bestScore: Math.max(previousBest, score),
        scoreTotal: (advanced.stats.scoreTotal ?? 0) + score,
      },
    };
    this.writer.schedule(this.save);
    this.writer.flush();
  }

  /** From the result sheet: the next game, shown straight away. */
  advance(): void {
    if (this.phase !== 'over') return;
    this.load(this.save.level);
    this.begin();
  }

  /**
   * Gives up on the game on screen and deals the next one.
   *
   * The rounds already repeated are banked rather than thrown away — they were
   * genuinely remembered, and a best run should not depend on having lost it
   * rather than walked away from it. A game that has not finished a round is
   * simply replaced, so tapping New game twice does not count two games.
   */
  newGame(): void {
    if (this.phase === 'loading') return;
    if (this.phase === 'over') {
      this.advance();
      return;
    }

    if (scoreOf(this.run) > 0) this.bank();
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
    this.save = { ...this.save, level: target, inProgress: null };
    this.writer.schedule(this.save);
    this.load(target);
  }

  async replaceSave(save: SaveData<number>): Promise<void> {
    this.save = save;
    this.writer.schedule(save);
    this.writer.flush();
    this.load(save.level, save.inProgress?.level === save.level ? save.inProgress.moves : []);
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

  updateSettings(patch: Partial<SaveData<number>['settings']>): void {
    this.save = { ...this.save, settings: { ...this.save.settings, ...patch } };
    this.writer.schedule(this.save);
    this.notify();
  }
}
