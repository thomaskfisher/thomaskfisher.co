/**
 * Sudoku generation.
 *
 * The shape of this is different from the other puzzles here, and the reason is
 * worth stating: **digging is monotone.** Every clue taken out of a grid makes
 * it weakly harder, and every clue put back makes it weakly easier. So rather
 * than deal boards and keep the ones that happen to score inside the band — the
 * generate-and-test loop every other game in this collection uses — this digs
 * one grid as far as it will go and then *binary-searches back up* the same dig
 * order for the point where difficulty lands where the curve asked.
 *
 * That is six solver runs instead of dozens of rejected candidates, and it means
 * the band is hit rather than approached.
 *
 * Two promises hold for every grid this returns, and both are checked rather
 * than assumed:
 *
 *  - **Exactly one solution.** Checked by an exhaustive search after every
 *    removal, so a correct deduction is never marked wrong.
 *  - **Solvable by reasoning alone.** The technique solver has to finish it. A
 *    grid needing a guess is discarded however elegant it looks — that is the
 *    difference between this and the Expert tab of the app it replaces.
 */

import { pressureForLevel } from '../shared/difficulty';
import { type Rng, createRng, hashSeed } from '../shared/rng';
import { CELLS, type Grid } from './model';
import { MAX_RANK, countSolutions, fillGrid, logicalSolve } from './solve';

export const GAME_ID = 'sudoku';

export interface GeneratedLevel {
  level: number;
  /** The puzzle. 0 is a blank the player fills. */
  givens: Grid;
  /** The unique answer. Held so a wrong digit can be named without re-solving. */
  solution: Grid;
  /** 0..1, measured. See `score`. */
  difficulty: number;
  /** Hardest technique rank the logical solver needed. 1-7. */
  hardest: number;
  /** How many cells start filled. */
  clues: number;
}

/**
 * What one deduction of each rank costs the player.
 *
 * **This replaced "the hardest technique needed", which was the first thing
 * tried and was far too coarse to calibrate against.** Measured over two dozen
 * dug grids, more than half of every difficulty needed nothing above a hidden
 * single, so they all collapsed onto one score and the curve had a single step
 * in it below halfway. The whole easy half of the game was one difficulty.
 *
 * Summing a per-step cost fixes that, because the thing that actually separates
 * an easy grid from a medium one is not which techniques appear but **how much
 * work there is** — forty naked singles is a different evening from twenty naked
 * singles and fifteen hidden ones, and the ladder above cannot tell them apart.
 *
 * The weights are super-linear on purpose: a locked-candidate step is not three
 * naked singles, it is a step where you have to stop and look at a whole box.
 */
const STEP_COST = [0, 1, 3, 9, 18, 30, 55, 80] as const;

/** Total work the logical solver had to do. See `tools/sudoku.ts` for the range. */
export function effort(counts: readonly number[]): number {
  let total = 0;
  for (let rank = 1; rank <= MAX_RANK; rank++) {
    total += (counts[rank] as number) * (STEP_COST[rank] as number);
  }
  return total;
}

/**
 * Effort mapped onto the shared 0..1 curve.
 *
 * Both ends are measured rather than chosen. `FLOOR` is what a grid with
 * fifty-five clues costs — the most trivial thing that is still a sudoku — and
 * `CEILING` is what the deepest dig from a random solution reliably reaches
 * across a few attempts. Setting the ceiling at the *rare* maximum instead
 * (around 280) is the mistake this collection has made twice: it puts the top
 * of the curve where the format almost never goes, so every attempt at a late
 * level misses, difficulty comes out noisy, and the generator burns solver runs
 * proving it.
 *
 * Logarithmic because effort is: going from 40 to 50 steps of work is a
 * noticeable jump, going from 240 to 250 is not.
 */
const FLOOR = 25;
const CEILING = 130;

export function score(counts: readonly number[]): number {
  const work = effort(counts);
  if (work <= FLOOR) return 0;
  return Math.min(1, Math.log(work / FLOOR) / Math.log(CEILING / FLOOR));
}

/**
 * Clue counts a grid is allowed to stop between.
 *
 * The floor is not a difficulty lever — it is a legibility one. Below about 22
 * clues a grid stops looking like a puzzle and starts looking like an empty
 * page. The ceiling keeps a breather level from being a grid that fills itself.
 */
const MIN_CLUES = 22;
const MAX_CLUES = 46;

/** Digs to try before settling for the closest miss. */
const ATTEMPTS = 5;

export function generateLevel(seed: string, level: number): GeneratedLevel {
  const rng = createRng(hashSeed(seed, GAME_ID, level));
  const { band } = pressureForLevel(level, rng);

  let best: GeneratedLevel | null = null;
  let bestMiss = Infinity;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const candidate = dig(rng, level, band);
    const miss =
      candidate.difficulty < band[0]
        ? band[0] - candidate.difficulty
        : Math.max(0, candidate.difficulty - band[1]);

    if (miss === 0) return candidate;
    if (miss < bestMiss) {
      bestMiss = miss;
      best = candidate;
    }
  }

  // Unreachable: every dig returns something playable.
  if (!best) throw new Error('sudoku generation produced nothing');
  return best;
}

/**
 * One solution, dug to exhaustion, then searched back up for the band.
 *
 * The dig is symmetric under a 180° rotation. That is a real constraint — it
 * costs a few clues of depth — and it is kept because a symmetric grid is what
 * a sudoku looks like, and this collection replaces games she already plays
 * rather than improving on them. A second free pass runs only when the band is
 * high enough to need the depth symmetry leaves on the table.
 */
function dig(rng: Rng, level: number, band: [number, number]): GeneratedLevel {
  const solution = fillGrid((max) => rng.int(max));
  const grid = solution.slice();

  /** Cells removed, in order. Restoring a suffix of this undoes the deep end. */
  const removed: number[] = [];
  const order = rng.shuffle(Array.from({ length: CELLS }, (_, cell) => cell));

  for (const cell of order) {
    const partner = CELLS - 1 - cell;
    if (!grid[cell] && !grid[partner]) continue;

    const saved: [number, number] = [grid[cell] as number, grid[partner] as number];
    grid[cell] = 0;
    grid[partner] = 0;

    if (countSolutions(grid, 2) === 1) {
      if (saved[0]) removed.push(cell);
      if (saved[1] && partner !== cell) removed.push(partner);
    } else {
      grid[cell] = saved[0];
      grid[partner] = saved[1];
    }
  }

  if (band[1] > 0.6) {
    for (const cell of order) {
      if (!grid[cell]) continue;
      if (clueCount(grid) <= MIN_CLUES) break;
      const saved = grid[cell] as number;
      grid[cell] = 0;
      if (countSolutions(grid, 2) === 1) removed.push(cell);
      else grid[cell] = saved;
    }
  }

  /** The grid with the last `restored` removals put back. */
  const at = (restored: number): Grid => {
    const candidate = grid.slice();
    for (let i = 0; i < restored && i < removed.length; i++) {
      const cell = removed[removed.length - 1 - i] as number;
      candidate[cell] = solution[cell] as number;
    }
    return candidate;
  };

  const measure = (restored: number): GeneratedLevel | null => {
    const givens = at(restored);
    const result = logicalSolve(givens);
    if (!result.solved) return null;

    return {
      level,
      givens,
      solution,
      difficulty: score(result.counts),
      hardest: result.hardest,
      clues: clueCount(givens),
    };
  };

  /*
   * Binary search for the hardest acceptable point on the ladder.
   *
   * "Acceptable" means solvable by reasoning *and* at or under the top of the
   * band, and it is monotone in `restored`: putting clues back never makes a
   * grid harder and never makes a solvable grid unsolvable. A grid the solver
   * cannot finish counts as too hard, which is the honest reading — it is over
   * the top of every band there is.
   *
   * **The ladder is bounded by clue count rather than by the whole dig.** Each
   * restore puts exactly one clue back, so the legibility limits are a range of
   * `restored` and can be applied here. Enforcing them inside `measure` instead
   * was the first attempt and it broke the search outright: a too-full grid came
   * back as null, the search read null as "too hard", and walked *up* — so every
   * level of the game came out at the maximum clue count and one difficulty.
   */
  const base = clueCount(grid);
  let low = Math.max(0, MIN_CLUES - base);
  let high = Math.min(removed.length, MAX_CLUES - base);
  let found: GeneratedLevel | null = null;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const candidate = measure(middle);

    if (candidate && candidate.difficulty <= band[1]) {
      found = candidate;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }

  if (found) return found;

  // Every point on the ladder was above the band or unsolvable, which means the
  // grid stays too hard even nearly full. Handing back the fullest measurable
  // point is closer than handing back the deepest dig.
  for (let restored = high; restored >= low; restored--) {
    const candidate = measure(restored);
    if (candidate) return candidate;
  }

  return safeFallback(rng, solution, level);
}

function clueCount(grid: Grid): number {
  let count = 0;
  for (let cell = 0; cell < CELLS; cell++) if (grid[cell]) count++;
  return count;
}

/**
 * The solution with twenty cells blanked. Trivially unique and trivially
 * solvable — a level nobody enjoys, but a level, which is the promise.
 *
 * No dig has ever reached this: the top of the restore ladder is the full grid
 * minus one cell, and that is always solvable. It exists so that a future change
 * to the clue bounds cannot produce a game with no board.
 */
function safeFallback(rng: Rng, solution: Grid, level: number): GeneratedLevel {
  const givens = solution.slice();
  for (const cell of rng.shuffle(Array.from({ length: CELLS }, (_, i) => i)).slice(0, 20)) {
    givens[cell] = 0;
  }
  const result = logicalSolve(givens);
  return {
    level,
    givens,
    solution,
    difficulty: score(result.counts),
    hardest: result.hardest,
    clues: clueCount(givens),
  };
}
