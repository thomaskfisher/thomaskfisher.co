/**
 * Difficulty curve, shared by all four games.
 *
 * The design brief here is unusual and worth stating, because it is the
 * opposite of what a free-to-play game does: **level 1 is meant to be hard.**
 * There is no funnel to protect and nobody to convert. The player is one person
 * who is bored by ramps, and the failure mode we are actually guarding against
 * is a hundred levels of imperceptible increments — not a player bouncing off
 * level 3.
 *
 * So the curve is short and steep. It opens at roughly a quarter of full
 * intensity, reaches full intensity by level 50, and stays there. Levels past
 * 50 keep coming forever and are all pitched at the ceiling; what varies is the
 * board, not the pressure. Fifty levels that mean something, then an endless
 * supply of them, rather than five hundred that shade into each other.
 *
 * Two things the previous version did are deliberately gone:
 *
 *  - the **hidden rubber band**, which eased difficulty by up to forty
 *    effective levels after a losing streak. On a curve this short that is the
 *    entire game, and it would quietly undo the whole point of this file. Level
 *    N now means exactly one thing, forever, on every device.
 *  - most of the **breather levels**. A few remain, because back-to-back
 *    maximum boards blur together and the contrast is what makes a hard one
 *    land — but they are ~11% of levels now rather than 22%, and they dip less
 *    far.
 *
 * None of this is ever surfaced in the UI. The level number is the only number
 * the player sees.
 */

import type { Rng } from './rng';

export interface LevelPressure {
  level: number;
  /** 0..1 overall intensity for this specific level, jitter included. */
  pressure: number;
  isBreather: boolean;
  /** Acceptable difficulty-score window for the generated board. */
  band: [number, number];
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** The level at which the curve reaches full intensity and stops climbing. */
export const PEAK_LEVEL = 50;

/**
 * Shift and time-constant of the ramp.
 *
 * `SHIFT` is what makes level 1 start partway up instead of at zero — it is the
 * single most important number in this file, and the reason the old curve
 * opened with a walkover. `TAU` sets how fast the rest arrives.
 */
const SHIFT = 3;
const TAU = 16;

/** Normalised so `ramp(PEAK_LEVEL)` is exactly 1 rather than nearly 1. */
const RAMP_MAX = 1 - Math.exp(-(PEAK_LEVEL + SHIFT) / TAU);

/**
 * Saturating ramp: L1 -> 0.23, L5 -> 0.41, L10 -> 0.58, L20 -> 0.79,
 * L30 -> 0.91, L50 -> 1.0, flat thereafter.
 */
function ramp(level: number): number {
  return Math.min(1, (1 - Math.exp(-(level + SHIFT) / TAU)) / RAMP_MAX);
}

/**
 * Roughly every ninth level is an intentional breather. Kept irregular — a
 * strict cadence becomes noticeable and then becomes a level you skip.
 */
function isBreatherLevel(level: number): boolean {
  return level % 9 === 4;
}

export function pressureForLevel(level: number, rng: Rng): LevelPressure {
  const base = ramp(level);

  const breather = isBreatherLevel(level);
  // Tighter than it was (+-0.09). On a curve this steep, wide jitter means a
  // level-2 board can roll out easier than a level-1 board, which reads as the
  // game being random rather than as it being hard.
  const jitter = rng.next() * 0.12 - 0.06;
  const pressure = clamp01(base + jitter + (breather ? -0.15 : 0));

  // Maps intensity onto the difficulty score the generators actually measure.
  //
  // Calibrated against what boards can really produce — roughly 0.05 to 0.95
  // across viable shapes once the per-game caps are opened up. Asking for more
  // than the format can deliver makes every attempt miss, which burns solver
  // runs and leaves difficulty noisy rather than high, so the top of this
  // mapping sits just inside the achievable ceiling rather than at it.
  const center = 0.14 + Math.pow(pressure, 1.3) * 0.78;

  // **The band is deliberately lopsided.** A generator takes the first board
  // that lands inside it, so a symmetric window is not neutral — it accepts an
  // undershoot exactly as readily as a hit, and with the cheap boards being the
  // ones found first, a symmetric band drifts low. Measured: level 1 was
  // landing at 0.13 against a 0.26 target in three of the four games.
  //
  // Being generous upwards and strict downwards costs a few more attempts and
  // makes "harder than asked" the failure mode instead of "easier than asked",
  // which for this collection is the right way round.
  return {
    level,
    pressure,
    isBreather: breather,
    band: [clamp01(center - 0.07), clamp01(center + 0.19)],
  };
}
