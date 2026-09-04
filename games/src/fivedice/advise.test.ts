import { describe, expect, it } from 'vitest';

import { type Advice, advise, autoPlay, boxPrices, handSpaceSize } from './advise';
import {
  CATEGORIES,
  ROLLS_PER_TURN,
  type RoundState,
  applyMove,
  isFinished,
  isLegalMove,
  replay,
  startRound,
  totals,
} from './model';

const box = (id: string): number => CATEGORIES.findIndex((category) => category.id === id);

/** A position, built directly rather than played into, so a test can be specific. */
function position(dice: number[], options: { rollsUsed?: number; filled?: string[] } = {}): RoundState {
  const filled = options.filled ?? [];
  return {
    seed: 'position',
    turn: filled.length,
    rollsUsed: options.rollsUsed ?? 1,
    dice,
    scores: CATEGORIES.map((category) => (filled.includes(category.id) ? 0 : null)),
  };
}

describe('the tables', () => {
  it('cover every distinct hand of five dice', () => {
    expect(handSpaceSize()).toBe(252);
  });

  /**
   * The prices are what stop the hint scratching a good box for a bad hand, so
   * the two extremes are worth pinning: Chance is worth whatever a turn of
   * chasing the biggest sum gives, and five alike is worth almost nothing.
   */
  it('prices a box at what a turn spent chasing it would earn', () => {
    const prices = Object.fromEntries(boxPrices().map(({ name, expected }) => [name, expected]));

    expect(prices['Chance']).toBeCloseTo(23.33, 1);
    expect(prices['Five of a kind']).toBeLessThan(4);
    expect(prices['Sixes']).toBeGreaterThan(prices['Ones'] as number);
  });
});

describe('what it advises', () => {
  it('writes the hand down once the throws are gone', () => {
    const state = position([1, 3, 2, 6, 4], { rollsUsed: ROLLS_PER_TURN });
    const advice = advise(state) as Advice;

    expect(advice.kind).toBe('score');
    expect(advice.category).toBeGreaterThanOrEqual(0);
  });

  it('takes the big scoring hands rather than throwing them away', () => {
    const spent = { rollsUsed: ROLLS_PER_TURN };

    expect((advise(position([6, 6, 6, 6, 6], spent)) as Advice).category).toBe(box('five-of-a-kind'));
    expect((advise(position([1, 1, 1, 1, 1], spent)) as Advice).category).toBe(box('five-of-a-kind'));
    expect((advise(position([1, 2, 3, 4, 5], spent)) as Advice).category).toBe(box('large-straight'));
    expect((advise(position([3, 3, 3, 5, 5], spent)) as Advice).category).toBe(box('full-house'));
  });

  /** A hand already worth forty points is not worth gambling two throws on. */
  it('stops early on a hand that will not be improved', () => {
    const advice = advise(position([2, 3, 4, 5, 6], { rollsUsed: 1 })) as Advice;
    expect(advice.kind).toBe('score');
    expect(advice.category).toBe(box('large-straight'));
  });

  it('holds the dice worth holding', () => {
    const advice = advise(position([6, 6, 1, 2, 3])) as Advice;
    expect(advice.kind).toBe('roll');
    // The two sixes, and not the 1, 2 and 3 behind them.
    expect([...advice.keep].sort()).toEqual([0, 1]);

    const chasing = advise(position([2, 3, 4, 5, 1], { rollsUsed: ROLLS_PER_TURN - 1, filled: ['large-straight', 'small-straight'] })) as Advice;
    expect(chasing.kind).toBe('roll');
  });

  /**
   * The whole point of pricing a box. A greedy hint hands over Five of a kind for
   * a five-point hand the moment nothing better is showing, and a card never
   * recovers from it.
   */
  it('will not scratch an expensive box while a cheap one is open', () => {
    const spent = { rollsUsed: ROLLS_PER_TURN };
    for (const dice of [[1, 2, 3, 5, 6], [1, 1, 2, 4, 6], [2, 3, 3, 5, 6]]) {
      const advice = advise(position(dice, spent)) as Advice;
      expect(advice.category).not.toBe(box('five-of-a-kind'));
      expect(advice.category).not.toBe(box('large-straight'));
    }
  });

  it('has nothing to say about a finished card', () => {
    const { state } = autoPlay('finished');
    expect(isFinished(state)).toBe(true);
    expect(advise(state)).toBeNull();
  });
});

describe('what it cannot see', () => {
  /**
   * The honesty test.
   *
   * Every face in a round is already determined, so a hint that read the seed
   * could tell the player their next throw. Two identical positions from
   * different rounds must get identical advice — if this ever fails, the hint has
   * started cheating on the player's behalf, which is worse than not having one.
   */
  it('gives the same advice on the same position from different rounds', () => {
    const dice = [5, 5, 2, 3, 6];
    const filled = ['ones', 'chance'];

    for (const rollsUsed of [1, 2, ROLLS_PER_TURN]) {
      const a = advise({ ...position(dice, { rollsUsed, filled }), seed: 'round-7' }) as Advice;
      const b = advise({ ...position(dice, { rollsUsed, filled }), seed: 'round-8100' }) as Advice;
      expect(b).toEqual(a);
    }
  });

  /**
   * The other games cache a winning line because re-solving after every move can
   * return a different one and the hint button ping-pongs forever. There is no
   * line to cache here, and this is why that is safe: the advice is a pure
   * function of the position, so asking twice cannot disagree with itself.
   */
  it('does not change its mind when asked twice', () => {
    const state = position([4, 4, 2, 6, 1], { filled: ['fours'] });
    expect(advise(state)).toEqual(advise(state));
  });
});

/**
 * The sweep. This stands where the other games put their generator invariant
 * test: play a long run of rounds by following the hint alone, and check that
 * every one of them is legal from start to finish and adds up.
 */
describe('following the hint through whole rounds', () => {
  const ROUNDS = 120;
  const cards = Array.from({ length: ROUNDS }, (_, i) => autoPlay(`sweep-${i}`));

  it('only ever suggests a legal move', () => {
    for (const [round, { moves }] of cards.entries()) {
      let state = startRound(`sweep-${round}`);
      for (const [step, move] of moves.entries()) {
        expect(isLegalMove(state, move), `round ${round}, step ${step}`).toBe(true);
        state = applyMove(state, move);
      }
    }
  });

  it('fills all thirteen boxes on every card', () => {
    for (const [round, { state }] of cards.entries()) {
      expect(isFinished(state), `round ${round} did not finish`).toBe(true);
      expect(state.scores.filter((value) => value === null)).toHaveLength(0);
      expect(state.turn).toBe(CATEGORIES.length);
    }
  });

  it('writes a card that replays to the same scores and adds up', () => {
    for (const [round, { moves, state }] of cards.entries()) {
      const rebuilt = replay(`sweep-${round}`, moves);
      expect(rebuilt.applied).toBe(moves.length);
      expect(rebuilt.state.scores).toEqual(state.scores);

      const sum = totals(state.scores);
      expect(sum.grand).toBe(sum.upper + sum.bonus + sum.lower);
      expect(sum.grand).toBeGreaterThan(0);
    }
  });

  /**
   * The hint has to be worth pressing. Human players average somewhere around
   * 200-220 and perfect play is about 254; `tools/dice.ts` measures this policy
   * at 233 over four hundred cards. The floor here is deliberately well below
   * that — it is a guard against a change that quietly breaks the search, not a
   * restatement of the measurement.
   */
  it('plays a card worth pressing the button for', () => {
    const scores = cards.map(({ state }) => totals(state.scores).grand);
    const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;

    expect(mean).toBeGreaterThan(200);
    expect(Math.min(...scores)).toBeGreaterThan(80);
  });
});
