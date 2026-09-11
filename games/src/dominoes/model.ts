/**
 * Mexican Train rules. Pure: no DOM, no `Math.random`, no opponent.
 *
 * **A double-nine set, one tile a turn.** The traditional game lets you lay
 * your whole train on the first turn and runs thirteen rounds off a double-
 * twelve set, which is a pleasant evening at a table and an unpleasant hour on
 * a phone. What is kept is everything that makes it Mexican Train rather than
 * dominoes: your own train, the communal one, trains that open when their owner
 * cannot play, and doubles that have to be answered before anything else
 * happens.
 *
 * **A round is a level.** Round one runs off the double nine, round two off the
 * double eight, and so on down to the double blank, then round eleven starts
 * again at the nine. The score is the pips left in your hand, added up across
 * rounds, and the player with the fewest wins — so the ladder the rest of this
 * collection uses for difficulty is here a ladder of hands played, which is the
 * only honest thing to count in a game with no generated board.
 *
 * **The deal is a pure function of (seed, round, players).** Nothing else in
 * here is random at all: the boneyard is dealt from the top in order, so a save
 * is the list of moves and nothing more — the same property every other game in
 * this collection has, for the same reason.
 */

import { createRng, hashSeed } from '../shared/rng';

export const MAX_PIP = 9;

/** Every tile in a double-nine set, ordered by low pip then high. */
export const TILES: readonly (readonly [number, number])[] = (() => {
  const out: [number, number][] = [];
  for (let low = 0; low <= MAX_PIP; low++) {
    for (let high = low; high <= MAX_PIP; high++) out.push([low, high]);
  }
  return out;
})();

export const TILE_COUNT = TILES.length;

export const pipsOf = (tile: number): readonly [number, number] =>
  TILES[tile] as readonly [number, number];

export const isDouble = (tile: number): boolean => {
  const [low, high] = pipsOf(tile);
  return low === high;
};

/** The tile's value against the scoring at the end of a round. */
export const valueOf = (tile: number): number => {
  const [low, high] = pipsOf(tile);
  return low + high;
};

/** The index of the double worth `pips`. The engine of every round is one. */
export function doubleOf(pips: number): number {
  return TILES.findIndex(([low, high]) => low === pips && high === pips);
}

/** The other end of a tile, given the end that matched. */
export function otherEnd(tile: number, matched: number): number {
  const [low, high] = pipsOf(tile);
  return matched === low ? high : low;
}

export function hasPip(tile: number, pips: number): boolean {
  const [low, high] = pipsOf(tile);
  return low === pips || high === pips;
}

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

/**
 * Tiles dealt to each player. Eight, whatever the table size.
 *
 * This started as fourteen for two players down to nine for four, on the
 * reasoning that a smaller table wants a bigger hand. Three hundred rounds a
 * setting said otherwise. What a big hand actually does is end the round
 * *blocked* — everybody stuck with the boneyard spent and nobody out — because
 * the tiles that would have unstuck somebody are sitting in a hand rather than
 * on a train:
 *
 *      hand   2 players   3 players   4 players    (rounds ending blocked)
 *        14        53%         69%         58%
 *        12        49%         49%         54%
 *        10        40%         34%         36%
 *         8        36%         22%         18%
 *
 * Eight is the bottom of that, and also the shortest round. A blocked round is
 * a real ending and it still scores, but half of them ending in a shrug is not
 * a game, so the number is the measured one rather than the reasoned one.
 *
 * Trimming the boneyard instead was measured too, and runs the wrong way: a
 * ten-tile boneyard cuts a two-player round from 47 turns to 25 and pushes
 * blocked rounds back up to 70%, because blocking is what happens when the
 * boneyard is empty.
 */
export function handSize(_players: number): number {
  return 8;
}

/** The engine double for a round. Ten rounds down from the nine, then again. */
export function engineFor(round: number): number {
  const step = (round - 1) % (MAX_PIP + 1);
  return MAX_PIP - step;
}

export interface Placed {
  tile: number;
  /** The pip that matched the train's open end when this tile was laid. */
  from: number;
  /** The pip it left open. Equal to `from` on a double. */
  to: number;
}

export interface Train {
  /** The player who owns it, or null for the Mexican train. */
  owner: number | null;
  tiles: Placed[];
  /** The pip anything played here has to match. The engine until it is started. */
  end: number;
  /**
   * Anybody may play here.
   *
   * Always true for the Mexican train. True for a player's train once they have
   * had a turn they could not play on it — which is the whole tension of the
   * game: not playing costs you the privacy of your own train.
   */
  open: boolean;
}

export interface Position {
  round: number;
  players: number;
  engine: number;
  hands: number[][];
  boneyard: number[];
  /** One per player, in seat order, then the Mexican train last. */
  trains: Train[];
  turn: number;
  /**
   * A double that has been laid and not yet answered.
   *
   * Until it is, it is the only thing anybody may play on — including the
   * player who laid it, and including the players after them if they could
   * not. That is the rule that makes a double worth holding on to.
   */
  pending: { train: number; pips: number } | null;
  /** The current player has taken their tile from the boneyard. */
  drawn: boolean;
  /** Consecutive turns in which nobody could play. The round dies at `players`. */
  passes: number;
  /** Where the current turn began in the move list. See `canUndo` in game.ts. */
  turnStart: number;
  /** Moves back to which undo is safe: never past a draw, which reveals a tile. */
  undoFloor: number;
  over: boolean;
  /** The player who went out, or null when the round was blocked. */
  wentOut: number | null;
}

/** The index of the Mexican train in `trains`. */
export const mexicanIndex = (players: number): number => players;

export function deal(seed: string, round: number, players: number): Position {
  const engine = engineFor(round);
  const rng = createRng(hashSeed(seed, ':', round, ':', players));

  const pool = TILES.map((_, index) => index).filter((tile) => tile !== doubleOf(engine));
  rng.shuffle(pool);

  const size = handSize(players);
  const hands: number[][] = [];
  for (let player = 0; player < players; player++) {
    // Sorted, because a hand you have to search is a hand you misplay. The deal
    // is already random; the order it is held in is not information.
    hands.push(pool.splice(0, size).sort((a, b) => valueOf(a) - valueOf(b) || a - b));
  }

  const trains: Train[] = [];
  for (let player = 0; player < players; player++) {
    trains.push({ owner: player, tiles: [], end: engine, open: false });
  }
  trains.push({ owner: null, tiles: [], end: engine, open: true });

  return {
    round,
    players,
    engine,
    hands,
    boneyard: pool,
    trains,
    turn: 0,
    pending: null,
    drawn: false,
    passes: 0,
    turnStart: 0,
    undoFloor: 0,
    over: false,
    wentOut: null,
  };
}

/* ------------------------------------------------------------------ */
/* Moves                                                               */
/* ------------------------------------------------------------------ */

export type Move =
  | { kind: 'play'; tile: number; train: number }
  | { kind: 'draw' }
  | { kind: 'pass' };

export interface Play {
  tile: number;
  train: number;
}

/** Whether `player` is allowed to lay tiles on train `index` at all. */
export function mayUse(position: Position, player: number, index: number): boolean {
  const train = position.trains[index];
  if (!train) return false;
  return train.open || train.owner === player;
}

/**
 * Everything the player to move could lay right now.
 *
 * The pending double short-circuits the whole thing: while one is outstanding
 * there is exactly one place on the board anybody may play, and this is the
 * only rule in the game that overrides whose train is whose.
 */
export function legalPlays(position: Position): Play[] {
  if (position.over) return [];
  const hand = position.hands[position.turn];
  if (!hand) return [];

  const out: Play[] = [];

  if (position.pending) {
    const { train, pips } = position.pending;
    for (const tile of hand) {
      if (hasPip(tile, pips)) out.push({ tile, train });
    }
    return out;
  }

  for (let index = 0; index < position.trains.length; index++) {
    if (!mayUse(position, position.turn, index)) continue;
    const train = position.trains[index] as Train;
    for (const tile of hand) {
      if (hasPip(tile, train.end)) out.push({ tile, train: index });
    }
  }
  return out;
}

export function isLegalMove(position: Position, move: Move): boolean {
  if (position.over) return false;

  if (move.kind === 'play') {
    return legalPlays(position).some(
      (play) => play.tile === move.tile && play.train === move.train,
    );
  }

  // Drawing and passing are both "I cannot play", and the difference between
  // them is only whether the boneyard still has something to give.
  if (legalPlays(position).length > 0) return false;
  if (move.kind === 'draw') return !position.drawn && position.boneyard.length > 0;
  return position.drawn || position.boneyard.length === 0;
}

/**
 * Plays one move. The caller is expected to have checked `isLegalMove`.
 *
 * **Nothing here ends a turn on the player's behalf except a tile that fits.**
 * Drawing and failing does not, and neither does laying a double you cannot
 * answer: both leave the player holding the board until they tap Pass. It
 * costs a tap and buys the only moment in the game in which a player can look
 * at the tile they just drew — which is theirs alone, so the curtain cannot
 * come down on its own before they have seen it.
 *
 * Returns a new position; nothing here mutates its argument, which is what lets
 * `replay` be the single definition of what the board is.
 */
export function applyMove(position: Position, move: Move, moveIndex: number): Position {
  const next = clone(position);

  if (move.kind === 'play') {
    playTile(next, move.tile, move.train, moveIndex);
    return next;
  }

  if (move.kind === 'draw') {
    const tile = next.boneyard.shift() as number;
    const hand = next.hands[next.turn] as number[];
    hand.push(tile);
    hand.sort((a, b) => valueOf(a) - valueOf(b) || a - b);
    next.drawn = true;
    // An undo may not reach back past this: the drawn tile is information the
    // player did not have a moment ago, and taking the draw back would hand
    // them a look into the boneyard.
    next.undoFloor = moveIndex + 1;
    return next;
  }

  endTurn(next, moveIndex + 1, true);
  return next;
}

function playTile(position: Position, tile: number, index: number, moveIndex: number): void {
  const train = position.trains[index] as Train;
  const hand = position.hands[position.turn] as number[];

  hand.splice(hand.indexOf(tile), 1);
  closeOwnTrain(position, index);
  const from = train.end;
  const to = isDouble(tile) ? from : otherEnd(tile, from);
  train.tiles.push({ tile, from, to });
  train.end = to;

  position.passes = 0;

  if (hand.length === 0) {
    position.over = true;
    position.wentOut = position.turn;
    position.pending = null;
    return;
  }

  if (isDouble(tile)) {
    /*
     * The double has to be answered, and the player who laid it answers it
     * first — so the turn does not end here. If they have nothing for it they
     * take the normal way out, drawing and then passing, and the double is
     * left standing for whoever comes next.
     */
    position.pending = { train: index, pips: to };
    return;
  }

  position.pending = null;
  endTurn(position, moveIndex + 1, false);
}

/**
 * Hands the board on.
 *
 * `opened` is the whole cost of not being able to play: a train whose owner had
 * to draw is open to everybody until they lay on it again. It is deliberately
 * not cleared here — `playTile` closes it, because laying on your own train is
 * the only thing that does.
 */
function endTurn(position: Position, nextIndex: number, failed: boolean): void {
  const train = position.trains[position.turn];
  if (failed && train) {
    train.open = true;
    /*
     * A turn nobody could play only counts towards killing the round once the
     * boneyard is spent. While there are tiles left to draw the table is not
     * stuck — it is one tile poorer and about to come round again — and
     * counting those would end four rounds in five with half the set unplayed.
     */
    position.passes = position.boneyard.length === 0 ? position.passes + 1 : 0;
  }

  // Everybody round the table in turn with nothing to play and nothing left to
  // draw. That is the only way a round ends without somebody going out.
  if (position.passes >= position.players) {
    position.over = true;
    position.wentOut = null;
    return;
  }

  position.turn = (position.turn + 1) % position.players;
  position.drawn = false;
  position.turnStart = nextIndex;
  position.undoFloor = nextIndex;
}

/**
 * Closes the current player's train when they lay on it.
 *
 * Called from `playTile` rather than folded into it, because the rule is about
 * ownership and not about the tile: laying on somebody else's open train, or on
 * the Mexican one, leaves yours open.
 */
function closeOwnTrain(position: Position, index: number): void {
  const train = position.trains[index];
  if (train && train.owner === position.turn) train.open = false;
}

function clone(position: Position): Position {
  return {
    ...position,
    hands: position.hands.map((hand) => hand.slice()),
    boneyard: position.boneyard.slice(),
    trains: position.trains.map((train) => ({ ...train, tiles: train.tiles.slice() })),
    pending: position.pending ? { ...position.pending } : null,
  };
}

/* ------------------------------------------------------------------ */
/* Replay and scoring                                                  */
/* ------------------------------------------------------------------ */

/**
 * Replays a move list from the deal.
 *
 * A move that no longer applies ends the replay rather than throwing — a
 * corrupt tail should cost the tail, not the round.
 */
export function replay(
  seed: string,
  round: number,
  players: number,
  moves: readonly Move[],
): { position: Position; applied: Move[] } {
  let position = deal(seed, round, players);
  const applied: Move[] = [];

  for (const move of moves) {
    if (!isLegalMove(position, move)) break;
    position = applyMove(position, move, applied.length);
    applied.push(move);
  }

  return { position, applied };
}

/** What each player is left holding. Lower is better; going out scores nothing. */
export function scores(position: Position): number[] {
  return position.hands.map((hand) => hand.reduce((sum, tile) => sum + valueOf(tile), 0));
}

/** The lowest score, or several where they tie. */
export function winnersOf(position: Position): number[] {
  const totals = scores(position);
  const best = Math.min(...totals);
  return totals.flatMap((total, player) => (total === best ? [player] : []));
}
