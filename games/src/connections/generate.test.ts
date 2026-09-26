import { describe, expect, it } from 'vitest';

import { CATEGORIES } from './categories';
import { TRAP_BAND, generateLevel } from './generate';
import { indicesOf, initialProgress, play } from './model';
import { candidates, isPartition, partitions } from './solve';

/**
 * The generator invariant sweep.
 *
 * The claim that matters is the one the original cannot make: **every puzzle
 * has exactly one answer**, across every category in the bank — not just the
 * four it was built from. Checked here by re-running the solver from scratch
 * on the dealt words, and then by playing the answer through the rules.
 */

const SWEEP = [1, 2, 3, 4, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610];

describe('generated puzzles', () => {
  for (const level of SWEEP) {
    describe(`puzzle ${level}`, () => {
      const generated = generateLevel('sweep-seed', level);

      it('is well formed', () => {
        expect(generated.words).toHaveLength(16);
        expect(new Set(generated.words).size).toBe(16);
        expect(generated.groups).toHaveLength(4);
        expect(isPartition(generated.groups.map((group) => group.mask))).toBe(true);
        expect(generated.groups.map((group) => group.color)).toEqual([0, 1, 2, 3]);
      });

      it('has one group from each tier, yellow to purple', () => {
        expect(generated.groups.map((group) => group.tier)).toEqual([1, 2, 3, 4]);
      });

      it('labels each group with a category that accepts its words', () => {
        for (const group of generated.groups) {
          const category = CATEGORIES.find((c) => c.name === group.name);
          expect(category, group.name).toBeDefined();
          for (const index of indicesOf(group.mask)) {
            expect(category!.words, group.name).toContain(generated.words[index]);
          }
        }
      });

      it('has exactly one answer across the whole bank', () => {
        const found = partitions(candidates(generated.words), 5);
        expect(found).toHaveLength(1);
        expect(new Set(found[0])).toEqual(new Set(generated.groups.map((group) => group.mask)));
      });

      it('is won by playing its answer', () => {
        let progress = initialProgress();
        for (const group of generated.groups) {
          const next = play(generated, progress, group.mask);
          expect(next).not.toBeNull();
          progress = next!;
        }
        expect(progress.won).toBe(true);
        expect(progress.mistakes).toBe(0);
      });

      it('has at least one herring', () => {
        expect(generated.decoys).toBeGreaterThan(0);
      });
    });
  }

  it('lands nearly every puzzle inside the trap band', () => {
    let inside = 0;
    for (let level = 1; level <= 60; level++) {
      const { trapRate } = generateLevel('band-seed', level);
      if (trapRate >= TRAP_BAND[0] && trapRate <= TRAP_BAND[1]) inside++;
    }
    expect(inside).toBeGreaterThanOrEqual(57);
  });

  it('is deterministic', () => {
    expect(generateLevel('same', 42)).toEqual(generateLevel('same', 42));
  });

  it('varies between profiles', () => {
    expect(generateLevel('one', 7).words).not.toEqual(generateLevel('two', 7).words);
  });

  it('rarely repeats a category across neighbouring puzzles', () => {
    const seen = new Map<string, number>();
    for (let level = 1; level <= 40; level++) {
      for (const group of generateLevel('variety', level).groups) {
        seen.set(group.name, (seen.get(group.name) ?? 0) + 1);
      }
    }
    // 160 groups from a bank of three hundred-odd categories.
    expect(seen.size).toBeGreaterThan(100);
  });
});
