import { describe, expect, it } from 'vitest';

import { GravityClock } from './clock';

/**
 * A stand-in for the window's timers that runs them by hand.
 *
 * The whole point of this file is that the one real-time part of the game gets
 * tested at all, and the thing worth asserting is not that gravity works — that
 * is `run.test.ts` — but that there is never more than one timer outstanding.
 * Every bug this project has had with deferred work has been a second handle
 * nobody was holding.
 */
function fakeTimers() {
  const pending = new Map<number, () => void>();
  let next = 1;
  /** Every handle ever issued, so a leaked one can be spotted. */
  let issued = 0;

  return {
    pending,
    get issued() {
      return issued;
    },
    setTimer(fn: () => void, _ms: number): number {
      const handle = next++;
      issued++;
      pending.set(handle, fn);
      return handle;
    },
    clearTimer(handle: number): void {
      pending.delete(handle);
    },
    /** Fires everything outstanding, once. */
    fire(): void {
      const due = [...pending.entries()];
      pending.clear();
      for (const [, fn] of due) fn();
    },
  };
}

const clockWith = (onTick: () => number) => {
  const timers = fakeTimers();
  const clock = new GravityClock({
    onTick,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  return { clock, timers };
};

describe('the gravity clock', () => {
  it('starts stopped', () => {
    const { clock, timers } = clockWith(() => 100);
    expect(clock.running).toBe(false);
    expect(timers.pending.size).toBe(0);
  });

  it('keeps exactly one timer outstanding while it runs', () => {
    let ticks = 0;
    const { clock, timers } = clockWith(() => {
      ticks++;
      return 100;
    });

    clock.start(50);
    for (let i = 0; i < 20; i++) {
      expect(timers.pending.size, `after ${i} ticks`).toBe(1);
      timers.fire();
    }
    expect(ticks).toBe(20);
    expect(timers.pending.size).toBe(1);
  });

  it('replaces its timer rather than adding one when restarted', () => {
    const { clock, timers } = clockWith(() => 100);
    clock.start(100);
    clock.start(50);
    clock.start(10);
    expect(timers.pending.size).toBe(1);
    expect(timers.issued).toBe(3);
  });

  it('stops, and stopping twice is not an error', () => {
    const { clock, timers } = clockWith(() => 100);
    clock.start(100);
    clock.stop();
    clock.stop();
    expect(clock.running).toBe(false);
    expect(timers.pending.size).toBe(0);

    // And a stopped clock stays stopped — nothing fires it back to life.
    timers.fire();
    expect(timers.pending.size).toBe(0);
  });

  it('stops for good when a tick asks for no more', () => {
    let ticks = 0;
    const { clock, timers } = clockWith(() => {
      ticks++;
      return ticks < 3 ? 100 : 0;
    });

    clock.start(10);
    timers.fire();
    timers.fire();
    timers.fire();
    expect(ticks).toBe(3);
    expect(timers.pending.size).toBe(0);
    expect(clock.running).toBe(false);
  });

  /*
   * The case the whole design turns on. `settle()` restarts the clock when a
   * new piece arrives, and it can be called from inside a tick — so the tick's
   * own rescheduling must not then add a second timer on top of it. Without the
   * `handle === null` guard in `schedule`, this is two.
   */
  it('lets a tick that restarts it win over its own rescheduling', () => {
    let ticks = 0;
    const timers = fakeTimers();
    const clock: GravityClock = new GravityClock({
      onTick: () => {
        ticks++;
        if (ticks === 1) clock.start(999);
        return 100;
      },
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    clock.start(10);
    timers.fire();
    expect(ticks).toBe(1);
    expect(timers.pending.size).toBe(1);
  });

  /*
   * The other half of the same guard: a tick that stops the clock — a sheet
   * opening, the tab being hidden, the game ending — must stay stopped, and
   * not be revived by the rescheduling underneath it.
   */
  it('lets a tick that stops it win over its own rescheduling', () => {
    let ticks = 0;
    const timers = fakeTimers();
    const clock: GravityClock = new GravityClock({
      onTick: () => {
        ticks++;
        clock.stop();
        return 100;
      },
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    clock.start(10);
    timers.fire();
    expect(ticks).toBe(1);
    expect(clock.running).toBe(false);
    expect(timers.pending.size).toBe(0);
  });

  it('never asks for a negative delay', () => {
    const delays: number[] = [];
    const timers = fakeTimers();
    const clock = new GravityClock({
      onTick: () => 100,
      setTimer: (fn, ms) => {
        delays.push(ms);
        return timers.setTimer(fn, ms);
      },
      clearTimer: timers.clearTimer,
    });

    clock.start(-500);
    expect(delays).toEqual([0]);
  });
});
