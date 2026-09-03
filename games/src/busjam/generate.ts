/**
 * Level generation for Bus Jam.
 *
 * Boards are built by **reverse play**. Dealing a crowd at random and hoping is
 * hopeless here: the physical constraint and the colour constraint have to line
 * up, and a random board is nearly always either unsolvable or trivial.
 *
 * So generation runs the game backwards. It first plays out a legal *colour*
 * order against the buses and the bench — which is easy, because a bus at the
 * stop always has someone left on the board who matches it. Then it walks that
 * order from the last tap to the first, placing each passenger into a cell that
 * still has a clear path to the exit at that point in the reverse sequence.
 *
 * The result is solvable by construction: at forward step i the grid holds
 * exactly the passengers placed at reverse steps i..n, which is precisely the
 * state passenger i was placed against. The solver then confirms it, and the
 * confirmation is what the player is really being sold — no level here is ever
 * a dead end.
 *
 * People are placed deepest-first, so crowds pack from the back like a real
 * queue, and the front of the board stays open enough to move in.
 */

import type { SinkConfig } from '../shared/buffer-sink';
import { accept, createSinkState, isDrained } from '../shared/buffer-sink';
import { type LevelPressure, pressureForLevel } from '../shared/difficulty';
import { MAX_COLORS } from '../shared/palette';
import { type Rng, createRng, hashSeed } from '../shared/rng';
import {
  type Board,
  type BoardState,
  type Passenger,
  boardPassenger,
  cellX,
  cellY,
  createBoardState,
  exitDistances,
  indexBoard,
  isClearable,
  isWellFormed,
  reachableIds,
} from './model';
import { search } from './solve';

/** Seats on a bus. Three, in the original and here. */
export const SINK_CAPACITY = 3;
/** Buses at the stop in the opening levels. Later levels take one away. */
export const MAX_OPEN_BUSES = 2;

export interface LevelShape {
  gridWidth: number;
  gridHeight: number;
  /** Cells walled off, narrowing the routes to the exit. */
  wallCount: number;
  passengerCount: number;
  colors: number;
  /** Buses accepting passengers at any one moment. The sharpest lever here. */
  openBuses: number;
  benchCapacity: number;
}

export interface GeneratedLevel {
  level: number;
  board: Board;
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

  // Passenger count must be a multiple of the bus capacity so every bus fills
  // exactly and no colour is ever left stranded.
  const buses = clamp(Math.round(3 + p * 9), 3, 12);
  const passengerCount = buses * SINK_CAPACITY;

  const gridWidth = clamp(4 + Math.round(p * 3), 4, 7);

  // Crowd density is the physical half of the difficulty. Too loose and most of
  // the grid is free space, so everyone is reachable and the layout stops
  // mattering; too tight and there is one legal move at a time, which is
  // transcription rather than a puzzle.
  const density = 0.5 + p * 0.22;
  const openCells = Math.ceil(passengerCount / density);
  const gridHeight = clamp(Math.ceil(openCells / gridWidth) + 1, 3, 11);

  // Walls narrow the routes out, which is what turns "who is in front" into
  // "who is in front of the only way through".
  const slack = Math.max(0, gridWidth * gridHeight - openCells);
  const wallCount = Math.round(slack * clamp(0.3 + p * 0.45, 0, 0.8));

  // Two buses at the stop is a tutorial setting: with two colours accepted at
  // once something on the board almost always matches, the bench never fills,
  // and the level cannot be lost. Dropping to one is what turns "tap the people
  // you can reach" into a decision, so it happens early and the transition is
  // blurred so it does not read as a wall.
  const openBuses = p < 0.16 ? 2 : p < 0.3 ? (rng.chance((p - 0.16) / 0.14) ? 1 : 2) : 1;

  // The other half of the colour lever: what matters is the ratio of colours on
  // the board to seats open for them. Square root rather than linear, for the
  // same reason as Screw Land — a linear ramp leaves a long flat stretch early
  // where the measured trap rate is zero.
  const colors = clamp(3 + Math.round(Math.sqrt(p) * 4), 3, Math.min(6, MAX_COLORS));

  // A four-seat bench is the sharpest of the remaining levers, so it stays a
  // minority even at the top of the curve. It is not held back from one-bus
  // boards the way Screw Land holds its four-slot tray back from two-box ones,
  // because by the time pressure is this high every board is a one-bus board —
  // gating it that way left the lever permanently switched off. The difficulty
  // band is what catches the combinations that overshoot.
  const benchCapacity = p > 0.55 && rng.chance(((p - 0.55) / 0.45) * 0.3) ? 4 : 5;

  return {
    gridWidth,
    gridHeight,
    wallCount,
    passengerCount,
    colors,
    openBuses,
    benchCapacity,
  };
}

/* ------------------------------------------------------------------- grid */

/** Every open cell must be able to reach the exit row, or it is dead space. */
function allOpenCellsConnected(open: boolean[], width: number, height: number): boolean {
  const seen = new Array<boolean>(open.length).fill(false);
  const queue: number[] = [];

  for (let x = 0; x < width; x++) {
    if (open[x]) {
      seen[x] = true;
      queue.push(x);
    }
  }
  if (queue.length === 0) return false;

  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head] as number;
    const x = cell % width;
    const y = Math.floor(cell / width);
    const step = (nx: number, ny: number): void => {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
      const next = ny * width + nx;
      if (seen[next] || !open[next]) return;
      seen[next] = true;
      queue.push(next);
    };
    step(x, y - 1);
    step(x, y + 1);
    step(x - 1, y);
    step(x + 1, y);
  }

  return open.every((isOpen, cell) => !isOpen || seen[cell] === true);
}

/**
 * Carves the walkable shape.
 *
 * Walls go in as short runs rather than scattered single cells: a lone hole in
 * the middle of a grid reads as a missing tile, while a run of two or three
 * reads as a wall you have to walk around — which is what it is. Any run that
 * would strand part of the grid is rolled back.
 */
function buildGrid(shape: LevelShape, rng: Rng): boolean[] | null {
  const { gridWidth: width, gridHeight: height } = shape;
  const open = new Array<boolean>(width * height).fill(true);

  let carved = 0;
  let guard = 0;
  while (carved < shape.wallCount && guard++ < shape.wallCount * 12 + 40) {
    const horizontal = rng.chance(0.5);
    const length = Math.min(rng.range(1, 3), shape.wallCount - carved);
    let x = rng.int(width);
    let y = rng.int(height);
    const dx = horizontal ? 1 : 0;
    const dy = horizontal ? 0 : 1;

    for (let i = 0; i < length; i++, x += dx, y += dy) {
      if (x >= width || y >= height) break;
      const cell = y * width + x;
      if (!open[cell]) continue;

      open[cell] = false;
      if (allOpenCellsConnected(open, width, height)) carved++;
      else open[cell] = true;
    }
  }

  const openCount = open.reduce((n, isOpen) => (isOpen ? n + 1 : n), 0);
  // Reverse placement needs somewhere to stand *and* somewhere to walk.
  if (openCount <= shape.passengerCount) return null;
  return open;
}

/* ----------------------------------------------------------------- colour */

interface ColorPlan {
  /** Bus colours, index 0 next to pull in. */
  queue: number[];
  /** A legal forward order of passenger colours. */
  taps: number[];
}

/**
 * Plays a legal colour order forward.
 *
 * This can never stall: while a bus sits at the stop unfilled, the passengers
 * that finish it are by definition still on the board, so a bus-matching colour
 * is always available. That is what makes the reverse construction total — the
 * only thing that can fail is the *placement*, which retries handle.
 *
 * `benchBias` deliberately parks people who could have boarded. A solution that
 * never touches the bench tends to also be the one a careless player stumbles
 * into, and levels built from those measure as trivial.
 */
function planColors(shape: LevelShape, config: SinkConfig, rng: Rng, benchBias: number): ColorPlan | null {
  const buses = shape.passengerCount / SINK_CAPACITY;

  const busColors: number[] = [];
  for (let c = 0; c < shape.colors && busColors.length < buses; c++) busColors.push(c);
  while (busColors.length < buses) busColors.push(rng.int(shape.colors));
  rng.shuffle(busColors);

  const remaining = new Array<number>(shape.colors).fill(0);
  for (const color of busColors) {
    remaining[color] = (remaining[color] as number) + SINK_CAPACITY;
  }

  let sinks = createSinkState(config, busColors);
  const taps: number[] = [];

  for (let step = 0; step < shape.passengerCount; step++) {
    const boarding: number[] = [];
    const parking: number[] = [];

    for (let color = 0; color < shape.colors; color++) {
      if ((remaining[color] as number) === 0) continue;
      const placed = accept(sinks, config, color).placed;
      if (placed === 'sink') boarding.push(color);
      else if (placed === 'buffer') parking.push(color);
    }

    let pool = boarding;
    if (parking.length > 0 && (boarding.length === 0 || rng.chance(benchBias))) pool = parking;
    if (pool.length === 0) return null;

    const color = rng.pick(pool);
    sinks = accept(sinks, config, color).state;
    remaining[color] = (remaining[color] as number) - 1;
    taps.push(color);
  }

  return isDrained(sinks) ? { queue: busColors, taps } : null;
}

/* -------------------------------------------------------------- placement */

/**
 * Walks the tap order backwards, seating each passenger somewhere that still
 * has a clear route out.
 *
 * The last person to leave is placed into an empty grid and can go anywhere;
 * the first is placed last, when the board is at its fullest, and therefore
 * ends up at the front. That is the whole trick, and it is why the level is
 * solvable without ever having been searched.
 */
function placeCrowd(
  open: boolean[],
  shape: LevelShape,
  taps: readonly number[],
  rng: Rng,
  looseness: number,
): Passenger[] | null {
  const shell: Board = {
    width: shape.gridWidth,
    height: shape.gridHeight,
    open,
    passengers: [],
    colors: shape.colors,
  };
  const index = indexBoard(shell);
  const state: BoardState = createBoardState(shell);
  const cells = new Array<number>(taps.length).fill(-1);

  for (let i = taps.length - 1; i >= 0; i--) {
    const distance = exitDistances(shell, index, state);

    let deepest = -1;
    for (let cell = 0; cell < distance.length; cell++) {
      const d = distance[cell] as number;
      if (d > deepest) deepest = d;
    }
    if (deepest < 0) return null; // nowhere left with a route out

    // How far forward of the deepest free cell someone may be seated.
    //
    // Zero packs the crowd into a solid block at the back, which is what a late
    // level should look like and play like. Widening it scatters people over
    // the grid instead — more of them are reachable at once, so there is more
    // choice and less to plan, which is what an early level wants. It is also
    // the difference between the two boards in `examples/bus-jam`: the tutorial
    // one is a thin scatter, the hard one is packed columns.
    const slack = rng.int(Math.round(1 + looseness * 5) + 1);
    const candidates: number[] = [];
    for (let cell = 0; cell < distance.length; cell++) {
      const d = distance[cell] as number;
      if (d >= 0 && d >= deepest - slack) candidates.push(cell);
    }

    const cell = rng.pick(candidates);
    cells[i] = cell;
    state.occupant[cell] = i;
  }

  return taps.map((color, id) => {
    const cell = cells[id] as number;
    return { id, color, x: cellX(shell, cell), y: cellY(shell, cell) };
  });
}

/* ------------------------------------------------------------- difficulty */

/**
 * Trap rate: the fraction of naive playthroughs that overfill the bench.
 *
 * The rollout models someone playing without searching ahead — usually taking
 * an obvious match when one is in front of them, otherwise tapping whoever
 * catches their eye. A board most careless runs survive is easy; one where four
 * in five end on a full bench is hard.
 */
function trapRate(
  board: Board,
  queue: readonly number[],
  config: SinkConfig,
  rng: Rng,
  rollouts = 20,
): number {
  const index = indexBoard(board);
  let lost = 0;

  for (let r = 0; r < rollouts; r++) {
    const state = createBoardState(board);
    let sinks = createSinkState(config, queue);
    let failed = false;

    for (let step = 0; step < board.passengers.length; step++) {
      const reachable = reachableIds(board, index, state);
      if (reachable.length === 0) break;

      // 75% of the time, take someone a bus is already asking for.
      let choice = reachable[rng.int(reachable.length)] as number;
      if (rng.chance(0.75)) {
        const wanted = reachable.filter((id) => {
          const color = (board.passengers[id] as Passenger).color;
          return sinks.sinks.some(
            (sink) => sink && sink.color === color && sink.filled < config.sinkCapacity,
          );
        });
        if (wanted.length > 0) choice = wanted[rng.int(wanted.length)] as number;
      }

      const result = accept(sinks, config, (board.passengers[choice] as Passenger).color);
      if (result.placed === 'lost') {
        failed = true;
        break;
      }
      sinks = result.state;
      boardPassenger(board, state, choice);
    }

    if (failed) lost++;
  }

  return lost / rollouts;
}

/** Fraction of open cells that start occupied — the physical half of the squeeze. */
function crowdDensity(board: Board): number {
  const openCells = board.open.reduce((n, isOpen) => (isOpen ? n + 1 : n), 0);
  return openCells === 0 ? 0 : board.passengers.length / openCells;
}

function scoreDifficulty(shape: LevelShape, board: Board, trap: number): number {
  const trapScore = clamp(trap / 0.8, 0, 1);
  const structural = clamp(
    (shape.colors / 6) * 0.3 +
      (MAX_OPEN_BUSES - shape.openBuses) * 0.24 +
      (shape.benchCapacity === 4 ? 0.24 : 0.06) +
      (shape.passengerCount / 36) * 0.12 +
      clamp((crowdDensity(board) - 0.45) / 0.35, 0, 1) * 0.1,
    0,
    1,
  );
  return clamp(0.7 * trapScore + 0.3 * structural, 0, 1);
}

/* --------------------------------------------------------------- assembly */

/**
 * Deterministic for a given (profileSeed, level, difficultyOffset), so a save
 * stores a boarding order rather than a board, and a reported bug reproduces
 * exactly.
 */
export function generateLevel(
  profileSeed: string,
  level: number,
  difficultyOffset = 0,
): GeneratedLevel {
  const pressureRng = createRng(hashSeed(profileSeed, 'busjam', 'pressure', level));
  const pressure = pressureForLevel(level, difficultyOffset, pressureRng);

  let closest: GeneratedLevel | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rng = createRng(hashSeed(profileSeed, 'busjam', level, difficultyOffset, attempt));
    const shape = shapeFor(pressure, rng);

    const open = buildGrid(shape, rng);
    if (!open) continue;

    const config: SinkConfig = {
      openSinks: shape.openBuses,
      sinkCapacity: SINK_CAPACITY,
      bufferCapacity: shape.benchCapacity,
    };

    const plan = planColors(shape, config, rng, 0.15 + pressure.pressure * 0.35);
    if (!plan) continue;

    const passengers = placeCrowd(open, shape, plan.taps, rng, 1 - pressure.pressure);
    if (!passengers) continue;

    const board: Board = {
      width: shape.gridWidth,
      height: shape.gridHeight,
      open,
      passengers,
      colors: shape.colors,
    };

    if (!isWellFormed(board) || !isClearable(board)) continue;

    const spec = { board, queue: plan.queue, config };
    if (search(spec, { nodeBudget: VERIFY_BUDGET }).status !== 'solved') continue;

    const rollRng = createRng(hashSeed(profileSeed, 'busjam', 'rollout', level, attempt));
    const difficulty = scoreDifficulty(shape, board, trapRate(board, plan.queue, config, rollRng));

    const candidate: GeneratedLevel = {
      level,
      board,
      queue: plan.queue,
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
  throw new Error(`Unable to generate a solvable Bus Jam level ${level}`);
}
