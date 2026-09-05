/**
 * Level generation for Depot.
 *
 * Two guarantees have to hold before a board is worth solving, and both are
 * bought by construction rather than by dealing and hoping.
 *
 * **The lot always empties.** Buses are parked one at a time, each into a spot
 * that still has a clear drive-out *in the grid as it stands*. Reverse the
 * placement order and you have a legal way to empty the lot; and because
 * removing a bus never blocks another, that order still works no matter what
 * the player pulls first. Random lots are not like this at all — a bus parked
 * nose-first into a wall of other buses can be unreachable forever.
 *
 * **The queue always drains.** Rather than dealing a crowd and checking, the
 * generator *plays a level and writes down what happened*. It walks the
 * guaranteed pull order, and between pulls it emits passengers of colours that
 * a bus at the kerb is actually waiting for. The queue it records is therefore
 * one that its own play finished, and — because the emitted passengers are run
 * through the real `boardWaiting` rather than a model of it — the play it
 * recorded is a play the game will accept.
 *
 * The solver then proves it anyway, which is the promise the collection is
 * built on: no level here is ever a dead end.
 *
 * What is left for the levers to do is make the *other* orders lose, which is
 * what `trapRate` measures.
 */

import { type LevelPressure, pressureForLevel } from '../shared/difficulty';
import { MAX_COLORS } from '../shared/palette';
import { type Rng, createRng, hashSeed } from '../shared/rng';
import {
  type Board,
  type Bus,
  type Facing,
  type Level,
  EMPTY,
  boardWaiting,
  cellsOf,
  createState,
  drivableIds,
  freeBay,
  isVertical,
  isWellFormed,
  isWon,
  laneIsClear,
  occupancy,
  pull,
} from './model';
import { search } from './solve';

export interface LevelShape {
  gridWidth: number;
  gridHeight: number;
  /** How many buses to try to park. Placement stops early when the lot fills. */
  busTarget: number;
  colors: number;
  /** Loading bays. The sharpest lever in the game. */
  bays: number;
  /** Chance a bus is three cells long — a bigger blocker with more seats. */
  longChance: number;
  /** Share of buses whose colour is hidden until they are out of the lot. */
  unknownRate: number;
  /**
   * How hard placement works to park buses across other buses' exit lanes.
   * 0 scatters, 1 packs them nose to tail.
   */
  blockBias: number;
  /**
   * How eagerly the recorded play commits bays before draining them. High
   * values interleave more colours into the queue at once.
   */
  pullBias: number;
  /** Longest run of one colour the recorded play emits at a time. */
  maxRun: number;
}

export interface GeneratedLevel {
  level: number;
  board: Board;
  queue: number[];
  shape: LevelShape;
  /** 0..1, measured from naive playthroughs. */
  difficulty: number;
  /** Pulls in the solver's winning line — what the clock is budgeted against. */
  moves: number;
  attempts: number;
}

const MAX_ATTEMPTS = 26;
const VERIFY_BUDGET = 150_000;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/* ------------------------------------------------------------------ shape */

const FACINGS: readonly Facing[] = ['up', 'right', 'down', 'left'];

/**
 * The levers, staggered along the curve on purpose.
 *
 * Stacking four thresholds at the same pressure is what turned Screw Land's
 * levels 2-8 into a lurch rather than a ramp, so bays, colours, board size and
 * the hidden buses each step at a different point.
 */
export function shapeFor(pressure: LevelPressure): LevelShape {
  const p = pressure.pressure;

  // Bays are where the level is actually lost, so this is the sharpest lever —
  // and it is held back rather than spent early. `tools/depot.ts` measured a
  // three-bay board at a trap rate of 0.73 while the curve was still asking for
  // 0.52, so dropping to three at level 10 skipped a third of the game.
  //
  // Two bays is the top of the curve and nothing else, because it *saturates*:
  // measured across three to six colours, two bays reads 0.84-0.96 whatever
  // else is set. It is a ceiling, not a dial, and using it earlier would flatten
  // every other lever underneath it.
  const bays = p < 0.62 ? 4 : p < 0.88 ? 3 : 2;

  // Deliberately **not** capped against the bays. The obvious reading of the
  // collection's own "colours and holding slots are one budget" lesson says six
  // colours across two bays should be a board the generator fails to produce —
  // and it is not: the probe built 39 of 40 of them, because the queue is
  // recorded from a play rather than dealt and checked. The cap was cargo cult
  // from a game that deals, and it left the colour lever dead above level 26.
  const colors = clamp(4 + Math.round(Math.max(0, p - 0.1) * 2.2), 4, Math.min(6, MAX_COLORS));

  // Six by six from level 1. The lot has to be big enough that pulling the
  // wrong bus can actually cost something: a five-by-five with seven buses
  // measured at 0.07, which is a board that cannot be lost.
  const gridWidth = clamp(6 + Math.round(Math.max(0, p - 0.55) * 2.2), 6, 7);
  const gridHeight = clamp(6 + Math.round(Math.max(0, p - 0.2) * 2.3), 6, 8);

  // How full to park it. Placement undershoots this once it runs out of spots
  // with a clear drive-out, and that undershoot is the point — it is what keeps
  // every bus reachable. 2.3 is the mean bus length across `longChance`.
  const fill = 0.6 + p * 0.13;
  const busTarget = Math.max(8, Math.round((gridWidth * gridHeight * fill) / 2.3));

  const longChance = 0.16 + p * 0.24;

  // **Nothing hidden until the back half of the curve**, and capped low. This
  // is the one lever here that is a gamble rather than a decision: the probe
  // put ten per cent of buses hidden at +0.11 trap rate and twenty per cent at
  // +0.18, which is more than colours and bays put together. Undo makes a
  // hidden bus a peek rather than a punishment, but a board that is mostly `?`
  // is a coin flip whichever way you play it.
  //
  // The threshold is on *pressure*, and this curve is steep — 0.55 pressure is
  // level 9, not the halfway point it reads as. 0.72 puts the first hidden bus
  // at around level 18, by which time three bays and five colours have been
  // seen and there is a game to complicate.
  const unknownRate = p < 0.72 ? 0 : clamp((p - 0.72) * 0.55, 0, 0.15);

  const blockBias = clamp(0.3 + p * 0.5, 0, 0.8);
  const pullBias = clamp(0.3 + p * 0.38, 0, 0.68);
  const maxRun = p < 0.4 ? 4 : p < 0.72 ? 3 : 2;

  return {
    gridWidth,
    gridHeight,
    busTarget,
    colors,
    bays,
    longChance,
    unknownRate,
    blockBias,
    pullBias,
    maxRun,
  };
}

/* -------------------------------------------------------------- the lot */

interface Spot {
  x: number;
  y: number;
  length: number;
  facing: Facing;
}

/** Cells a spot would cover, without needing a Bus to exist yet. */
function spotCells(width: number, spot: Spot): number[] {
  const cells: number[] = [];
  const vertical = isVertical(spot.facing);
  for (let step = 0; step < spot.length; step++) {
    const x = vertical ? spot.x : spot.x + step;
    const y = vertical ? spot.y + step : spot.y;
    cells.push(y * width + x);
  }
  return cells;
}

/** The lane a spot would drive out through, nose first. */
function spotLane(width: number, height: number, spot: Spot): number[] {
  const lane: number[] = [];
  const stepX = spot.facing === 'left' ? -1 : spot.facing === 'right' ? 1 : 0;
  const stepY = spot.facing === 'up' ? -1 : spot.facing === 'down' ? 1 : 0;
  let x = spot.x + (spot.facing === 'right' ? spot.length : 0) + (stepX < 0 ? -1 : 0);
  let y = spot.y + (spot.facing === 'down' ? spot.length : 0) + (stepY < 0 ? -1 : 0);

  while (x >= 0 && y >= 0 && x < width && y < height) {
    lane.push(y * width + x);
    x += stepX;
    y += stepY;
  }
  return lane;
}

/**
 * Parks the lot, one bus at a time, newest last.
 *
 * A spot is only taken if the bus could drive straight out of it *right now*.
 * That single rule is what makes the finished lot guaranteed to empty, and it
 * is also why the lot has a grain to it: the buses parked first end up buried,
 * and are the ones the player has to dig down to.
 *
 * Among the legal spots, the ones that stand across the most existing exit
 * lanes are preferred. Difficulty here is *constrained choice* — how few buses
 * are drivable at any moment — rather than how many buses there are, and a lot
 * dealt without this bias is a car park with an aisle down the middle.
 */
function parkLot(shape: LevelShape, rng: Rng): Spot[] | null {
  const { gridWidth: width, gridHeight: height } = shape;
  const grid = new Uint8Array(width * height).fill(EMPTY);
  const parked: Spot[] = [];

  for (let placed = 0; placed < shape.busTarget; placed++) {
    const candidates: { spot: Spot; blocks: number }[] = [];

    for (const facing of FACINGS) {
      const vertical = isVertical(facing);
      const length = rng.chance(shape.longChance) ? 3 : 2;
      const maxX = vertical ? width : width - length + 1;
      const maxY = vertical ? height - length + 1 : height;

      for (let y = 0; y < maxY; y++) {
        for (let x = 0; x < maxX; x++) {
          const spot: Spot = { x, y, length, facing };
          if (spotCells(width, spot).some((cell) => grid[cell] !== EMPTY)) continue;
          if (spotLane(width, height, spot).some((cell) => grid[cell] !== EMPTY)) continue;

          // How many already-parked buses this one would shut in. Counted
          // before placing, which is why the lane test above uses the same grid.
          const cells = new Set(spotCells(width, spot));
          let blocks = 0;
          for (const other of parked) {
            if (
              spotLane(width, height, other).some((cell) => cells.has(cell))
            ) {
              blocks++;
            }
          }
          candidates.push({ spot, blocks });
        }
      }
    }

    if (candidates.length === 0) break;

    // Sorted by how much they shut in, then a pick from the top slice. The
    // slice widens as the bias falls, so an easy lot is nearly a free choice
    // and a hard one is always the meanest available spot.
    candidates.sort((a, b) => b.blocks - a.blocks);
    const window = Math.max(1, Math.round(candidates.length * (1 - shape.blockBias)));
    const chosen = candidates[rng.int(window)] as { spot: Spot };

    for (const cell of spotCells(width, chosen.spot)) grid[cell] = parked.length;
    parked.push(chosen.spot);
  }

  // Too few buses and there is no lot to speak of — every one of them is
  // drivable from the start and the geometry stops mattering.
  return parked.length >= Math.max(6, Math.round(shape.busTarget * 0.6)) ? parked : null;
}

/* --------------------------------------------------------------- colours */

/**
 * Colours and seat counts.
 *
 * Capacity is tied to length so that it can be read off the shape of the bus as
 * well as from the number printed on it — a three-cell bus is the one that
 * holds a bay for a long time, and it should look like it.
 *
 * Every colour is used at least once. A colour that appears on no bus is a
 * colour the player learns to ignore, which is the opposite of a lever.
 */
function paintBuses(spots: readonly Spot[], shape: LevelShape, rng: Rng): Bus[] {
  const colors: number[] = [];
  for (let i = 0; i < spots.length; i++) colors.push(i % shape.colors);
  rng.shuffle(colors);

  const unknowns = new Array<boolean>(spots.length).fill(false);
  const hidden = Math.round(spots.length * shape.unknownRate);
  const order = spots.map((_, index) => index);
  rng.shuffle(order);
  for (let i = 0; i < hidden; i++) unknowns[order[i] as number] = true;

  return spots.map((spot, id) => ({
    x: spot.x,
    y: spot.y,
    length: spot.length,
    facing: spot.facing,
    color: colors[id] as number,
    capacity: spot.length === 3 ? rng.range(5, 6) : rng.range(3, 4),
    unknown: unknowns[id] as boolean,
  }));
}

/* ----------------------------------------------------------------- queue */

/**
 * Plays the level and writes down the crowd that would have made it work.
 *
 * The pull order is the reverse of the parking order, which the lot guarantees
 * is legal. Between pulls the play emits a short run of passengers for a colour
 * some bus at the kerb is still waiting on, and lets the game's own
 * `boardWaiting` decide where they go — so nothing here can record a queue the
 * rules would route differently.
 *
 * It cannot stall. When a bay is free there is a bus to pull; when none is, at
 * least one bay has room, because a full one departs the instant it fills.
 */
function planQueue(board: Board, order: readonly number[], shape: LevelShape, rng: Rng): number[] {
  const queue: number[] = [];
  const level: Level = { board, queue };
  const state = createState(board);

  let next = 0;
  let guard = 0;
  const limit = board.buses.length * 40 + 400;

  while (guard++ < limit) {
    const done = next >= order.length && state.bays.every((bay) => bay === null);
    if (done) return queue;

    const canPull = next < order.length && freeBay(state) !== -1;
    const waiting = state.bays
      .map((bay, index) => ({ bay, index }))
      .filter((entry) => entry.bay !== null);

    // Draining is forced whenever the kerb is full or the lot is empty.
    const drain = !canPull || (waiting.length > 0 && !rng.chance(shape.pullBias));

    if (drain && waiting.length > 0) {
      const target = rng.pick(waiting).bay as NonNullable<(typeof waiting)[0]['bay']>;
      const need = target.capacity - target.loaded;
      const run = Math.min(need, rng.range(1, shape.maxRun));
      for (let i = 0; i < run; i++) queue.push(target.color);
      boardWaiting(level, state);
      continue;
    }

    // Unreachable: `drain` is forced true whenever a pull is impossible, and
    // the kerb always has a bay with room when it is full. Kept as a hard stop
    // rather than an assertion, because a queue nobody can board is the one
    // failure that would slip past the solver as a merely *hard* level.
    if (!canPull) return [];
    if (pull(level, state, order[next++] as number) !== 'ok') return [];
    if (state.boarded !== queue.length) return [];
  }

  return [];
}

/* ------------------------------------------------------------ difficulty */

/**
 * Trap rate: the fraction of naive playthroughs that jam the kerb.
 *
 * The rollout models someone playing on the couch rather than searching —
 * usually pulling a bus whose colour the front of the queue is waiting for, and
 * otherwise pulling whatever catches the eye.
 *
 * **It only reads a colour the player can actually see.** A hidden bus is a
 * fifth option with no information attached, exactly as it is on screen, so a
 * board full of them measures as the gamble it is instead of as a board the
 * rollout happens to know the answers to. Measuring the rule the game enforces
 * rather than the one the model finds convenient is the whole reason this
 * number is worth anything.
 */
function trapRate(level: Level, rng: Rng, rollouts = 22): number {
  const { board } = level;
  let lost = 0;

  for (let r = 0; r < rollouts; r++) {
    const state = createState(board);
    boardWaiting(level, state);

    let failed = false;
    for (let step = 0; step <= board.buses.length; step++) {
      if (isWon(level, state)) break;
      const drivable = drivableIds(board, state);
      if (drivable.length === 0) {
        failed = true;
        break;
      }

      let choice = drivable[rng.int(drivable.length)] as number;
      if (rng.chance(0.78)) {
        const front = level.queue[state.boarded];
        const ahead = new Set(level.queue.slice(state.boarded, state.boarded + 8));

        const visible = drivable.filter((id) => !(board.buses[id] as Bus).unknown);
        const exact = visible.filter((id) => (board.buses[id] as Bus).color === front);
        const soon = visible.filter((id) => ahead.has((board.buses[id] as Bus).color));
        const pool = exact.length > 0 ? exact : soon.length > 0 ? soon : [];
        if (pool.length > 0) choice = pool[rng.int(pool.length)] as number;
      }

      if (pull(level, state, choice) !== 'ok') {
        failed = true;
        break;
      }
    }

    if (failed || !isWon(level, state)) lost++;
  }

  return lost / rollouts;
}

/** Where `value` sits in [lo, hi], clamped. Every structural term is one of these. */
const norm = (value: number, lo: number, hi: number): number =>
  clamp((value - lo) / (hi - lo), 0, 1);

/**
 * Blends the measured trap rate with what the board is made of.
 *
 * Every term is normalised against the range `shapeFor` actually reaches, and
 * the weights sum to one — otherwise a term that cannot move contributes a
 * constant and quietly drags every board towards one end of the band.
 *
 * There was such a term here, and the probe is what caught it: the first
 * version scored a board harder for having *fewer* drivable buses, on the
 * intuition that a tight lot is a hard lot. Measured, the opposite is true —
 * six buses trap 0.19 of naive runs and eighteen trap 0.91, because the lot is
 * not where a level is lost. The kerb is, and every extra bus is another
 * chance to commit a bay to the wrong colour. So bus count is a difficulty
 * term with a positive sign, and the tightness of the lot is not a term at all.
 */
function scoreDifficulty(shape: LevelShape, level: Level, trap: number): number {
  // Denominator at 0.9 rather than 0.8: the signal genuinely reaches 0.96, and
  // saturating it early compresses everything above level 20 into one value.
  const trapScore = clamp(trap / 0.9, 0, 1);
  const structural = clamp(
    // Inverted: fewer bays is a harder board.
    norm(4 - shape.bays, 0, 2) * 0.34 +
      norm(shape.colors, 4, 6) * 0.24 +
      norm(level.board.buses.length, 9, 18) * 0.22 +
      norm(shape.unknownRate, 0, 0.15) * 0.12 +
      norm(shape.pullBias, 0.3, 0.68) * 0.08,
    0,
    1,
  );
  return clamp(0.7 * trapScore + 0.3 * structural, 0, 1);
}

/* -------------------------------------------------------------- assembly */

/**
 * Deterministic for a given (profileSeed, level), so a save stores a pull order
 * rather than a board, a level is shareable by number, and a reported bug
 * reproduces exactly.
 */
export function generateLevel(profileSeed: string, level: number): GeneratedLevel {
  const pressureRng = createRng(hashSeed(profileSeed, 'depot', 'pressure', level));
  const pressure = pressureForLevel(level, pressureRng);
  const shape = shapeFor(pressure);

  let closest: GeneratedLevel | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rng = createRng(hashSeed(profileSeed, 'depot', level, attempt));

    const spots = parkLot(shape, rng);
    if (!spots) continue;

    const buses = paintBuses(spots, shape, rng);
    const board: Board = {
      width: shape.gridWidth,
      height: shape.gridHeight,
      buses,
      colors: shape.colors,
      bays: shape.bays,
    };

    // Newest parked leaves first. See the header.
    const order = buses.map((_, id) => id).reverse();

    const queue = planQueue(board, order, shape, rng);
    if (queue.length === 0) continue;

    const candidate: Level = { board, queue };
    if (!isWellFormed(candidate)) continue;

    const result = search(candidate, { nodeBudget: VERIFY_BUDGET });
    if (result.status !== 'solved') continue;

    const rollRng = createRng(hashSeed(profileSeed, 'depot', 'rollout', level, attempt));
    const trap = trapRate(candidate, rollRng);
    const difficulty = scoreDifficulty(shape, candidate, trap);

    const generated: GeneratedLevel = {
      level,
      board,
      queue,
      shape,
      difficulty,
      moves: result.moves.length,
      attempts: attempt + 1,
    };

    const [lo, hi] = pressure.band;
    if (difficulty >= lo && difficulty <= hi) return generated;

    const distance = difficulty < lo ? lo - difficulty : difficulty - hi;
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = generated;
    }
  }

  if (closest) return closest;
  throw new Error(`Unable to generate a solvable Depot level ${level}`);
}

/** Re-exported so the probe tools and tests need not reach into two modules. */
export { occupancy, cellsOf, laneIsClear };

/* ---------------------------------------------------------------- probing */

/**
 * Builds boards at fixed lever settings and reports the raw signal.
 *
 * Exported only for `tools/depot.ts`. Nothing in the game calls it — the point
 * of it is to answer "what range can the trap rate actually reach" *before* the
 * band is calibrated to a range, which is the mistake that flattened the curve
 * in two of the earlier games.
 */
export function probeShape(
  overrides: Partial<LevelShape>,
  samples = 40,
): { trap: number; open: number; built: number; buses: number } {
  const base: LevelShape = {
    gridWidth: 6,
    gridHeight: 7,
    busTarget: 14,
    colors: 4,
    bays: 3,
    longChance: 0.25,
    unknownRate: 0,
    blockBias: 0.6,
    pullBias: 0.5,
    maxRun: 3,
    ...overrides,
  };

  let trapTotal = 0;
  let openTotal = 0;
  let busTotal = 0;
  let built = 0;

  for (let sample = 0; sample < samples; sample++) {
    const rng = createRng(hashSeed('probe', sample, base.bays, base.colors, base.blockBias, base.pullBias));
    const spots = parkLot(base, rng);
    if (!spots) continue;

    const buses = paintBuses(spots, base, rng);
    const board: Board = {
      width: base.gridWidth,
      height: base.gridHeight,
      buses,
      colors: base.colors,
      bays: base.bays,
    };
    const order = buses.map((_, id) => id).reverse();
    const queue = planQueue(board, order, base, rng);
    if (queue.length === 0) continue;

    const level: Level = { board, queue };
    if (!isWellFormed(level)) continue;
    if (search(level, { nodeBudget: VERIFY_BUDGET }).status !== 'solved') continue;

    built++;
    trapTotal += trapRate(level, createRng(hashSeed('probe-roll', sample)), 30);
    const state = createState(board);
    boardWaiting(level, state);
    openTotal += drivableIds(board, state).length;
    busTotal += buses.length;
  }

  return {
    trap: built === 0 ? 0 : trapTotal / built,
    open: built === 0 ? 0 : openTotal / built,
    built,
    buses: built === 0 ? 0 : busTotal / built,
  };
}
