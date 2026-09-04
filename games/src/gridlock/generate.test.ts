import { describe, expect, it } from 'vitest';

import { pressureForLevel } from '../shared/difficulty';
import { createRng, hashSeed } from '../shared/rng';
import { format } from './ascii';
import {
  EASIEST_MOVES,
  HARDEST_MOVES,
  type GeneratedLevel,
  generateLevel,
  scoreDifficulty,
  shapeFor,
} from './generate';
import {
  EXIT_ROW,
  SIZE,
  TARGET,
  TARGET_LENGTH,
  applyMove,
  blockersAhead,
  isLegalMove,
  isSolved,
  isValidPosition,
  isWellFormed,
} from './model';
import { findSolution, minMoves } from './solve';

const SEED = 'test-profile-seed';

/**
 * A spread across the curve, weighted towards where the shape changes.
 *
 * Shorter than the other games' sweeps on purpose: a Gridlock level costs an
 * exhaustive search of a few thousand positions, repeated across a hill climb,
 * so generating one is closer to a second than to a millisecond. The sweep is
 * therefore generated **once** and shared by every assertion below rather than
 * regenerated per test.
 */
const SWEEP = [1, 2, 4, 6, 9, 13, 18, 24, 32, 42, 55, 80, 130, 240];

const LEVELS: GeneratedLevel[] = SWEEP.map((level) => generateLevel(SEED, level));

const show = (generated: GeneratedLevel): string =>
  `level ${generated.level}\n${format(generated.board, generated.start)}`;

describe('generated levels', () => {
  /**
   * The one that matters.
   *
   * For every level in the sweep: the park is structurally sound, it is not
   * already finished, it can be solved, and the line the solver hands back
   * actually gets the target out when it is played move by move.
   *
   * That last clause is the point. "Solvable" and "here is a solution that
   * works" are two different claims, and only replaying tests the second — which
   * is the one that reaches the player, as a hint that moves the wrong car.
   */
  it('are well formed, solvable, and solved by following the solver', () => {
    for (const generated of LEVELS) {
      const { board, start } = generated;

      expect(isWellFormed(board), show(generated)).toBe(true);
      expect(isValidPosition(board, start), show(generated)).toBe(true);
      expect(isSolved(board, start), `${show(generated)} is already finished`).toBe(false);

      const solution = findSolution(board, start);
      expect(solution, `${show(generated)} has no solution`).not.toBeNull();

      let at: readonly number[] = start;
      for (const move of solution as { id: number; to: number }[]) {
        expect(isLegalMove(board, at, move), `illegal move on\n${format(board, at)}`).toBe(true);
        at = applyMove(at, move);
      }

      expect(isSolved(board, at), `${show(generated)} solution does not finish`).toBe(true);
    }
  }, 120_000);

  /**
   * The generator reports the depth it read out of its own analysis. An
   * independent search from the same position has to agree, or every level in
   * the game is mis-rated and nothing says so.
   */
  it('report the true shortest-solution length', () => {
    for (const generated of LEVELS) {
      expect(minMoves(generated.board, generated.start), show(generated)).toBe(generated.moves);
      expect(generated.difficulty).toBeCloseTo(scoreDifficulty(generated.moves), 10);
    }
  }, 120_000);

  it('always leave something in the way of the exit', () => {
    for (const generated of LEVELS) {
      expect(blockersAhead(generated.board, generated.start).length, show(generated)).toBeGreaterThan(0);
    }
  });

  it('keep the target in the exit row and every vehicle a legal length', () => {
    for (const generated of LEVELS) {
      const target = generated.board.vehicles[TARGET];
      expect(target?.orientation).toBe('h');
      expect(target?.length).toBe(TARGET_LENGTH);
      expect(target?.cross).toBe(EXIT_ROW);

      for (const vehicle of generated.board.vehicles) {
        expect(vehicle.length).toBeGreaterThanOrEqual(2);
        expect(vehicle.length).toBeLessThanOrEqual(4);
        expect(vehicle.cross).toBeGreaterThanOrEqual(0);
        expect(vehicle.cross).toBeLessThan(SIZE);
      }
    }
  });

  /**
   * Difficulty is chosen rather than sampled — the generator picks the layer of
   * the component at the depth the curve asked for — so landing inside the band
   * should be the overwhelming norm rather than a coin flip. A level that misses
   * is one whose hill climb never found a deep enough layout, and a handful of
   * those is tolerable; a third of them would mean the ceiling is set above what
   * the format can reach, which is the mistake this whole file exists to avoid.
   */
  it('land inside the difficulty band they were asked for', () => {
    const missed = LEVELS.filter((generated) => {
      const pressure = pressureForLevel(
        generated.level,
        createRng(hashSeed(SEED, 'gridlock', 'pressure', generated.level)),
      );
      return (
        generated.difficulty < pressure.band[0] || generated.difficulty > pressure.band[1]
      );
    });

    expect(missed.map((generated) => `${generated.level}:${generated.moves}`)).toHaveLength(0);
  });

  /** The curve has to actually climb, not just vary. */
  it('get harder as the curve rises', () => {
    const early = LEVELS.slice(0, 4);
    const late = LEVELS.slice(-4);
    const mean = (list: GeneratedLevel[]) =>
      list.reduce((total, generated) => total + generated.moves, 0) / list.length;

    expect(mean(late)).toBeGreaterThan(mean(early) + 5);
    expect(mean(early)).toBeGreaterThanOrEqual(EASIEST_MOVES);
    expect(mean(late)).toBeLessThanOrEqual(HARDEST_MOVES);
  });

  /**
   * The save stores a move list, not a board. If the same (seed, level) ever
   * produced a different park, every save in the wild would replay its moves
   * against geometry that no longer matches.
   */
  it('are a pure function of the seed and the level', () => {
    for (const level of [1, 13, 55]) {
      const first = generateLevel(SEED, level);
      const second = generateLevel(SEED, level);
      expect(second.board).toEqual(first.board);
      expect(second.start).toEqual(first.start);
      expect(second.moves).toBe(first.moves);
    }
  }, 60_000);

  it('differ between profiles', () => {
    const mine = generateLevel(SEED, 7);
    const theirs = generateLevel('a-different-profile', 7);
    expect(format(theirs.board, theirs.start)).not.toBe(format(mine.board, mine.start));
  }, 60_000);
});

describe('the shape function', () => {
  it('keeps the park inside the range the depth survey found usable', () => {
    for (const level of [1, 5, 12, 25, 50, 120, 400]) {
      const pressure = pressureForLevel(level, createRng(hashSeed(SEED, 'shape', level)));
      const shape = shapeFor(pressure, createRng(hashSeed(SEED, 'shape', 'rng', level)));

      // Above about thirteen vehicles the park jams and yield collapses — see
      // `tools/gridlock.ts`. Below eight there is nothing in the way.
      expect(shape.vehicles).toBeGreaterThanOrEqual(8);
      expect(shape.vehicles).toBeLessThanOrEqual(13);
      expect(shape.gates).toBeGreaterThanOrEqual(1);
      expect(shape.gates).toBeLessThanOrEqual(3);
    }
  });
});
