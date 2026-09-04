/**
 * The optional clock.
 *
 * These games are turn-based, and the collection's whole premise is that a
 * puzzle you can sit with beats a puzzle that harasses you. So a timer is a
 * genuinely awkward thing to add, and the resolution is that it is **a way to
 * play, not a difficulty setting**: the board is identical either way. The same
 * level 30 is the same level 30 whether or not the clock is running. One mode
 * asks you to find the line; the other asks you to find it now.
 *
 * That distinction is what keeps it out of the same category as the lives and
 * energy meters this collection exists to get away from. Nothing here is ever
 * withheld, nothing recharges, and nothing costs anything. The toggle is one
 * tap away at all times, mid-level included.
 *
 * Three details matter more than they look:
 *
 *  - **It is a budget, not a countdown.** Every success — a bus away, a box
 *    filled, a tube finished, a row survived — puts time back. A player who is
 *    solving it never runs out; a player who is staring at it does. That is the
 *    behaviour we want, and a fixed per-level countdown does not produce it.
 *  - **It pauses when the app is not in front of you.** Losing a level to a
 *    phone call would be indefensible.
 *  - **It does not run the render loop.** The games render on state change and
 *    that stays true: the clock owns one 250ms interval for its own label, and
 *    the depleting bar is a CSS transition the GPU handles. Nothing else in the
 *    game redraws on a tick.
 */

/** How the clock is set up for one level. */
export interface TimerConfig {
  /** Seconds on the clock when the level opens. */
  initial: number;
  /** Seconds returned by each success event. */
  bonus: number;
  /** Seconds the clock will never exceed, so banked time cannot snowball. */
  ceiling: number;
}

export type TimerListener = (remaining: number, config: TimerConfig) => void;

const TICK_MS = 250;

export class LevelTimer {
  private config: TimerConfig | null = null;
  private remainingMs = 0;
  private deadline: number | null = null;
  private handle: ReturnType<typeof setInterval> | null = null;

  /**
   * Reasons the clock is currently held, rather than a boolean.
   *
   * A sheet can open while the tab is hidden, and the tab can come back while
   * the sheet is still up. With a flag, whichever resume fired last would start
   * the clock behind a dialog the player cannot see past.
   */
  private holds = new Set<string>();

  constructor(
    private readonly onTick: TimerListener,
    private readonly onExpire: () => void,
  ) {
    // Guarded rather than assumed. The clock is only ever built from a game's
    // entry point, where a document certainly exists — but a class that throws
    // on construction outside a browser cannot be unit tested, and the pause
    // behaviour is the part here most worth having tests for.
    globalThis.document?.addEventListener('visibilitychange', this.onVisibility);
  }

  private onVisibility = (): void => {
    if (document.hidden) this.pause('hidden');
    else this.resume('hidden');
  };

  get running(): boolean {
    return this.config !== null && this.holds.size === 0;
  }

  get active(): boolean {
    return this.config !== null;
  }

  get remaining(): number {
    return Math.max(0, Math.ceil(this.currentMs() / 1000));
  }

  private currentMs(): number {
    if (this.deadline === null) return this.remainingMs;
    return Math.max(0, this.deadline - Date.now());
  }

  start(config: TimerConfig): void {
    this.stop();
    this.config = config;
    this.remainingMs = config.initial * 1000;
    this.holds.clear();
    this.begin();
  }

  private begin(): void {
    if (!this.config || this.holds.size > 0) return;
    this.deadline = Date.now() + this.remainingMs;
    this.handle ??= setInterval(this.tick, TICK_MS);
    this.emit();
  }

  private tick = (): void => {
    if (!this.config) return;
    const left = this.currentMs();
    this.emit();
    if (left <= 0) {
      this.stop();
      this.onExpire();
    }
  };

  private emit(): void {
    if (this.config) this.onTick(this.remaining, this.config);
  }

  /** Adds `bonus` seconds, capped at the ceiling. Called on every success. */
  reward(multiplier = 1): void {
    if (!this.config) return;
    const next = Math.min(
      this.config.ceiling * 1000,
      this.currentMs() + this.config.bonus * multiplier * 1000,
    );
    this.remainingMs = next;
    if (this.deadline !== null) this.deadline = Date.now() + next;
    this.emit();
  }

  pause(reason: string): void {
    if (!this.config) return;
    const wasRunning = this.holds.size === 0;
    this.holds.add(reason);
    if (!wasRunning) return;
    this.remainingMs = this.currentMs();
    this.deadline = null;
  }

  resume(reason: string): void {
    if (!this.holds.delete(reason)) return;
    if (this.holds.size === 0) this.begin();
  }

  stop(): void {
    if (this.handle !== null) {
      clearInterval(this.handle);
      this.handle = null;
    }
    this.config = null;
    this.deadline = null;
    this.remainingMs = 0;
    this.holds.clear();
  }

  dispose(): void {
    this.stop();
    globalThis.document?.removeEventListener('visibilitychange', this.onVisibility);
  }
}

/* ------------------------------------------------------------------ */
/* Budgets                                                             */
/* ------------------------------------------------------------------ */

/**
 * Turns a level's size and intensity into a clock.
 *
 * `units` is whatever the level's work is counted in — passengers to seat,
 * screws to clear, rows to climb — and `rewards` is how many success events
 * that work contains. The clock is then sized so that a player moving steadily
 * finishes with time to spare and a player deliberating does not, which is a
 * different sum for a nine-bus level than a four-bus one.
 *
 * `secondsPerUnit` shrinks with pressure, so the same board is tighter at level
 * 45 than the same shape would have been at level 5. That is the only way the
 * clock reflects the curve — it never changes the board.
 */
export function budgetFor(options: {
  units: number;
  rewards: number;
  pressure: number;
  /** Seconds per unit of work at the bottom of the curve. */
  generous: number;
  /** Seconds per unit of work at the top. */
  tight: number;
  /** Never open with less than this, however small the board. */
  floor: number;
}): TimerConfig {
  const { units, rewards, pressure, generous, tight, floor } = options;
  const perUnit = generous + (tight - generous) * Math.min(1, Math.max(0, pressure));
  const total = Math.max(floor, units * perUnit);

  // A third up front, the rest earned.
  //
  // The split is what decides how the clock *feels*, more than the total does.
  // Front-load more and the opening is safe while the endgame is unwinnable;
  // front-load less and the first decision is made in a panic before any time
  // has been banked. Paying back 80% of a unit's nominal cost per success means
  // a player working at the nominal pace drifts slowly downwards and one
  // working a quarter faster holds station — pressure that rewards fluency
  // rather than a countdown that ignores it.
  const initial = Math.max(floor, Math.round(total * 0.35));
  const bonus = Math.max(2, Math.round((total * 0.8) / Math.max(1, rewards)));

  // Banked time is capped so a strong opening cannot buy an unlimited stare at
  // the endgame — which is the one way a timed level quietly becomes untimed.
  return { initial, bonus, ceiling: Math.round(total * 0.7) };
}

/** `m:ss`, or `ss` under a minute — a leading `0:` reads as more time than it is. */
export function formatClock(seconds: number): string {
  if (seconds < 60) return String(seconds);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
