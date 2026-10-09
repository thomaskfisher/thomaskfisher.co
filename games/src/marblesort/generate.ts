/**
 * Level generation for Marble Sort.
 *
 * A level is columns of coloured blocks plus a handful of numbers — block size,
 * drop size, belt length — and the pipes follow from the blocks. Unlike Bus Jam
 * there is no physical half to build by construction: any arrangement of blocks
 * can be emptied *eventually*, and the only question is whether the belt
 * overflows on the way. So boards are dealt, verified by the solver, and scored
 * by trap rate, and the dealing is where the difficulty levers live.
 *
 * Deterministic for a given (profileSeed, level): a save stores taps, not a
 * board, and a reported bug reproduces exactly.
 */

import { type LevelPressure, pressureForLevel } from '../shared/difficulty';
import { type Rng, createRng, hashSeed } from '../shared/rng';
import {
  CURVE_SLOTS,
  type Level,
  createSim,
  geometryFor,
  isWellFormed,
  settle,
  step,
  tap,
} from './model';
import { openHoles, search } from './solve';

export interface LevelShape {
  colors: number;
  columns: number;
  /** Blocks per column. */
  rows: number;
  blockSize: number;
  dropSize: number;
  straightSlots: number;
  /**
   * 0 deals blocks in colour bands — a whole row of one colour, then the next —
   * so one pipe feeds every column at once. 1 is a uniform shuffle.
   */
  mix: number;
  visibleRows: number;
}

export interface GeneratedLevel {
  level: number;
  board: Level;
  shape: LevelShape;
  /** 0..1, mostly measured from naive playthroughs. */
  difficulty: number;
  trap: number;
  greedyLoss: number;
  attempts: number;
}

const MAX_ATTEMPTS = 40;
const VERIFY_BUDGET = 60_000;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/* ------------------------------------------------------------------ shape */

export function shapeFor(pressure: LevelPressure): LevelShape {
  const p = pressure.pressure;
  const columns = clamp(3 + Math.round(p * 3), 3, 6);
  // Two slots of straight per column at least. One is enough for the rules —
  // every column needs its own drop slot — but on a phone it makes a column
  // one marble wide, and a block of three holes no longer fits in it.
  const straightSlots = Math.max(columns * 2, clamp(Math.round(8 - p * 3.5), 4, 8));
  const beltLength = 2 * straightSlots + 2 * CURVE_SLOTS;
  return {
    colors: clamp(Math.round(2.6 + p * 3.6), 3, 6),
    columns,
    rows: clamp(6 + Math.round(p * 3), 6, 9),
    blockSize: 3,
    // The lever with the range. What matters is a handful against the room on
    // the belt, so it is set as a share of the belt rather than a count.
    dropSize: Math.round(beltLength * (0.45 + p * 0.17)),
    straightSlots,
    mix: clamp(0.2 + p * 0.8, 0, 1),
    visibleRows: p < 0.5 ? 99 : p < 0.8 ? 3 : 2,
  };
}

/* ----------------------------------------------------------------- blocks */

/**
 * Deals the blocks.
 *
 * Colour counts are as even as the block total allows, so no pipe is a token
 * two marbles. The banded order is row-major — every column's first block,
 * then every column's second — with colours in runs as long as a row, which is
 * what "all the blues come first" looks like. `mix` then swaps that fraction of
 * blocks with a random partner.
 */
export function dealColumns(shape: LevelShape, rng: Rng): number[][] {
  const total = shape.columns * shape.rows;
  const order = rng.shuffle(Array.from({ length: shape.colors }, (_, i) => i));
  const counts = order.map((_, i) =>
    Math.floor(total / shape.colors) + (i < total % shape.colors ? 1 : 0),
  );

  const flat: number[] = [];
  order.forEach((color, i) => {
    for (let n = 0; n < (counts[i] as number); n++) flat.push(color);
  });

  for (let i = 0; i < flat.length; i++) {
    if (!rng.chance(shape.mix)) continue;
    const j = rng.int(flat.length);
    [flat[i], flat[j]] = [flat[j] as number, flat[i] as number];
  }

  const columns: number[][] = Array.from({ length: shape.columns }, () => []);
  flat.forEach((color, i) => (columns[i % shape.columns] as number[]).push(color));
  return columns;
}

export function boardFor(shape: LevelShape, columns: number[][]): Level {
  return {
    colors: shape.colors,
    columns,
    blockSize: shape.blockSize,
    dropSize: shape.dropSize,
    straightSlots: shape.straightSlots,
    visibleRows: shape.visibleRows,
  };
}

/* ----------------------------------------------------------------- timing */

/**
 * True if the winning line still wins however long she waits before each tap.
 *
 * The belt never stops, so a tap lands at whatever point in its rotation her
 * thumb happens to — and in principle that can change which of two red blocks
 * a marble reaches first, and so which block clears and what rises in its
 * place. Measured over 640 played lines it never once changed the outcome, but
 * "never in 640" is a measurement and the promise is a guarantee: a board
 * whose line only wins with the right timing is a dead end for a person, so it
 * is discarded rather than shipped.
 */
export function isTimingProof(level: Level, plan: readonly number[], rng: Rng, trials = 4): boolean {
  const geometry = geometryFor(level);
  for (let t = 0; t < trials; t++) {
    const sim = createSim(level);
    let status = settle(level, sim, geometry);
    for (const color of plan) {
      const wait = rng.int(geometry.length);
      for (let i = 0; i < wait; i++) step(level, sim, geometry);
      tap(level, sim, color);
      status = settle(level, sim, geometry);
      if (status === 'lost') return false;
    }
    if (status !== 'won') return false;
  }
  return true;
}

/* ------------------------------------------------------------- difficulty */

/**
 * Trap rate: the fraction of naive playthroughs that fill the belt.
 *
 * The naive player waits for things to settle, then usually taps a colour the
 * open blocks want — weighted towards whichever wants most — and otherwise taps
 * any pipe at all. That is someone playing the obvious move without asking what
 * it leaves on the belt.
 */
export function trapRate(level: Level, rng: Rng, rollouts = 24, greed = 0.75): number {
  const geometry = geometryFor(level);
  let lost = 0;

  for (let r = 0; r < rollouts; r++) {
    const sim = createSim(level);
    for (;;) {
      const live: number[] = [];
      const wanted: number[] = [];
      for (let color = 0; color < level.colors; color++) {
        if ((sim.remaining[color] as number) === 0) continue;
        live.push(color);
        if (openHoles(level, sim, color) > 0) wanted.push(color);
      }
      if (live.length === 0) break;
      const pool = wanted.length > 0 && rng.chance(greed) ? wanted : live;
      tap(level, sim, rng.pick(pool));
      const status = settle(level, sim, geometry);
      if (status === 'lost') {
        lost++;
        break;
      }
      if (status === 'won') break;
    }
  }

  return lost / rollouts;
}

/**
 * How often the obvious strategy loses: always tap the colour the open blocks
 * want most, ties at random.
 *
 * Trap rate alone saturates. Past the middle of the curve nearly every careless
 * run loses, so it stops telling boards apart — but most of those boards are
 * still won by this one simple rule, which a player learns in a dozen levels.
 * The boards that beat it are the ones that need looking at the blocks
 * underneath, and that is what the top of the curve should be made of.
 */
export function greedyLossRate(level: Level, rng: Rng, rollouts = 16): number {
  const geometry = geometryFor(level);
  let lost = 0;
  for (let r = 0; r < rollouts; r++) {
    const sim = createSim(level);
    for (;;) {
      let best = -1;
      let pool: number[] = [];
      for (let color = 0; color < level.colors; color++) {
        if ((sim.remaining[color] as number) === 0) continue;
        const holes = openHoles(level, sim, color);
        if (holes > best) {
          best = holes;
          pool = [color];
        } else if (holes === best) {
          pool.push(color);
        }
      }
      if (pool.length === 0) break;
      tap(level, sim, rng.pick(pool));
      const status = settle(level, sim, geometry);
      if (status === 'lost') lost++;
      if (status !== 'settled') break;
    }
  }
  return lost / rollouts;
}

/** Where `value` sits in [lo, hi], clamped. */
const norm = (value: number, lo: number, hi: number): number =>
  clamp((value - lo) / (hi - lo), 0, 1);

export function scoreDifficulty(shape: LevelShape, trap: number, greedyLoss: number): number {
  const structural =
    norm(shape.colors, 3, 6) * 0.6 + norm(3 - Math.min(3, shape.visibleRows), 0, 1) * 0.4;
  return clamp(
    0.55 * norm(trap, 0, 0.9) + 0.3 * norm(greedyLoss, 0, 0.3) + 0.15 * structural,
    0,
    1,
  );
}

/* --------------------------------------------------------------- assembly */

export function generateLevel(profileSeed: string, level: number): GeneratedLevel {
  const pressureRng = createRng(hashSeed(profileSeed, 'marblesort', 'pressure', level));
  const pressure = pressureForLevel(level, pressureRng);
  return generateForPressure(profileSeed, level, pressure);
}

export function generateForPressure(
  profileSeed: string,
  level: number,
  pressure: LevelPressure,
  shapeOverride?: LevelShape,
): GeneratedLevel {
  const shape = shapeOverride ?? shapeFor(pressure);
  let closest: GeneratedLevel | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rng = createRng(hashSeed(profileSeed, 'marblesort', level, attempt));
    const board = boardFor(shape, dealColumns(shape, rng));
    if (!isWellFormed(board)) continue;

    const start = createSim(board);
    const verified = search(board, start, { nodeBudget: VERIFY_BUDGET });
    if (verified.status !== 'solved' || !verified.plan) continue;

    const rollRng = createRng(hashSeed(profileSeed, 'marblesort', 'rollout', level, attempt));
    if (!isTimingProof(board, verified.plan, rollRng)) continue;

    const trap = trapRate(board, rollRng);
    const greedyLoss = greedyLossRate(board, rollRng);
    const difficulty = scoreDifficulty(shape, trap, greedyLoss);
    const candidate: GeneratedLevel = {
      level,
      board,
      shape,
      difficulty,
      trap,
      greedyLoss,
      attempts: attempt + 1,
    };

    const [lo, hi] = pressure.band;
    if (difficulty >= lo && difficulty <= hi) return candidate;
    const distance = difficulty < lo ? lo - difficulty : difficulty - hi;
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = candidate;
    }
  }

  if (closest) return closest;
  throw new Error(`Unable to generate a solvable Marble Sort level ${level}`);
}
