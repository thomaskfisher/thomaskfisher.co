import { describe, expect, it } from 'vitest';

import { PEAK_LEVEL, pressureForLevel } from './difficulty';
import { createRng, hashSeed } from './rng';

const at = (level: number): ReturnType<typeof pressureForLevel> =>
  pressureForLevel(level, createRng(hashSeed('curve', level)));

/** Mean pressure over a span, so per-level jitter does not decide the answer. */
const meanPressure = (from: number, to: number): number => {
  let sum = 0;
  for (let level = from; level <= to; level++) sum += at(level).pressure;
  return sum / (to - from + 1);
};

describe('the curve', () => {
  /**
   * The whole brief in one assertion. The previous curve opened at 0.02 and
   * asked the generators for a board scoring 6% of maximum, which is what made
   * level 1 a walkover and levels 1-15 indistinguishable from each other.
   */
  it('opens a long way up rather than at zero', () => {
    expect(meanPressure(1, 3)).toBeGreaterThan(0.18);
  });

  it('reaches full intensity by the peak level', () => {
    expect(at(PEAK_LEVEL).pressure).toBeGreaterThan(0.95);
    expect(meanPressure(1, 10)).toBeLessThan(meanPressure(11, 25));
    expect(meanPressure(11, 25)).toBeLessThan(meanPressure(26, PEAK_LEVEL));
  });

  /**
   * Levels past the peak keep coming forever and are all pitched at the
   * ceiling. What varies up there is the board, not the pressure — which is the
   * deliberate answer to "500 levels that shade into each other".
   */
  it('plateaus rather than creeping on past the peak', () => {
    expect(meanPressure(PEAK_LEVEL, PEAK_LEVEL + 20)).toBeCloseTo(
      meanPressure(400, 420),
      1,
    );
  });

  it('asks for a much harder board at level 1 than the old curve did', () => {
    const [lo] = at(1).band;
    expect(lo).toBeGreaterThan(0.1);
  });

  /**
   * Generators take the first board that lands in the band, and cheap boards
   * are found first — so a symmetric band drifts low in practice. Being
   * generous upwards and strict downwards makes "harder than asked" the failure
   * mode instead of "easier than asked".
   */
  it('leaves more room above the target than below it', () => {
    const { band } = at(20);
    const center = 0.14 + Math.pow(at(20).pressure, 1.3) * 0.78;
    expect(band[1] - center).toBeGreaterThan(center - band[0]);
  });

  it('keeps breather levels a minority', () => {
    let breathers = 0;
    for (let level = 1; level <= 90; level++) if (at(level).isBreather) breathers++;
    expect(breathers / 90).toBeLessThan(0.15);
    expect(breathers).toBeGreaterThan(4);
  });

  /** Level N means one thing forever, on every device. No hidden adjustment. */
  it('is a pure function of the level', () => {
    for (const level of [1, 7, 33, 120]) {
      const a = pressureForLevel(level, createRng(hashSeed('curve', level)));
      const b = pressureForLevel(level, createRng(hashSeed('curve', level)));
      expect(a.pressure).toBe(b.pressure);
      expect(a.band).toEqual(b.band);
    }
  });
});
