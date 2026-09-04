/**
 * Level generation for Survival.
 *
 * Boards are built **forward, against the solver's own arithmetic**. Dealing
 * random gate values and hoping does not work here for a reason specific to
 * this game: values compound. A row of `x4` gates early is worth an order of
 * magnitude more than the same row late, so a board scattered with absolute
 * numbers is either a walkover or a wall, and which one is decided by accident.
 *
 * So the generator walks up the board carrying the same best-count-per-lane
 * vector the solver carries, and scales every gate it writes to the magnitude
 * actually reachable at that row. A `+300` appears where 300 soldiers is a
 * meaningful gift and nowhere else. That is also the answer to the one real
 * objection to letting the numbers inflate: an additive gate that stayed small
 * while the total grew would stop being a decision by the third row.
 *
 * Solvability then comes for free, in two halves:
 *
 *  - every row is checked to leave at least one lane alive, and repaired if it
 *    does not, so some route always reaches the top;
 *  - the horde is chosen *after* the grid, at a fraction of the best finish the
 *    solver reports, so a winning line provably exists.
 *
 * The solver is still run before a board ships. At that point it is a proof
 * rather than a filter, which is exactly the position we want to be in.
 */

import { type LevelPressure, pressureForLevel } from '../shared/difficulty';
import { type Rng, createRng, hashSeed } from '../shared/rng';
import { type Board, DEAD, type Node, applyNode, isWellFormed, nodeAt } from './model';
import { isWinnable, maxFinal } from './solve';

/**
 * Above this magnitude the generator stops emitting multipliers.
 *
 * Inflation is deliberate — a squad of eight becoming a squad of nine thousand
 * is the fantasy — but a gate label has to fit a phone lane, and a seven-digit
 * subtraction stops being arithmetic anyone does in their head. This lets the
 * numbers climb hard for the first several rows and then plateau, rather than
 * being clamped at the end where the clamp would be visible.
 */
const MULTIPLIER_CEILING = 250_000;

const MAX_ATTEMPTS = 60;

/**
 * Boards that finish below this are rejected.
 *
 * Punishing rows are priced as a fraction of the count arriving at them, so
 * they compound downwards exactly as multipliers compound upwards. Left alone,
 * a nine-row board with three barriers and two hostile rows lands the player on
 * eight soldiers against a horde of seven — arithmetically a fine puzzle, and
 * completely the wrong feeling. The row budget below is the real fix; this is
 * the backstop that catches whatever slips past it.
 */
const MIN_FINISH = 40;

/**
 * How many complete routes may be walked before the horde is placed by sampling
 * instead of by exact enumeration. Nine rows of at most three onward lanes is
 * about 33k routes, so the exact path is what actually runs; the cap exists so
 * that widening `reach` later degrades the answer rather than the frame rate.
 */
const ROUTE_ENUMERATION_CAP = 400_000;
const ROUTE_SAMPLE_SIZE = 4000;

export type RowKind = 'mixed' | 'hostile' | 'barrier';

export interface LevelShape {
  lanes: number;
  rows: number;
  /** Lanes the squad may shift between rows. The constrained-choice lever. */
  reach: number;
  startCount: number;
  /** Rows that are solid barriers — hard checkpoints part-way up. */
  barrierRows: number;
  /** Rows on which every gate takes something away. */
  hostileRows: number;
  /** Share of friendly gates that multiply rather than add. */
  mulShare: number;
  /** Share of cells on an ordinary row that take something away. */
  hostileShare: number;
  /**
   * Share of all possible routes that should get through, which is what the
   * horde is placed to produce. The sharpest lever on the board, and the one
   * that costs nothing in magnitude.
   */
  winTarget: number;
}

export interface GeneratedLevel {
  level: number;
  board: Board;
  shape: LevelShape;
  /** 0..1, measured from naive playthroughs. */
  difficulty: number;
  attempts: number;
  /** Best finish the solver can reach. Diagnostic only — never shown. */
  best: number;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const clampInt = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Math.round(n)));

/* ------------------------------------------------------------------ shape */

export function shapeFor(pressure: LevelPressure, rng: Rng): LevelShape {
  const p = pressure.pressure;

  // Board size is capped at what a portrait phone can show without scrolling.
  // Past that, difficulty has to come from the measured signal rather than from
  // more board — the same ceiling the other three games ran into.
  const lanes = clampInt(4 + p * 2, 4, 6);
  const rows = clampInt(6 + p * 5, 6, 11);

  // **Reach is 1 everywhere, including level 1.** Reach 2 meant every lane was
  // always available, so there was no route to plan and the opening levels were
  // a pure arithmetic warm-up: read the row, take the biggest number, repeat.
  // One lane of movement per row is what makes the board a corridor you commit
  // to five rows in advance, and that is the game. There is no version of this
  // worth playing where you can cross the board in a single step.
  const reach = 1;

  const startCount = clampInt(5 + p * 13 + rng.next() * 4, 4, 22);

  // Barriers and hostile rows are the two strongest structural levers, and they
  // are also the two that shrink the army. Spending more than about two rows in
  // five on them makes the board net-deflationary: the count that took six rows
  // to build is gone in three, and the finale is a skirmish rather than a war.
  // They share one budget so the sum can never get there, and `margin` — which
  // costs no magnitude at all — carries the difficulty past where they stop.
  const punishBudget = Math.floor(rows * 0.5);
  const barrierRows = clampInt(0.4 + p * 2.6, 0, Math.min(3, punishBudget));
  const hostileRows = clampInt(0.3 + p * 2.4, 0, Math.max(0, Math.min(3, punishBudget - barrierRows)));

  // Multipliers are what make order matter: x3 then +50 and +50 then x3 differ,
  // so a board with none of them rewards taking the biggest number in sight and
  // a board with too many rewards only ever taking the multiplier.
  const mulShare = clamp(0.28 + p * 0.34, 0, 0.62);
  // Opens at 0.26 rather than 0.09. A row where one cell in eleven hurts is a
  // row you can take without reading it.
  const hostileShare = clamp(0.18 + p * 0.34, 0, 0.52);

  // Difficulty here is "how many ways are there to win", set directly rather
  // than inferred from a fraction of the best possible finish. Deriving it the
  // other way put deep levels at four winning routes out of fourteen hundred —
  // arithmetically a puzzle, in practice a lottery, and no amount of lookahead
  // makes a needle findable. Three percent of a thousand routes is thirty ways
  // through, which is a board worth tracing.
  //
  // The opening value matters as much as the closing one: at 0.55, more than
  // half of all routes won, so a level-1 board was cleared by walking upwards
  // without reading it.
  const winTarget = clamp(0.3 - p * 0.27, 0.03, 0.3);

  return {
    lanes,
    rows,
    reach,
    startCount,
    barrierRows,
    hostileRows,
    mulShare,
    hostileShare,
    winTarget,
  };
}

/* ------------------------------------------------------------- assembly */

/**
 * Best count the squad could be carrying in each lane on entering the next row.
 *
 * Deliberately the same sweep `solve.ts` performs. The generator has to price
 * gates against what is actually reachable at that point, and "reachable" means
 * exactly what the solver means by it — the two drifting apart is how a
 * generator ends up calibrated against a game nobody is playing.
 */
function incomingValues(values: readonly number[], lanes: number, reach: number): number[] {
  const incoming = new Array<number>(lanes).fill(DEAD);
  for (let lane = 0; lane < lanes; lane++) {
    let best = DEAD;
    const lo = Math.max(0, lane - reach);
    const hi = Math.min(lanes - 1, lane + reach);
    for (let from = lo; from <= hi; from++) best = Math.max(best, values[from] as number);
    incoming[lane] = best;
  }
  return incoming;
}

/**
 * The finishing count of every route on the board, dead ones included as zero.
 *
 * Exact whenever the tree is small enough to walk, which for every shape this
 * generator produces it is. The sampled fallback keeps a future wider `reach`
 * from turning this into a hang; the horde clamp downstream is what keeps the
 * solvability guarantee true either way.
 */
function routeFinals(board: Board, rng: Rng): number[] {
  const finals: number[] = [];
  let overflowed = false;

  const walk = (row: number, lane: number, count: number): void => {
    if (overflowed) return;
    if (finals.length >= ROUTE_ENUMERATION_CAP) {
      overflowed = true;
      return;
    }
    if (count <= DEAD) {
      finals.push(DEAD);
      return;
    }
    if (row === board.rows) {
      finals.push(count);
      return;
    }
    const lo = lane < 0 ? 0 : Math.max(0, lane - board.reach);
    const hi = lane < 0 ? board.lanes - 1 : Math.min(board.lanes - 1, lane + board.reach);
    for (let next = lo; next <= hi; next++) {
      walk(row + 1, next, applyNode(nodeAt(board, row, next), count));
    }
  };

  walk(0, -1, board.startCount);
  if (!overflowed) return finals;

  const sampled: number[] = [];
  for (let i = 0; i < ROUTE_SAMPLE_SIZE; i++) {
    let count = board.startCount;
    let lane = -1;
    for (let row = 0; row < board.rows; row++) {
      const lo = lane < 0 ? 0 : Math.max(0, lane - board.reach);
      const hi = lane < 0 ? board.lanes - 1 : Math.min(board.lanes - 1, lane + board.reach);
      lane = lo + rng.int(hi - lo + 1);
      count = applyNode(nodeAt(board, row, lane), count);
      if (count <= DEAD) break;
    }
    sampled.push(Math.max(DEAD, count));
  }
  return sampled;
}

/**
 * Where the barrier and all-hostile rows sit.
 *
 * Row 0 stays ordinary — opening on a barrier is a coin flip on a count the
 * player has had no chance to grow yet — and punishing rows are spread apart
 * where the board allows it. Two checkpoints back to back leave nothing in
 * between to rebuild on, so the second is decided by the first rather than
 * played, and a row nobody gets to make a decision on is a wasted row.
 */
function planRowKinds(shape: LevelShape, rng: Rng): RowKind[] {
  const kinds = new Array<RowKind>(shape.rows).fill('mixed');
  const pool = rng.shuffle(Array.from({ length: shape.rows - 1 }, (_, i) => i + 1));

  const place = (kind: RowKind): boolean => {
    const spaced = pool.findIndex(
      (row) => kinds[row - 1] === 'mixed' && (kinds[row + 1] ?? 'mixed') === 'mixed',
    );
    // Fall back to any free row rather than dropping the lever entirely: on a
    // short board there may be nowhere with a clear neighbour on both sides.
    const index = spaced >= 0 ? spaced : 0;
    const row = pool.splice(index, 1)[0];
    if (row === undefined) return false;
    kinds[row] = kind;
    return true;
  };

  for (let i = 0; i < shape.barrierRows; i++) if (!place('barrier')) break;
  for (let i = 0; i < shape.hostileRows; i++) if (!place('hostile')) break;

  return kinds;
}

/** A gate that takes something away, priced against the row's magnitude. */
function hostileNode(rng: Rng, reference: number): Node {
  // Division needs room to divide: halving three soldiers is a death sentence
  // dressed as a small penalty, which reads as unfair rather than as hard.
  if (reference >= 8 && rng.chance(0.5)) {
    return { kind: 'gate', op: 'div', value: rng.chance(0.72) ? 2 : 3 };
  }
  const value = clampInt(reference * (0.18 + rng.next() * 0.42), 1, Math.max(1, reference - 1));
  return { kind: 'gate', op: 'sub', value };
}

function friendlyNode(rng: Rng, reference: number, allowMultiply: boolean): Node {
  if (allowMultiply && rng.chance(0.5)) {
    // Weighted low: a board of x4s inflates past readable in four rows, and a
    // x4 next to a x2 is a far more interesting choice than x4 next to x3.
    const roll = rng.next();
    return { kind: 'gate', op: 'mul', value: roll < 0.56 ? 2 : roll < 0.88 ? 3 : 4 };
  }
  // Deliberately *narrow*. An add is priced against the best count arriving at
  // this row, so it is still worth more to a lane carrying less than that —
  // which is what makes the same row a different decision depending on where
  // you are standing, and what stops "always take the multiplier" from being a
  // strategy.
  //
  // The spread used to be 0.3x to 2.0x, and that width was the single biggest
  // reason the game read as easy: on a row holding +15, +22 and +2,759, there
  // is no decision to make. Every gate is now within a factor of about two and
  // a half of every other, so telling them apart means carrying the arithmetic
  // forward a row or two rather than scanning for the big number.
  const value = clampInt(reference * (0.45 + rng.next() * 0.75), 1, Number.MAX_SAFE_INTEGER);
  return { kind: 'gate', op: 'add', value };
}

function buildRow(
  rng: Rng,
  shape: LevelShape,
  kind: RowKind,
  reference: number,
  allowMultiply: boolean,
): Node[] {
  const row: Node[] = [];

  for (let lane = 0; lane < shape.lanes; lane++) {
    if (kind === 'barrier') {
      // Capped one below the best count arriving at this row, so the row is
      // always passable from *somewhere*. Lanes carrying less than the best
      // still die on it, which is the entire point of a checkpoint.
      // Spread wide on purpose. A barrier row where every lane costs the same
      // is a row with no decision in it — it subtracts and moves on. What makes
      // a checkpoint a checkpoint is that the cheap way through is somewhere
      // specific, and you have to have routed yourself towards it.
      const hp = clampInt(
        reference * (0.22 + rng.next() * 0.56),
        1,
        Math.max(1, reference - 1),
      );
      row.push({ kind: 'barrier', hp });
      continue;
    }

    if (kind === 'hostile') {
      row.push(hostileNode(rng, reference));
      continue;
    }

    row.push(
      rng.chance(shape.hostileShare)
        ? hostileNode(rng, reference)
        : friendlyNode(rng, reference, allowMultiply && rng.chance(shape.mulShare / 0.5)),
    );
  }

  return row;
}

/**
 * Builds the grid and picks the horde from what it turns out to allow.
 *
 * Returns null only if the arithmetic collapses to nothing, which the repair
 * step below should make impossible — it is kept as a guard rather than as a
 * path anything is expected to take.
 */
export function buildBoard(shape: LevelShape, rng: Rng): { board: Board; best: number } | null {
  const kinds = planRowKinds(shape, rng);
  const nodes: Node[] = [];

  let values = new Array<number>(shape.lanes).fill(shape.startCount);

  for (let row = 0; row < shape.rows; row++) {
    // Row 0 is entered from off the board, so every lane is available for it.
    const reach = row === 0 ? shape.lanes : shape.reach;
    const incoming = incomingValues(values, shape.lanes, reach);

    const reference = Math.max(...incoming);
    if (reference <= DEAD) return null;

    const kind = kinds[row] as RowKind;
    const built = buildRow(rng, shape, kind, reference, reference < MULTIPLIER_CEILING);

    let next = built.map((node, lane) => applyNode(node, incoming[lane] as number));

    // Repair: no row may wipe out every lane. The lane carrying the most
    // soldiers is the one made safe, so the surviving line is also the strong
    // one — surviving is not the same as beating the horde, and the margin
    // below is what decides whether surviving is enough.
    if (!next.some((value) => value > DEAD)) {
      const safeLane = incoming.indexOf(reference);
      built[safeLane] = {
        kind: 'gate',
        op: 'add',
        value: Math.max(1, Math.round(reference * 0.5)),
      };
      next = built.map((node, lane) => applyNode(node, incoming[lane] as number));
    }

    nodes.push(...built);
    values = next;
  }

  const skeleton: Board = {
    lanes: shape.lanes,
    rows: shape.rows,
    nodes,
    startCount: shape.startCount,
    reach: shape.reach,
    horde: 1,
  };

  const best = maxFinal(skeleton);
  if (best < MIN_FINISH) return null;

  // Place the horde at a percentile of what the routes on this board actually
  // finish on, so the same `winTarget` means the same thing on a board full of
  // multipliers and on a board full of barriers.
  const finals = routeFinals(skeleton, rng);
  finals.sort((a, b) => b - a);
  const wanted = clamp(Math.round(shape.winTarget * finals.length), 1, finals.length);
  const threshold = finals[wanted - 1] ?? best;

  // On a board where most routes die outright, the percentile lands on a
  // survivor count rather than on an army, and the horde comes out as "1" while
  // the best line finishes on four hundred. The board plays fine — the puzzle
  // there is not dying — but a one-soldier horde at the top of the screen reads
  // as a bug and cheapens the whole fiction. A floor keeps it looking like an
  // enemy; boards that the floor makes too hard fail the band and are retried.
  const floor = Math.max(Math.round(best * 0.12), shape.startCount * 3);
  const horde = clamp(Math.max(threshold - 1, floor), 1, best - 1);

  return { board: { ...skeleton, horde }, best };
}

/* ------------------------------------------------------------- difficulty */

/**
 * Trap rate: the fraction of naive playthroughs that fail.
 *
 * The rollout models the player this collection is built for — someone reading
 * the row in front of them and taking whichever gate leaves them biggest, with
 * a bit of wandering. It is not a search, on purpose: a board that defeats a
 * greedy reader is exactly a board where looking further ahead pays.
 *
 * Both ways the real game ends are counted, because both are how the real game
 * ends: the squad wiped out part-way up, and the squad arriving at the top
 * without enough soldiers.
 */
export function trapRate(board: Board, rng: Rng, rollouts = 40): number {
  let lost = 0;

  for (let roll = 0; roll < rollouts; roll++) {
    let count = board.startCount;
    let lane = -1;

    for (let row = 0; row < board.rows; row++) {
      const lo = lane < 0 ? 0 : Math.max(0, lane - board.reach);
      const hi = lane < 0 ? board.lanes - 1 : Math.min(board.lanes - 1, lane + board.reach);

      const options: number[] = [];
      for (let candidate = lo; candidate <= hi; candidate++) options.push(candidate);

      let choice = options[rng.int(options.length)] as number;
      if (rng.chance(0.78)) {
        // Whatever leaves the most soldiers standing right now. Myopic by
        // design — this is the reader the ordering trap is set for.
        let bestValue = -1;
        const bestLanes: number[] = [];
        for (const candidate of options) {
          const value = applyNode(nodeAt(board, row, candidate), count);
          if (value > bestValue) {
            bestValue = value;
            bestLanes.length = 0;
            bestLanes.push(candidate);
          } else if (value === bestValue) {
            bestLanes.push(candidate);
          }
        }
        choice = bestLanes[rng.int(bestLanes.length)] as number;
      }

      count = applyNode(nodeAt(board, row, choice), count);
      lane = choice;
      if (count <= DEAD) break;
    }

    if (count <= board.horde) lost++;
  }

  return lost / rollouts;
}

/**
 * Combines the measured trap rate with the board's structure.
 *
 * `reach` used to contribute here; it is 1 on every board now, so it would be a
 * constant and is gone. The remaining terms are rescaled to the ranges the
 * shape function actually produces — a structural term normalised against a
 * range nothing reaches is a term that never moves.
 */
export function scoreDifficulty(shape: LevelShape, trap: number): number {
  const trapScore = clamp(trap / 0.85, 0, 1);
  const structural = clamp(
    clamp((0.3 - shape.winTarget) / 0.27, 0, 1) * 0.44 +
      (shape.barrierRows / 3) * 0.2 +
      (shape.hostileRows / 3) * 0.14 +
      ((shape.rows - 6) / 5) * 0.12 +
      ((shape.lanes - 4) / 2) * 0.1,
    0,
    1,
  );
  return clamp(0.72 * trapScore + 0.28 * structural, 0, 1);
}

/* --------------------------------------------------------------- assembly */

/**
 * Deterministic for a given (profileSeed, level), so a save stores a list of
 * lane choices rather than a board, and a reported bug reproduces exactly.
 */
export function generateLevel(profileSeed: string, level: number): GeneratedLevel {
  const pressureRng = createRng(hashSeed(profileSeed, 'survival', 'pressure', level));
  const pressure = pressureForLevel(level, pressureRng);

  let closest: GeneratedLevel | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rng = createRng(hashSeed(profileSeed, 'survival', level, attempt));
    const shape = shapeFor(pressure, rng);

    const built = buildBoard(shape, rng);
    if (!built) continue;

    const { board, best } = built;
    if (!isWellFormed(board)) continue;

    // Proof, not filter — the construction above already guarantees this. It
    // stays because the promise the whole collection rests on is worth an
    // O(rows x lanes) sweep, and because it is what would catch a change to the
    // rules that quietly broke the guarantee.
    if (!isWinnable(board)) continue;

    const rollRng = createRng(hashSeed(profileSeed, 'survival', 'rollout', level, attempt));
    const difficulty = scoreDifficulty(shape, trapRate(board, rollRng));

    const candidate: GeneratedLevel = {
      level,
      board,
      shape,
      difficulty,
      attempts: attempt + 1,
      best,
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
  throw new Error(`Unable to generate a solvable Survival level ${level}`);
}
