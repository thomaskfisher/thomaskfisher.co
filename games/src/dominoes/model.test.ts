import { describe, expect, it } from 'vitest';

import {
  type Move,
  type Position,
  MAX_PIP,
  TILE_COUNT,
  applyMove,
  deal,
  doubleOf,
  engineFor,
  handSize,
  isDouble,
  isLegalMove,
  legalPlays,
  mayUse,
  mexicanIndex,
  otherEnd,
  pipsOf,
  replay,
  scores,
  valueOf,
  winnersOf,
} from './model';

const SEED = 'test-seed';

/** Plays a whole round with a fixed policy, and hands back what happened. */
function playOut(
  seed: string,
  round: number,
  players: number,
  choose: (position: Position) => Move,
): { position: Position; moves: Move[] } {
  let position = deal(seed, round, players);
  const moves: Move[] = [];

  for (let guard = 0; guard < 500 && !position.over; guard++) {
    const move = choose(position);
    if (!isLegalMove(position, move)) break;
    position = applyMove(position, move, moves.length);
    moves.push(move);
  }

  return { position, moves };
}

/** The obvious policy: play the first thing you can, else draw, else pass. */
const greedy = (position: Position): Move => {
  const plays = legalPlays(position);
  if (plays.length > 0) return { kind: 'play', ...(plays[0] as { tile: number; train: number }) };
  if (!position.drawn && position.boneyard.length > 0) return { kind: 'draw' };
  return { kind: 'pass' };
};

describe('the set', () => {
  it('is a double nine', () => {
    expect(TILE_COUNT).toBe(55);
    expect(MAX_PIP).toBe(9);
  });

  it('holds every pair once, low pip first', () => {
    const seen = new Set<string>();
    for (let tile = 0; tile < TILE_COUNT; tile++) {
      const [low, high] = pipsOf(tile);
      expect(low).toBeLessThanOrEqual(high);
      seen.add(`${low}-${high}`);
    }
    expect(seen.size).toBe(TILE_COUNT);
  });

  it('knows a double, a value and the far end of a tile', () => {
    expect(pipsOf(doubleOf(4))).toEqual([4, 4]);
    expect(isDouble(doubleOf(7))).toBe(true);
    expect(valueOf(doubleOf(9))).toBe(18);

    const tile = TILES_INDEX(2, 5);
    expect(otherEnd(tile, 2)).toBe(5);
    expect(otherEnd(tile, 5)).toBe(2);
  });
});

/** The index of the tile with these two pips. */
function TILES_INDEX(a: number, b: number): number {
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  for (let tile = 0; tile < TILE_COUNT; tile++) {
    const [l, h] = pipsOf(tile);
    if (l === low && h === high) return tile;
  }
  throw new Error(`no tile ${a}-${b}`);
}

describe('the round', () => {
  it('runs the engine down from the nine and starts over', () => {
    expect(engineFor(1)).toBe(9);
    expect(engineFor(10)).toBe(0);
    expect(engineFor(11)).toBe(9);
  });

  it('deals every player a hand and nobody the engine', () => {
    for (const players of [2, 3, 4]) {
      const position = deal(SEED, 1, players);
      const size = handSize(players);

      expect(position.hands).toHaveLength(players);
      for (const hand of position.hands) expect(hand).toHaveLength(size);

      const dealt = position.hands.flat();
      expect(dealt).not.toContain(doubleOf(position.engine));
      expect(new Set(dealt).size).toBe(dealt.length);
      expect(dealt.length + position.boneyard.length).toBe(TILE_COUNT - 1);
    }
  });

  it('gives everybody a train that starts at the engine, plus the Mexican one', () => {
    const position = deal(SEED, 3, 3);
    expect(position.trains).toHaveLength(4);
    expect(position.trains.every((train) => train.end === position.engine)).toBe(true);
    expect(position.trains.every((train) => train.tiles.length === 0)).toBe(true);

    const mexican = position.trains[mexicanIndex(3)];
    expect(mexican?.owner).toBeNull();
    expect(mexican?.open).toBe(true);
  });

  it('deals the same hands for the same seed and different ones otherwise', () => {
    expect(deal(SEED, 1, 3).hands).toEqual(deal(SEED, 1, 3).hands);
    expect(deal(SEED, 1, 3).hands).not.toEqual(deal(SEED, 2, 3).hands);
    expect(deal(SEED, 1, 3).hands).not.toEqual(deal('other', 1, 3).hands);
  });
});

describe('whose train is whose', () => {
  it('lets you use your own and the Mexican one, and nobody else closed', () => {
    const position = deal(SEED, 1, 3);
    expect(mayUse(position, 0, 0)).toBe(true);
    expect(mayUse(position, 0, 1)).toBe(false);
    expect(mayUse(position, 0, mexicanIndex(3))).toBe(true);

    const opened = { ...position, trains: position.trains.map((t, i) => ({ ...t, open: i === 1 })) };
    expect(mayUse(opened, 0, 1)).toBe(true);
  });
});

describe('playing', () => {
  it('lays the tile, turns it the right way round, and moves the end', () => {
    const position = deal(SEED, 1, 2);
    const tile = TILES_INDEX(9, 4);
    const hand = [tile, TILES_INDEX(1, 2)];
    const start: Position = { ...position, hands: [hand, position.hands[1] as number[]] };

    const after = applyMove(start, { kind: 'play', tile, train: 0 }, 0);
    const train = after.trains[0];

    expect(train?.tiles).toEqual([{ tile, from: 9, to: 4 }]);
    expect(train?.end).toBe(4);
    expect(after.hands[0]).not.toContain(tile);
    expect(after.turn).toBe(1);
  });

  it('refuses a tile that does not match the open end', () => {
    const position = deal(SEED, 1, 2);
    const tile = TILES_INDEX(1, 2);
    const start: Position = { ...position, hands: [[tile], position.hands[1] as number[]] };
    expect(isLegalMove(start, { kind: 'play', tile, train: 0 })).toBe(false);
  });

  it('closes your own train when you lay on it, and only then', () => {
    const position = deal(SEED, 1, 2);
    const mine = TILES_INDEX(9, 4);
    const communal = TILES_INDEX(9, 5);
    const start: Position = {
      ...position,
      hands: [[mine, communal], position.hands[1] as number[]],
      trains: position.trains.map((train, index) => ({ ...train, open: index === 0 || index === 2 })),
    };

    const onMexican = applyMove(start, { kind: 'play', tile: communal, train: 2 }, 0);
    expect(onMexican.trains[0]?.open).toBe(true);

    const onMine = applyMove(start, { kind: 'play', tile: mine, train: 0 }, 0);
    expect(onMine.trains[0]?.open).toBe(false);
  });
});

describe('doubles', () => {
  it('have to be answered, and the player who laid one answers first', () => {
    const position = deal(SEED, 1, 2);
    const double = doubleOf(9);
    const answer = TILES_INDEX(9, 3);
    const start: Position = { ...position, hands: [[double, answer, TILES_INDEX(1, 1)], position.hands[1] as number[]] };

    const laid = applyMove(start, { kind: 'play', tile: double, train: 0 }, 0);
    expect(laid.pending).toEqual({ train: 0, pips: 9 });
    // Still their turn, and the double is the only place on the board.
    expect(laid.turn).toBe(0);
    expect(legalPlays(laid)).toEqual([{ tile: answer, train: 0 }]);

    const answered = applyMove(laid, { kind: 'play', tile: answer, train: 0 }, 1);
    expect(answered.pending).toBeNull();
    expect(answered.turn).toBe(1);
    expect(answered.trains[0]?.end).toBe(3);
  });

  it('are left for the next player when the one who laid it cannot answer', () => {
    const position = deal(SEED, 1, 2);
    const double = doubleOf(9);
    const start: Position = {
      ...position,
      hands: [[double, TILES_INDEX(1, 2)], [TILES_INDEX(9, 6), TILES_INDEX(3, 4)]],
      boneyard: [],
    };

    // Laying it leaves the turn where it is with nothing to play, so the only
    // way on is the pass — which is what costs the layer their train.
    const laid = applyMove(start, { kind: 'play', tile: double, train: 0 }, 0);
    expect(laid.turn).toBe(0);
    expect(legalPlays(laid)).toEqual([]);
    expect(isLegalMove(laid, { kind: 'pass' })).toBe(true);

    const passed = applyMove(laid, { kind: 'pass' }, 1);
    expect(passed.turn).toBe(1);
    expect(passed.pending).toEqual({ train: 0, pips: 9 });
    expect(passed.trains[0]?.open).toBe(true);
    expect(legalPlays(passed)).toEqual([{ tile: TILES_INDEX(9, 6), train: 0 }]);
  });

  it('leave the end where it was', () => {
    const position = deal(SEED, 1, 2);
    const double = doubleOf(9);
    const start: Position = { ...position, hands: [[double, TILES_INDEX(9, 1)], position.hands[1] as number[]] };
    const laid = applyMove(start, { kind: 'play', tile: double, train: 0 }, 0);
    expect(laid.trains[0]?.end).toBe(9);
    expect(laid.trains[0]?.tiles[0]).toEqual({ tile: double, from: 9, to: 9 });
  });
});

describe('drawing', () => {
  it('is refused while there is something to play', () => {
    const position = deal(SEED, 1, 2);
    const start: Position = { ...position, hands: [[TILES_INDEX(9, 2)], position.hands[1] as number[]] };
    expect(isLegalMove(start, { kind: 'draw' })).toBe(false);
  });

  /**
   * The turn stays put even when the tile is no use — the player has to be able
   * to look at what they drew before the curtain comes down on them, and the
   * only moment that exists is between the draw and the pass.
   */
  it('takes one tile and leaves the player to pass', () => {
    const position = deal(SEED, 1, 2);
    const start: Position = {
      ...position,
      hands: [[TILES_INDEX(1, 2)], position.hands[1] as number[]],
      boneyard: [TILES_INDEX(3, 4), TILES_INDEX(5, 6)],
    };

    const after = applyMove(start, { kind: 'draw' }, 0);
    expect(after.hands[0]).toContain(TILES_INDEX(3, 4));
    expect(after.boneyard).toEqual([TILES_INDEX(5, 6)]);
    expect(after.turn).toBe(0);
    expect(after.drawn).toBe(true);
    expect(isLegalMove(after, { kind: 'pass' })).toBe(true);

    const passed = applyMove(after, { kind: 'pass' }, 1);
    expect(passed.turn).toBe(1);
    expect(passed.trains[0]?.open).toBe(true);
  });

  it('leaves the turn alive when the drawn tile can be played', () => {
    const position = deal(SEED, 1, 2);
    const start: Position = {
      ...position,
      hands: [[TILES_INDEX(1, 2)], position.hands[1] as number[]],
      boneyard: [TILES_INDEX(9, 4)],
    };

    const after = applyMove(start, { kind: 'draw' }, 0);
    expect(after.turn).toBe(0);
    expect(after.drawn).toBe(true);
    expect(legalPlays(after)).toEqual([
      { tile: TILES_INDEX(9, 4), train: 0 },
      { tile: TILES_INDEX(9, 4), train: 2 },
    ]);
  });

  /**
   * Inside a turn there is nothing undo could reveal, so the floor stays where
   * the turn started. Laying a double is the case that matters: it commits you
   * to answering it, and a player meeting that rule for the first time will
   * want the tile back.
   */
  it('leaves the floor at the start of the turn while the turn is still yours', () => {
    const position = deal(SEED, 1, 2);
    const double = doubleOf(9);
    const start: Position = {
      ...position,
      hands: [[double, TILES_INDEX(9, 3)], position.hands[1] as number[]],
      turnStart: 4,
      undoFloor: 4,
    };

    const laid = applyMove(start, { kind: 'play', tile: double, train: 0 }, 4);
    expect(laid.turn).toBe(0);
    expect(laid.undoFloor).toBe(4);
    // One move played, floor at four: the controller has something to take back.
    expect(5).toBeGreaterThan(laid.undoFloor);
  });

  /** The drawn tile is information; undo must never reach back past it. */
  it('moves the undo floor past itself', () => {
    const position = deal(SEED, 1, 2);
    const start: Position = {
      ...position,
      hands: [[TILES_INDEX(1, 2)], position.hands[1] as number[]],
      boneyard: [TILES_INDEX(9, 4)],
    };
    expect(applyMove(start, { kind: 'draw' }, 3).undoFloor).toBe(4);
  });
});

describe('passing', () => {
  it('needs the boneyard to be spent, or the draw already taken', () => {
    const position = deal(SEED, 1, 2);
    const stuck: Position = { ...position, hands: [[TILES_INDEX(1, 2)], position.hands[1] as number[]] };
    expect(isLegalMove(stuck, { kind: 'pass' })).toBe(false);
    expect(isLegalMove({ ...stuck, boneyard: [] }, { kind: 'pass' })).toBe(true);
    expect(isLegalMove({ ...stuck, drawn: true }, { kind: 'pass' })).toBe(true);
  });

  it('kills the round once everybody has passed in turn', () => {
    const position = deal(SEED, 1, 2);
    const dead: Position = {
      ...position,
      hands: [[TILES_INDEX(1, 2)], [TILES_INDEX(3, 4)]],
      boneyard: [],
    };

    const first = applyMove(dead, { kind: 'pass' }, 0);
    expect(first.over).toBe(false);
    const second = applyMove(first, { kind: 'pass' }, 1);
    expect(second.over).toBe(true);
    expect(second.wentOut).toBeNull();
  });
});

describe('the end of a round', () => {
  it('ends the moment somebody lays their last tile', () => {
    const position = deal(SEED, 1, 2);
    const last = TILES_INDEX(9, 7);
    const start: Position = { ...position, hands: [[last], position.hands[1] as number[]] };

    const after = applyMove(start, { kind: 'play', tile: last, train: 0 }, 0);
    expect(after.over).toBe(true);
    expect(after.wentOut).toBe(0);
    expect(scores(after)[0]).toBe(0);
  });

  it('scores the pips left in hand, lowest wins', () => {
    const position = deal(SEED, 1, 3);
    const held: Position = {
      ...position,
      hands: [[], [TILES_INDEX(2, 3)], [TILES_INDEX(9, 9)]],
      over: true,
      wentOut: 0,
    };
    expect(scores(held)).toEqual([0, 5, 18]);
    expect(winnersOf(held)).toEqual([0]);
  });

  it('names every player on a tie', () => {
    const position = deal(SEED, 1, 3);
    const level: Position = {
      ...position,
      hands: [[TILES_INDEX(1, 1)], [TILES_INDEX(0, 2)], [TILES_INDEX(9, 9)]],
    };
    expect(winnersOf(level)).toEqual([0, 1]);
  });
});

describe('a whole round', () => {
  for (const players of [2, 3, 4]) {
    it(`finishes with ${players} players and never loses a tile`, () => {
      const { position } = playOut(SEED, 1, players, greedy);

      expect(position.over).toBe(true);

      const onBoard = position.trains.reduce((sum, train) => sum + train.tiles.length, 0);
      const inHands = position.hands.reduce((sum, hand) => sum + hand.length, 0);
      // The engine is not on a train — it is the thing they all start from.
      expect(onBoard + inHands + position.boneyard.length).toBe(TILE_COUNT - 1);
    });
  }

  it('replays a move list to exactly the same position', () => {
    const { position, moves } = playOut(SEED, 4, 3, greedy);
    const { position: replayed, applied } = replay(SEED, 4, 3, moves);

    expect(applied).toEqual(moves);
    expect(replayed).toEqual(position);
  });

  it('stops a replay at the first move that no longer applies', () => {
    const bogus: Move[] = [{ kind: 'play', tile: TILES_INDEX(1, 2), train: 0 }];
    const { position, applied } = replay(SEED, 1, 2, bogus);
    expect(applied).toEqual([]);
    expect(position).toEqual(deal(SEED, 1, 2));
  });

  it('never leaves a train showing an end its last tile does not have', () => {
    const { position } = playOut(SEED, 2, 4, greedy);
    for (const train of position.trains) {
      const last = train.tiles.at(-1);
      if (!last) {
        expect(train.end).toBe(position.engine);
        continue;
      }
      expect(train.end).toBe(last.to);
      const [low, high] = pipsOf(last.tile);
      expect([low, high]).toContain(last.to);
    }
  });

  it('joins every tile on a train to the one before it', () => {
    const { position } = playOut(SEED, 5, 3, greedy);
    for (const train of position.trains) {
      let end = position.engine;
      for (const placed of train.tiles) {
        expect(placed.from).toBe(end);
        const [low, high] = pipsOf(placed.tile);
        expect([low, high]).toContain(placed.from);
        end = placed.to;
      }
    }
  });
});
