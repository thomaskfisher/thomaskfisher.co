/**
 * A naive player, and the difficulty signal.
 *
 * Every measured game in this collection scores difficulty by *trap rate*: the
 * fraction of unskilled playthroughs that lose. It models the player being
 * built for rather than the search algorithm, and it is the one signal that has
 * had range and monotonicity in every game here. A falling-block game cannot
 * quite use it as written — a run always ends, so "did it lose" is a constant —
 * but the same idea inverted works: how *long* does a naive player last.
 *
 * So this bot places pieces the way somebody who is concentrating but not
 * expert would: it looks one piece ahead, prefers a flat stack with no holes,
 * and every so often does something careless. What it never does is search. A
 * bot that plays perfectly would measure the ceiling of the format, and the
 * ceiling is not where anybody is standing.
 *
 * The three things it deliberately does not do, all of which would flatter the
 * bag into looking harmless:
 *
 *  - **No hold.** Hold is the tool for surviving a bad stream, which is the
 *    thing being measured. A bot that uses it perfectly would report a bias
 *    that a real careless player will feel keenly.
 *  - **No tucks or spins.** Placements are rotate, slide, drop — the reachable
 *    set a player actually uses. Sliding a piece under an overhang at the last
 *    moment is an expert move.
 *  - **No lookahead past the falling piece.** The preview is on screen for the
 *    player's benefit, not the measurement's.
 */

import { createRng, hashSeed } from '../shared/rng';
import { EMPTY, ROWS, WELL_W, canPlace, dropDistance, lock, collapse } from './model';
import { type Run, lockDown, startRun } from './run';

/**
 * Lee's weights, which are the well-known ones for this heuristic and are used
 * unchanged on purpose: tuning them would make the bot better, and a better bot
 * measures a different player.
 */
const W_HEIGHT = -0.51;
const W_LINES = 0.76;
const W_HOLES = -0.36;
const W_BUMPINESS = -0.18;

/** Column heights, measured from the floor. */
function heights(well: Int8Array): number[] {
  const out: number[] = [];
  for (let x = 0; x < WELL_W; x++) {
    let height = 0;
    for (let y = 0; y < ROWS; y++) {
      if (well[y * WELL_W + x] !== EMPTY) {
        height = ROWS - y;
        break;
      }
    }
    out.push(height);
  }
  return out;
}

/** Covered empty cells — the thing that actually ends a run. */
function holes(well: Int8Array, columnHeights: readonly number[]): number {
  let count = 0;
  for (let x = 0; x < WELL_W; x++) {
    const top = ROWS - (columnHeights[x] ?? 0);
    for (let y = top + 1; y < ROWS; y++) {
      if (well[y * WELL_W + x] === EMPTY) count++;
    }
  }
  return count;
}

function score(well: Int8Array, lines: number): number {
  const columnHeights = heights(well);
  const total = columnHeights.reduce((sum, h) => sum + h, 0);
  let bumpiness = 0;
  for (let x = 0; x + 1 < WELL_W; x++) {
    bumpiness += Math.abs((columnHeights[x] ?? 0) - (columnHeights[x + 1] ?? 0));
  }
  return (
    W_HEIGHT * total + W_LINES * lines + W_HOLES * holes(well, columnHeights) + W_BUMPINESS * bumpiness
  );
}

interface Placement {
  rot: number;
  x: number;
  value: number;
}

/** Every rotate-slide-drop the falling piece can reach, scored. */
function placements(run: Run): Placement[] {
  const piece = run.piece;
  if (!piece) return [];
  const out: Placement[] = [];

  for (let rot = 0; rot < 4; rot++) {
    for (let x = -3; x <= WELL_W; x++) {
      const candidate = { type: piece.type, rot, x, y: piece.y };
      // Reachable means it fits where the piece already is, then slides down.
      if (!canPlace(run.well, candidate)) continue;
      const landed = { ...candidate, y: candidate.y + dropDistance(run.well, candidate) };
      const { well, cleared, toppedOut } = lock(run.well, landed);
      // A placement that tops out is not chosen unless it is the only one.
      const value = toppedOut ? -1e6 : score(collapse(well, cleared), cleared.length);
      out.push({ rot, x, value });
    }
  }

  return out;
}

export interface RolloutResult {
  /** Pieces placed before the run ended. */
  placed: number;
  lines: number;
  /** The level reached, had the level been floating. Reported, never used. */
  reachedLines: number;
}

export interface BotOptions {
  /**
   * How often the bot places at random instead of well.
   *
   * The dial that turns this from a benchmark into a model of a person. At 0 it
   * is a competent player and survives nearly any stream; the useful range is
   * around a tenth, where a run ends to a stream the player could not absorb
   * rather than to a blunder on every piece.
   */
  sloppiness?: number;
  /** Stop here rather than playing forever at a bias that cannot kill. */
  maxPieces?: number;
}

/**
 * Plays one run to its end.
 *
 * Seeded from the run's own seed and game, so a rollout is reproducible and a
 * surprising number in a sweep can be looked at again.
 */
export function rollout(run: Run, options: BotOptions = {}): RolloutResult {
  const { sloppiness = 0.1, maxPieces = 3000 } = options;
  // Deliberately not seeded on the level: the bot's careless moments should be
  // the same sequence at every point of a sweep, so what differs between two
  // levels is the stream and not also the player.
  const rng = createRng(hashSeed(run.seed, 'tetris-bot', run.game));

  let current = run;
  while (!current.over && current.placed < maxPieces) {
    const options_ = placements(current);
    if (options_.length === 0) break;

    const choice =
      rng.next() < sloppiness
        ? rng.pick(options_)
        : options_.reduce((best, p) => (p.value > best.value ? p : best), options_[0]!);

    const piece = current.piece!;
    const placed = { ...piece, rot: choice.rot, x: choice.x };
    const landed = { ...placed, y: placed.y + dropDistance(current.well, placed) };
    current = lockDown({ ...current, piece: landed }).run;
  }

  return { placed: current.placed, lines: current.lines, reachedLines: current.lines };
}

/** A fresh run pinned to one level, for a sweep. */
export const runAtLevel = (seed: string, game: number, level: number): Run =>
  startRun(seed, game, level);
