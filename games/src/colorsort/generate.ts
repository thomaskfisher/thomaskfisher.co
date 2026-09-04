/**
 * Level generation for Color Sort.
 *
 * Every level is dealt at random from a seed, then *verified by the solver*
 * before it is ever shown. Boards that can't be solved are discarded, so unlike
 * the games this replaces, a level is never a dead end.
 *
 * Difficulty is measured, not assumed. The signal is how much backtracking the
 * search needed relative to the length of the solution it found: a board a
 * greedy walk strolls through is easy, one that forces heavy search is hard,
 * even with the same colors and the same solution length.
 */

import { MAX_COLORS } from '../shared/palette';
import { createRng, hashSeed } from '../shared/rng';
import { type LevelPressure, pressureForLevel } from '../shared/difficulty';
import {
  type Board,
  type Move,
  type Tube,
  applyMove,
  cloneBoard,
  isMonochrome,
  isSolved,
  isWellFormed,
  legalMoves,
} from './model';
import { search } from './solve';

export interface LevelShape {
  colors: number;
  height: number;
  emptyTubes: number;
}

export interface GeneratedLevel {
  level: number;
  board: Board;
  shape: LevelShape;
  /** 0..1, measured from the verified solution. */
  difficulty: number;
  /** Length of the solution the verifier found (an upper bound on optimal). */
  solutionLength: number;
  /** How many deals were rejected before this one was accepted. */
  attempts: number;
}

const MAX_ATTEMPTS = 60;
const VERIFY_BUDGET = 120_000;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Board dimensions for a level.
 *
 * Two archetypes, because they scale differently:
 *
 *  - *wide*  — many colors, two spare tubes. Grows with pressure up to the
 *              twelve colors that still fit on a phone screen.
 *  - *tight* — fewer colors, a single spare tube. Looks smaller and plays much
 *              harder, and is what keeps difficulty climbing once `wide` has
 *              run out of screen.
 *
 * Tight boards deliberately cap at six colors. Measured solvability of a random
 * deal with a single spare tube falls off a cliff: 55% at four colors, 31% at
 * five, 8% at six, 2% at eight, and essentially zero at nine. Past the cliff
 * the verifier rejects nearly every attempt and the lever silently stops firing.
 *
 * **Tube height is the lever this game was not using.** It used to be pinned at
 * four, reaching five only past level 150 and only on a 15% roll — which is to
 * say, never. It is the strongest single lever available: a fifth band adds a
 * unit of every colour *and* a layer of burial, so the same colour count plays
 * far deeper. It now moves with pressure like everything else, and carries the
 * back half of the curve where colour count has run out of screen.
 */
export function shapeFor(pressure: LevelPressure, rng: ReturnType<typeof createRng>): LevelShape {
  const { pressure: p } = pressure;

  // Four bands is now the *opening* height rather than the standing one, and
  // six is where it tops out — past that a tube is taller than the phone and
  // the bands get too thin to read apart at a glance.
  const height = p < 0.22 ? 4 : p < 0.62 ? 5 : 6;

  // A single spare tube is the sharpest lever in the game, and it used to be
  // switched off until roughly level 35. It is now live from level 1 — about
  // one opening board in six — and is the majority of boards at the top.
  const tightChance = Math.min(0.55, p * 0.6);
  if (rng.chance(tightChance)) {
    // Tight boards cap *both* levers, and the height cap is the one that is
    // easy to get wrong. Measured solvability of a random deal with a single
    // spare falls off a cliff in colours — 55% at four, 31% at five, 8% at six
    // — and every extra band multiplies the deal, so a six-band six-colour
    // tight board is solvable so rarely that the verifier rejects essentially
    // all of them.
    //
    // That failure is silent and cost this lever its whole purpose: asking for
    // 55% tight boards produced 4 in 61 levels, because the accepted attempt
    // was almost always the wide fallback. A lever the verifier quietly filters
    // out is worse than no lever, because the shape function claims it fired.
    return {
      colors: clamp(4 + Math.round(p), 4, 5),
      height: Math.min(height, 5),
      emptyTubes: 1,
    };
  }

  return {
    colors: clamp(5 + Math.round(p * 7), 5, Math.min(12, MAX_COLORS)),
    height,
    emptyTubes: 2,
  };
}

/** Deal `colors * height` units into `colors` full tubes plus the spares. */
function deal(shape: LevelShape, rng: ReturnType<typeof createRng>): Board {
  const units: number[] = [];
  for (let c = 0; c < shape.colors; c++) {
    for (let i = 0; i < shape.height; i++) units.push(c);
  }
  rng.shuffle(units);

  const tubes: Tube[] = [];
  for (let t = 0; t < shape.colors; t++) {
    tubes.push(units.slice(t * shape.height, (t + 1) * shape.height));
  }
  for (let e = 0; e < shape.emptyTubes; e++) tubes.push([]);

  return { tubes, height: shape.height, colors: shape.colors };
}

/**
 * Trap rate: the fraction of naive playthroughs that dead-end.
 *
 * This is the difficulty signal, and it is a direct model of the player we are
 * building for — someone enjoying a puzzle on the couch, not running a search.
 * A board most careless playthroughs survive is easy; one where four in five
 * walk into a corner is hard, regardless of how many colors are on screen.
 *
 * (An earlier version scored difficulty by how much the *solver* backtracked.
 * That turned out to be nearly flat: with two spare tubes a greedy walk almost
 * never backtracks, so the signal spanned a range too narrow to rank levels.)
 */
function trapRate(board: Board, rng: ReturnType<typeof createRng>, rollouts = 20): number {
  let stuck = 0;
  for (let r = 0; r < rollouts; r++) {
    const b = cloneBoard(board);
    for (let step = 0; step < 400; step++) {
      if (isSolved(b)) break;
      const moves = legalMoves(b);
      if (moves.length === 0) {
        stuck++;
        break;
      }
      applyMove(b, moves[rng.int(moves.length)] as Move);
    }
  }
  return stuck / rollouts;
}

/**
 * Combined difficulty score in 0..1.
 *
 * Trap rate dominates. `structural` stops a board that happened to roll a low
 * trap rate from being rated trivial when it is visibly wide or down to a
 * single spare tube. Observed range across viable shapes is about 0.08 (three
 * colors, two spares) to 0.92 (seven colors, one spare).
 */
function scoreDifficulty(shape: LevelShape, trap: number): number {
  const trapScore = clamp(trap / 0.75, 0, 1);

  const structural = clamp(
    (shape.colors / 12) * 0.5 +
      (shape.emptyTubes === 1 ? 0.5 : 0.15) +
      (shape.height === 5 ? 0.1 : 0),
    0,
    1,
  );

  return clamp(0.7 * trapScore + 0.3 * structural, 0, 1);
}

/** A dealt board that is already solved, or has a tube of one color, is a dud. */
function isDegenerate(board: Board): boolean {
  if (isSolved(board)) return true;
  return board.tubes.some((tube) => tube.length > 0 && isMonochrome(tube));
}

/**
 * Deterministic for a given (profileSeed, level, difficultyOffset). The same
 * inputs always produce the same board, which is what lets a save store a move
 * list instead of a board, and lets a reported bug be reproduced exactly.
 */
export function generateLevel(profileSeed: string, level: number): GeneratedLevel {
  const pressureRng = createRng(hashSeed(profileSeed, 'colorsort', 'pressure', level));
  const pressure = pressureForLevel(level, pressureRng);

  let closest: GeneratedLevel | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rng = createRng(hashSeed(profileSeed, 'colorsort', level, attempt));
    const shape = shapeFor(pressure, rng);
    const board = deal(shape, rng);

    if (isDegenerate(board)) continue;

    const result = search(board, { mode: 'first', nodeBudget: VERIFY_BUDGET });
    if (result.status !== 'solved') continue; // unsolvable, or too slow to trust

    // Seeded separately so the score is reproducible for a given level.
    const rolloutRng = createRng(hashSeed(profileSeed, 'colorsort', 'rollout', level, attempt));
    const difficulty = scoreDifficulty(shape, trapRate(board, rolloutRng));

    const candidate: GeneratedLevel = {
      level,
      board,
      shape,
      difficulty,
      solutionLength: result.moves.length,
      attempts: attempt + 1,
    };

    const [lo, hi] = pressure.band;
    if (difficulty >= lo && difficulty <= hi) return candidate;

    // Keep the near miss: relaxing to the closest beats looping forever.
    const distance = difficulty < lo ? lo - difficulty : difficulty - hi;
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = candidate;
    }
  }

  if (closest) return closest;

  // Every deal was rejected — fall back to a guaranteed-safe shape rather than
  // handing the player nothing. Two spare tubes makes a solution near-certain.
  return generateFallback(profileSeed, level);
}

function generateFallback(profileSeed: string, level: number): GeneratedLevel {
  const shape: LevelShape = { colors: 4, height: 4, emptyTubes: 2 };
  for (let attempt = 0; attempt < 200; attempt++) {
    const rng = createRng(hashSeed(profileSeed, 'colorsort', 'fallback', level, attempt));
    const board = deal(shape, rng);
    if (isDegenerate(board)) continue;
    const result = search(board, { mode: 'first', nodeBudget: VERIFY_BUDGET });
    if (result.status !== 'solved') continue;
    const rolloutRng = createRng(hashSeed(profileSeed, 'colorsort', 'fallback-roll', level, attempt));
    return {
      level,
      board,
      shape,
      difficulty: scoreDifficulty(shape, trapRate(board, rolloutRng)),
      solutionLength: result.moves.length,
      attempts: attempt + 1,
    };
  }
  throw new Error(`Unable to generate a solvable level ${level}`);
}

/** Used by the tests; exported so the invariant is checkable from outside. */
export function verifyLevel(generated: GeneratedLevel): boolean {
  return (
    isWellFormed(generated.board) &&
    !isSolved(generated.board) &&
    search(generated.board, { mode: 'first', nodeBudget: VERIFY_BUDGET }).status === 'solved'
  );
}
