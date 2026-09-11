/**
 * Mancala rules — Kalah, six pits a side, four seeds each. Pure: no DOM, no
 * randomness, no opponent.
 *
 * **The board is one array of fourteen counts, and the stores are in it.**
 * Indices 0-5 are south's pits, 6 is south's store, 7-12 are north's, 13 is
 * north's. Sowing is then "step forward, wrapping at fourteen", and the only
 * special case in the whole file is skipping the *other* player's store — which
 * is one condition rather than a separate data structure for the stores and a
 * second set of rules for moving between them.
 *
 * There is no randomness anywhere in this game. Every position is reachable
 * from the opening by a list of moves, which is what makes the save a move list
 * and — see `game.ts` — is also why undo can be unlimited here when it cannot
 * be in Backgammon.
 */

export type Seat = 'south' | 'north';

export const PITS_PER_SIDE = 6;
export const SEEDS_PER_PIT = 4;

/** 0-5 south's pits, 6 south's store, 7-12 north's pits, 13 north's store. */
export const SOUTH_STORE = 6;
export const NORTH_STORE = 13;
export const BOARD_SIZE = 14;

export const TOTAL_SEEDS = PITS_PER_SIDE * SEEDS_PER_PIT * 2;

export type Board = number[];

export const OTHER: Readonly<Record<Seat, Seat>> = { south: 'north', north: 'south' };

export const storeOf = (seat: Seat): number => (seat === 'south' ? SOUTH_STORE : NORTH_STORE);

/** The six pits a seat may sow from, nearest their store last. */
export function pitsOf(seat: Seat): number[] {
  const from = seat === 'south' ? 0 : 7;
  return Array.from({ length: PITS_PER_SIDE }, (_, index) => from + index);
}

export function ownsPit(seat: Seat, pit: number): boolean {
  return seat === 'south' ? pit >= 0 && pit <= 5 : pit >= 7 && pit <= 12;
}

export const isStore = (pit: number): boolean => pit === SOUTH_STORE || pit === NORTH_STORE;

/**
 * The pit facing this one across the board.
 *
 * Used only by the capture rule, and it is the reason the two sides are stored
 * in opposite directions: the pit opposite `i` is always `12 - i`, with no
 * arithmetic that depends on whose turn it is.
 */
export const facing = (pit: number): number => 12 - pit;

export function openingBoard(): Board {
  const board = new Array<number>(BOARD_SIZE).fill(SEEDS_PER_PIT);
  board[SOUTH_STORE] = 0;
  board[NORTH_STORE] = 0;
  return board;
}

/* ------------------------------------------------------------------ */
/* Moves                                                               */
/* ------------------------------------------------------------------ */

/** A move is the pit picked up. That is the only decision in the game. */
export type Move = number;

export function legalMoves(board: Board, seat: Seat): Move[] {
  return pitsOf(seat).filter((pit) => (board[pit] as number) > 0);
}

export function isLegalMove(board: Board, seat: Seat, pit: Move): boolean {
  return ownsPit(seat, pit) && (board[pit] as number) > 0;
}

/** Everything one sowing did, so the renderer can show it rather than snap. */
export interface SowResult {
  board: Board;
  /** Pits the seeds landed in, in the order they were dropped. */
  path: number[];
  /** Where the last seed landed. */
  last: number;
  /** True when the last seed landed in the mover's own store. */
  extraTurn: boolean;
  /** Set when the last seed triggered a capture. */
  capture: { from: number; facing: number; seeds: number } | null;
  /** Whose turn it is after this move. */
  next: Seat;
  /** Seeds swept up because one side emptied. Set only on the final move. */
  sweep: { seat: Seat; seeds: number } | null;
  over: boolean;
}

/**
 * Plays one move.
 *
 * The three rules that make Kalah a game rather than a counting exercise all
 * live here, in the order they are checked:
 *
 *  1. **A seed never goes in the opponent's store.** Sowing skips it, which is
 *     why a lap of the board is thirteen pits for you and thirteen for them.
 *  2. **Finishing in your own store buys another turn.** Chaining these is most
 *     of the skill in the game.
 *  3. **Finishing in an empty pit on your own side captures** that seed and
 *     everything facing it. This is the only way seeds cross the board, and it
 *     is why the pit you are about to land in matters as much as the one you
 *     are picking up.
 */
export function sow(board: Board, seat: Seat, pit: Move): SowResult {
  const next = board.slice();
  const skip = storeOf(OTHER[seat]);
  const own = storeOf(seat);

  let seeds = next[pit] as number;
  next[pit] = 0;

  const path: number[] = [];
  let cursor = pit;

  while (seeds > 0) {
    cursor = (cursor + 1) % BOARD_SIZE;
    if (cursor === skip) continue;
    next[cursor] = (next[cursor] as number) + 1;
    path.push(cursor);
    seeds--;
  }

  const last = cursor;
  const extraTurn = last === own;

  let capture: SowResult['capture'] = null;
  if (!extraTurn && ownsPit(seat, last) && next[last] === 1) {
    const across = facing(last);
    const taken = next[across] as number;
    /*
     * **The facing pit has to hold something.** Landing in your own empty pit
     * opposite an empty one is simply a move that ended there — you do not win
     * the seed you just dropped. That is the standard Kalah rule and it is the
     * one worth having: the variant where you bank the lone seed rewards
     * running your own side dry, which is the opposite of how the game wants to
     * be played.
     */
    if (taken > 0) {
      next[own] = (next[own] as number) + taken + 1;
      next[across] = 0;
      next[last] = 0;
      capture = { from: last, facing: across, seeds: taken + 1 };
    }
  }

  /*
   * The end, and the sweep.
   *
   * When either side runs out of pits the game is over at once and the *other*
   * player banks whatever is left in front of them. Checking this after the
   * capture matters: a capture can be what empties a side.
   */
  const sweptSeat = emptiedSide(next);
  let sweep: SowResult['sweep'] = null;

  if (sweptSeat) {
    const collector = OTHER[sweptSeat];
    let total = 0;
    for (const collectorPit of pitsOf(collector)) {
      total += next[collectorPit] as number;
      next[collectorPit] = 0;
    }
    next[storeOf(collector)] = (next[storeOf(collector)] as number) + total;
    sweep = { seat: collector, seeds: total };
  }

  return {
    board: next,
    path,
    last,
    extraTurn,
    capture,
    next: extraTurn ? seat : OTHER[seat],
    sweep,
    over: sweptSeat !== null,
  };
}

/** Whichever side has no seeds left in its pits, or null. */
function emptiedSide(board: Board): Seat | null {
  const southEmpty = pitsOf('south').every((pit) => board[pit] === 0);
  if (southEmpty) return 'south';
  const northEmpty = pitsOf('north').every((pit) => board[pit] === 0);
  if (northEmpty) return 'north';
  return null;
}

export function isOver(board: Board): boolean {
  return emptiedSide(board) !== null;
}

export function scoreOf(board: Board, seat: Seat): number {
  return board[storeOf(seat)] as number;
}

/** The winner, or null for a draw. Only meaningful once the board is over. */
export function winnerOf(board: Board): Seat | null {
  const south = scoreOf(board, 'south');
  const north = scoreOf(board, 'north');
  if (south === north) return null;
  return south > north ? 'south' : 'north';
}

/* ------------------------------------------------------------------ */
/* Replay                                                              */
/* ------------------------------------------------------------------ */

export interface Position {
  board: Board;
  turn: Seat;
  over: boolean;
}

export function openingPosition(): Position {
  return { board: openingBoard(), turn: 'south', over: false };
}

/** Applies one move if it is legal. Returns null when it is not. */
export function step(position: Position, pit: Move): { position: Position; result: SowResult } | null {
  if (position.over) return null;
  if (!isLegalMove(position.board, position.turn, pit)) return null;

  const result = sow(position.board, position.turn, pit);
  return {
    position: { board: result.board, turn: result.next, over: result.over },
    result,
  };
}

/**
 * Replays a move list from the opening.
 *
 * A move that no longer applies ends the replay rather than throwing — a
 * corrupt tail should cost the tail, not the game.
 */
export function replay(moves: readonly Move[]): Position {
  let position = openingPosition();
  for (const pit of moves) {
    const played = step(position, pit);
    if (!played) break;
    position = played.position;
  }
  return position;
}

/** Seeds on the board, stores included. Always 48; the tests hold it to that. */
export function totalSeeds(board: Board): number {
  return board.reduce((sum, count) => sum + count, 0);
}
