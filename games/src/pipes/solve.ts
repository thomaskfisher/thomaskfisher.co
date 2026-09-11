/**
 * The constraint solver, and the hint.
 *
 * **Solvability is never in question here, and that is unusual for this
 * collection.** Every board is built by scrambling a spanning tree, so turning
 * each tile back is a solution by construction — there is nothing for a solver
 * to verify. What there *is* to measure is how hard the board is to reason
 * through, and getting that right took two attempts.
 *
 * **The first attempt measured the wrong thing.** It ran arc consistency to a
 * fixpoint and scored a board by what share of its tiles came out forced, on the
 * theory that a board with ambiguous tiles is one you have to probe. The
 * measurement killed it: across every width and every tree shape, the forced
 * share is 1.00 — pipes boards grown this way are *always* fully determined. The
 * theory was not slightly off, it had nothing to measure, and difficulty
 * flattened at exactly the grid-size term with every level missing its band.
 *
 * **What makes a pipes board hard is finding the forced tile, not whether one
 * exists.** So the signal is the same one Nonogram uses: work one tile at a
 * time, and count how many tiles you have to look at before one of them tells
 * you something. A board where the next deduction is always next to the last is
 * a board you run down; one where you re-scan half the grid each time is one you
 * grind through. `propagate` stays, because "is this board fully determined" is
 * still worth being able to assert — it is just not the difficulty.
 */

import {
  type Board,
  SIDES,
  type Tiles,
  distinctRotations,
  neighbour,
  opposite,
  rotate,
  wetCells,
} from './model';

/** The distinct masks a tile can be turned to, in clockwise order from itself. */
export function rotationsOf(mask: number): number[] {
  const out: number[] = [];
  let current = mask;
  for (let turn = 0; turn < distinctRotations(mask); turn++) {
    out.push(current);
    current = rotate(current);
  }
  return out;
}

export interface PropagationResult {
  /** Candidate masks left for each cell, after the fixpoint. */
  candidates: number[][];
  /** Cells narrowed to exactly one rotation. */
  forced: number;
  /** `forced` as a share of the board. The difficulty signal. */
  forcedShare: number;
}

/**
 * Arc consistency over the tile rotations.
 *
 * Two constraints, and the first is doing more work than it looks like it
 * should: a stub may not point off the grid. On a board of any size most of the
 * information in a pipes puzzle enters through the border, and the interior is
 * then solved inwards from it. Take that constraint away and almost nothing is
 * forced anywhere.
 */
export function propagate(board: Board, tiles: Tiles): PropagationResult {
  const candidates: number[][] = tiles.map((mask, cell) =>
    rotationsOf(mask).filter((option) => {
      for (let sideIndex = 0; sideIndex < 4; sideIndex++) {
        const side = SIDES[sideIndex] as number;
        if (option & side && neighbour(board, cell, sideIndex) < 0) return false;
      }
      return true;
    }),
  );

  let changed = true;
  while (changed) {
    changed = false;

    for (let cell = 0; cell < candidates.length; cell++) {
      const mine = candidates[cell] as number[];

      for (let sideIndex = 0; sideIndex < 4; sideIndex++) {
        const other = neighbour(board, cell, sideIndex);
        if (other < 0) continue;

        const side = SIDES[sideIndex] as number;
        const back = opposite(side);
        const theirs = candidates[other] as number[];

        // Which answers does the neighbour still allow for the side we share?
        let theyCanJoin = false;
        let theyCanRefuse = false;
        for (const option of theirs) {
          if (option & back) theyCanJoin = true;
          else theyCanRefuse = true;
        }

        const kept = mine.filter((option) => (option & side ? theyCanJoin : theyCanRefuse));
        if (kept.length !== mine.length) {
          candidates[cell] = kept;
          changed = true;
        }
      }
    }
  }

  let forced = 0;
  for (const options of candidates) if (options.length === 1) forced++;

  return { candidates, forced, forcedShare: forced / Math.max(1, candidates.length) };
}

/* ------------------------------------------------------------------ */
/* The difficulty signal                                               */
/* ------------------------------------------------------------------ */

export interface EffortResult {
  /** Tiles narrowed to one rotation by the end. */
  forced: number;
  /** Tiles looked at before each narrowing, summed. */
  examined: number;
  /** Narrowings made. */
  steps: number;
}

/**
 * Works the board one tile at a time, counting how far it had to look.
 *
 * Deliberately a model of the player rather than of the algorithm. `propagate`
 * sweeps everything to a fixpoint and reports the same answer for every board;
 * this reports how much *hunting* that answer cost, which is the thing a person
 * actually experiences. A tile is examined, its constraints applied once, and if
 * it narrowed then the next sweep starts from there — because that is what
 * somebody does, rather than restarting at the top left after every turn.
 */
export function solveWithEffort(board: Board, tiles: Tiles): EffortResult {
  const candidates: number[][] = tiles.map((mask) => rotationsOf(mask));
  const cells = candidates.length;

  let examined = 0;
  let steps = 0;
  let cursor = 0;

  /** Applies the two constraints to one tile. True if anything was struck out. */
  const narrow = (cell: number): boolean => {
    const mine = candidates[cell] as number[];

    const kept = mine.filter((option) => {
      for (let sideIndex = 0; sideIndex < 4; sideIndex++) {
        const side = SIDES[sideIndex] as number;
        const other = neighbour(board, cell, sideIndex);

        // A stub may not point off the grid. Most of the information in a pipes
        // board enters through the border and is then solved inwards from it.
        if (other < 0) {
          if (option & side) return false;
          continue;
        }

        const back = opposite(side);
        const theirs = candidates[other] as number[];
        let theyCanJoin = false;
        let theyCanRefuse = false;
        for (const theirOption of theirs) {
          if (theirOption & back) theyCanJoin = true;
          else theyCanRefuse = true;
        }

        if (option & side ? !theyCanJoin : !theyCanRefuse) return false;
      }
      return true;
    });

    if (kept.length === mine.length) return false;
    candidates[cell] = kept;
    return true;
  };

  for (;;) {
    let progressed = false;

    for (let scan = 0; scan < cells; scan++) {
      const cell = (cursor + scan) % cells;
      examined++;
      if (!narrow(cell)) continue;

      steps++;
      cursor = cell;
      progressed = true;
      break;
    }

    if (!progressed) break;
  }

  let forced = 0;
  for (const options of candidates) if (options.length === 1) forced++;

  return { forced, examined, steps };
}

/**
 * The next tile to turn, and what it should end up as.
 *
 * **It follows the board's own answer, outward from the source.** Two things
 * that buys, both of which matter more than they sound:
 *
 *  - **It is a pure function of the position**, so the same board always gets
 *    the same advice and the button cannot ping-pong between two tiles. The
 *    games with a search behind the hint have to cache a winning line to get
 *    this; here it is free.
 *  - **It grows the network rather than dotting about.** Advice that fixes a
 *    tile in the far corner is correct and unhelpful: the water does not move,
 *    so nothing visibly happens. Working outward from the source means every
 *    hint the player takes lights something up.
 *
 * Tiles are compared by mask, so a straight pipe already lying the right way is
 * never suggested however it got there, and a cross never is at all.
 */
export function nextTurn(board: Board, tiles: Tiles): { cell: number; to: number } | null {
  const order = breadthFirst(board);

  for (const cell of order) {
    const target = board.solution[cell] as number;
    if (tiles[cell] !== target) return { cell, to: target };
  }
  return null;
}

/** Cells in breadth-first order from the source, walking the finished network. */
function breadthFirst(board: Board): number[] {
  const seen = new Array<boolean>(board.solution.length).fill(false);
  const order: number[] = [];
  const queue: number[] = [board.source];
  seen[board.source] = true;

  while (queue.length) {
    const cell = queue.shift() as number;
    order.push(cell);

    const mask = board.solution[cell] as number;
    for (let sideIndex = 0; sideIndex < 4; sideIndex++) {
      const side = SIDES[sideIndex] as number;
      if (!(mask & side)) continue;
      const next = neighbour(board, cell, sideIndex);
      if (next < 0 || seen[next]) continue;
      seen[next] = true;
      queue.push(next);
    }
  }

  // A board whose solution is a spanning tree reaches everything, so this only
  // catches a malformed one — but returning a partial order would make the hint
  // silently stop working on the cells it missed.
  for (let cell = 0; cell < seen.length; cell++) if (!seen[cell]) order.push(cell);

  return order;
}

/**
 * The fewest turns that finish the board, following its own answer.
 *
 * An upper bound on the true minimum rather than the minimum itself: another
 * arrangement of the same tiles might also be a solution and be closer. It is
 * used for the clock's budget and for the "best" figure on the win sheet, where
 * a bound the player can actually beat is the right kind of wrong.
 */
export function turnsRemaining(board: Board, tiles: Tiles): number {
  let total = 0;
  for (let cell = 0; cell < tiles.length; cell++) {
    const target = board.solution[cell] as number;
    let mask = tiles[cell] as number;
    let turns = 0;
    while (mask !== target && turns < 4) {
      mask = rotate(mask);
      turns++;
    }
    total += turns % 4;
  }
  return total;
}

/** Tiles that are wet but still leak somewhere. Used only by the tests. */
export function wetLeakers(board: Board, tiles: Tiles): number[] {
  const wet = wetCells(board, tiles);
  const out: number[] = [];

  for (let cell = 0; cell < tiles.length; cell++) {
    if (!wet[cell]) continue;
    const mask = tiles[cell] as number;
    for (let sideIndex = 0; sideIndex < 4; sideIndex++) {
      const side = SIDES[sideIndex] as number;
      if (!(mask & side)) continue;
      const next = neighbour(board, cell, sideIndex);
      if (next < 0 || !((tiles[next] as number) & opposite(side))) {
        out.push(cell);
        break;
      }
    }
  }

  return out;
}
