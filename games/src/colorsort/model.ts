/**
 * Color Sort rules. Pure — no DOM, no storage, no randomness.
 *
 * The solver, the generator, the worker, the renderer and the tests all import
 * this module, so it must stay free of side effects.
 *
 * A tube is bottom-first: index 0 is the bottom band, the last element is the
 * top band and the only one that can be poured.
 */

export type Color = number;
export type Tube = Color[];

export interface Board {
  tubes: Tube[];
  /** Units a tube holds when full. */
  height: number;
  /** Distinct colors in play; each has exactly `height` units. */
  colors: number;
}

export interface Move {
  from: number;
  to: number;
}

export function cloneBoard(board: Board): Board {
  return {
    tubes: board.tubes.map((t) => t.slice()),
    height: board.height,
    colors: board.colors,
  };
}

export function topColor(tube: Tube): Color | undefined {
  return tube[tube.length - 1];
}

/** Length of the run of identical colors at the top of the tube. */
export function topRunLength(tube: Tube): number {
  if (tube.length === 0) return 0;
  const color = tube[tube.length - 1];
  let run = 1;
  for (let i = tube.length - 2; i >= 0 && tube[i] === color; i--) run++;
  return run;
}

export function isMonochrome(tube: Tube): boolean {
  return tube.length > 0 && topRunLength(tube) === tube.length;
}

/** Full and single-colored — done, and never worth disturbing. */
export function isComplete(tube: Tube, height: number): boolean {
  return tube.length === height && isMonochrome(tube);
}

export function canPour(board: Board, from: number, to: number): boolean {
  if (from === to) return false;
  const source = board.tubes[from];
  const dest = board.tubes[to];
  if (!source || !dest) return false;
  if (source.length === 0) return false;
  if (dest.length >= board.height) return false;
  return dest.length === 0 || topColor(dest) === topColor(source);
}

/**
 * How many units a pour would actually move: the whole top run, capped by the
 * space available in the destination.
 */
export function pourAmount(board: Board, from: number, to: number): number {
  if (!canPour(board, from, to)) return 0;
  const source = board.tubes[from] as Tube;
  const dest = board.tubes[to] as Tube;
  return Math.min(topRunLength(source), board.height - dest.length);
}

/** Mutates `board`. Returns the number of units moved (0 if the move was illegal). */
export function applyMove(board: Board, move: Move): number {
  const amount = pourAmount(board, move.from, move.to);
  if (amount === 0) return 0;
  const source = board.tubes[move.from] as Tube;
  const dest = board.tubes[move.to] as Tube;
  const color = topColor(source) as Color;
  source.length -= amount;
  for (let i = 0; i < amount; i++) dest.push(color);
  return amount;
}

/** Inverse of `applyMove`, for the solver's depth-first walk. */
export function undoMove(board: Board, move: Move, amount: number): void {
  if (amount === 0) return;
  const source = board.tubes[move.from] as Tube;
  const dest = board.tubes[move.to] as Tube;
  const color = topColor(dest) as Color;
  dest.length -= amount;
  for (let i = 0; i < amount; i++) source.push(color);
}

export function isSolved(board: Board): boolean {
  for (const tube of board.tubes) {
    if (tube.length === 0) continue;
    if (!isComplete(tube, board.height)) return false;
  }
  return true;
}

/**
 * Legal moves, with the prunes that make search tractable. These remove moves
 * that can never appear in an optimal solution, so the solver stays complete:
 *
 *  - never disturb a finished tube;
 *  - never move a monochrome tube's contents into an empty tube (it just
 *    relabels which tube holds that color);
 *  - among several empty destinations, only ever consider the first, since
 *    empty tubes are interchangeable.
 */
export function legalMoves(board: Board): Move[] {
  const moves: Move[] = [];
  const { tubes, height } = board;

  let firstEmpty = -1;
  for (let i = 0; i < tubes.length; i++) {
    if ((tubes[i] as Tube).length === 0) {
      firstEmpty = i;
      break;
    }
  }

  for (let from = 0; from < tubes.length; from++) {
    const source = tubes[from] as Tube;
    if (source.length === 0) continue;
    if (isComplete(source, height)) continue;

    const sourceIsMonochrome = isMonochrome(source);

    for (let to = 0; to < tubes.length; to++) {
      if (from === to) continue;
      const dest = tubes[to] as Tube;

      if (dest.length === 0) {
        if (to !== firstEmpty) continue; // empty tubes are interchangeable
        if (sourceIsMonochrome) continue; // pointless relocation
      }

      if (canPour(board, from, to)) moves.push({ from, to });
    }
  }

  return moves;
}

/**
 * Identity of a position, ignoring tube order — which is meaningless in this
 * game. Collapsing those permutations is the single biggest search win.
 */
export function canonicalKey(board: Board): string {
  const parts = new Array<string>(board.tubes.length);
  for (let i = 0; i < board.tubes.length; i++) {
    const tube = board.tubes[i] as Tube;
    let s = '';
    for (let j = 0; j < tube.length; j++) s += String.fromCharCode(65 + (tube[j] as number));
    parts[i] = s;
  }
  parts.sort();
  return parts.join(',');
}

/**
 * Admissible lower bound on remaining pours: for each color, the number of
 * distinct tubes holding it, minus one. A single pour can retire at most one
 * such surplus tube, for one color, so this never overestimates.
 *
 * Called once per search node, so it uses module scratch buffers rather than
 * allocating. `lastTube` doubles as a per-color stamp so each color is counted
 * at most once per tube even when it appears in several separated runs.
 */
const tubesWithColor = new Int32Array(64);
const lastTube = new Int32Array(64);

export function heuristic(board: Board): number {
  const n = board.colors;
  tubesWithColor.fill(0, 0, n);
  lastTube.fill(-1, 0, n);

  for (let t = 0; t < board.tubes.length; t++) {
    const tube = board.tubes[t] as Tube;
    for (let j = 0; j < tube.length; j++) {
      const c = tube[j] as number;
      if (lastTube[c] !== t) {
        lastTube[c] = t;
        tubesWithColor[c] = (tubesWithColor[c] as number) + 1;
      }
    }
  }

  let total = 0;
  for (let c = 0; c < n; c++) {
    const count = tubesWithColor[c] as number;
    if (count > 0) total += count - 1;
  }
  return total;
}

/** Sanity invariant: unit counts are conserved and tubes never overflow. */
export function isWellFormed(board: Board): boolean {
  const counts = new Array<number>(board.colors).fill(0);
  for (const tube of board.tubes) {
    if (tube.length > board.height) return false;
    for (const unit of tube) {
      if (unit < 0 || unit >= board.colors) return false;
      counts[unit] = (counts[unit] as number) + 1;
    }
  }
  return counts.every((n) => n === board.height);
}
