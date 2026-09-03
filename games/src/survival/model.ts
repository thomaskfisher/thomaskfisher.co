/**
 * Survival — the rules, and nothing else. No DOM, no randomness, no timers.
 *
 * A board is a lane of `rows` rows and `lanes` columns. The squad starts below
 * row 0 with `startCount` soldiers and walks up, entering exactly one cell per
 * row. Every cell does something to the count: a gate applies an arithmetic
 * operation, a barrier demands to be outnumbered and takes its own value with
 * it. Reaching the top with more soldiers than the horde wins.
 *
 * The one rule that turns this from arithmetic into a puzzle is `reach`: you
 * may shift at most that many lanes between consecutive rows, so the gate you
 * want four rows up may not be reachable from the gate you want now. The whole
 * board is visible from the start — the constraint is meant to be planned
 * around, never guessed at.
 *
 * Every operation here is monotone non-decreasing in the incoming count: more
 * soldiers is never worse. That is not a coincidence, it is load-bearing. It is
 * what lets `solve.ts` carry a single best-count per cell and still be exact,
 * which in turn is what lets the generator guarantee solvability rather than
 * search for it.
 */

/** Ceiling on the soldier count. Far above anything generation produces; it
 *  exists so a pathological board can never reach Number.MAX_SAFE_INTEGER and
 *  start losing precision mid-comparison. */
export const COUNT_CAP = 1_000_000_000;

/** A wiped-out squad. Zero is the only dead value — nothing ever goes negative. */
export const DEAD = 0;

export type Op = 'add' | 'mul' | 'sub' | 'div';

export interface Gate {
  readonly kind: 'gate';
  readonly op: Op;
  readonly value: number;
}

/**
 * A wall that has to be outnumbered, not merely met. Passing costs `hp`
 * soldiers, which is what stops "save every multiplier for the last row" from
 * being a universal strategy: you have to be big *here*, not just at the end.
 */
export interface Barrier {
  readonly kind: 'barrier';
  readonly hp: number;
}

export type Node = Gate | Barrier;

export interface Board {
  readonly lanes: number;
  readonly rows: number;
  /** Row-major, `rows * lanes` entries. Row 0 is the one nearest the squad. */
  readonly nodes: readonly Node[];
  readonly startCount: number;
  /** Largest lane change allowed between consecutive rows. Row 0 is free. */
  readonly reach: number;
  /** You must finish strictly above this. */
  readonly horde: number;
}

/** A committed run: one lane index per row entered so far. */
export type Route = readonly number[];

export type Phase = 'playing' | 'won' | 'lost';

/**
 * Why a run ended.
 *
 * `wiped` and `blocked` are immediate — the squad is gone the moment it happens
 * and there is nothing left to walk. `overrun` only becomes true at the top, and
 * deliberately so: the game never tells you mid-run that you can no longer
 * win. Knowing whether you are still on track is the arithmetic, and the
 * arithmetic is the game.
 */
export type LossCause = 'wiped' | 'blocked' | 'overrun';

export const nodeIndex = (board: Board, row: number, lane: number): number =>
  row * board.lanes + lane;

export function nodeAt(board: Board, row: number, lane: number): Node {
  const node = board.nodes[nodeIndex(board, row, lane)];
  if (!node) throw new Error(`No node at row ${row}, lane ${lane}`);
  return node;
}

/**
 * Applies one cell to a soldier count. Returns DEAD for a run that ends here.
 *
 * Monotone non-decreasing in `count` for every branch, including the barrier —
 * if a smaller count survives a barrier, so does a larger one, and by more.
 */
export function applyNode(node: Node, count: number): number {
  if (count <= 0) return DEAD;

  if (node.kind === 'barrier') {
    return count > node.hp ? count - node.hp : DEAD;
  }

  switch (node.op) {
    case 'add':
      return Math.min(COUNT_CAP, count + node.value);
    case 'mul':
      return Math.min(COUNT_CAP, count * node.value);
    case 'sub':
      return Math.max(DEAD, count - node.value);
    case 'div':
      return Math.floor(count / node.value);
  }
}

/** Lanes the squad may enter at `row`, given the lane it stands in below it. */
export function lanesInReach(board: Board, fromLane: number | null): number[] {
  const lanes: number[] = [];
  for (let lane = 0; lane < board.lanes; lane++) {
    // Row 0 is entered from off the board, so any lane is an opening move.
    if (fromLane === null || Math.abs(lane - fromLane) <= board.reach) lanes.push(lane);
  }
  return lanes;
}

/** The lanes selectable right now. Empty once the run is over. */
export function legalLanes(board: Board, route: Route): number[] {
  if (route.length >= board.rows) return [];
  const from = route.length === 0 ? null : (route[route.length - 1] as number);
  return lanesInReach(board, from);
}

export function isLegalStep(board: Board, route: Route, lane: number): boolean {
  if (lane < 0 || lane >= board.lanes) return false;
  return legalLanes(board, route).includes(lane);
}

export interface Evaluation {
  phase: Phase;
  cause: LossCause | null;
  /** Soldiers right now — after the last committed row, or `startCount`. */
  count: number;
  /** Count after each committed row, parallel to the route. */
  counts: number[];
  /** The cell that ended the run, for `wiped` and `blocked`. */
  death: { row: number; lane: number; cause: 'wiped' | 'blocked' } | null;
}

/**
 * Replays a route from the start.
 *
 * Defensive about an illegal step rather than throwing: saved routes are
 * replayed against a freshly generated board, and a move that no longer applies
 * should cost the tail of the run, not the level.
 */
export function evaluate(board: Board, route: Route): Evaluation {
  let count = board.startCount;
  const counts: number[] = [];

  for (let row = 0; row < route.length; row++) {
    const lane = route[row] as number;
    const from = row === 0 ? null : (route[row - 1] as number);
    if (lane < 0 || lane >= board.lanes) break;
    if (from !== null && Math.abs(lane - from) > board.reach) break;

    const node = nodeAt(board, row, lane);
    const before = count;
    count = applyNode(node, count);
    counts.push(count);

    if (count <= DEAD) {
      // A barrier that was met but not beaten reads differently from a gate
      // that subtracted the squad away, and the loss sheet says which.
      const cause = node.kind === 'barrier' && before > 0 ? 'blocked' : 'wiped';
      return { phase: 'lost', cause, count: DEAD, counts, death: { row, lane, cause } };
    }
  }

  if (counts.length >= board.rows) {
    return count > board.horde
      ? { phase: 'won', cause: null, count, counts, death: null }
      : { phase: 'lost', cause: 'overrun', count, counts, death: null };
  }

  return { phase: 'playing', cause: null, count, counts, death: null };
}

/**
 * Structural sanity. Cheap enough to assert in the generator and the tests, and
 * it catches the whole class of "the board arrived half-built" bugs before they
 * reach a renderer that would silently draw nothing.
 */
export function isWellFormed(board: Board): boolean {
  if (board.lanes < 2 || board.rows < 1) return false;
  if (board.reach < 1) return false;
  if (board.nodes.length !== board.rows * board.lanes) return false;
  if (!Number.isInteger(board.startCount) || board.startCount < 1) return false;
  if (!Number.isInteger(board.horde) || board.horde < 1) return false;

  return board.nodes.every((node) => {
    if (node.kind === 'barrier') return Number.isInteger(node.hp) && node.hp >= 1;
    if (!Number.isInteger(node.value) || node.value < 1) return false;
    // A multiplier or divisor of one is a no-op wearing a costume; a divisor
    // has to actually divide.
    if (node.op === 'mul' || node.op === 'div') return node.value >= 2;
    return true;
  });
}
