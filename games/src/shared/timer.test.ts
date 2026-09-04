import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LevelTimer, budgetFor, formatClock } from './timer';

describe('budgetFor', () => {
  it('gives a bigger clock to a bigger level', () => {
    const small = budgetFor({ units: 12, rewards: 12, pressure: 0.5, generous: 3, tight: 2, floor: 10 });
    const large = budgetFor({ units: 45, rewards: 45, pressure: 0.5, generous: 3, tight: 2, floor: 10 });
    expect(large.initial).toBeGreaterThan(small.initial);
  });

  it('tightens as pressure rises, for the same amount of work', () => {
    const easy = budgetFor({ units: 30, rewards: 30, pressure: 0, generous: 3.4, tight: 1.9, floor: 10 });
    const hard = budgetFor({ units: 30, rewards: 30, pressure: 1, generous: 3.4, tight: 1.9, floor: 10 });
    expect(hard.initial).toBeLessThan(easy.initial);
    expect(hard.ceiling).toBeLessThan(easy.ceiling);
  });

  /**
   * The property the whole design rests on: a player who keeps up is not losing
   * ground. If a success paid back much less than a unit of work costs, the
   * clock would be a countdown wearing a bonus, and no amount of skill would
   * hold it steady.
   */
  it('pays back most of what a unit of work costs', () => {
    const config = budgetFor({
      units: 40,
      rewards: 40,
      pressure: 0.6,
      generous: 3.4,
      tight: 1.9,
      floor: 10,
    });
    const perUnit = 3.4 + (1.9 - 3.4) * 0.6;
    expect(config.bonus).toBeGreaterThan(perUnit * 0.6);
    expect(config.bonus).toBeLessThan(perUnit);
  });

  it('never opens below the floor, however small the level', () => {
    const tiny = budgetFor({ units: 1, rewards: 1, pressure: 1, generous: 3, tight: 2, floor: 25 });
    expect(tiny.initial).toBeGreaterThanOrEqual(25);
  });

  /** Banked time is capped, or a strong opening buys an untimed endgame. */
  it('caps banked time below the full allowance', () => {
    const config = budgetFor({ units: 40, rewards: 8, pressure: 0.4, generous: 4, tight: 2.4, floor: 10 });
    expect(config.ceiling).toBeLessThan(40 * 4);
    expect(config.ceiling).toBeGreaterThan(config.initial);
  });
});

describe('formatClock', () => {
  it('drops the leading zero minute, which reads as more time than it is', () => {
    expect(formatClock(45)).toBe('45');
    expect(formatClock(9)).toBe('9');
  });

  it('shows minutes and padded seconds above a minute', () => {
    expect(formatClock(60)).toBe('1:00');
    expect(formatClock(125)).toBe('2:05');
  });
});

/**
 * The clock's state machine.
 *
 * `LevelTimer` reaches for `document` to pause when the app is backgrounded,
 * which is the one behaviour here that would be indefensible to get wrong —
 * losing a level to a phone call. The suite runs in node, so the listener is
 * stubbed rather than skipped.
 */
describe('LevelTimer', () => {
  const config = { initial: 30, bonus: 5, ceiling: 60 };
  const original = (globalThis as { document?: unknown }).document;

  beforeEach(() => {
    (globalThis as { document?: unknown }).document = {
      hidden: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
  });

  afterEach(() => {
    (globalThis as { document?: unknown }).document = original;
  });

  it('counts down from the configured start', () => {
    const timer = new LevelTimer(
      () => undefined,
      () => undefined,
    );
    timer.start(config);
    expect(timer.remaining).toBe(30);
    expect(timer.running).toBe(true);
    timer.dispose();
  });

  it('pays time back on a success, never past the ceiling', () => {
    const timer = new LevelTimer(
      () => undefined,
      () => undefined,
    );
    timer.start(config);
    timer.reward();
    expect(timer.remaining).toBe(35);
    // Ten more rewards would be 85s; the ceiling is 60.
    for (let i = 0; i < 10; i++) timer.reward();
    expect(timer.remaining).toBe(60);
    timer.dispose();
  });

  /**
   * Holds are counted by reason, not by a flag. A sheet can open while the tab
   * is hidden and the tab can come back while the sheet is still up — with a
   * boolean, whichever resume fired last would start the clock behind a dialog
   * the player cannot see past.
   */
  it('stays paused until every hold is released', () => {
    const timer = new LevelTimer(
      () => undefined,
      () => undefined,
    );
    timer.start(config);

    timer.pause('hidden');
    timer.pause('settings');
    expect(timer.running).toBe(false);

    timer.resume('hidden');
    expect(timer.running).toBe(false);

    timer.resume('settings');
    expect(timer.running).toBe(true);
    timer.dispose();
  });

  it('reports itself inactive once stopped', () => {
    const timer = new LevelTimer(
      () => undefined,
      () => undefined,
    );
    timer.start(config);
    expect(timer.active).toBe(true);
    timer.stop();
    expect(timer.active).toBe(false);
    expect(timer.running).toBe(false);
    timer.dispose();
  });

  it('ignores a reward when no level is running', () => {
    const timer = new LevelTimer(
      () => undefined,
      () => undefined,
    );
    expect(timer.remaining).toBe(0);
    timer.reward();
    expect(timer.remaining).toBe(0);
    timer.dispose();
  });
});
