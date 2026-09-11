/**
 * Pipes generation.
 *
 * **Built backwards, like Screw Land and Depot.** A random spanning tree is
 * grown over the grid first; each tile's stubs are then read off the tree edges
 * that touch it, and finally every tile is given a random quarter turn. Turning
 * each one back is a solution, so solvability is a property of the construction
 * rather than something a solver has to certify. Dealing tiles at random and
 * checking instead would spend nearly all its time rejecting boards.
 *
 * What *is* measured is how hard the board is to hunt through — see `solve.ts`,
 * where the first attempt at this measured something with no range at all. The
 * scramble cannot affect it, because rotating a tile cannot change the set of
 * rotations it has. What does affect it is the **shape of the tree**, and that
 * is the lever this file pulls.
 */

import { pressureForLevel } from '../shared/difficulty';
import { type Rng, createRng, hashSeed } from '../shared/rng';
import {
  type Board,
  SIDES,
  STEPS,
  type Tiles,
  isSolved,
  misalignedCount,
  opposite,
  rotateTimes,
} from './model';
import { solveWithEffort, turnsRemaining } from './solve';

export const GAME_ID = 'pipes';

export interface GeneratedLevel {
  level: number;
  board: Board;
  /** The scrambled tiles the level opens on. */
  start: Tiles;
  /** 0..1, measured. See `score`. */
  difficulty: number;
  /** Tiles looked at per deduction — the raw signal behind `difficulty`. */
  lookahead: number;
  /** Fewest quarter turns that finish it, following the board's own answer. */
  turns: number;
}

/* ------------------------------------------------------------------ */
/* Size                                                                */
/* ------------------------------------------------------------------ */

/**
 * The grid, in portrait. Eight across is what fits at a tap target anybody can
 * hit on a phone; the extra two rows come free because the screen is taller
 * than it is wide.
 */
export const MIN_WIDTH = 4;
export const MAX_WIDTH = 8;
export const EXTRA_ROWS = 2;

export function widthForPressure(pressure: number): number {
  return Math.min(
    MAX_WIDTH,
    MIN_WIDTH + Math.round(pressure * (MAX_WIDTH - MIN_WIDTH)),
  );
}

/* ------------------------------------------------------------------ */
/* Difficulty                                                          */
/* ------------------------------------------------------------------ */

/** Tiles looked at per deduction. See `solveWithEffort`. */
export function lookaheadOf(examined: number, steps: number): number {
  return examined / Math.max(1, steps);
}

/**
 * The measured ends of the lookahead range, from `tools/pipes.ts`.
 *
 * **This replaced "what share of the board is forced", which had no range at
 * all.** That measurement came back 1.00 for every width and every tree shape —
 * a pipes board grown from a spanning tree is always fully determined — so the
 * think term was a constant, difficulty was the grid-size term alone, and every
 * level missed its band. The board is never ambiguous; it is only ever hard to
 * *search*, and this measures the search.
 */
const LOOKAHEAD_FLOOR = 2.9;
const LOOKAHEAD_CEILING = 6.5;

/**
 * Difficulty, from the size of the grid and how far the eye has to travel.
 *
 * The two terms are genuinely independent, which is the whole reason both are
 * here: the scramble cannot change what is deducible, and the grid size does not
 * predict how scattered the deductions are, so a big easy board and a small
 * nasty one are both reachable and both mean something.
 */
export function score(width: number, lookahead: number): number {
  const sizePart = (width - MIN_WIDTH) / (MAX_WIDTH - MIN_WIDTH);
  const huntPart = Math.min(
    1,
    Math.max(0, (lookahead - LOOKAHEAD_FLOOR) / (LOOKAHEAD_CEILING - LOOKAHEAD_FLOOR)),
  );
  return Math.min(1, Math.max(0, 0.5 * sizePart + 0.5 * huntPart));
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

/** Trees to try before handing back the closest miss. */
const ATTEMPTS = 40;

export function generateLevel(seed: string, level: number): GeneratedLevel {
  const rng = createRng(hashSeed(seed, GAME_ID, level));
  const { pressure, band } = pressureForLevel(level, rng);

  const width = widthForPressure(pressure);
  const height = width + EXTRA_ROWS;

  let best: GeneratedLevel | null = null;
  let bestMiss = Infinity;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    /*
     * How much of the tree runs in straight corridors, swept across attempts.
     *
     * Swept rather than derived from the pressure because the spread *within* a
     * setting is wider than the gap between settings — see `tools/pipes.ts` —
     * so trying several trees is what actually reaches the band, and the bias
     * only tilts the odds.
     */
    const straightness = 0.05 + (attempt % 8) * 0.12;

    const candidate = build(rng, level, width, height, straightness);
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

  // Unreachable: `build` only returns null for a board that scrambled to an
  // already-solved position, and the retry inside it makes that vanishingly
  // unlikely. Rebuilding once with no straightness bias keeps the promise that
  // a level always exists.
  return best ?? (build(rng, level, width, height, 0.5) as GeneratedLevel);
}

function build(
  rng: Rng,
  level: number,
  width: number,
  height: number,
  straightness: number,
): GeneratedLevel | null {
  const source = rng.int(width * height);
  const solution = growTree(rng, width, height, source, straightness);
  const board: Board = { width, height, source, solution };

  const start = scramble(rng, board);
  if (!start) return null;

  const effort = solveWithEffort(board, start);
  const lookahead = lookaheadOf(effort.examined, effort.steps);

  return {
    level,
    board,
    start,
    difficulty: score(width, lookahead),
    lookahead,
    turns: turnsRemaining(board, start),
  };
}

/**
 * A spanning tree over the grid, grown by a randomised depth-first walk.
 *
 * `straightness` is the chance of carrying on the way the walk was already
 * going, and it is the one lever on the shape of the puzzle. **A windier tree is
 * the harder one**, measured at 4.20 lookahead against 3.57 at width 8: long
 * corridors of straight pipe are quick to read off, where a bushy tree scatters
 * the next deduction somewhere else on the board every time.
 *
 * The effect is real but modest, and smaller than the spread between two trees
 * grown at the *same* setting. That is why the generator sweeps it across
 * attempts rather than picking one value per level and trusting it.
 */
function growTree(
  rng: Rng,
  width: number,
  height: number,
  root: number,
  straightness: number,
): number[] {
  const cells = width * height;
  const masks = new Array<number>(cells).fill(0);
  const seen = new Array<boolean>(cells).fill(false);

  /** The stack carries the direction each cell was entered from, for the bias. */
  const stack: { cell: number; from: number }[] = [{ cell: root, from: -1 }];
  seen[root] = true;

  while (stack.length) {
    const top = stack[stack.length - 1] as { cell: number; from: number };
    const { cell } = top;

    const open: number[] = [];
    for (let sideIndex = 0; sideIndex < 4; sideIndex++) {
      const step = STEPS[sideIndex] as readonly [number, number];
      const x = (cell % width) + step[0];
      const y = Math.floor(cell / width) + step[1];
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      if (seen[y * width + x]) continue;
      open.push(sideIndex);
    }

    if (open.length === 0) {
      stack.pop();
      continue;
    }

    // Carry straight on with probability `straightness`, when that is an option.
    let chosen = open[rng.int(open.length)] as number;
    if (top.from >= 0 && open.includes(top.from) && rng.chance(straightness)) {
      chosen = top.from;
    }

    const step = STEPS[chosen] as readonly [number, number];
    const next = (Math.floor(cell / width) + step[1]) * width + (cell % width) + step[0];

    const side = SIDES[chosen] as number;
    masks[cell] = (masks[cell] as number) | side;
    masks[next] = (masks[next] as number) | opposite(side);

    seen[next] = true;
    stack.push({ cell: next, from: chosen });
  }

  return masks;
}

/**
 * Gives every tile a random quarter turn, and refuses to hand back a board that
 * is already finished.
 *
 * On a small grid full of crosses and straights that is a real possibility
 * rather than a theoretical one, and "level 1 opens already solved" is the kind
 * of bug that only ever shows up on somebody else's phone.
 */
function scramble(rng: Rng, board: Board): Tiles | null {
  for (let attempt = 0; attempt < 12; attempt++) {
    const tiles = board.solution.map((mask) => rotateTimes(mask, rng.int(4)));
    if (!isSolved(board, tiles) && misalignedCount(board, tiles) > 0) return tiles;
  }
  return null;
}
