import { describe, expect, it } from 'vitest';

import { dieFace, openingRoll, pipsFor, turnRoll } from './board';

/**
 * The dice.
 *
 * There is no level to verify here and no difficulty to measure, so this stands
 * where the puzzles keep their generator sweep, and it is guarding the promise
 * that replaces theirs: **the dice are fair, and they were fixed before either
 * player picked the phone up.** Two people playing across a table have to trust
 * that between them, and neither of them can audit a hash — so it is tested
 * rather than asserted, and everything here is seeded, which means a failure is
 * a real change in behaviour and never a flake.
 */

/** Sum of (observed - expected)^2 / expected. */
function chiSquare(observed: readonly number[], expected: number): number {
  return observed.reduce((sum, count) => sum + (count - expected) ** 2 / expected, 0);
}

const SEEDS = Array.from({ length: 300 }, (_, i) => `fairness-${i}`);
const TURNS = 120;
/** 5 degrees of freedom: 20.5 is the 0.999 point. */
const CHI_6 = 20.5;

describe('every face is equally likely', () => {
  it('is uniform across every turn and both dice', () => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const seed of SEEDS) {
      for (let turn = 1; turn <= TURNS; turn++) {
        for (let die = 0; die < 2; die++) {
          const face = dieFace(seed, turn, die);
          expect(face).toBeGreaterThanOrEqual(1);
          expect(face).toBeLessThanOrEqual(6);
          counts[face] = (counts[face] as number) + 1;
        }
      }
    }

    const total = counts.reduce((sum, count) => sum + count, 0);
    expect(total).toBe(SEEDS.length * TURNS * 2);
    expect(chiSquare(counts.slice(1), total / 6)).toBeLessThan(CHI_6);
  });

  /**
   * A hash that mixed its arguments poorly could be uniform overall and still
   * give the left-hand die a taste for sixes, or turn 7 a taste for ones. That
   * is the bias a player would feel and could never prove, so each input is
   * checked on its own.
   */
  it('is uniform die by die and turn by turn', () => {
    const byDie = [0, 1].map(() => [0, 0, 0, 0, 0, 0, 0]);
    const byTurn = Array.from({ length: TURNS + 1 }, () => [0, 0, 0, 0, 0, 0, 0]);

    for (const seed of SEEDS) {
      for (let turn = 1; turn <= TURNS; turn++) {
        for (let die = 0; die < 2; die++) {
          const face = dieFace(seed, turn, die);
          (byDie[die] as number[])[face] = ((byDie[die] as number[])[face] as number) + 1;
          (byTurn[turn] as number[])[face] = ((byTurn[turn] as number[])[face] as number) + 1;
        }
      }
    }

    for (const [index, counts] of byDie.entries()) {
      const total = counts.reduce((sum, count) => sum + count, 0);
      expect(chiSquare(counts.slice(1), total / 6), `die ${index}`).toBeLessThan(CHI_6);
    }
    for (let turn = 1; turn <= TURNS; turn++) {
      const counts = byTurn[turn] as number[];
      const total = counts.reduce((sum, count) => sum + count, 0);
      expect(chiSquare(counts.slice(1), total / 6), `turn ${turn}`).toBeLessThan(CHI_6);
    }
  });
});

describe('the two dice are independent', () => {
  /**
   * Per-face uniformity passes happily while the pair leans on itself, and a
   * doubles rate that is off is the one a player notices within an evening —
   * doubles are worth four moves, so a generator that is shy of them is quietly
   * making every game longer.
   */
  it('rolls doubles about one time in six', () => {
    let doubles = 0;
    let rolls = 0;
    const pairs = Array.from({ length: 36 }, () => 0);

    for (const seed of SEEDS) {
      for (let turn = 1; turn <= TURNS; turn++) {
        const [a, b] = turnRoll(seed, turn);
        pairs[(a - 1) * 6 + (b - 1)] = (pairs[(a - 1) * 6 + (b - 1)] as number) + 1;
        if (a === b) doubles++;
        rolls++;
      }
    }

    expect(doubles / rolls).toBeGreaterThan(0.15);
    expect(doubles / rolls).toBeLessThan(0.18);
    // 35 degrees of freedom over the whole 6x6 grid: 66.6 is the 0.999 point.
    expect(chiSquare(pairs, rolls / 36)).toBeLessThan(66.6);
  });

  it('is worth four moves when the faces match, and two when they do not', () => {
    expect(pipsFor([3, 3])).toEqual([3, 3, 3, 3]);
    expect(pipsFor([5, 2])).toEqual([5, 2]);
  });
});

describe('the roll that decides who starts', () => {
  const openings = SEEDS.map((seed) => openingRoll(seed));

  it('is never a tie, because a tie is thrown again', () => {
    for (const opening of openings) {
      expect(opening.dice[0]).not.toBe(opening.dice[1]);
      expect(opening.first).toBe(opening.dice[0] > opening.dice[1] ? 'white' : 'red');
    }
    // And the re-rolls genuinely happen, rather than the tie being papered over
    // by an off-by-one that could only ever draw distinct faces.
    expect(openings.some((opening) => opening.ties > 0)).toBe(true);
  });

  it('starts each player about half the time', () => {
    const white = openings.filter((opening) => opening.first === 'white').length;
    expect(white / openings.length).toBeGreaterThan(0.42);
    expect(white / openings.length).toBeLessThan(0.58);
  });

  it('is what the first turn is played with', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      expect(turnRoll(seed, 0)).toEqual(openingRoll(seed).dice);
    }
  });
});

describe('a face depends on nothing but the seed and the turn', () => {
  it('gives the same answer however it is asked', () => {
    for (const seed of SEEDS.slice(0, 30)) {
      for (let turn = 0; turn < 20; turn++) {
        expect(turnRoll(seed, turn)).toEqual(turnRoll(seed, turn));
        expect(dieFace(seed, turn, 0)).toBe(dieFace(seed, turn, 0));
      }
    }
  });

  it('gives different games different dice', () => {
    const first = SEEDS.slice(0, 50).map((seed) => turnRoll(seed, 4).join(''));
    expect(new Set(first).size).toBeGreaterThan(15);
  });
});
