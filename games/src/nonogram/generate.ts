/**
 * Nonogram generation.
 *
 * Pictures are grown rather than dealt. A grid of independent coin flips
 * produces clue lists like `1 1 1 1 2 1`, which are both ugly and unusually
 * hard — a run of one tells you almost nothing — and it produces no picture at
 * all, which is half of what makes a nonogram satisfying. So cells are seeded at
 * a density and then *smoothed*, which pulls them into blobs: fewer, longer runs,
 * and something recognisable at the end.
 *
 * Everything after that is the usual loop. Derive the clues, hand them to the
 * line solver, and throw the puzzle away unless reasoning alone finishes it.
 *
 * Two promises hold for every puzzle this returns:
 *
 *  - **Solvable one line at a time, with no guessing.** Stronger than "has one
 *    answer": a uniquely-solvable nonogram that needs a two-line contradiction
 *    to crack is fair in principle and miserable on a phone.
 *  - **Exactly one answer**, which comes free with the above — the solver only
 *    ever writes a cell that was the same in every consistent arrangement, so it
 *    cannot have ruled a second picture out.
 */

import { pressureForLevel } from '../shared/difficulty';
import { type Rng, createRng, hashSeed } from '../shared/rng';
import { type Picture, type Puzzle, cluesFor, isWellFormed, paintedCount } from './model';
import { solveByLines } from './solve';

export const GAME_ID = 'nonogram';

export interface GeneratedLevel {
  level: number;
  puzzle: Puzzle;
  /** The answer. Held so a wrong cell can be named without re-solving. */
  picture: Picture;
  /** 0..1, measured. See `score`. */
  difficulty: number;
  /** Lines the solver read per deduction — the raw signal behind `difficulty`. */
  lookahead: number;
  /** Painted cells in the finished picture. */
  painted: number;
}

/* ------------------------------------------------------------------ */
/* Size                                                                */
/* ------------------------------------------------------------------ */

/**
 * The smallest and largest grid the game uses.
 *
 * Fifteen is not a difficulty decision, it is a phone. Past fifteen the cells
 * plus the clue gutters stop fitting across a portrait screen at a size anyone
 * can tap, and a nonogram you have to scroll is one you cannot scan — which is
 * the entire activity. Difficulty past that point comes from the measured
 * signal, not from more grid.
 */
export const MIN_SIZE = 5;
export const MAX_SIZE = 15;

export function sizeForPressure(pressure: number): number {
  const span = MAX_SIZE - MIN_SIZE;
  return Math.min(MAX_SIZE, MIN_SIZE + Math.round(pressure * span));
}

/* ------------------------------------------------------------------ */
/* Difficulty                                                          */
/* ------------------------------------------------------------------ */

/**
 * How far the solver had to look to find its next move, on average.
 *
 * One means the next deduction was always in the line it had just worked on.
 * Eight means it swept most of the board between deductions. That is what
 * separates a nonogram you can run down from one you have to hunt through, and
 * — this is the part that was measured rather than assumed — **neither the grid
 * size nor the fill rate predicts it.** See `tools/nonogram.ts`.
 */
export function lookaheadOf(examined: number, steps: number): number {
  return examined / Math.max(1, steps);
}

/**
 * The measured ends of the lookahead range, from `tools/nonogram.ts`.
 *
 * **These were guessed at 1 and 7 first, and both were wrong.** In principle a
 * puzzle could resolve every deduction in the line it just worked on, giving a
 * lookahead of 1 — in practice no grown picture ever does: the floor across
 * every size and density measured is 3.05, because the first pass over a fresh
 * board reads a lot of lines that have nothing to say yet. The ceiling is 6.1,
 * not 7. Mapping 1..7 onto a signal that lives in 3..6 threw away more than half
 * the dial and left the depth term barely moving.
 */
const LOOKAHEAD_FLOOR = 3;
const LOOKAHEAD_CEILING = 5.6;

/**
 * Difficulty, from the size of the grid and the depth of the reasoning.
 *
 * Both halves matter and they are genuinely different things. A 15x15 that falls
 * out line by line is a long, pleasant, easy puzzle; a 8x8 that needs a sweep
 * per deduction is short and nasty. Weighting size slightly higher is the honest
 * reading of which one the player notices first.
 */
export function score(size: number, lookahead: number): number {
  const sizePart = (size - MIN_SIZE) / (MAX_SIZE - MIN_SIZE);
  const depthPart = Math.min(
    1,
    Math.max(0, (lookahead - LOOKAHEAD_FLOOR) / (LOOKAHEAD_CEILING - LOOKAHEAD_FLOOR)),
  );
  return Math.min(1, Math.max(0, 0.55 * sizePart + 0.45 * depthPart));
}

/* ------------------------------------------------------------------ */
/* Pictures                                                            */
/* ------------------------------------------------------------------ */

/**
 * A blobby picture at roughly the given density.
 *
 * Seed every cell independently, then smooth: a cell ends up painted when most
 * of its own three-by-three neighbourhood was. Two rounds is enough to turn
 * static into shapes and not so many that everything collapses to one blob.
 *
 * The edges count as unpainted during smoothing, which pulls shapes away from
 * the border. That is deliberate — a run touching the edge is the easiest thing
 * in a nonogram to place, and a picture made entirely of them is not a puzzle.
 */
function growPicture(rng: Rng, width: number, height: number, density: number): Picture {
  let cells: boolean[] = Array.from({ length: width * height }, () => rng.chance(density));

  for (let round = 0; round < 2; round++) {
    const next = cells.slice();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let neighbours = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (cells[ny * width + nx]) neighbours++;
          }
        }
        next[y * width + x] = neighbours >= 5;
      }
    }
    cells = next;
  }

  return cells;
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

/** Pictures to try before handing back the closest miss. */
const ATTEMPTS = 90;

export function generateLevel(seed: string, level: number): GeneratedLevel {
  const rng = createRng(hashSeed(seed, GAME_ID, level));
  const { pressure, band } = pressureForLevel(level, rng);
  const size = sizeForPressure(pressure);

  let best: GeneratedLevel | null = null;
  let bestMiss = Infinity;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    /*
     * Density is the one lever that varies within a size, and it is swept rather
     * than fixed: a picture around half painted has the longest, most tangled
     * clue lists, and one that is sparse or nearly solid falls out immediately.
     * Sweeping it means a single size can reach most of the band on its own.
     */
    const density = 0.4 + (attempt % 9) * 0.023;

    const candidate = build(rng, level, size, density);
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

  // Nothing in the sweep was line-solvable, which a real sweep has never
  // produced at any size. A single solid block is trivially solvable and
  // trivially dull, and it keeps the promise that a level always exists.
  return fallback(level, size);
}

function build(rng: Rng, level: number, size: number, density: number): GeneratedLevel | null {
  const picture = growPicture(rng, size, size, density);

  const painted = paintedCount(picture);
  /*
   * A picture has to be substantial enough to be a picture.
   *
   * The first version of this only rejected a *nearly empty* grid, and the
   * generator duly handed back an 8x8 with nine cells painted — technically a
   * valid, uniquely-solvable nonogram, and visually a few specks. Two cells per
   * row on average is the floor for something that resolves into a shape.
   */
  if (painted < size * 2 || painted > size * size * 0.62) return null;

  const puzzle = cluesFor(picture, size, size);
  if (!isWellFormed(puzzle)) return null;

  const result = solveByLines(puzzle);
  if (!result.solved) return null;

  const lookahead = lookaheadOf(result.examined, result.steps);
  return {
    level,
    puzzle,
    picture,
    difficulty: score(size, lookahead),
    lookahead,
    painted,
  };
}

/** A square in the middle of the grid. Always solvable, never interesting. */
function fallback(level: number, size: number): GeneratedLevel {
  const picture: Picture = new Array<boolean>(size * size).fill(false);
  const from = Math.floor(size / 4);
  const to = size - from;
  for (let y = from; y < to; y++) {
    for (let x = from; x < to; x++) picture[y * size + x] = true;
  }

  const puzzle = cluesFor(picture, size, size);
  const result = solveByLines(puzzle);
  const lookahead = lookaheadOf(result.examined, result.steps);

  return {
    level,
    puzzle,
    picture,
    difficulty: score(size, lookahead),
    lookahead,
    painted: paintedCount(picture),
  };
}
