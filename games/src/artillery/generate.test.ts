import { describe, expect, it } from 'vitest';

import { hashSeed } from '../shared/rng';
import { COLUMNS, GROUND_MAX, GROUND_MIN, encodeTerrain } from './terrain';
import { canReach, generateOpening, hasLineOfSight, reachCount } from './generate';
import { POOL_IDS } from './model';

const SEED = 'test-artillery';

/**
 * The invariant sweep. In the puzzles this is the most valuable test in the
 * project, and it is the same shape here with solvability replaced by the two
 * promises this game can actually make: both sides can reach the other, and the
 * battlefield is covered or open as the seed asked.
 */
describe('every battlefield', () => {
  const MATCHES = 80;

  it('is a pure function of the seed and the match number', () => {
    for (const match of [1, 2, 17, 140]) {
      const once = generateOpening(SEED, match);
      const twice = generateOpening(SEED, match);
      expect(encodeTerrain(once.terrain)).toBe(encodeTerrain(twice.terrain));
      expect(once.columns).toEqual(twice.columns);
    }
  });

  it('differs between matches and between profiles', () => {
    const shapes = new Set<string>();
    for (let match = 1; match <= 20; match++) {
      shapes.add(encodeTerrain(generateOpening(SEED, match).terrain));
      shapes.add(encodeTerrain(generateOpening('another-profile', match).terrain));
    }
    expect(shapes.size).toBe(40);
  });

  it('keeps the ground inside the field', () => {
    for (let match = 1; match <= MATCHES; match++) {
      const { terrain } = generateOpening(SEED, match);
      expect(terrain).toHaveLength(COLUMNS);
      for (const height of terrain) {
        expect(height).toBeGreaterThanOrEqual(GROUND_MIN);
        expect(height).toBeLessThanOrEqual(GROUND_MAX);
      }
    }
  });

  it('starts both tanks apart, inset, and on level ground', () => {
    for (let match = 1; match <= MATCHES; match++) {
      const { terrain, columns } = generateOpening(SEED, match);
      const [left, right] = columns;

      expect(left).toBeGreaterThanOrEqual(4);
      expect(left).toBeLessThanOrEqual(14);
      expect(right).toBeGreaterThanOrEqual(81);
      expect(right).toBeLessThanOrEqual(91);
      expect(right - left).toBeGreaterThan(60);

      // A pad, so neither tank opens the match unable to move either way.
      for (const column of columns) {
        for (let c = column - 2; c <= column + 2; c++) {
          expect(terrain[c]).toBe(terrain[column]);
        }
      }
    }
  });

  it('can be hit from both sides, with a band of settings rather than one', () => {
    for (let match = 1; match <= MATCHES; match++) {
      const { terrain, columns } = generateOpening(SEED, match);
      expect(canReach(terrain, columns[0], columns[1]), `match ${match}, left to right`).toBe(true);
      expect(canReach(terrain, columns[1], columns[0]), `match ${match}, right to left`).toBe(true);
      expect(reachCount(terrain, columns[0], columns[1], 3)).toBeGreaterThanOrEqual(3);
      expect(reachCount(terrain, columns[1], columns[0], 3)).toBeGreaterThanOrEqual(3);
    }
  });

  it('is covered or open exactly as the seed asked', () => {
    let covered = 0;
    for (let match = 1; match <= MATCHES; match++) {
      const { terrain, columns } = generateOpening(SEED, match);
      const wantsCover = hashSeed(SEED, 'artillery-cover', match) % 4 !== 0;
      expect(hasLineOfSight(terrain, columns), `match ${match}`).toBe(!wantsCover);
      if (wantsCover) covered++;
    }
    // Roughly three in four, which is what `OPEN_FIELD_IN` asks for. Checked as
    // a band because the seed decides each match independently.
    expect(covered / MATCHES).toBeGreaterThan(0.6);
    expect(covered / MATCHES).toBeLessThan(0.9);
  });

  it('offers the whole weapon pool to draft from', () => {
    const { pool } = generateOpening(SEED, 1);
    expect(pool).toEqual([...POOL_IDS]);
    expect(pool.length % 2).toBe(0);
  });
});

describe('line of sight', () => {
  it('is clear across flat ground and blocked by a wall between', () => {
    const flat = new Uint8Array(COLUMNS).fill(40);
    expect(hasLineOfSight(flat, [8, 88])).toBe(true);

    const walled = new Uint8Array(COLUMNS).fill(40);
    for (let c = 40; c < 50; c++) walled[c] = 90;
    expect(hasLineOfSight(walled, [8, 88])).toBe(false);
  });

  it('is clear over a dip, which is why cover is checked and not assumed', () => {
    const dipped = new Uint8Array(COLUMNS).fill(40);
    for (let c = 30; c < 60; c++) dipped[c] = 14;
    expect(hasLineOfSight(dipped, [8, 88])).toBe(true);
  });
});

describe('reaching across', () => {
  it('finds no shot out of a pit walled higher than the field allows', () => {
    const terrain = new Uint8Array(COLUMNS).fill(GROUND_MAX);
    terrain[8] = 10;
    terrain[88] = 10;
    for (let c = 6; c <= 10; c++) terrain[c] = 10;
    for (let c = 86; c <= 90; c++) terrain[c] = 10;
    expect(canReach(terrain, 8, 88)).toBe(false);
  });

  it('finds plenty of shots across open ground', () => {
    const flat = new Uint8Array(COLUMNS).fill(40);
    expect(reachCount(flat, 8, 88)).toBeGreaterThan(5);
  });
});
