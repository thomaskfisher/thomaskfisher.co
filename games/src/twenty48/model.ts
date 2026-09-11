/**
 * 2048 rules. Pure — no DOM, no randomness, no solver.
 *
 * **Tiles are stored as exponents, not as the numbers on their faces.** A cell
 * holds 0 for empty, 1 for a 2, 2 for a 4, and so on. Merging is then `n + 1`
 * rather than `value * 2`, the target is a small integer rather than a power,
 * and the palette index is the exponent. The face value is a rendering concern
 * and appears in exactly one function.
 *
 * **Spawns are a pure function of the move number.** This is the rule that makes
 * the whole game deterministic, and it is lifted straight from Yahtzee: index
 * the randomness by *when* it happens rather than by a running counter, and a
 * rewind stops being an oracle. Without it, unlimited undo — a house rule here —
 * would let a player re-roll the spawn until it landed where they wanted, which
 * is not a puzzle.
 */

import { createRng, hashSeed } from '../shared/rng';

/** Up, right, down, left. The order matters only in that it is fixed. */
export const enum Dir {
  Up = 0,
  Right = 1,
  Down = 2,
  Left = 3,
}

export const DIRECTIONS = [Dir.Up, Dir.Right, Dir.Down, Dir.Left] as const;

/** A cell holds an exponent: 0 empty, 1 is a 2, 2 is a 4, 11 is 2048. */
export type Grid = number[];

/** The number painted on a tile. The only place exponents become faces. */
export function faceOf(exponent: number): number {
  return exponent === 0 ? 0 : 2 ** exponent;
}

export function emptyGrid(size: number): Grid {
  return new Array<number>(size * size).fill(0);
}

export function emptyCells(grid: Grid): number[] {
  const out: number[] = [];
  for (let cell = 0; cell < grid.length; cell++) if (grid[cell] === 0) out.push(cell);
  return out;
}

export function highestTile(grid: Grid): number {
  let best = 0;
  for (const exponent of grid) if (exponent > best) best = exponent;
  return best;
}

/* ------------------------------------------------------------------ */
/* Sliding                                                             */
/* ------------------------------------------------------------------ */

/** One tile's journey during a move. Two share a `to` when they merged. */
export interface Movement {
  from: number;
  to: number;
  /** True for both halves of a merge. */
  merged: boolean;
}

export interface SlideResult {
  grid: Grid;
  /** False when nothing could move, which is not a turn. */
  moved: boolean;
  /** Exponents of the tiles created by merging, for the score and the sounds. */
  merges: number[];
  /**
   * Where every tile went.
   *
   * Here so the renderer can animate the slide without keeping tile identities
   * across moves. Given the destination board and this list, each tile can be
   * drawn where it ended up and then animated *from* where it started — which
   * is the same picture as moving it, with none of the bookkeeping.
   */
  movements: Movement[];
}

/**
 * The cells of one line, in the order tiles travel when moving `direction`.
 *
 * Written once and shared by the slide and the solver rather than four
 * near-identical loops. Index 0 is the far end — the wall tiles pile up
 * against — which is what lets the merge pass below be direction-agnostic.
 */
export function lineCells(size: number, direction: Dir, line: number): number[] {
  const cells: number[] = [];
  for (let step = 0; step < size; step++) {
    switch (direction) {
      case Dir.Up:
        cells.push(step * size + line);
        break;
      case Dir.Down:
        cells.push((size - 1 - step) * size + line);
        break;
      case Dir.Left:
        cells.push(line * size + step);
        break;
      case Dir.Right:
        cells.push(line * size + (size - 1 - step));
        break;
    }
  }
  return cells;
}

/**
 * Slides and merges the whole board one way.
 *
 * **A tile merges at most once per move**, which is the rule that stops
 * `2 2 4` collapsing straight to an 8 and is the single most commonly
 * mis-implemented thing in this game. Enforced by building each line from
 * scratch and never looking back at a cell already written.
 */
export function slide(grid: Grid, size: number, direction: Dir): SlideResult {
  const next = grid.slice();
  const merges: number[] = [];
  const movements: Movement[] = [];
  let moved = false;

  for (let line = 0; line < size; line++) {
    const cells = lineCells(size, direction, line);

    /** The occupied cells of this line, in travel order, with where they were. */
    const values: { exponent: number; cell: number }[] = [];
    for (const cell of cells) {
      const exponent = grid[cell] as number;
      if (exponent !== 0) values.push({ exponent, cell });
    }

    const packed: { exponent: number; from: number[]; merged: boolean }[] = [];
    for (let i = 0; i < values.length; i++) {
      const here = values[i] as { exponent: number; cell: number };
      const nextUp = values[i + 1];

      if (nextUp && nextUp.exponent === here.exponent) {
        packed.push({ exponent: here.exponent + 1, from: [here.cell, nextUp.cell], merged: true });
        merges.push(here.exponent + 1);
        i++; // consumed, and cannot merge again this move
      } else {
        packed.push({ exponent: here.exponent, from: [here.cell], merged: false });
      }
    }

    for (let step = 0; step < size; step++) {
      const cell = cells[step] as number;
      const slot = packed[step];
      const value = slot ? slot.exponent : 0;

      if (next[cell] !== value) moved = true;
      next[cell] = value;

      if (slot) {
        for (const from of slot.from) movements.push({ from, to: cell, merged: slot.merged });
      }
    }
  }

  return { grid: next, moved, merges, movements };
}

/** Every direction that would actually change the board. */
export function legalMoves(grid: Grid, size: number): Dir[] {
  return DIRECTIONS.filter((direction) => slide(grid, size, direction).moved);
}

/** True when nothing can move in any direction. */
export function isStuck(grid: Grid, size: number): boolean {
  return legalMoves(grid, size).length === 0;
}

/* ------------------------------------------------------------------ */
/* Spawning                                                            */
/* ------------------------------------------------------------------ */

/** What the next tile will be, before it is known where it goes. */
export interface Spawn {
  /** Exponent: 1 for a 2, 2 for a 4. */
  exponent: number;
  /** Which of the empty cells it takes, once they are known. */
  pick: number;
}

/**
 * The tile that arrives after move number `moveIndex`.
 *
 * **Indexed by the move number and nothing else**, which is what keeps the
 * whole game a pure function of the save's move list. Two consequences worth
 * being explicit about:
 *
 *  - **Undo is not an oracle.** Rewinding and playing a *different* direction
 *    gets the same tile, because the tile was never a property of the move.
 *    Only where it lands can change, and only because the board did.
 *  - **The preview is honest.** The next tile's value is shown before the move
 *    is made, and it is genuinely already decided rather than drawn afterwards.
 *
 * One tile in ten is a 4, which is the original's ratio.
 */
export function spawnAt(seed: string, level: number, moveIndex: number): Spawn {
  const rng = createRng(hashSeed(seed, 'twenty48', level, moveIndex));
  return {
    exponent: rng.next() < 0.1 ? 2 : 1,
    // Large and reduced against the count at the call site, so the value does
    // not shift when the number of empty cells changes.
    pick: rng.int(0x10000),
  };
}

/** Places a spawn on the board. Returns the same grid when there is no room. */
export function placeSpawn(grid: Grid, spawn: Spawn): { grid: Grid; cell: number } {
  const open = emptyCells(grid);
  if (open.length === 0) return { grid, cell: -1 };

  const cell = open[spawn.pick % open.length] as number;
  const next = grid.slice();
  next[cell] = spawn.exponent;
  return { grid: next, cell };
}

/* ------------------------------------------------------------------ */
/* Replay                                                              */
/* ------------------------------------------------------------------ */

export interface Position {
  grid: Grid;
  /** Moves played so far, which is also the index of the next spawn. */
  moveIndex: number;
  /** Sum of every merged tile's face value. */
  score: number;
  /** Where the last spawn landed, so the renderer can pop it. */
  lastSpawn: number;
  /** Where every tile came from in the move that produced this position. */
  movements: Movement[];
}

/**
 * The board a level opens on: the starting tiles, already placed.
 *
 * The opening is two spawns rather than a dealt board, so the very first
 * position is as reproducible as every later one.
 */
export function openingPosition(seed: string, level: number, size: number, seeds: number): Position {
  let grid = emptyGrid(size);
  let lastSpawn = -1;

  for (let i = 0; i < seeds; i++) {
    // Negative indices, so the opening tiles cannot collide with the spawn for
    // move 0 — which would make the first move's tile depend on the opening.
    const placed = placeSpawn(grid, spawnAt(seed, level, -1 - i));
    grid = placed.grid;
    lastSpawn = placed.cell;
  }

  return { grid, moveIndex: 0, score: 0, lastSpawn, movements: [] };
}

/** Plays one direction. Returns null when that direction does nothing. */
export function step(
  position: Position,
  size: number,
  direction: Dir,
  seed: string,
  level: number,
): Position | null {
  const result = slide(position.grid, size, direction);
  if (!result.moved) return null;

  let score = position.score;
  for (const exponent of result.merges) score += faceOf(exponent);

  const placed = placeSpawn(result.grid, spawnAt(seed, level, position.moveIndex));

  return {
    grid: placed.grid,
    moveIndex: position.moveIndex + 1,
    score,
    lastSpawn: placed.cell,
    movements: result.movements,
  };
}

/** Replays a move list from the opening. Used by undo and by save restore. */
export function replay(
  seed: string,
  level: number,
  size: number,
  seeds: number,
  moves: readonly Dir[],
): Position {
  let position = openingPosition(seed, level, size, seeds);
  for (const direction of moves) {
    const next = step(position, size, direction, seed, level);
    // A move that no longer applies ends the replay rather than throwing: a
    // corrupt tail should cost the tail, not the level.
    if (!next) break;
    position = next;
  }
  return position;
}

/** Reached the target, which is the only way to finish a level. */
export function hasReached(grid: Grid, target: number): boolean {
  return highestTile(grid) >= target;
}
