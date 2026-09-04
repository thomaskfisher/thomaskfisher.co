/**
 * Level generation for Gridlock.
 *
 * Three things about this file are different from the other four games, and all
 * three follow from the same property of the rules: **Gridlock cannot be lost.**
 * Every slide is reversible, so the state space is undirected, there are no dead
 * ends, and the *trap rate* the rest of the collection is calibrated on has
 * nothing to measure.
 *
 * **1. The difficulty score is the length of a shortest solution, exactly.**
 * Not a rollout, not an estimate. `solve.ts` enumerates the whole reachable
 * component, so "this park needs nineteen slides" means no eighteen-slide
 * sequence exists. Nothing else contributes to the score.
 *
 * **2. Levels are built backwards from a finished one.** The generator starts
 * from a park that is already solved — target against the exit wall — and the
 * component reached from it therefore contains a win by definition. Every
 * position in that component can reach it, so any starting position drawn from
 * the component is solvable *by construction*, and the solver measures rather
 * than filters. Dealing at random and verifying does not work here: a random
 * park is usually either wide open or welded shut, and `solve.test.ts` holds a
 * hand-built board that looks entirely reasonable and is a proven dead end.
 *
 * **3. The generator searches the layout, not the deal.** This is the part that
 * was measured rather than assumed, and the measurement changed the design.
 * `tools/gridlock.ts` surveyed what random parks actually produce: a median
 * component depth of *two or three slides*, with anything past eighteen turning
 * up about once in a hundred layouts. A generator that dealt and hoped would
 * spend a hundred exhaustive sweeps to find one hard level. But depth is a
 * property of the layout — which vehicles exist and which row or column each is
 * locked to — and a layout can be hill-climbed: replace one vehicle, keep the
 * change if the component got deeper, reseed when a climb stops improving. In
 * the survey that reached a target depth of eight or twelve slides in 97% of
 * runs and sixteen in 88%, against the roughly 1% a random deal manages.
 *
 * Two numbers from the same survey pay for themselves:
 *
 *  - **`STATE_CAP` is 8,000 and that is not a compromise.** Deep layouts have
 *    *small* components — three to seven thousand positions. A park with a
 *    hundred thousand reachable positions is a wide-open one where everything
 *    shuffles freely and the target is three slides from the exit. So the cap
 *    throws away only layouts that were going to be discarded anyway, while
 *    making every discard much cheaper — the wide parks are exactly the ones
 *    that used to run all the way to a 25,000 cap before being thrown out.
 *  - **The seed layout plants its own blockers.** A hard park has vertical
 *    vehicles standing across the exit row; in the solved layout those are the
 *    verticals crossing row 2 to the left of the parked target. Building them in
 *    saves the climb from rediscovering them every time.
 *
 * Because the depth of a *layer* is chosen after the component is known, the
 * band is hit exactly whenever the climb reaches its target — there is no
 * "generate and hope it scores in range" step here at all.
 */

import { type LevelPressure, pressureForLevel } from '../shared/difficulty';
import { type Rng, createRng, hashSeed } from '../shared/rng';
import {
  type Board,
  type Vehicle,
  EXIT_ROW,
  SIZE,
  TARGET_LENGTH,
  blockersAhead,
  cellsOf,
  decode,
  isValidPosition,
  isWellFormed,
} from './model';
import { type Analysis, analyse } from './solve';

/**
 * Positions one layout may hold before it is abandoned.
 *
 * See the note above: this is a *filter on shape*, not a budget that risks
 * shipping something unverified. A park this wide is an easy one.
 */
export const STATE_CAP = 8_000;

/**
 * Exhaustive sweeps one level may spend before it settles for the deepest
 * layout it found.
 */
const MAX_SWEEPS = 420;

/** Fresh seed layouts one level may start a climb from. */
const MAX_ROUNDS = 22;

/**
 * Mutations without an improvement before the climb abandons this layout and
 * reseeds.
 *
 * Settling instead of reseeding was a real bug rather than a tuning question. A
 * climb that lands on a jammed park — four hundred reachable positions, nothing
 * with room to move — cannot mutate its way out, because almost every
 * replacement collides. Level 150 came out at six slides against a target of
 * twenty: a trivial board, a hundred and fifty levels in, dressed as a hard one.
 * A stalled climb now starts again somewhere else.
 */
const STALL_LIMIT = 30;

/** Tries at finding a free slot for one vehicle before giving up on it. */
const PLACEMENT_TRIES = 60;

/**
 * The measured range of the difficulty signal, in slides.
 *
 * **Probed before they were set, not guessed** — see `tools/gridlock.ts`. The
 * ceiling is where it is because that is what the generator can reliably reach
 * inside a second or two: in the survey the climb landed sixteen slides 88% of
 * the time and twenty 45% of the time, and past that the cost climbs faster
 * than the puzzle gets better. For scale, the hardest published cards for this puzzle sit in
 * the low thirties, and its hardest known configuration is fifty-one.
 *
 * Calibrating a band to a range the format cannot deliver is the single most
 * expensive mistake made in this project. Color Sort's first difficulty signal
 * spanned a factor the formula assumed was a thousand times wider, and the
 * curve went flat halfway up as a result.
 */
export const EASIEST_MOVES = 5;
export const HARDEST_MOVES = 21;

export interface LevelShape {
  /** How many vehicles are in the park, target included. */
  vehicles: number;
  /** Verticals planted across the exit row in the solved layout. */
  gates: number;
  /** Share of the freely placed vehicles that are three cells long. */
  truckShare: number;
  /** Share that are four. Deliberately small — see `pickLength`. */
  busShare: number;
}

export interface GeneratedLevel {
  level: number;
  board: Board;
  /** Where the vehicles start. Not solved, and solvable by construction. */
  start: number[];
  shape: LevelShape;
  /** Exact length of a shortest solution. The difficulty signal itself. */
  moves: number;
  /** 0..1, mapped from `moves`. */
  difficulty: number;
  /** Exhaustive sweeps spent getting here. Diagnostic only — never shown. */
  attempts: number;
  /** Positions in this layout's component. Diagnostic only. */
  states: number;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const clampInt = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Math.round(n)));

/* ------------------------------------------------------------------ shape */

export function shapeFor(pressure: LevelPressure, rng: Rng): LevelShape {
  const p = pressure.pressure;

  // Vehicle count is not monotonic in difficulty, which is worth stating
  // because the obvious assumption is wrong. A nearly empty park is trivial
  // because nothing is in the way; a nearly full one is trivial because almost
  // nothing can move and the few things that can have one place to go. The
  // survey bore that out — yield fell away above thirteen. So this climbs into
  // the middle and stops, and the depth of the shortest solution does the rest.
  const vehicles = clampInt(9 + p * 3 + rng.next() * 1.4, 8, 13);

  // Planted blockers. Two is enough to make a park about something; three makes
  // the opening harder to read, so it arrives with the curve.
  const gates = clampInt(1.6 + p * 1.5, 1, 3);

  // Longer vehicles are the constraint that does not move. A four-cell bus in a
  // six-wide park has three positions and spends the level being something to
  // route around, which is what makes it interesting and also why there is
  // rarely more than one.
  const truckShare = clamp(0.22 + p * 0.2, 0, 0.44);
  const busShare = clamp(p * 0.11, 0, 0.11);

  return { vehicles, gates, truckShare, busShare };
}

/** Difficulty from an exact move count. This is the whole scoring model. */
export function scoreDifficulty(moves: number): number {
  return clamp((moves - EASIEST_MOVES) / (HARDEST_MOVES - EASIEST_MOVES), 0, 1);
}

/** The inverse: the shortest-solution length a difficulty score is asking for. */
export function movesForScore(score: number): number {
  return EASIEST_MOVES + score * (HARDEST_MOVES - EASIEST_MOVES);
}

/* --------------------------------------------------------------- assembly */

export interface Layout {
  board: Board;
  /** A position in which the target is parked at the exit. */
  solved: number[];
}

function pickLength(shape: LevelShape, rng: Rng): number {
  const roll = rng.next();
  if (roll < shape.busShare) return 4;
  if (roll < shape.busShare + shape.truckShare) return 3;
  return 2;
}

function footprint(
  orientation: 'h' | 'v',
  cross: number,
  start: number,
  length: number,
): number[] {
  const cells: number[] = [];
  for (let step = 0; step < length; step++) {
    const row = orientation === 'h' ? cross : start + step;
    const column = orientation === 'h' ? start + step : cross;
    cells.push(row * SIZE + column);
  }
  return cells;
}

/** Drops one randomly shaped vehicle wherever it fits. */
function placeRandom(
  shape: LevelShape,
  rng: Rng,
  taken: Uint8Array,
  vehicles: Vehicle[],
  solved: number[],
): boolean {
  for (let attempt = 0; attempt < PLACEMENT_TRIES; attempt++) {
    const length = pickLength(shape, rng);
    const orientation = rng.chance(0.5) ? 'h' : 'v';
    const cross = rng.int(SIZE);
    const start = rng.int(SIZE - length + 1);

    const cells = footprint(orientation, cross, start, length);
    if (cells.some((cell) => taken[cell])) continue;

    for (const cell of cells) taken[cell] = 1;
    vehicles.push({ orientation, length, cross });
    solved.push(start);
    return true;
  }
  return false;
}

/**
 * A park in its finished state: the target against the exit wall, some vertical
 * vehicles planted in the lane it has to travel down, and the rest dropped
 * wherever they fit.
 *
 * This is the whole solvability guarantee. Because the position it returns is a
 * win, every position reachable from it can reach a win — reversibility does
 * the rest — so the generator never has to ask whether a board can be finished,
 * only how long it takes.
 *
 * Returns null if the park came out too sparse to be worth analysing, which
 * happens when the random placement kept colliding.
 */
export function buildSolvedLayout(shape: LevelShape, rng: Rng): Layout | null {
  const vehicles: Vehicle[] = [{ orientation: 'h', length: TARGET_LENGTH, cross: EXIT_ROW }];
  const solved: number[] = [SIZE - TARGET_LENGTH];

  const taken = new Uint8Array(SIZE * SIZE);
  for (const cell of footprint('h', EXIT_ROW, SIZE - TARGET_LENGTH, TARGET_LENGTH)) {
    taken[cell] = 1;
  }

  // The planted blockers: verticals standing in the exit row, in the columns
  // the target has to travel through once it is back at the far end.
  for (const column of rng.shuffle([0, 1, 2, 3]).slice(0, shape.gates)) {
    const length = rng.chance(0.55) ? 3 : 2;
    const spans: number[] = [];
    for (let start = 0; start + length <= SIZE; start++) {
      if (start <= EXIT_ROW && EXIT_ROW < start + length) spans.push(start);
    }
    const start = spans[rng.int(spans.length)] as number;
    const cells = footprint('v', column, start, length);
    if (cells.some((cell) => taken[cell])) continue;

    for (const cell of cells) taken[cell] = 1;
    vehicles.push({ orientation: 'v', length, cross: column });
    solved.push(start);
  }

  while (vehicles.length < shape.vehicles) {
    if (!placeRandom(shape, rng, taken, vehicles, solved)) break;
  }

  // A park that lost more than a couple of vehicles to collisions is not the
  // shape that was asked for, and analysing it wastes the sweep.
  if (vehicles.length < shape.vehicles - 1) return null;

  return { board: { vehicles }, solved };
}

/**
 * One step of the climb: lift a vehicle out and set a fresh one down elsewhere.
 *
 * **This deliberately re-rolls the vehicle rather than nudging it.** The
 * intuition is that hill climbing wants small local moves, and a nudge — shift
 * one vehicle a row or a column — was tried and measured: it made the generator
 * *worse*, taking the share of levels landing inside their band from 23 in 23
 * down to 20, and nearly doubling the slowest level. Small moves rarely change
 * the depth of a component at all, so the climb spent its budget on them and
 * reseeded less often. What this search actually wants is diversity, which is
 * why `STALL_LIMIT` is short and there are many rounds.
 *
 * The target is never touched — it defines the exit row and the win condition,
 * so moving it would change what is being generated rather than how hard it is.
 */
export function mutateLayout(shape: LevelShape, layout: Layout, rng: Rng): Layout | null {
  const { board, solved } = layout;
  if (board.vehicles.length < 2) return null;

  const drop = 1 + rng.int(board.vehicles.length - 1);

  const taken = new Uint8Array(SIZE * SIZE);
  for (let id = 0; id < board.vehicles.length; id++) {
    if (id === drop) continue;
    for (const cell of cellsOf(board, id, solved[id] as number)) taken[cell] = 1;
  }

  for (let attempt = 0; attempt < PLACEMENT_TRIES; attempt++) {
    const length = pickLength(shape, rng);
    const orientation = rng.chance(0.5) ? 'h' : 'v';
    const cross = rng.int(SIZE);
    const start = rng.int(SIZE - length + 1);

    const cells = footprint(orientation, cross, start, length);
    if (cells.some((cell) => taken[cell])) continue;

    const vehicles = board.vehicles.slice();
    const next = solved.slice();
    vehicles[drop] = { orientation, length, cross };
    next[drop] = start;
    return { board: { vehicles }, solved: next };
  }

  return null;
}

/**
 * Picks the starting position, by depth.
 *
 * The layer at exactly the depth asked for is taken when the component has one,
 * so a successful climb hits the difficulty band exactly rather than landing
 * near it. Ties break upwards, for the reason `shared/difficulty.ts` makes its
 * band lopsided: the generator has to choose something, and "harder than asked"
 * is the right way for it to be wrong.
 *
 * Among the positions at that depth, one that still has the exit blocked is
 * preferred. Anything at depth two or more is obstructed in some real sense,
 * but a park whose opening move is simply "drive out" reads as a mistake
 * whatever the move count says.
 */
function pickStart(
  board: Board,
  analysis: Analysis,
  wanted: number,
  rng: Rng,
): { start: number[]; moves: number } | null {
  let best = -1;
  for (let depth = 1; depth < analysis.byDistance.length; depth++) {
    if ((analysis.byDistance[depth] as string[]).length === 0) continue;
    if (best < 0 || Math.abs(depth - wanted) <= Math.abs(best - wanted)) best = depth;
  }
  if (best < 0) return null;

  const layer = analysis.byDistance[best] as string[];
  const candidates = layer.length > 200 ? rng.shuffle(layer.slice()).slice(0, 200) : layer;

  let fallback: number[] | null = null;
  for (const key of candidates) {
    const position = decode(key);
    if (blockersAhead(board, position).length > 0) return { start: position, moves: best };
    fallback ??= position;
  }

  return fallback ? { start: fallback, moves: best } : null;
}

/**
 * Deterministic for a given (profileSeed, level), so a save stores a list of
 * slides rather than a board, and a reported bug reproduces exactly.
 */
export function generateLevel(profileSeed: string, level: number): GeneratedLevel {
  const pressureRng = createRng(hashSeed(profileSeed, 'gridlock', 'pressure', level));
  const pressure = pressureForLevel(level, pressureRng);

  // Aimed at the middle of the band rather than at its lower edge, so that a
  // successful climb lands inside it with room on both sides.
  const wanted = Math.max(1, Math.round(movesForScore((pressure.band[0] + pressure.band[1]) / 2)));

  const rng = createRng(hashSeed(profileSeed, 'gridlock', level));
  const shape = shapeFor(pressure, rng);

  let best: { layout: Layout; analysis: Analysis } | null = null;
  let sweeps = 0;
  let rounds = 0;

  // Rounds of climbing, each from its own seed layout, until one of them
  // reaches the depth the curve asked for. Ties are accepted within a round so
  // a climb can drift sideways off a plateau rather than stopping on the first
  // local maximum; a round that stops improving altogether is abandoned.
  while (
    sweeps < MAX_SWEEPS &&
    rounds < MAX_ROUNDS &&
    (best === null || best.analysis.depth < wanted)
  ) {
    rounds++;

    const seeded = buildSolvedLayout(shape, rng);
    if (!seeded) continue;
    if (!isWellFormed(seeded.board) || !isValidPosition(seeded.board, seeded.solved)) continue;

    let current = seeded;
    let reached = analyse(current.board, current.solved, STATE_CAP);
    sweeps++;
    if (!reached) continue;
    if (!best || reached.depth > best.analysis.depth) best = { layout: current, analysis: reached };

    let stall = 0;
    while (sweeps < MAX_SWEEPS && reached.depth < wanted && stall < STALL_LIMIT) {
      const candidate = mutateLayout(shape, current, rng);
      if (!candidate) {
        stall++;
        continue;
      }

      const analysis = analyse(candidate.board, candidate.solved, STATE_CAP);
      sweeps++;
      if (!analysis) {
        stall++;
        continue;
      }

      stall = analysis.depth > reached.depth ? 0 : stall + 1;
      if (analysis.depth >= reached.depth) {
        current = candidate;
        reached = analysis;
      }
      if (analysis.depth > best.analysis.depth) best = { layout: current, analysis };
    }
  }

  if (!best) throw new Error(`Unable to generate a Gridlock level ${level}`);

  const picked = pickStart(best.layout.board, best.analysis, wanted, rng);
  if (!picked) throw new Error(`Gridlock level ${level} produced no playable position`);

  return {
    level,
    board: best.layout.board,
    start: picked.start,
    shape,
    moves: picked.moves,
    difficulty: scoreDifficulty(picked.moves),
    attempts: sweeps,
    states: best.analysis.size,
  };
}
