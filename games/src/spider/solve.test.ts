import { describe, expect, it } from 'vitest';

import { makeCard } from '../shared/cards';
import { createRng, hashSeed } from '../shared/rng';
import { COLUMNS, applyMove, deal, isWon } from './model';
import { solve } from './solve';
import { packFor } from './generate';

const SPADES = 0;

describe('the player', () => {
  it('sees a board that is already out', () => {
    const won = deal(createRng(hashSeed('won')).shuffle(packFor(1)));
    won.completed = 8;
    const result = solve(won);
    expect(result.status).toBe('solved');
    expect(result.status === 'solved' && result.moves).toEqual([]);
  });

  /**
   * There is no third answer here — playouts can never prove that no line
   * exists — so a board with nothing legal in it comes back as `unknown`. That
   * is the honest reading, and it is why `isDead` rather than the search is what
   * ends a level. See the header of `solve.ts`.
   *
   * It is also the regression test for a search that never returned. A playout
   * on a board with no legal move spends nothing, so the budget never ran down
   * and the restart loop went round forever — on a phone that is a frozen tab,
   * and in CI it was one worker pinned at 100% with no failure to point at.
   */
  it('says unknown, never unsolvable, when it finds nothing', () => {
    const stuck = {
      columns: Array.from({ length: COLUMNS }, () => ({ cards: [] as number[], down: 0 })),
      stock: [] as number[],
      completed: 0,
    };
    stuck.columns[0] = { cards: [makeCard(SPADES, 3)], down: 0 };
    expect(solve(stuck, { budget: 200 }).status).toBe('unknown');
  });

  /**
   * The line has to survive being played, not just being found. This is the
   * check that would catch a solver reasoning about a different game from the
   * one `applyMove` implements.
   */
  it('hands back a line that actually goes out when it is replayed', () => {
    let played = 0;

    for (let i = 0; i < 6 && played < 3; i++) {
      const start = deal(createRng(hashSeed('replay', i)).shuffle(packFor(1)));
      const result = solve(start, { budget: 60_000, seed: i });
      if (result.status !== 'solved') continue;

      for (const move of result.moves) {
        expect(applyMove(start, move), 'the solver played an illegal move').toBe(true);
      }
      expect(isWon(start)).toBe(true);
      played++;
    }

    expect(played, 'no one-suit deal in the sample was solvable at all').toBeGreaterThan(0);
  }, 120_000);

  it('gives the same line twice for the same seed', () => {
    const start = deal(createRng(hashSeed('stable')).shuffle(packFor(1)));
    const a = solve(start, { budget: 40_000, seed: 7 });
    const b = solve(start, { budget: 40_000, seed: 7 });
    expect(a).toEqual(b);
  }, 60_000);
});
