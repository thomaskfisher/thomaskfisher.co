import { describe, expect, it } from 'vitest';

import { createRng } from '../shared/rng';
import { candidates, isPartition, partitions, trapRate } from './solve';

/** Four clean lists that share nothing. One answer, no decoys. */
const CLEAN = [
  'MERCURY', 'VENUS', 'EARTH', 'NEPTUNE',
  'CHEDDAR', 'BRIE', 'GOUDA', 'FETA',
  'TANGO', 'WALTZ', 'SALSA', 'RUMBA',
  'COMMA', 'PERIOD', 'COLON', 'HYPHEN',
];

describe('candidates', () => {
  it('finds each group on a clean board', () => {
    const pool = candidates(CLEAN);
    const found = partitions(pool, 5);
    expect(found).toHaveLength(1);
    expect(isPartition(found[0]!)).toBe(true);
  });

  it('turns a fifth member into four decoy sets', () => {
    // BASS is a fish, and it is dealt here as an instrument: five fish on the
    // board, four of them the answer — five four-word fish sets in all.
    const words = [
      'PIKE', 'CARP', 'COD', 'TROUT',
      'BASS', 'PIANO', 'GUITAR', 'VIOLIN',
      'TANGO', 'WALTZ', 'SALSA', 'RUMBA',
      'COMMA', 'PERIOD', 'COLON', 'HYPHEN',
    ];
    const pool = candidates(words);
    const fish = pool.filter((candidate) => candidate.mask & 0b10001 && candidate.mask & 0b1110);
    expect(fish.length).toBeGreaterThanOrEqual(4);
    expect(partitions(pool, 5)).toHaveLength(1);
  });
});

describe('partitions', () => {
  it('reports a board with two answers', () => {
    // Four planets that are also Roman gods, and four gods that are not
    // planets: MARS and MERCURY can sit in either group.
    const words = [
      'EARTH', 'URANUS', 'MARS', 'SATURN',
      'JUNO', 'CUPID', 'VULCAN', 'MERCURY',
      'TANGO', 'WALTZ', 'SALSA', 'RUMBA',
      'COMMA', 'PERIOD', 'COLON', 'HYPHEN',
    ];
    expect(partitions(candidates(words), 5).length).toBeGreaterThan(1);
  });
});

describe('trap rate', () => {
  it('is zero on a board with no decoys', () => {
    const pool = candidates(CLEAN);
    const [solution] = partitions(pool);
    expect(trapRate(createRng(1), pool, solution!, 40, 4)).toBe(0);
  });
});
