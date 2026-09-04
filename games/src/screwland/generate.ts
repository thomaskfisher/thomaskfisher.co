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

/** Screws a box holds at the easiest setting. Levels take it higher. */
export const BASE_BOX_CAPACITY = 3;
/** The most boxes any level opens at once. */
export const MAX_OPEN_BOXES = 3;

export interface LevelShape {
  gridWidth: number;
  gridHeight: number;
  plateCount: number;
  screwCount: number;
  colors: number;
  /** Boxes accepting screws at any one moment. The sharpest lever here. */
  openBoxes: number;
  /** Screws one box wants. More means a colour is committed to for longer. */
  boxCapacity: number;
  trayCapacity: number;
  /** Upcoming boxes the player is shown. Fewer means planning blind. */
  previewCount: number;
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

const MAX_ATTEMPTS = 32;
/**
 * Solver nodes allowed to prove one candidate solvable.
 *
 * Lowered from 120k, which is worth explaining because it looks like weakening
 * the guarantee and is not. A rejected candidate costs the *whole* budget, and
 * on the 45-screw structures the curve now reaches, 120k nodes was ~2s per
 * attempt — level 20 took 23 seconds to generate, far past the level-long
 * window the background worker has and a certain freeze on the main-thread
 * fallback.
 *
 * Nothing unsolvable can slip through: this only ever makes the verifier give
 * up sooner, and giving up rejects the board. What it changes is the *kind* of
 * board that survives — one whose solution is findable inside 40k nodes rather
 * than one that needs a quarter-million-state search to prove. For a game whose
 * whole promise is that a person can find the line, that is the boards we want
 * anyway.
 */
const VERIFY_BUDGET = 40_000;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/* ------------------------------------------------------------------ shape */

export function shapeFor(pressure: LevelPressure): LevelShape {
  const p = pressure.pressure;

  // A box wanting four or five screws is a much longer commitment than one
  // wanting three: the colour stays open, and every screw of the *other*
  // colours found in the meantime goes to the tray. This lever did not exist
  // before — capacity was a module constant — and it is the one that makes a
  // small board hard without making it bigger.
  const boxCapacity = p < 0.45 ? 3 : p < 0.75 ? 4 : 5;

  // Screw count must be a multiple of the box capacity so every box fills
  // exactly and no colour is ever left stranded.
  //
  // The box count is capped low *because* capacity now goes to five: the two
  // multiply, and the product is what generation costs. At twelve boxes of five
  // the solver was verifying sixty-screw structures and level 20 took 34
  // seconds to generate — well past the level-long budget the background worker
  // actually has, and a guaranteed freeze on the main-thread fallback. Nine
  // fives is 45, which measures at well under a second.
  const boxes = clamp(Math.round(4 + p * 5), 4, 9);
  const screwCount = boxes * boxCapacity;

  // Many small plates rather than few large ones. All of a plate's screws
  // become reachable the moment it is uncovered, so fat plates hand the player
  // a dozen simultaneous choices — and with that many options one always
  // matches an open box, the tray never fills, and the level cannot be lost.
  const plateCount = clamp(Math.round(screwCount / 2.1), 3, 20);

  // How many colours the player may unscrew at once. Four open boxes was the
  // old tutorial setting: with four of anything on offer something on the board
  // almost always matches, the tray never fills, and the level cannot be lost.
  // Four is gone entirely — three is now the *easiest* this ever gets, and most
  // levels run on two.
  //
  // This threshold and the three below are deliberately staggered rather than
  // stacked. When boxes, capacity, tray and preview all stepped within the same
  // stretch of the curve, levels 2 to 8 lurched from 0.34 to 0.82 and back to
  // 0.61 — four levers firing at once is a cliff, not a ramp.
  //
  // The threshold sits below the *whole* of level 1's jitter range, not merely
  // below its centre. Level 1 has a base pressure of 0.23 and jitters +-0.06,
  // so a 0.2 threshold caught it on some profile seeds and not others — and the
  // seeds it caught got a level 1 measuring 0.04, because three boxes against a
  // five-slot tray means the tray cannot fill and the level cannot be lost.
  //
  // Three boxes and a five-slot tray now belong to breather levels, which sit
  // 0.15 lower and are the only place a genuinely easy board is wanted.
  const openBoxes = p < 0.12 ? 3 : 2;

  // The tray is where the level is actually lost, so this is the sharpest of
  // the remaining levers. It now moves with pressure rather than on a rare
  // roll, but it stops at four rather than three: `tools/probe.ts` measures a
  // three-slot tray against a five-screw box as solvable in under a tenth of
  // deals, which is not a hard level so much as a level that mostly does not
  // exist.
  const trayCapacity = p < 0.15 ? 5 : 4;

  // Colour count is not a free lever here, and this is the one place the design
  // has to say so out loud.
  //
  // Colours, open boxes, tray slots and box capacity are **one budget**, not
  // four dials. `tools/probe.ts` measures the solvable region directly, and it
  // is unforgiving: at two open boxes and a four-screw box, seven colours is
  // solvable in 2 deals in 20 and eight in none at all. Levels asking for that
  // do not come out hard, they fail to come out — the generator burns every
  // attempt and throws.
  //
  // So colour count rises early, while boxes and capacity are still cheap, and
  // then yields to them. The cap below is fitted to the probe: each extra screw
  // a box demands costs roughly one colour, and each tray slot buys one back.
  // Difficulty past that point comes from capacity, preview and occlusion,
  // which do not draw on this budget at all.
  // The `+ 2` is fitted to the probe, and it is also a generation-cost control:
  // one colour past this and the solvable share of deals falls from ~75% to
  // ~35%, so two thirds of attempts burn the full verify budget and level 20
  // takes ten seconds to build. A lever that costs six seconds of latency to
  // move one notch is not worth the notch.
  const colorBudget = openBoxes + trayCapacity + 2 - boxCapacity;

  // The floor wins over the budget, and the order matters: `clamp(n, 4, 3)`
  // returns 3, so writing this as a single clamp quietly produced three-colour
  // boards at the top of the curve. The probe says that was needlessly timid
  // anyway — two boxes with five-screw boxes and a four-slot tray is solvable
  // in 11 deals in 20 at four colours. Four is the floor everywhere.
  const colors = Math.max(
    4,
    Math.min(4 + Math.round(Math.sqrt(p) * 3), colorBudget, MAX_COLORS),
  );

  // How far ahead the box queue is visible. Three upcoming boxes is enough to
  // park a colour deliberately; one is enough to know only whether the screw in
  // your hand is about to pay off.
  const previewCount = p < 0.45 ? 3 : p < 0.75 ? 2 : 1;

  const gridWidth = clamp(6 + Math.round(p * 3), 6, 9);
  const gridHeight = clamp(7 + Math.round(p * 4), 7, 11);

  return {
    gridWidth,
    gridHeight,
    plateCount,
    screwCount,
    colors,
    openBoxes,
    boxCapacity,
    trayCapacity,
    previewCount,
  };
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
 * Assigns colours in groups of `shape.boxCapacity` so every box fills exactly, then
 * shuffles which screw gets which. The box queue is that same multiset of
 * colours in a random order — the order is a large part of the difficulty.
 */
function assignColors(
  screws: Screw[],
  shape: LevelShape,
  rng: Rng,
): { screws: Screw[]; queue: number[] } {
  const boxes = screws.length / shape.boxCapacity;
  const boxColors: number[] = [];

  // Every colour in play should appear at least once, then fill at random.
  for (let c = 0; c < shape.colors && boxColors.length < boxes; c++) boxColors.push(c);
  while (boxColors.length < boxes) boxColors.push(rng.int(shape.colors));

  const pool: number[] = [];
  for (const color of boxColors) {
    for (let i = 0; i < shape.boxCapacity; i++) pool.push(color);
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

/** Where `value` sits in [lo, hi], clamped. Every structural term is one of these. */
const norm = (value: number, lo: number, hi: number): number =>
  clamp((value - lo) / (hi - lo), 0, 1);

/**
 * Blends the measured trap rate with what the board is made of.
 *
 * Every term is normalised against the range `shapeFor` actually produces, and
 * the weights sum to one — including the two levers that did not exist when
 * this was first written. Box capacity and the queue preview are what carry the
 * top of the curve here, since colours cannot (see `colorBudget`), so leaving
 * them out of the score meant the band could not tell the hardest boards from
 * the middling ones.
 */
function scoreDifficulty(shape: LevelShape, trap: number): number {
  const trapScore = clamp(trap / 0.8, 0, 1);
  const structural = clamp(
    norm(shape.colors, 4, 6) * 0.22 +
      norm(shape.boxCapacity, 3, 5) * 0.22 +
      // Inverted: a smaller tray and fewer open boxes are harder boards.
      norm(5 - shape.trayCapacity, 0, 2) * 0.22 +
      norm(MAX_OPEN_BOXES - shape.openBoxes, 0, 1) * 0.14 +
      norm(shape.screwCount, 12, 45) * 0.12 +
      norm(3 - shape.previewCount, 0, 2) * 0.08,
    0,
    1,
  );
  return clamp(0.7 * trapScore + 0.3 * structural, 0, 1);
}

/* --------------------------------------------------------------- assembly */

/**
 * One assembly attempt: build the stack, colour it, and verify it.
 *
 * Returns null when the attempt is unusable — an impossible screw placement, a
 * structure that cannot be taken apart, or a colour order the solver cannot
 * clear. Exported so `tools/probe.ts` can measure the solvable region of the
 * (colours, boxes, tray, capacity) space directly. That region is not obvious:
 * those four are one budget, not four levers, and asking for a combination
 * outside it burns every attempt and throws.
 */
export function buildCandidate(
  shape: LevelShape,
  rng: Rng,
  rollRng: Rng,
): Omit<GeneratedLevel, 'level' | 'attempts'> | null {
  const plates = buildPlates(shape, rng);
  const placed = placeScrews(plates, shape, rng);
  if (!placed) return null;

  const coloured = assignColors(placed, shape, rng);
  const structure: Structure = {
    plates,
    screws: coloured.screws,
    gridWidth: shape.gridWidth,
    gridHeight: shape.gridHeight,
    colors: shape.colors,
  };

  if (!isWellFormed(structure) || !isDisassemblable(structure)) return null;

  const config: SinkConfig = {
    openSinks: shape.openBoxes,
    sinkCapacity: shape.boxCapacity,
    bufferCapacity: shape.trayCapacity,
  };

  const spec = { structure, queue: coloured.queue, config };
  if (search(spec, { nodeBudget: VERIFY_BUDGET }).status !== 'solved') return null;

  const difficulty = scoreDifficulty(shape, trapRate(structure, coloured.queue, config, rollRng));

  return { structure, queue: coloured.queue, config, shape, difficulty };
}

/**
 * Deterministic for a given (profileSeed, level), so a save stores a removal
 * order rather than a board, and a reported bug reproduces exactly.
 */
export function generateLevel(profileSeed: string, level: number): GeneratedLevel {
  const pressureRng = createRng(hashSeed(profileSeed, 'screwland', 'pressure', level));
  const pressure = pressureForLevel(level, pressureRng);
  const shape = shapeFor(pressure);

  let closest: GeneratedLevel | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rng = createRng(hashSeed(profileSeed, 'screwland', level, attempt));
    const rollRng = createRng(hashSeed(profileSeed, 'screwland', 'rollout', level, attempt));

    const built = buildCandidate(shape, rng, rollRng);
    if (!built) continue;

    const candidate: GeneratedLevel = { ...built, level, attempts: attempt + 1 };

    const [lo, hi] = pressure.band;
    if (candidate.difficulty >= lo && candidate.difficulty <= hi) return candidate;

    const distance =
      candidate.difficulty < lo ? lo - candidate.difficulty : candidate.difficulty - hi;
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = candidate;
    }
  }

  if (closest) return closest;
  throw new Error(`Unable to generate a solvable Screw Land level ${level}`);
}
