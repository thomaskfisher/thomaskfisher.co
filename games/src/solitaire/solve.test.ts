import { describe, expect, it } from 'vitest';

import { makeCard, orderedDeck } from '../shared/cards';
import { createRng, hashSeed } from '../shared/rng';
import { type Klondike, PILES, applyMove, deal, isWon } from './model';
import { solve } from './solve';

const SPADES = 0;
const HEARTS = 1;

const empty = (): Klondike => ({
  stock: [],
  waste: [],
  foundations: [0, 0, 0, 0],
  tableau: Array.from({ length: PILES }, () => ({ cards: [], down: 0 })),
});

describe('the search', () => {
  it('sees a position that is already home', () => {
    const state = empty();
    state.foundations = [13, 13, 13, 13];
    const result = solve(state);
    expect(result.status).toBe('solved');
    expect(result.status === 'solved' && result.moves).toEqual([]);
  });

  /**
   * Two kings, no pack, nowhere to go. This is the answer the generator's
   * promise depends on being *different* from running out of budget: the space
   * really was walked out.
   */
  it('says unsolvable when the space runs out, not the budget', () => {
    const state = empty();
    state.tableau[0] = { cards: [makeCard(SPADES, 13)], down: 0 };
    state.tableau[1] = { cards: [makeCard(HEARTS, 13)], down: 0 };
    expect(solve(state).status).toBe('unsolvable');
  });

  it('says unknown when the budget runs out, not the space', () => {
    const state = deal(createRng(hashSeed('budget')).shuffle(orderedDeck()));
    expect(solve(state, { budget: 4 }).status).toBe('unknown');
  });

  /**
   * The line has to survive being played, not just being found. This is the
   * check that would catch a solver quietly reasoning about a different game
   * from the one `applyMove` implements.
   */
  it('hands back a line that actually wins when it is replayed', () => {
    let played = 0;

    for (let i = 0; i < 40 && played < 3; i++) {
      const state = deal(createRng(hashSeed('replay', i)).shuffle(orderedDeck()));
      const result = solve(state, { budget: 30_000 });
      if (result.status !== 'solved') continue;

      for (const move of result.moves) {
        expect(applyMove(state, move), 'the solver played an illegal move').toBe(true);
      }
      expect(isWon(state)).toBe(true);
      played++;
    }

    expect(played, 'no deal in the sample was solvable at all').toBeGreaterThan(0);
  });
});
