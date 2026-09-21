/**
 * Battleship generation.
 *
 * The answer comes first: a fleet is dropped at random onto an empty sea,
 * obeying the no-touching rule, and the row and column counts are read off it.
 * Counts alone rarely pin a fleet down, so squares of the answer are then
 * handed over as givens — each one chosen from where the solver stalled, so it
 * is a square that genuinely unlocks something — until deduction finishes the
 * board. Then the givens are pruned back: any the solver can do without is
 * taken away again, down to as few as the level's pressure asks for.
 *
 * Two promises hold for every level this returns:
 *
 *  - **Finished by deduction, with no guessing.** See `solve.ts`.
 *  - **Exactly one answer**, which comes free with the above.
 */

import { pressureForLevel } from '../shared/difficulty';
import { type Rng, createRng, hashSeed } from '../shared/rng';
import {
  type Given,
  type Layout,
  type Puzzle,
  countsOf,
  emptyBoard,
  isLegalLayout,
  segmentOf,
} from './model';
import { type Rule, placementsFor, solve } from './solve';

export const GAME_ID = 'battleship';

export interface GeneratedLevel {
  level: number;
  puzzle: Puzzle;
  /** The answer. Held so a wrong square can be named without re-solving. */
  layout: Layout;
  /** 0..1, measured. See `score`. */
  difficulty: number;
  /** Solver work per blank square it had to decide. */
  depth: number;
  /** Mean non-trivial deductions on offer at each step. See `optionsAt`. */
  openness: number;
  /** Share of steps with exactly one deduction on offer. */
  narrow: number;
  /** Ship squares in the fleet. */
  shipSquares: number;
  uses: Record<Rule, number>;
}

/* ------------------------------------------------------------------ */
/* Size and fleet                                                      */
/* ------------------------------------------------------------------ */

/**
 * Six to ten. Ten is the classic board and it is also a phone: ten squares
 * plus a count gutter across a portrait screen is about as small as a square
 * gets and stays easy to hit.
 */
export const MIN_SIZE = 6;
export const MAX_SIZE = 10;

/**
 * The fleet for each size — the standard sets, scaled so ships cover a little
 * under a third of the sea. Denser than that and the no-touching rule does all
 * the work; sparser and the counts are mostly zeros.
 */
export const FLEETS: Record<number, number[]> = {
  6: [3, 2, 2, 1, 1, 1],
  7: [4, 3, 2, 2, 1, 1, 1],
  8: [4, 3, 3, 2, 2, 2, 1, 1, 1],
  9: [4, 3, 3, 2, 2, 2, 1, 1, 1, 1],
  10: [4, 3, 3, 2, 2, 2, 1, 1, 1, 1],
};

/**
 * Grows more slowly than the pressure does, so the first few levels are all
 * on the small sea: level 1 is a 6x6, level 10 an 8x8, and the full 10x10
 * arrives in the thirties.
 */
export function sizeForPressure(pressure: number): number {
  const span = MAX_SIZE - MIN_SIZE;
  const grown = Math.round(Math.pow(Math.min(1, Math.max(0, pressure)), 1.5) * span);
  return Math.min(MAX_SIZE, MIN_SIZE + grown);
}

/* ------------------------------------------------------------------ */
/* Difficulty                                                          */
/* ------------------------------------------------------------------ */

/**
 * The measured ends of the openness range, from `tools/battleship.ts`. A board
 * pruned to the bone averages 4.5 deductions on offer per step at every size,
 * across 2.5 to 7.5; spare givens push it past 8. The floor sits above the
 * lowest boards measured, not at them, so that the top of the band is reached
 * by a typical hard board rather than only by a freak one — at 3.0 the 10x10s
 * topped out at 0.84 against a band starting at 0.85.
 */
const OPEN_FLOOR = 3.2;
const OPEN_CEILING = 7;

/**
 * Difficulty from the size of the sea, how narrow the way through it is, and
 * how often it needed a whole-board sweep.
 *
 * Openness is inverted: fewer deductions on offer is harder. Size carries a
 * smaller share because it mostly makes a level longer; narrowness is what
 * makes one hard. The sweeps — a square no ship can reach, the last ship of a
 * length — are the two rules a person finds late, so a level that leans on
 * them scores higher and the early levels are steered towards ones that do
 * not.
 */
export function score(size: number, openness: number, sweeps: number): number {
  const sizePart = (size - MIN_SIZE) / (MAX_SIZE - MIN_SIZE);
  const tightPart = Math.min(
    1,
    Math.max(0, (OPEN_CEILING - openness) / (OPEN_CEILING - OPEN_FLOOR)),
  );
  const sweepPart = Math.min(1, sweeps / 2);
  return Math.min(1, Math.max(0, 0.35 * sizePart + 0.45 * tightPart + 0.2 * sweepPart));
}

/* ------------------------------------------------------------------ */
/* Layouts                                                             */
/* ------------------------------------------------------------------ */

/**
 * A random legal fleet, longest ship first. Backtracks on a dead end rather
 * than restarting, and gives up (null) only after a generous budget — which a
 * fleet this sparse never needs.
 */
export function placeFleet(rng: Rng, size: number, fleet: readonly number[]): Layout | null {
  const lengths = fleet.slice().sort((a, b) => b - a);
  const layout: Layout = new Array<boolean>(size * size).fill(false);
  let budget = 5000;

  const place = (index: number): boolean => {
    if (index === lengths.length) return true;
    if (--budget <= 0) return false;
    const options = rng.shuffle(placementsFor(size, lengths[index] as number).slice());
    for (const p of options) {
      if (p.cells.some((c) => layout[c])) continue;
      if (p.ring.some((c) => layout[c])) continue;
      for (const c of p.cells) layout[c] = true;
      if (place(index + 1)) return true;
      for (const c of p.cells) layout[c] = false;
      if (budget <= 0) return false;
    }
    return false;
  };

  return place(0) ? layout : null;
}

function givenFor(layout: Layout, size: number, cell: number): Given {
  return { cell, kind: layout[cell] ? segmentOf(layout, size, cell) : 'water' };
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

/** Layouts to try before handing back the closest miss. */
const ATTEMPTS = 24;

export function generateLevel(seed: string, level: number): GeneratedLevel {
  const rng = createRng(hashSeed(seed, GAME_ID, level));
  const { pressure, band } = pressureForLevel(level, rng);
  const size = sizeForPressure(pressure);

  let best: GeneratedLevel | null = null;
  let bestMiss = Infinity;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    // Spare ship pieces on the easy levels, on top of the minimum. The
    // attempts wobble one either side of the target so that a layout that
    // came out too hard or too easy has a neighbour to fall back on.
    const target = Math.max(0, Math.round((0.55 - pressure) * size));
    const spare = Math.max(0, target + ((attempt % 3) - 1));
    const candidate = build(rng, level, size, spare);
    if (!candidate) continue;

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

  if (best) return best;
  throw new Error(`No battleship level could be built for level ${level}`);
}

/**
 * One level on a fresh layout, or null if the layout would not place.
 *
 * The givens are pruned to the bone and then `spare` ship pieces are handed
 * back. Spares are how the easy levels are easy: every one opens more ways in,
 * and pruning only part of the way was tried first and barely moved anything —
 * a fully pruned board has two or three givens, so "keep half" kept one.
 */
export function build(rng: Rng, level: number, size: number, spare: number): GeneratedLevel | null {
  const fleet = FLEETS[size] as number[];
  const layout = placeFleet(rng, size, fleet);
  if (!layout) return null;

  const counts = countsOf(layout, size);
  const puzzle: Puzzle = {
    size,
    fleet: fleet.slice(),
    rowCounts: counts.rows,
    colCounts: counts.cols,
    givens: [],
  };

  // Add givens where the solver stalls until it finishes.
  for (let guard = 0; guard < size * size; guard++) {
    const result = solve(puzzle);
    if (result.solved) break;
    const blanks: number[] = [];
    for (let cell = 0; cell < result.board.length; cell++) {
      if (result.board[cell] === 0) blanks.push(cell);
    }
    if (blanks.length === 0) return null;
    // A ship square says far more than a water one, so it is preferred — but
    // not always, or every level opens on the same half-built ships.
    const ships = blanks.filter((cell) => layout[cell]);
    const pool = ships.length > 0 && rng.chance(0.7) ? ships : blanks;
    puzzle.givens.push(givenFor(layout, size, rng.pick(pool)));
  }
  if (!solve(puzzle).solved) return null;

  // Prune: try taking each given away, in random order.
  for (const given of rng.shuffle(puzzle.givens.slice())) {
    const without = puzzle.givens.filter((g) => g !== given);
    if (solve({ ...puzzle, givens: without }).solved) puzzle.givens = without;
  }

  // Then hand back the spares, from ship squares not already shown.
  const shown = new Set(puzzle.givens.map((given) => given.cell));
  const hidden: number[] = [];
  for (let cell = 0; cell < layout.length; cell++) if (layout[cell] && !shown.has(cell)) hidden.push(cell);
  for (const cell of rng.shuffle(hidden).slice(0, spare)) {
    puzzle.givens.push(givenFor(layout, size, cell));
  }

  puzzle.givens.sort((a, b) => a.cell - b.cell);
  const result = solve(puzzle, undefined, true);
  if (!result.solved) return null;
  const openness =
    result.options.reduce((sum, n) => sum + n, 0) / Math.max(1, result.options.length);
  const narrow =
    result.options.filter((n) => n <= 1).length / Math.max(1, result.options.length);

  const blanks = emptyBoard(puzzle).filter((mark) => mark === 0).length;
  const depth = result.work / Math.max(1, blanks);
  if (!isLegalLayout(layout, size, fleet)) return null;

  return {
    level,
    puzzle,
    layout,
    difficulty: score(size, openness, result.uses.reach + result.uses.last),
    depth,
    openness,
    narrow,
    shipSquares: fleet.reduce((sum, length) => sum + length, 0),
    uses: result.uses,
  };
}
