/**
 * Difficulty curve, shared by all three games.
 *
 * "Infinite levels that get harder" has an obvious failure mode: a monotonic
 * ramp eventually walls the player and they stop playing. The commercial games
 * quietly avoid this and never say so. Three mechanisms here do the same job:
 *
 *  - a *saturating* ramp, so difficulty rises fast early and slowly forever after;
 *  - *variance* — per-level jitter plus deliberate breather levels, so no two
 *    brutal boards land back to back;
 *  - *rubber-banding* — a hidden offset that eases off after a run of failures
 *    and tightens after a run of clean clears.
 *
 * None of this is ever surfaced in the UI. The level number is the only number
 * the player sees.
 */

import type { Rng } from './rng';

/** How a level ended, from the difficulty engine's point of view. */
export type Outcome = 'clean' | 'assisted' | 'failed';

export interface LevelPressure {
  level: number;
  /** Level shifted by the hidden rubber-band offset. */
  effectiveLevel: number;
  /** 0..1 overall intensity for this specific level, jitter included. */
  pressure: number;
  isBreather: boolean;
  /** Acceptable difficulty-score window for the generated board. */
  band: [number, number];
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * Saturating ramp. Roughly: L10 -> 0.17, L30 -> 0.42, L60 -> 0.66, L120 -> 0.89,
 * L250 -> 0.99. Past that, boards stop getting structurally wider and get harder
 * only by requiring more backtracking — which is what makes "infinite" work
 * without running out of phone screen.
 */
function ramp(level: number): number {
  return 1 - Math.exp(-level / 55);
}

/**
 * Roughly every fifth level is an intentional breather. The pattern is
 * irregular on purpose — a strict every-5th cadence becomes noticeable.
 */
function isBreatherLevel(level: number): boolean {
  return level % 7 === 3 || level % 11 === 0;
}

export function pressureForLevel(level: number, offset: number, rng: Rng): LevelPressure {
  const effectiveLevel = Math.max(1, level + offset);
  const base = ramp(effectiveLevel);

  const breather = isBreatherLevel(level);
  const jitter = rng.next() * 0.18 - 0.09;
  const pressure = clamp01(base + jitter + (breather ? -0.22 : 0));

  // Tutorial levels are wide open; later bands tighten around the target.
  //
  // The mapping is calibrated against what boards actually score (roughly 0.08
  // to 0.92 across viable shapes). Asking for more than the format can deliver
  // makes every attempt miss, which costs sixty solver runs per level and
  // leaves difficulty noisy rather than high. The exponent keeps the early
  // levels gentle even though `ramp` climbs quickly.
  const width = effectiveLevel < 12 ? 0.2 : 0.15;
  const center = 0.06 + Math.pow(pressure, 1.7) * 0.62;

  return {
    level,
    effectiveLevel,
    pressure,
    isBreather: breather,
    band: [clamp01(center - width), clamp01(center + width)],
  };
}

/**
 * Hidden adjustment applied after each level. Deliberately gentle and
 * asymmetric: it backs off from a losing streak roughly twice as fast as it
 * tightens after a winning one, because being stuck is what makes people quit.
 */
export function nextDifficultyOffset(offset: number, recent: readonly Outcome[]): number {
  if (recent.length < 4) return offset;

  const window = recent.slice(-10);
  const value = (o: Outcome): number => (o === 'clean' ? 1 : o === 'assisted' ? 0 : -1);
  const mean = window.reduce((sum, o) => sum + value(o), 0) / window.length;

  let next = offset;
  if (mean < -0.3) next -= 2;
  else if (mean > 0.6) next += 1;

  return Math.max(-40, Math.min(40, next));
}

/** Ring buffer of recent outcomes, capped at the rubber-band window size. */
export function pushOutcome(recent: readonly Outcome[], outcome: Outcome): Outcome[] {
  return [...recent, outcome].slice(-10);
}
