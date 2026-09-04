/**
 * Everything the four games need to run the optional clock, in one place.
 *
 * The per-game parts of timed play are small — what counts as a success, how
 * much work a level is, which phase means "playing" — and the parts that are
 * easy to get wrong are all shared: starting a fresh clock on a new level and
 * not on a re-render, holding it while a sheet is open, resuming it after an
 * undo puts a lost level back into play. Those bugs are invisible until they
 * cost someone a level, so they are written once here rather than four times.
 *
 * The state-diffing approach is deliberate. The games notify a single
 * subscriber on every state change and nothing else, so this hooks that one
 * signal rather than asking each game to sprout timer callbacks at every site
 * that might complete a bus or a tube.
 */

import { LevelTimer, type TimerConfig } from './timer';
import { type TimerChip, createTimerChip } from './timer-chip';

export interface TimedPlayOptions<S> {
  /** Where the clock goes: inserted immediately before this element. */
  anchor: HTMLElement;
  isTimed: () => boolean;
  onTimedChange: (timed: boolean) => void;
  /**
   * The clock for this level, or null if there is nothing to time yet.
   * Called once per level, not per render.
   */
  budget: (state: S) => TimerConfig | null;
  /**
   * Successes so far — buses filled, tubes finished, rows survived. Any
   * increase pays time back. Monotonic within a level is not required; a drop
   * (an undo) simply pays nothing.
   */
  progress: (state: S) => number;
  isPlaying: (state: S) => boolean;
  /** Identifies the level on screen, so a new one restarts the clock. */
  levelKey: (state: S) => string | null;
  onExpire: () => void;
}

export interface TimedPlay<S> {
  chip: TimerChip;
  /** Call from the game's state subscription, on every state change. */
  sync: (state: S) => void;
  /** Hold the clock while a sheet is up. */
  pause: (reason: string) => void;
  resume: (reason: string) => void;
}

export function createTimedPlay<S>(options: TimedPlayOptions<S>): TimedPlay<S> {
  let config: TimerConfig | null = null;
  let currentKey: string | null = null;
  let lastProgress = 0;
  let latest: S | null = null;

  const timer = new LevelTimer(
    (remaining, active) => chip.set(remaining, remaining / Math.max(1, active.ceiling)),
    () => options.onExpire(),
  );

  const chip = createTimerChip((enabled) => {
    options.onTimedChange(enabled);
    // Applied to the level already on screen, not the next one. Turning the
    // clock on restarts it from full rather than from whatever a half-played
    // level would have left, because a clock that starts mid-level with eight
    // seconds on it is a punishment for changing your mind.
    if (enabled) {
      if (latest) startFor(latest, true);
    } else {
      timer.stop();
    }
  });

  options.anchor.before(chip.root);

  function startFor(state: S, force = false): void {
    const key = options.levelKey(state);
    if (key === null) return;
    if (!force && key === currentKey) return;

    currentKey = key;
    lastProgress = options.progress(state);
    config = options.budget(state);

    if (config && options.isTimed() && options.isPlaying(state)) timer.start(config);
    else timer.stop();
  }

  return {
    chip,

    sync(state) {
      latest = state;
      chip.setEnabled(options.isTimed());

      const key = options.levelKey(state);
      if (key === null) {
        timer.stop();
        currentKey = null;
        return;
      }

      if (key !== currentKey) {
        startFor(state);
        return;
      }

      // Turning the clock off from the Settings sheet reaches us here rather
      // than through the chip's own handler, so this has to actually stop it —
      // returning early left the timer running invisibly behind an "∞" chip,
      // and the level still died when it expired.
      if (!options.isTimed()) {
        timer.stop();
        return;
      }

      // A level that was lost and then undone back into play needs its clock
      // again. Restarting rather than resuming is the honest reading: the time
      // that ran out is gone, and this is a fresh attempt at the same board.
      if (options.isPlaying(state) && !timer.active && config) {
        lastProgress = options.progress(state);
        timer.start(config);
        return;
      }

      if (!options.isPlaying(state)) {
        timer.stop();
        return;
      }

      const now = options.progress(state);
      if (now > lastProgress) timer.reward(now - lastProgress);
      lastProgress = now;
    },

    pause: (reason) => timer.pause(reason),
    resume: (reason) => timer.resume(reason),
  };
}
