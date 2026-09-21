/**
 * The gravity clock. The only thing in this game that knows what time it is.
 *
 * **There is no `requestAnimationFrame` loop here, and the house rule survives
 * intact.** A falling block game sounds like it needs one and does not: the
 * piece is on the grid at every moment a player can act on it, so the state
 * changes at discrete ticks and the renderer draws on each one. What a frame
 * loop would buy is sub-cell interpolation — a piece sliding smoothly between
 * two rows — and at a hundred milliseconds a row nobody can see it. Artillery
 * needed frames because its arc is the feedback. This does not, and her battery
 * is the better for it.
 *
 * **One timer, one handle, one place it is cancelled.** This project has been
 * bitten twice by deferred mutations firing against state that was replaced
 * underneath them, and a real-time game is nothing but deferred mutations. So
 * the whole of it is one self-rescheduling `setTimeout`: never a second handle,
 * never an interval left running, and `stop()` is idempotent. Everything that
 * could interrupt play — a sheet opening, the app being backgrounded, a new
 * game, a reload — calls `stop()` and means it.
 *
 * **A tick that arrives late is not replayed.** A backgrounded tab has its
 * timers throttled to once a second or stopped entirely, so coming back to a
 * ten-second-old clock and catching up would drop the piece ten rows into
 * whatever it landed in. The page pauses when hidden instead, which is the only
 * honest answer: a piece that fell while the phone was in a pocket fell in a
 * game nobody was playing.
 */

export interface ClockOptions {
  /** One gravity step. Returns the delay until the next, in ms. */
  onTick: () => number;
  /** Swappable for tests. Defaults to the window's timers. */
  setTimer?: (fn: () => void, ms: number) => number;
  clearTimer?: (handle: number) => void;
}

export class GravityClock {
  private handle: number | null = null;
  /**
   * `stop()` was called since the current tick began.
   *
   * Needed because a handle being null is ambiguous inside a tick: it is null
   * both when the tick has finished normally and when the tick's own handler
   * stopped the clock. Without this flag the second case reschedules anyway,
   * and a game that ended, a sheet that opened or a tab that went away all
   * leave gravity quietly running behind them.
   */
  private stopping = false;
  private readonly setTimer: (fn: () => void, ms: number) => number;
  private readonly clearTimer: (handle: number) => void;

  constructor(private readonly options: ClockOptions) {
    this.setTimer = options.setTimer ?? ((fn, ms) => window.setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => window.clearTimeout(handle));
  }

  get running(): boolean {
    return this.handle !== null;
  }

  /**
   * Starts, or restarts, the clock with `ms` until the first tick.
   *
   * Restarting rather than adding a second timer is the point: every caller
   * that wants a different delay — a soft drop pressed, a lock delay beginning,
   * a level ticking over — calls this, and there is still only ever one timer.
   */
  start(ms: number): void {
    this.stop();
    this.stopping = false;
    this.schedule(ms);
  }

  /** Idempotent, and safe to call on a clock that never started. */
  stop(): void {
    this.stopping = true;
    if (this.handle === null) return;
    this.clearTimer(this.handle);
    this.handle = null;
  }

  private schedule(ms: number): void {
    this.handle = this.setTimer(() => {
      // Both cleared *before* the tick, so what they say afterwards is about
      // this tick and nothing earlier. A handler that calls `start()` leaves a
      // handle behind; one that calls `stop()` leaves `stopping` set; and the
      // rescheduling below defers to either rather than talking over it.
      this.handle = null;
      this.stopping = false;
      const next = this.options.onTick();
      if (!this.stopping && this.handle === null && next > 0) this.schedule(next);
    }, Math.max(0, ms));
  }
}
