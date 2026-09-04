import { describe, expect, it } from 'vitest';

import {
  CATEGORIES,
  DICE,
  applyMove,
  dieFace,
  rerollMove,
  replay,
  scoreFor,
  scoreMove,
  startRound,
} from './model';

/**
 * The dice.
 *
 * This is the most important test in the game, and it stands where the other
 * four games have their generator invariant sweep. They promise "no level is a
 * dead end" and prove it with a solver; there is nothing to prove here, because
 * every round can be finished by writing a zero somewhere. What this game
 * promises instead is that **the dice are fair and were fixed before you touched
 * them** — that the app is not quietly weighting a roll against a good card, and
 * that nothing you do can change what a throw was going to give you.
 *
 * Both halves are testable, so both are tested. Everything here is seeded, so
 * these numbers are fixed rather than sampled: a failure is a real change in
 * behaviour, never a flake.
 */

/** Sum of (observed - expected)^2 / expected. */
function chiSquare(observed: readonly number[], expected: number): number {
  return observed.reduce((sum, count) => sum + (count - expected) ** 2 / expected, 0);
}

const SEEDS = Array.from({ length: 400 }, (_, i) => `fairness-${i}`);

describe('every face is equally likely', () => {
  it('is uniform across the whole space of turns, throws and slots', () => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const seed of SEEDS) {
      for (let turn = 0; turn < CATEGORIES.length; turn++) {
        for (let roll = 0; roll < 3; roll++) {
          for (let slot = 0; slot < DICE; slot++) {
            const face = dieFace(seed, turn, roll, slot);
            expect(face).toBeGreaterThanOrEqual(1);
            expect(face).toBeLessThanOrEqual(6);
            counts[face] = (counts[face] as number) + 1;
          }
        }
      }
    }

    const total = counts.reduce((sum, count) => sum + count, 0);
    expect(total).toBe(SEEDS.length * CATEGORIES.length * 3 * DICE);
    // 5 degrees of freedom: 20.5 is the 0.999 point, so a fair generator is far
    // under it and a generator with a visible lean is far over.
    expect(chiSquare(counts.slice(1), total / 6)).toBeLessThan(20.5);
  });

  /**
   * A hash that mixed its arguments poorly could be uniform overall and still
   * give slot 3 a taste for sixes, which is exactly the bias a player would
   * notice and could not prove. So each input is checked on its own.
   */
  it('is uniform slot by slot, throw by throw, and turn by turn', () => {
    const bySlot = Array.from({ length: DICE }, () => [0, 0, 0, 0, 0, 0, 0]);
    const byRoll = Array.from({ length: 3 }, () => [0, 0, 0, 0, 0, 0, 0]);
    const byTurn = Array.from({ length: CATEGORIES.length }, () => [0, 0, 0, 0, 0, 0, 0]);

    for (const seed of SEEDS) {
      for (let turn = 0; turn < CATEGORIES.length; turn++) {
        for (let roll = 0; roll < 3; roll++) {
          for (let slot = 0; slot < DICE; slot++) {
            const face = dieFace(seed, turn, roll, slot);
            (bySlot[slot] as number[])[face] = ((bySlot[slot] as number[])[face] as number) + 1;
            (byRoll[roll] as number[])[face] = ((byRoll[roll] as number[])[face] as number) + 1;
            (byTurn[turn] as number[])[face] = ((byTurn[turn] as number[])[face] as number) + 1;
          }
        }
      }
    }

    for (const group of [...bySlot, ...byRoll, ...byTurn]) {
      const total = group.reduce((sum, count) => sum + count, 0);
      expect(chiSquare(group.slice(1), total / 6)).toBeLessThan(20.5);
    }
  });

  /**
   * Neighbouring dice must be independent, not merely individually fair. A
   * counter-based seed that forgot to mix would give slot n+1 a face that tracked
   * slot n's, and every hand would arrive pre-sorted.
   */
  it('leaves neighbouring slots independent of each other', () => {
    const pairs = new Array<number>(36).fill(0);
    for (const seed of SEEDS) {
      for (let turn = 0; turn < CATEGORIES.length; turn++) {
        for (let roll = 0; roll < 3; roll++) {
          for (let slot = 0; slot < DICE - 1; slot++) {
            const a = dieFace(seed, turn, roll, slot);
            const b = dieFace(seed, turn, roll, slot + 1);
            pairs[(a - 1) * 6 + (b - 1)] = (pairs[(a - 1) * 6 + (b - 1)] as number) + 1;
          }
        }
      }
    }

    const total = pairs.reduce((sum, count) => sum + count, 0);
    // 35 degrees of freedom; 66.6 is the 0.999 point.
    expect(chiSquare(pairs, total / 36)).toBeLessThan(66.6);
  });

  /**
   * Hands, not just faces, because a per-face check can pass while the five dice
   * lean on each other — and it is the rate of the good hands that a player's
   * sense of whether the game is honest is actually built on.
   *
   * The counts are of ordered outcomes out of 6^5 = 7776: six ways to throw five
   * alike; 2 x 5! = 240 for a large straight; 1200 for four or more in a row; and
   * 6 x 5 x C(5,3) = 300 for a full house, which is three of one face and two of
   * another and nothing else, the joker rules being cut.
   */
  it('deals the rare hands at the rate the maths says', () => {
    const openings = Array.from({ length: 20000 }, (_, i) => startRound(`hands-${i}`).dice);
    const rate = (id: string): number => {
      const index = CATEGORIES.findIndex((category) => category.id === id);
      return openings.filter((dice) => scoreFor(index, dice) > 0).length / openings.length;
    };

    expect(rate('five-of-a-kind')).toBeCloseTo(6 / 7776, 3);
    expect(rate('large-straight')).toBeCloseTo(240 / 7776, 2);
    expect(rate('small-straight')).toBeCloseTo(1200 / 7776, 2);
    expect(rate('full-house')).toBeCloseTo(300 / 7776, 2);
  });
});

describe('the dice were fixed before you touched them', () => {
  /**
   * The property the whole design rests on.
   *
   * Because a face is a function of (turn, throw, slot) and of nothing else,
   * choosing to throw a different set of dice cannot change what any of them
   * comes up as. That is what makes a rewind pointless rather than powerful, and
   * it is why this game has no undo button — see `game.ts`.
   */
  it('gives a slot the same face however many others were thrown with it', () => {
    const state = startRound('no-fishing');

    const alone = applyMove(state, rerollMove(0b00001)).dice[0];
    const withOne = applyMove(state, rerollMove(0b00011)).dice[0];
    const withAll = applyMove(state, rerollMove(0b11111)).dice[0];

    expect(withOne).toBe(alone);
    expect(withAll).toBe(alone);
  });

  it('deals a turn the same opening hand whatever was written in the turn before', () => {
    const state = startRound('no-shopping');

    const viaChance = applyMove(state, scoreMove(12)).dice;
    const viaOnes = applyMove(state, scoreMove(0)).dice;

    expect(viaOnes).toEqual(viaChance);
  });

  it('deals a different round to every round number', () => {
    const opening = new Set(
      Array.from({ length: 200 }, (_, round) => startRound(`profile:${round + 1}`).dice.join('')),
    );
    // 200 draws from 7776 equally likely hands: a couple of collisions is normal,
    // a handful of distinct values would mean the round number is barely used.
    expect(opening.size).toBeGreaterThan(190);
  });
});

describe('a saved round', () => {
  /**
   * The save format, end to end: a seed and a list of small integers rebuild the
   * dice, the card and the turn. Nothing about the board is stored, so nothing
   * about it can drift out of step with the moves that produced it.
   */
  it('restores from its move list alone, down to the faces on the table', () => {
    const seed = 'save-me';
    let live = startRound(seed);
    const moves: number[] = [];

    const script = [rerollMove(0b10110), scoreMove(5), rerollMove(0b00011), rerollMove(0b01000)];
    for (const move of script) {
      live = applyMove(live, move);
      moves.push(move);
    }

    const restored = replay(seed, moves);
    expect(restored.applied).toBe(moves.length);
    expect(restored.state).toEqual(live);
  });
});
