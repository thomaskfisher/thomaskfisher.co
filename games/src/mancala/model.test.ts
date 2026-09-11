import { describe, expect, it } from 'vitest';

import {
  type Board,
  NORTH_STORE,
  OTHER,
  SOUTH_STORE,
  TOTAL_SEEDS,
  facing,
  isOver,
  legalMoves,
  openingBoard,
  openingPosition,
  ownsPit,
  pitsOf,
  replay,
  scoreOf,
  sow,
  step,
  totalSeeds,
  winnerOf,
} from './model';

/** A board from two rows of pits, so a test reads like the thing it describes. */
function board(south: number[], southStore: number, north: number[], northStore: number): Board {
  return [...south, southStore, ...north, northStore];
}

describe('the opening', () => {
  it('puts four seeds in each of the twelve pits and none in the stores', () => {
    const start = openingBoard();
    expect(start).toHaveLength(14);
    expect(start[SOUTH_STORE]).toBe(0);
    expect(start[NORTH_STORE]).toBe(0);
    expect(totalSeeds(start)).toBe(TOTAL_SEEDS);
    expect(TOTAL_SEEDS).toBe(48);
  });

  it('gives south the move', () => {
    expect(openingPosition().turn).toBe('south');
  });
});

describe('geometry', () => {
  it('gives each seat six pits and one store', () => {
    expect(pitsOf('south')).toEqual([0, 1, 2, 3, 4, 5]);
    expect(pitsOf('north')).toEqual([7, 8, 9, 10, 11, 12]);
  });

  it('knows whose pit is whose, and that a store belongs to neither side', () => {
    expect(ownsPit('south', 0)).toBe(true);
    expect(ownsPit('south', 6)).toBe(false);
    expect(ownsPit('north', 6)).toBe(false);
    expect(ownsPit('north', 12)).toBe(true);
    expect(ownsPit('south', 12)).toBe(false);
  });

  /** The capture rule is the only thing that needs this, and it must be exact. */
  it('faces each pit across the board', () => {
    expect(facing(0)).toBe(12);
    expect(facing(5)).toBe(7);
    expect(facing(7)).toBe(5);
    expect(facing(12)).toBe(0);
  });
});

describe('sowing', () => {
  it('drops one seed in each pit going forward', () => {
    const start = openingBoard();
    const result = sow(start, 'south', 0);

    expect(result.board[0]).toBe(0);
    expect(result.board[1]).toBe(5);
    expect(result.board[2]).toBe(5);
    expect(result.board[3]).toBe(5);
    expect(result.board[4]).toBe(5);
    expect(result.path).toEqual([1, 2, 3, 4]);
    expect(result.last).toBe(4);
  });

  it('never loses or invents a seed', () => {
    let position = openingPosition();
    for (let move = 0; move < 40; move++) {
      const options = legalMoves(position.board, position.turn);
      if (options.length === 0) break;
      const played = step(position, options[move % options.length] as number);
      if (!played) break;
      position = played.position;
      expect(totalSeeds(position.board)).toBe(TOTAL_SEEDS);
    }
  });

  /** The rule that makes a lap thirteen pits rather than fourteen. */
  it('skips the opponent store and never the mover own', () => {
    // South with one seed in pit 5 lands in their own store.
    const one = board([0, 0, 0, 0, 0, 1], 0, [4, 4, 4, 4, 4, 4], 0);
    expect(sow(one, 'south', 5).board[SOUTH_STORE]).toBe(1);

    // South with nine seeds in pit 5 goes round past north's store without
    // dropping one in it: own store, six north pits, then two of south's.
    //
    // Pits 0 and 1 are seeded so the last seed does not land in an empty pit of
    // south's own — that would be a capture, and this test is about the lap.
    const many = board([2, 2, 0, 0, 0, 9], 0, [0, 0, 0, 0, 0, 0], 0);
    const result = sow(many, 'south', 5);
    expect(result.board[NORTH_STORE]).toBe(0);
    expect(result.board[SOUTH_STORE]).toBe(1);
    expect(result.path).toEqual([6, 7, 8, 9, 10, 11, 12, 0, 1]);
  });

  it('gives north the same treatment in the other direction', () => {
    const many = board([0, 0, 0, 0, 0, 0], 0, [2, 2, 0, 0, 0, 9], 0);
    const result = sow(many, 'north', 12);
    expect(result.board[SOUTH_STORE]).toBe(0);
    expect(result.board[NORTH_STORE]).toBe(1);
    expect(result.path).toEqual([13, 0, 1, 2, 3, 4, 5, 7, 8]);
  });
});

describe('the extra turn', () => {
  it('is earned by finishing in your own store', () => {
    const start = openingBoard();
    // Pit 2 holds four seeds, which reach 3, 4, 5 and the store.
    const result = sow(start, 'south', 2);
    expect(result.last).toBe(SOUTH_STORE);
    expect(result.extraTurn).toBe(true);
    expect(result.next).toBe('south');
  });

  it('is not earned by finishing anywhere else', () => {
    const result = sow(openingBoard(), 'south', 0);
    expect(result.extraTurn).toBe(false);
    expect(result.next).toBe('north');
  });
});

describe('the capture', () => {
  /**
   * Landing in your own empty pit opposite an *empty* one wins nothing. This is
   * the standard Kalah rule, and the variant that banks the lone seed instead
   * rewards emptying your own side, which is the wrong incentive entirely.
   */
  it('wins nothing when the facing pit is empty too', () => {
    const before = board([0, 0, 0, 0, 1, 0], 0, [0, 0, 0, 0, 0, 6], 0);
    const result = sow(before, 'south', 4);

    expect(result.last).toBe(5);
    expect(result.capture).toBeNull();
    expect(result.board[SOUTH_STORE]).toBe(0);
    expect(result.board[5]).toBe(1);
  });

  it('wins the facing seeds as well when there are any', () => {
    const before = board([0, 0, 0, 0, 1, 0], 0, [3, 0, 0, 0, 0, 0], 0);
    const result = sow(before, 'south', 4);

    expect(result.capture).toEqual({ from: 5, facing: 7, seeds: 4 });
    expect(result.board[SOUTH_STORE]).toBe(4);
    expect(result.board[5]).toBe(0);
    expect(result.board[7]).toBe(0);
  });

  it('does not fire on the opponent side, or on a pit that was not empty', () => {
    // Landing in north's territory.
    const across = board([0, 0, 0, 0, 0, 2], 0, [0, 0, 0, 0, 0, 0], 0);
    expect(sow(across, 'south', 5).capture).toBeNull();

    // Landing in a pit of your own that already held something.
    const occupied = board([0, 0, 0, 1, 3, 0], 0, [2, 0, 0, 0, 0, 0], 0);
    expect(sow(occupied, 'south', 3).capture).toBeNull();
  });

  it('never fires on a move that ended in the store', () => {
    const result = sow(openingBoard(), 'south', 2);
    expect(result.extraTurn).toBe(true);
    expect(result.capture).toBeNull();
  });
});

describe('the end', () => {
  it('ends as soon as one side has nothing left, and sweeps the rest', () => {
    // South's last seed goes to their store, emptying their side. North's
    // remaining seeds are then swept into north's store.
    const before = board([0, 0, 0, 0, 0, 1], 20, [2, 3, 0, 0, 0, 0], 10);
    const result = sow(before, 'south', 5);

    expect(result.over).toBe(true);
    expect(result.sweep).toEqual({ seat: 'north', seeds: 5 });
    expect(result.board[SOUTH_STORE]).toBe(21);
    expect(result.board[NORTH_STORE]).toBe(15);
    expect(pitsOf('north').every((pit) => result.board[pit] === 0)).toBe(true);
  });

  it('keeps every seed through the sweep', () => {
    const before = board([0, 0, 0, 0, 0, 1], 20, [2, 3, 0, 0, 0, 0], 10);
    expect(totalSeeds(sow(before, 'south', 5).board)).toBe(totalSeeds(before));
  });

  it('names the winner, and a draw', () => {
    const southAhead = board([0, 0, 0, 0, 0, 0], 25, [0, 0, 0, 0, 0, 0], 23);
    expect(isOver(southAhead)).toBe(true);
    expect(winnerOf(southAhead)).toBe('south');
    expect(scoreOf(southAhead, 'south')).toBe(25);

    const level = board([0, 0, 0, 0, 0, 0], 24, [0, 0, 0, 0, 0, 0], 24);
    expect(winnerOf(level)).toBeNull();
  });
});

describe('moves', () => {
  it('offers only your own non-empty pits', () => {
    const position = board([0, 2, 0, 0, 0, 3], 0, [1, 0, 0, 0, 0, 0], 0);
    expect(legalMoves(position, 'south')).toEqual([1, 5]);
    expect(legalMoves(position, 'north')).toEqual([7]);
  });

  it('refuses an empty pit and the wrong side', () => {
    const position = openingPosition();
    expect(step(position, 7)).toBeNull();
    const emptied = { ...position, board: board([0, 4, 4, 4, 4, 4], 0, [4, 4, 4, 4, 4, 4], 0) };
    expect(step(emptied, 0)).toBeNull();
  });

  it('replays a move list to exactly the same position', () => {
    const moves: number[] = [];
    let position = openingPosition();

    for (let turn = 0; turn < 30; turn++) {
      const options = legalMoves(position.board, position.turn);
      if (options.length === 0) break;
      const pit = options[turn % options.length] as number;
      const played = step(position, pit);
      if (!played) break;
      position = played.position;
      moves.push(pit);
    }

    expect(replay(moves)).toEqual(position);
  });

  it('stops a replay at the first move that no longer applies', () => {
    // 7 is north's pit and it is south to move, so nothing is played at all.
    expect(replay([7])).toEqual(openingPosition());
  });
});

describe('seats', () => {
  it('are each other opposite', () => {
    expect(OTHER.south).toBe('north');
    expect(OTHER.north).toBe('south');
  });
});
