import { describe, expect, it } from 'vitest';

import { pressureForLevel } from '../shared/difficulty';
import { createRng, hashSeed } from '../shared/rng';
import {
  GAME_ID,
  OPENING_TILES,
  SIZE,
  generateLevel,
  score,
  targetFace,
  targetForBand,
} from './generate';
import { Dir, emptyCells, hasReached, openingPosition, step } from './model';
import { bestMove, evaluate, playOut } from './solve';

/**
 * The generator invariant sweep.
 *
 * The headline claim here is different from the other puzzles' and is checked
 * the same way: **the level can be finished, and the proof is a playthrough.**
 * Deterministic spawns are what make that mean anything — the tiles the verifier
 * was handed are the tiles the player will be handed, move for move.
 *
 * The playthrough is slow (a 1024 takes about five hundred moves of depth-five
 * search), so the sweep is shorter here than elsewhere and the deep levels are
 * checked at a lower depth. A level the *weaker* search can finish is finished
 * by the shipped one too.
 */

const SWEEP = [1, 2, 4, 8, 16, 30, 50, 90];

/**
 * Generating a deep level here means *playing a whole game of 2048* with a
 * depth-five search — about a second for a 1024, and several when a test does
 * half a dozen. That is honest work rather than a hang, so the slow tests say
 * so explicitly instead of running under the five-second default and failing
 * as a timeout, which is what they did first and reads as a broken generator.
 */
const SLOW = 120_000;

describe('generated levels', () => {
  for (const level of SWEEP) {
    describe(`level ${level}`, () => {
      const generated = generateLevel('sweep-seed', level);

      it('is well formed', () => {
        expect(generated.size).toBe(SIZE);
        expect(generated.seeds).toBe(OPENING_TILES);
        expect(generated.target).toBeGreaterThanOrEqual(6);
        expect(generated.target).toBeLessThanOrEqual(10);
        expect(generated.difficulty).toBeGreaterThanOrEqual(0);
        expect(generated.difficulty).toBeLessThanOrEqual(1);
      });

      it('opens on a board that is not already finished', () => {
        const opening = openingPosition('sweep-seed', level, SIZE, OPENING_TILES);
        expect(emptyCells(opening.grid)).toHaveLength(SIZE * SIZE - OPENING_TILES);
        expect(hasReached(opening.grid, generated.target)).toBe(false);
      });

      it(
        'can be finished, and the verifier walked the line to prove it',
        () => {
          const played = playOut('sweep-seed', level, SIZE, OPENING_TILES, generated.target, {
            depth: 4,
          });
          expect(played.reached).toBe(true);
          expect(played.moves).toBeGreaterThan(0);
        },
        SLOW,
      );

      it('reports a par that a real playthrough took', () => {
        expect(generated.par).toBeGreaterThan(0);
        // More moves than merges needed, by a wide margin — a sanity bound
        // rather than a tight one.
        expect(generated.par).toBeGreaterThanOrEqual(2 ** (generated.target - 1) / 8);
      });
    });
  }
});

describe('determinism', () => {
  it('is a pure function of (seed, level)', () => {
    for (const level of [1, 12, 40]) {
      const first = generateLevel('same', level);
      const second = generateLevel('same', level);
      expect(first).toEqual(second);
    }
  });

  it('gives different profiles different boards', () => {
    const a = openingPosition('profile-a', 10, SIZE, OPENING_TILES);
    const b = openingPosition('profile-b', 10, SIZE, OPENING_TILES);
    expect(a.grid).not.toEqual(b.grid);
  });
});

describe('the difficulty curve', () => {
  it(
    'climbs from level 1 to the ceiling',
    () => {
      const early = generateLevel('curve', 1).difficulty;
      const late = generateLevel('curve', 50).difficulty;
      expect(late).toBeGreaterThan(early);
      expect(late - early).toBeGreaterThan(0.4);
    },
    SLOW,
  );

  it(
    'lands inside the band it was asked for',
    () => {
      for (const level of [1, 5, 12, 20, 30, 50]) {
        const rng = createRng(hashSeed('band-check', GAME_ID, level));
        const { band } = pressureForLevel(level, rng);
        const generated = generateLevel('band-check', level);

        expect(
          generated.difficulty,
          `level ${level} scored ${generated.difficulty} against [${band[0]}, ${band[1]}]`,
        ).toBeGreaterThanOrEqual(band[0]);
        expect(generated.difficulty).toBeLessThanOrEqual(band[1]);
      }
    },
    SLOW,
  );

  it('climbs the target ladder with the band, and stops at 1024', () => {
    expect(targetFace(targetForBand([0, 0.05]))).toBe(64);
    expect(targetFace(targetForBand([0.95, 1]))).toBe(1024);
    // Monotone: a harder band never asks for a smaller tile.
    let last = 0;
    for (let centre = 0; centre <= 1; centre += 0.05) {
      const target = targetForBand([centre, centre]);
      expect(target).toBeGreaterThanOrEqual(last);
      last = target;
    }
  });
});

describe('score', () => {
  it('rises with the target and with the trap rate', () => {
    expect(score(10, 0.5)).toBeGreaterThan(score(6, 0.5));
    expect(score(8, 1)).toBeGreaterThan(score(8, 0));
  });

  it('never leaves 0..1', () => {
    expect(score(6, 0)).toBeGreaterThanOrEqual(0);
    expect(score(10, 1)).toBeLessThanOrEqual(1);
  });
});

describe('the strong player', () => {
  it('prefers a board with more room', () => {
    const roomy = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const crowded = [1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 0];
    expect(evaluate(roomy, SIZE)).toBeGreaterThan(evaluate(crowded, SIZE));
  });

  it('prefers the biggest tile in a corner', () => {
    const corner = [8, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const adrift = [0, 4, 2, 1, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(evaluate(corner, SIZE)).toBeGreaterThan(evaluate(adrift, SIZE));
  });

  /** The hint is this function, so it has to be stable for the same position. */
  it('gives the same answer to the same position', () => {
    const position = openingPosition('hint', 4, SIZE, OPENING_TILES);
    expect(bestMove(position, SIZE, 'hint', 4)).toBe(bestMove(position, SIZE, 'hint', 4));
  });

  it('only ever suggests a direction that actually moves', () => {
    let position = openingPosition('hint', 4, SIZE, OPENING_TILES);

    for (let move = 0; move < 60; move++) {
      const direction = bestMove(position, SIZE, 'hint', 4, 3);
      if (direction === null) break;
      const next = step(position, SIZE, direction, 'hint', 4);
      expect(next, `suggested a dead direction at move ${move}`).not.toBeNull();
      if (!next) return;
      position = next;
    }
  });

  it('returns null only when the board is finished', () => {
    const jammed = {
      grid: [1, 2, 1, 2, 2, 1, 2, 1, 1, 2, 1, 2, 2, 1, 2, 1],
      moveIndex: 0,
      score: 0,
      lastSpawn: -1,
      movements: [],
    };
    expect(bestMove(jammed, SIZE, 'x', 1, 2)).toBeNull();
  });
});

describe('directions', () => {
  it('covers all four', () => {
    expect(new Set([Dir.Up, Dir.Right, Dir.Down, Dir.Left]).size).toBe(4);
  });
});
