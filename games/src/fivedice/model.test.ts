import { describe, expect, it } from 'vitest';

import {
  CATEGORIES,
  DICE,
  ROLLS_PER_TURN,
  UPPER_BONUS,
  UPPER_TARGET,
  applyMove,
  bonusReachable,
  canReroll,
  canScore,
  isFinished,
  previews,
  replay,
  rerollMove,
  rollsLeft,
  scoreFor,
  scoreMove,
  startRound,
  totals,
} from './model';

const index = (id: string): number => CATEGORIES.findIndex((category) => category.id === id);

const score = (id: string, dice: number[]): number => scoreFor(index(id), dice);

describe('the scorecard', () => {
  it('has thirteen boxes, six upper and seven lower', () => {
    expect(CATEGORIES).toHaveLength(13);
    expect(CATEGORIES.filter((category) => category.section === 'upper')).toHaveLength(6);
    expect(CATEGORIES.filter((category) => category.section === 'lower')).toHaveLength(7);
  });

  it('pays the upper boxes the sum of their own face', () => {
    expect(score('threes', [3, 3, 1, 6, 3])).toBe(9);
    expect(score('sixes', [6, 6, 6, 6, 6])).toBe(30);
    expect(score('ones', [2, 3, 4, 5, 6])).toBe(0);
  });

  it('pays three and four of a kind the whole hand', () => {
    expect(score('three-of-a-kind', [4, 4, 4, 2, 1])).toBe(15);
    expect(score('three-of-a-kind', [4, 4, 2, 2, 1])).toBe(0);
    // Four alike also satisfies three alike, so the sum still counts.
    expect(score('three-of-a-kind', [5, 5, 5, 5, 1])).toBe(21);
    expect(score('four-of-a-kind', [5, 5, 5, 5, 1])).toBe(21);
    expect(score('four-of-a-kind', [5, 5, 5, 2, 1])).toBe(0);
  });

  /**
   * The joker rules are cut (see `model.ts`), and this is where that shows: five
   * alike is five alike and nothing else. Keeping it explicit because the
   * permissive reading is what most implementations quietly do.
   */
  it('does not let five alike stand in for a full house or a run', () => {
    expect(score('full-house', [3, 3, 3, 3, 3])).toBe(0);
    expect(score('small-straight', [3, 3, 3, 3, 3])).toBe(0);
    expect(score('five-of-a-kind', [3, 3, 3, 3, 3])).toBe(50);
    expect(score('full-house', [3, 3, 3, 5, 5])).toBe(25);
    expect(score('full-house', [3, 3, 3, 3, 5])).toBe(0);
  });

  it('pays a run only for consecutive faces', () => {
    expect(score('small-straight', [2, 3, 4, 5, 5])).toBe(30);
    expect(score('small-straight', [1, 2, 3, 5, 6])).toBe(0);
    expect(score('large-straight', [1, 2, 3, 4, 5])).toBe(40);
    expect(score('large-straight', [2, 3, 4, 5, 6])).toBe(40);
    expect(score('large-straight', [1, 2, 3, 4, 6])).toBe(0);
    // A large run contains a small one.
    expect(score('small-straight', [2, 3, 4, 5, 6])).toBe(30);
  });

  it('pays Chance whatever is on the table', () => {
    expect(score('chance', [1, 1, 1, 1, 1])).toBe(5);
    expect(score('chance', [6, 5, 4, 3, 2])).toBe(20);
  });
});

describe('totals', () => {
  const card = (entries: Record<string, number>): (number | null)[] =>
    CATEGORIES.map((category) => entries[category.id] ?? null);

  it('adds the bonus at exactly the target and not below it', () => {
    const justUnder = card({ ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 17 });
    expect(totals(justUnder).upper).toBe(62);
    expect(totals(justUnder).bonus).toBe(0);

    const justOn = card({ ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 });
    expect(totals(justOn).upper).toBe(UPPER_TARGET);
    expect(totals(justOn).bonus).toBe(UPPER_BONUS);
    expect(totals(justOn).grand).toBe(UPPER_TARGET + UPPER_BONUS);
  });

  it('keeps the sections apart and sums them into the grand total', () => {
    const mixed = card({ sixes: 24, chance: 21, 'large-straight': 40 });
    expect(totals(mixed)).toEqual({ upper: 24, bonus: 0, lower: 61, grand: 85 });
  });

  /** A scratched box is a 0, not an empty one, and the difference matters. */
  it('treats a scratched box as scored', () => {
    const scratched = card({ 'five-of-a-kind': 0 });
    expect(scratched.filter((value) => value !== null)).toHaveLength(1);
    expect(totals(scratched).grand).toBe(0);
  });
});

describe('whether the bonus is still worth chasing', () => {
  const open: (number | null)[] = CATEGORIES.map(() => null);

  it('is live on a fresh card and dead once won', () => {
    expect(bonusReachable(open)).toBe(true);

    const won = [...open];
    won[index('ones')] = 5;
    won[index('twos')] = 10;
    won[index('threes')] = 15;
    won[index('fours')] = 20;
    won[index('fives')] = 25;
    expect(bonusReachable(won)).toBe(false);
  });

  it('is dead once the arithmetic no longer reaches 63', () => {
    // Sixes and Fives scratched leaves at most 5+10+15+20 = 50 upper points.
    const stranded = [...open];
    stranded[index('sixes')] = 0;
    stranded[index('fives')] = 0;
    expect(bonusReachable(stranded)).toBe(false);
  });
});

describe('a round', () => {
  it('opens with five dice already thrown and two throws left', () => {
    const state = startRound('opening');
    expect(state.dice).toHaveLength(DICE);
    expect(state.dice.every((die) => die >= 1 && die <= 6)).toBe(true);
    expect(state.turn).toBe(0);
    expect(rollsLeft(state)).toBe(ROLLS_PER_TURN - 1);
    expect(isFinished(state)).toBe(false);
  });

  it('refuses a throw of nothing, and a throw once the turn is spent', () => {
    let state = startRound('legality');
    expect(canReroll(state, 0)).toBe(false);
    expect(canReroll(state, 0b11111)).toBe(true);

    state = applyMove(state, rerollMove(0b11111));
    state = applyMove(state, rerollMove(0b00001));
    expect(rollsLeft(state)).toBe(0);
    expect(canReroll(state, 0b00001)).toBe(false);
  });

  it('refuses a box that is already written in, including a scratched one', () => {
    let state = startRound('twice');
    const box = index('five-of-a-kind');
    expect(canScore(state, box)).toBe(true);
    state = applyMove(state, scoreMove(box));
    expect(canScore(state, box)).toBe(false);
    expect(() => applyMove(state, scoreMove(box))).toThrow();
  });

  it('throws a fresh hand at the start of every turn and ends after thirteen', () => {
    let state = startRound('thirteen');
    for (let turn = 0; turn < CATEGORIES.length; turn++) {
      expect(state.turn).toBe(turn);
      expect(rollsLeft(state)).toBe(ROLLS_PER_TURN - 1);
      state = applyMove(state, scoreMove(turn));
    }
    expect(isFinished(state)).toBe(true);
    expect(rollsLeft(state)).toBe(0);
    expect(state.scores.every((value) => value !== null)).toBe(true);
    // The last hand stays on the table so the finished card can be read.
    expect(state.dice).toHaveLength(DICE);
  });

  it('only throws the dice it was told to', () => {
    const state = startRound('subset');
    const before = [...state.dice];
    const after = applyMove(state, rerollMove(0b00110)).dice;

    expect(after[0]).toBe(before[0]);
    expect(after[3]).toBe(before[3]);
    expect(after[4]).toBe(before[4]);
    expect(after).toHaveLength(DICE);
  });

  it('previews every open box and nothing else', () => {
    let state = startRound('preview');
    state = applyMove(state, scoreMove(index('chance')));

    const shown = previews(state);
    expect(shown[index('chance')]).toBeNull();
    expect(shown[index('ones')]).toBe(scoreFor(index('ones'), state.dice));
  });
});

describe('replaying a move list', () => {
  it('reproduces a round exactly', () => {
    const moves = [rerollMove(0b01010), rerollMove(0b00001), scoreMove(3), rerollMove(0b11111)];
    const first = replay('replay-me', moves);
    const second = replay('replay-me', moves);

    expect(second.applied).toBe(moves.length);
    expect(second.state).toEqual(first.state);
  });

  /** A corrupt tail should cost the tail, not the round. */
  it('stops at the first move that no longer applies', () => {
    const moves = [scoreMove(0), scoreMove(0), scoreMove(1)];
    const { state, applied } = replay('corrupt', moves);

    expect(applied).toBe(1);
    expect(state.turn).toBe(1);
    expect(state.scores[1]).toBeNull();
  });
});
