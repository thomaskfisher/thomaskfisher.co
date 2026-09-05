import { describe, expect, it } from 'vitest';

import { type Board, type Bus, type Facing, type Level, createState, isWon, pull } from './model';
import { findSolution, search, searchFrom } from './solve';

function bus(x: number, y: number, facing: Facing, color: number, capacity = 2): Bus {
  return { x, y, length: 2, facing, color, capacity, unknown: false };
}

function boardOf(buses: Bus[], bays: number): Board {
  return {
    width: 5,
    height: 5,
    buses,
    colors: Math.max(...buses.map((b) => b.color)) + 1,
    bays,
  };
}

/** Plays a line of pulls and reports whether it finished the level. */
function replay(level: Level, moves: readonly number[]): boolean {
  const state = createState(level.board);
  for (const id of moves) {
    if (pull(level, state, id) !== 'ok') return false;
  }
  return isWon(level, state);
}

describe('search', () => {
  it('finds an order and the order actually wins', () => {
    const board = boardOf(
      [bus(0, 0, 'left', 0), bus(0, 2, 'left', 1), bus(0, 4, 'left', 2)],
      2,
    );
    const level: Level = { board, queue: [2, 2, 0, 0, 1, 1] };

    const result = search(level);
    expect(result.status).toBe('solved');
    expect(replay(level, result.moves)).toBe(true);
  });

  it('calls a genuinely impossible level unsolvable rather than giving up', () => {
    // One bay, and the queue wants a colour whose bus is walled in behind two
    // others that have to be parked somewhere first. With nowhere to park them
    // there is no order at all.
    const board = boardOf(
      [bus(0, 2, 'right', 0), bus(2, 2, 'right', 1), bus(0, 0, 'left', 2)],
      1,
    );
    const level: Level = { board, queue: [0, 0, 1, 1, 2, 2] };

    const result = search(level);
    expect(result.status).toBe('unsolvable');
    // The distinction the generator rests on: the space really was exhausted.
    expect(result.nodes).toBeLessThan(150_000);
  });

  it('says so when it ran out of budget instead of claiming unsolvable', () => {
    const board = boardOf(
      [bus(0, 0, 'left', 0), bus(0, 2, 'left', 1), bus(0, 4, 'left', 2)],
      2,
    );
    const level: Level = { board, queue: [2, 2, 1, 1, 0, 0] };
    expect(search(level, { nodeBudget: 0 }).status).toBe('budget');
  });
});

describe('searching from a partly played level', () => {
  const board = boardOf([bus(0, 0, 'left', 0), bus(0, 2, 'left', 1), bus(0, 4, 'left', 2)], 2);
  const level: Level = { board, queue: [2, 2, 0, 0, 1, 1] };

  it('finishes the level from where the player left off', () => {
    const opening = search(level).moves;
    const head = opening.slice(0, 1);
    const rest = searchFrom(level, head);
    expect(rest.status).toBe('solved');
    expect(replay(level, [...head, ...rest.moves])).toBe(true);
  });

  it('refuses a pull order the rules would never have allowed', () => {
    // Bus 0 faces left out of column 0 and is drivable, but pulling it twice is
    // not a position the game can be in. Replaying it as if it were would plan
    // a hint from a board that does not exist.
    expect(searchFrom(level, [0, 0]).status).toBe('unsolvable');
  });

  it('returns null once the player has painted themselves into a corner', () => {
    const cornered = boardOf(
      [bus(0, 0, 'left', 0), bus(0, 2, 'left', 1), bus(0, 4, 'left', 2)],
      2,
    );
    const tight: Level = { board: cornered, queue: [2, 2, 0, 0, 1, 1] };
    // Both bays spent on colours the front of the queue does not want.
    expect(findSolution(tight, [0, 1])).toBeNull();
  });
});

/**
 * The hint contract. A plan is followed rather than re-asked for, so what
 * matters is that one search returns a line that stays winning as it is
 * consumed — not that two searches agree with each other.
 */
describe('a hint plan', () => {
  it('stays winning all the way down', () => {
    const board = boardOf(
      [bus(0, 0, 'left', 0), bus(0, 2, 'left', 1), bus(0, 4, 'left', 2), bus(3, 0, 'right', 1)],
      2,
    );
    const level: Level = { board, queue: [2, 2, 1, 1, 1, 1, 0, 0] };
    const plan = findSolution(level);
    expect(plan).not.toBeNull();

    const played: number[] = [];
    for (const id of plan as number[]) {
      expect(searchFrom(level, played).status).toBe('solved');
      played.push(id);
    }
    expect(replay(level, played)).toBe(true);
  });
});
