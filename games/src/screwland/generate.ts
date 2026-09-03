/**
 * Level generation for Screw Land.
 *
 * Structures are *assembled* bottom-up: each new plate goes on top of what is
 * already there. Disassembly is then guaranteed to be physically possible, by
 * induction on layer — the topmost plate is never covered, so its screws are
 * reachable, so it falls, so the next one down becomes reachable.
 *
 * That leaves colour as the only thing that can make a level impossible, and
 * that is what the solver verifies before the level is ever shown.
 *
 * Difficulty is measured the same way as Color Sort: the fraction of naive
 * playthroughs that overflow the tray. It models the player we are building
 * for, rather than the search algorithm.
 */

import type { SinkConfig } from '../shared/buffer-sink';
import { accept, createSinkState } from '../shared/buffer-sink';
import { type LevelPressure, pressureForLevel } from '../shared/difficulty';
import { MAX_COLORS } from '../shared/palette';
import { type Rng, createRng, hashSeed } from '../shared/rng';
import {
  type BoardState,
  type Plate,
  type Screw,
  type Structure,
  accessibleScrewIds,
  createBoardState,
  indexStructure,
  isDisassemblable,
  isWellFormed,
  removeScrew,
} from './model';
import { search } from './solve';

export const SINK_CAPACITY = 3;
/** Box slots the tutorial levels hand out. Later levels take some away. */
export const MAX_OPEN_BOXES = 4;

export interface LevelShape {
  gridWidth: number;
  gridHeight: number;
  plateCount: number;
  screwCount: number;
  colors: number;
  /** Boxes accepting screws at any one moment. The sharpest lever here. */
  openBoxes: number;
  trayCapacity: number;
}

export interface GeneratedLevel {
  level: number;
  structure: Structure;
  queue: number[];
  config: SinkConfig;
  shape: LevelShape;
  /** 0..1, measured from naive playthroughs. */
  difficulty: number;
  attempts: number;
}

const MAX_ATTEMPTS = 30;
const VERIFY_BUDGET = 120_000;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/* ------------------------------------------------------------------ shape */

export function shapeFor(pressure: LevelPressure, rng: Rng): LevelShape {
  const p = pressure.pressure;

  // Screw count must be a multiple of the box capacity so every box fills
  // exactly and no colour is ever left stranded.
  const boxes = clamp(Math.round(4 + p * 10), 4, 14);
  const screwCount = boxes * SINK_CAPACITY;

  // Many small plates rather than few large ones. All of a plate's screws
  // become reachable the moment it is uncovered, so fat plates hand the player
  // a dozen simultaneous choices — and with that many options one always
  // matches an open box, the tray never fills, and the level cannot be lost.
  const plateCount = clamp(Math.round(screwCount / 2.2), 3, 20);

  // How many colours the player may unscrew at once. Four open boxes is a
  // tutorial setting: with four of anything on offer something on the board
  // almost always matches, the tray never fills, and the level cannot be lost.
  // Closing boxes is what turns "tap the screws you see" into a decision, so
  // the count comes down early and keeps coming down.
  const openBoxes =
    p < 0.12
      ? 4
      : p < 0.34
        ? 3
        : rng.chance(clamp((p - 0.34) / 0.5, 0, 1) * 0.75)
          ? 2
          : 3;

  // Colour count is the other half of the same lever: what matters is the ratio
  // of colours on the board to boxes open for them. The square root gets us to
  // five colours by about level 20 rather than level 45, where a linear ramp
  // left a long flat stretch with a measured trap rate of zero.
  //
  // The cap is what lets the two levers coexist. Two boxes against six colours
  // measures as maximum difficulty, lands outside the target band, and gets
  // thrown away — so pushing both levers at once quietly gives back the closed
  // boxes. Two boxes against four colours stays inside the band and is the
  // better puzzle anyway: it asks the player to plan rather than to guess.
  const colors = clamp(
    3 + Math.round(Math.sqrt(p) * 4),
    3,
    Math.min(7, openBoxes + 2, MAX_COLORS),
  );

  // A four-slot tray is the sharpest of the remaining levers and stays a
  // minority — and never lands on top of a two-box board, which is punishing
  // enough on its own.
  const trayCapacity =
    openBoxes > 2 && p > 0.55 && rng.chance(((p - 0.55) / 0.45) * 0.35) ? 4 : 5;

  const gridWidth = clamp(6 + Math.round(p * 3), 6, 9);
  const gridHeight = clamp(7 + Math.round(p * 4), 7, 11);

  return { gridWidth, gridHeight, plateCount, screwCount, colors, openBoxes, trayCapacity };
}

/* -------------------------------------------------------------- structure */

/**
 * Builds the plate stack. Later plates get higher layers and are nudged to
 * overlap what is already down, because plates that never overlap produce no
 * occlusion and therefore no puzzle.
 */
function buildPlates(shape: LevelShape, rng: Rng): Plate[] {
  const plates: Plate[] = [];

  // A base plate wide enough to hang everything else off.
  const baseW = clamp(shape.gridWidth - rng.int(2), 3, shape.gridWidth);
  const baseH = clamp(shape.gridHeight - 2 - rng.int(2), 3, shape.gridHeight);
  plates.push({
    id: 0,
    layer: 0,
    x: Math.floor((shape.gridWidth - baseW) / 2),
    y: Math.floor((shape.gridHeight - baseH) / 2),
    w: baseW,
    h: baseH,
  });

  for (let i = 1; i < shape.plateCount; i++) {
    const w = rng.range(2, 5);
    const h = rng.range(2, 5);

    // Anchor tightly on an existing plate: plates that barely overlap produce
    // no occlusion, and occlusion is the entire puzzle.
    const anchor = rng.pick(plates);
    const x = clamp(
      anchor.x + rng.range(-1, Math.max(0, anchor.w - 2)),
      0,
      Math.max(0, shape.gridWidth - w),
    );
    const y = clamp(
      anchor.y + rng.range(-1, Math.max(0, anchor.h - 2)),
      0,
      Math.max(0, shape.gridHeight - h),
    );

    plates.push({ id: i, layer: i, x, y, w, h });
  }

  return plates;
}

/**
 * Distributes screws across plates, at distinct lattice points.
 *
 * Every plate needs at least one screw or it could never have stood; the
 * remainder are spread at random, favouring plates with room left.
 */
function placeScrews(plates: Plate[], shape: LevelShape, rng: Rng): Screw[] | null {
  const taken = new Set<string>();
  const screws: Omit<Screw, 'color'>[] = [];

  const freePointsOn = (plate: Plate): { x: number; y: number }[] => {
    const points: { x: number; y: number }[] = [];
    for (let dx = 0; dx < plate.w; dx++) {
      for (let dy = 0; dy < plate.h; dy++) {
        const x = plate.x + dx;
        const y = plate.y + dy;
        if (!taken.has(`${x},${y}`)) points.push({ x, y });
      }
    }
    return points;
  };

  const addTo = (plate: Plate): boolean => {
    const free = freePointsOn(plate);
    if (free.length === 0) return false;
    const point = rng.pick(free);
    taken.add(`${point.x},${point.y}`);
    screws.push({ id: screws.length, plateId: plate.id, x: point.x, y: point.y });
    return true;
  };

  // One per plate first — a plate without a screw is malformed.
  for (const plate of plates) {
    if (!addTo(plate)) return null;
  }

  if (screws.length > shape.screwCount) return null; // more plates than screws

  let guard = 0;
  while (screws.length < shape.screwCount) {
    if (guard++ > shape.screwCount * 40) return null; // board too dense to fill
    addTo(rng.pick(plates));
  }

  return screws.map((screw) => ({ ...screw, color: 0 }));
}

/**
 * Assigns colours in groups of `SINK_CAPACITY` so every box fills exactly, then
 * shuffles which screw gets which. The box queue is that same multiset of
 * colours in a random order — the order is a large part of the difficulty.
 */
function assignColors(
  screws: Screw[],
  shape: LevelShape,
  rng: Rng,
): { screws: Screw[]; queue: number[] } {
  const boxes = screws.length / SINK_CAPACITY;
  const boxColors: number[] = [];

  // Every colour in play should appear at least once, then fill at random.
  for (let c = 0; c < shape.colors && boxColors.length < boxes; c++) boxColors.push(c);
  while (boxColors.length < boxes) boxColors.push(rng.int(shape.colors));

  const pool: number[] = [];
  for (const color of boxColors) {
    for (let i = 0; i < SINK_CAPACITY; i++) pool.push(color);
  }
  rng.shuffle(pool);

  return {
    screws: screws.map((screw, i) => ({ ...screw, color: pool[i] as number })),
    queue: rng.shuffle(boxColors.slice()),
  };
}

/* ------------------------------------------------------------- difficulty */

/**
 * Trap rate: the fraction of naive playthroughs that overflow the tray.
 *
 * The rollout models someone playing without searching ahead — usually taking
 * an obvious match when one is in front of them, otherwise picking whatever
 * catches their eye. A board most careless runs survive is easy; one where four
 * in five end in an overflow is hard.
 */
function trapRate(
  structure: Structure,
  queue: number[],
  config: SinkConfig,
  rng: Rng,
  rollouts = 20,
): number {
  const index = indexStructure(structure);
  let lost = 0;

  for (let r = 0; r < rollouts; r++) {
    const state: BoardState = createBoardState(structure, index);
    let sinks = createSinkState(config, queue);
    let failed = false;

    for (let step = 0; step < structure.screws.length; step++) {
      const reachable = accessibleScrewIds(structure, index, state);
      if (reachable.length === 0) break;

      // 75% of the time, take a screw a box is already asking for.
      let choice = reachable[rng.int(reachable.length)] as number;
      if (rng.chance(0.75)) {
        const wanted = reachable.filter((id) => {
          const color = (structure.screws[id] as Screw).color;
          return sinks.sinks.some(
            (sink) => sink && sink.color === color && sink.filled < config.sinkCapacity,
          );
        });
        if (wanted.length > 0) choice = wanted[rng.int(wanted.length)] as number;
      }

      const result = accept(sinks, config, (structure.screws[choice] as Screw).color);
      if (result.placed === 'lost') {
        failed = true;
        break;
      }
      sinks = result.state;
      removeScrew(structure, index, state, choice);
    }

    if (failed) lost++;
  }

  return lost / rollouts;
}

function scoreDifficulty(shape: LevelShape, trap: number): number {
  const trapScore = clamp(trap / 0.8, 0, 1);
  const structural = clamp(
    (shape.colors / 7) * 0.35 +
      ((MAX_OPEN_BOXES - shape.openBoxes) / 2) * 0.2 +
      (shape.trayCapacity === 4 ? 0.28 : 0.08) +
      (shape.screwCount / 42) * 0.17,
    0,
    1,
  );
  return clamp(0.7 * trapScore + 0.3 * structural, 0, 1);
}

/* --------------------------------------------------------------- assembly */

/**
 * Deterministic for a given (profileSeed, level, difficultyOffset), so a save
 * stores a removal order rather than a board, and a reported bug reproduces
 * exactly.
 */
export function generateLevel(
  profileSeed: string,
  level: number,
  difficultyOffset = 0,
): GeneratedLevel {
  const pressureRng = createRng(hashSeed(profileSeed, 'screwland', 'pressure', level));
  const pressure = pressureForLevel(level, difficultyOffset, pressureRng);

  let closest: GeneratedLevel | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rng = createRng(hashSeed(profileSeed, 'screwland', level, difficultyOffset, attempt));
    const shape = shapeFor(pressure, rng);

    const plates = buildPlates(shape, rng);
    const placed = placeScrews(plates, shape, rng);
    if (!placed) continue;

    const coloured = assignColors(placed, shape, rng);
    const structure: Structure = {
      plates,
      screws: coloured.screws,
      gridWidth: shape.gridWidth,
      gridHeight: shape.gridHeight,
      colors: shape.colors,
    };

    if (!isWellFormed(structure) || !isDisassemblable(structure)) continue;

    const config: SinkConfig = {
      openSinks: shape.openBoxes,
      sinkCapacity: SINK_CAPACITY,
      bufferCapacity: shape.trayCapacity,
    };

    const spec = { structure, queue: coloured.queue, config };
    if (search(spec, { nodeBudget: VERIFY_BUDGET }).status !== 'solved') continue;

    const rollRng = createRng(hashSeed(profileSeed, 'screwland', 'rollout', level, attempt));
    const difficulty = scoreDifficulty(
      shape,
      trapRate(structure, coloured.queue, config, rollRng),
    );

    const candidate: GeneratedLevel = {
      level,
      structure,
      queue: coloured.queue,
      config,
      shape,
      difficulty,
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
  throw new Error(`Unable to generate a solvable Screw Land level ${level}`);
}
