/**
 * Pipes rules. Pure — no DOM, no randomness, no solver.
 *
 * **A tile is four bits.** One per side: north, east, south, west, set where the
 * tile has a pipe stub pointing that way. Everything else in the game falls out
 * of that choice:
 *
 *  - rotating is a bit-rotate, so it cannot get a tile's shape wrong;
 *  - two tiles are joined when each points at the other, which is one AND;
 *  - **symmetry is free.** A straight pipe turned 180° has the same four bits it
 *    started with, and a cross has the same four bits whatever you do to it. Any
 *    representation that stored "shape plus rotation" would have to special-case
 *    both, and the hint would spend its life asking the player to rotate a cross.
 */

/** Sides, as bits. The order is clockwise from the top, which the rotate relies on. */
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

export const SIDES = [N, E, S, W] as const;

/** Where each side leads, as (dx, dy). Indexed the same way as `SIDES`. */
export const STEPS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** The side facing back the other way. */
export function opposite(side: number): number {
  return ((side << 2) | (side >> 2)) & 0b1111;
}

/** One quarter turn clockwise. */
export function rotate(mask: number): number {
  return ((mask << 1) | (mask >> 3)) & 0b1111;
}

export function rotateTimes(mask: number, turns: number): number {
  let out = mask;
  for (let turn = 0; turn < ((turns % 4) + 4) % 4; turn++) out = rotate(out);
  return out;
}

/** How many distinct masks this tile has. 1 for a cross, 2 for a straight, else 4. */
export function distinctRotations(mask: number): number {
  const seen = new Set<number>();
  let current = mask;
  for (let turn = 0; turn < 4; turn++) {
    seen.add(current);
    current = rotate(current);
  }
  return seen.size;
}

export function popcount(mask: number): number {
  let count = 0;
  let bits = mask;
  while (bits) {
    bits &= bits - 1;
    count++;
  }
  return count;
}

/* ------------------------------------------------------------------ */
/* Boards                                                              */
/* ------------------------------------------------------------------ */

export interface Board {
  width: number;
  height: number;
  /** The cell water comes from. */
  source: number;
  /** The answer: each tile's mask when the network is whole. */
  solution: number[];
}

export type Tiles = number[];

export const xOf = (board: Board, cell: number): number => cell % board.width;
export const yOf = (board: Board, cell: number): number => Math.floor(cell / board.width);

/** The cell on the far side of `side`, or -1 if that is off the grid. */
export function neighbour(board: Board, cell: number, sideIndex: number): number {
  const step = STEPS[sideIndex] as readonly [number, number];
  const x = xOf(board, cell) + step[0];
  const y = yOf(board, cell) + step[1];
  if (x < 0 || y < 0 || x >= board.width || y >= board.height) return -1;
  return y * board.width + x;
}

/* ------------------------------------------------------------------ */
/* Play                                                                */
/* ------------------------------------------------------------------ */

/** A move is a cell, turned one quarter clockwise. That is the only move. */
export type Move = number;

export function applyMove(tiles: Tiles, cell: number): Tiles {
  if (cell < 0 || cell >= tiles.length) return tiles;
  const next = tiles.slice();
  next[cell] = rotate(tiles[cell] as number);
  return next;
}

export function replay(start: readonly number[], moves: readonly Move[]): Tiles {
  let tiles = start.slice();
  for (const move of moves) tiles = applyMove(tiles, move);
  return tiles;
}

/* ------------------------------------------------------------------ */
/* Water                                                               */
/* ------------------------------------------------------------------ */

/**
 * Which tiles the water reaches.
 *
 * A flood fill from the source across *matched* joins only. A stub pointing at a
 * neighbour that does not point back is a leak, not a join — which is the rule
 * that makes the puzzle a puzzle rather than a connectivity check.
 */
export function wetCells(board: Board, tiles: Tiles): boolean[] {
  const wet = new Array<boolean>(tiles.length).fill(false);
  const queue: number[] = [board.source];
  wet[board.source] = true;

  while (queue.length) {
    const cell = queue.pop() as number;
    const mask = tiles[cell] as number;

    for (let sideIndex = 0; sideIndex < 4; sideIndex++) {
      const side = SIDES[sideIndex] as number;
      if (!(mask & side)) continue;

      const next = neighbour(board, cell, sideIndex);
      if (next < 0 || wet[next]) continue;
      if (!((tiles[next] as number) & opposite(side))) continue;

      wet[next] = true;
      queue.push(next);
    }
  }

  return wet;
}

/**
 * Stubs that lead nowhere: off the edge of the grid, or at a neighbour that
 * does not point back. Drawn as drips, and the reason a nearly-finished board
 * is readable at a glance.
 */
export function leakCount(board: Board, tiles: Tiles): number {
  let leaks = 0;

  for (let cell = 0; cell < tiles.length; cell++) {
    const mask = tiles[cell] as number;
    for (let sideIndex = 0; sideIndex < 4; sideIndex++) {
      const side = SIDES[sideIndex] as number;
      if (!(mask & side)) continue;

      const next = neighbour(board, cell, sideIndex);
      if (next < 0 || !((tiles[next] as number) & opposite(side))) leaks++;
    }
  }

  return leaks;
}

/**
 * Solved when every tile is wet and nothing drips.
 *
 * **Both halves are needed, and it is worth saying why the first does not imply
 * the second.** Rotation preserves how many stubs a tile has, so the board
 * always carries exactly enough stubs for a spanning tree — but they can pair up
 * into a separate ring somewhere and leave a matching hole elsewhere. Such a
 * board has no leaks and is not connected. Checking wetness alone fails the
 * other way: a leaking board can still be fully wet.
 */
export function isSolved(board: Board, tiles: Tiles): boolean {
  if (leakCount(board, tiles) > 0) return false;
  return wetCells(board, tiles).every(Boolean);
}

/** Tiles already carrying water. The clock pays out on this. */
export function wetCount(board: Board, tiles: Tiles): number {
  let count = 0;
  for (const wet of wetCells(board, tiles)) if (wet) count++;
  return count;
}

/**
 * Tiles whose mask does not match the answer's.
 *
 * Compared by *mask* rather than by turn count, which is the whole reason the
 * bit representation was chosen: a straight pipe lying the right way round is
 * correct whichever of its two turns put it there, and a cross is never wrong.
 */
export function misalignedCount(board: Board, tiles: Tiles): number {
  let count = 0;
  for (let cell = 0; cell < tiles.length; cell++) {
    if (tiles[cell] !== board.solution[cell]) count++;
  }
  return count;
}

/** How many quarter turns separate this tile from the answer. 0-3. */
export function turnsTo(from: number, to: number): number {
  let mask = from;
  for (let turns = 0; turns < 4; turns++) {
    if (mask === to) return turns;
    mask = rotate(mask);
  }
  return 0;
}
