/**
 * A run in progress, as a short string.
 *
 * **This is the one game here whose save is a position rather than a history.**
 * Every puzzle in this collection stores a move list and replays it, which
 * works because a board is a pure function of its seed and the moves are
 * integer arithmetic. A real-time game has no such list: what happened is not
 * "left, left, rotate" but "left, left, rotate, and forty-one gravity ticks in
 * between", and replaying that faithfully would mean the save depending on how
 * long the phone took to wake up.
 *
 * Artillery reached the same conclusion from the other direction and the
 * remedy is the same: store the position. A well is 220 cells of three bits,
 * so the whole run is about 250 characters — well inside the save code in
 * Settings, which is the entire backup story for a game with no server.
 *
 * Everything here is integers and a fixed alphabet, so a save written on one
 * browser reopens byte-identical on another.
 */

import { type BagState } from './bag';
import { EMPTY, PIECE_COUNT, ROWS, WELL_W, canPlace } from './model';
import { type Run } from './run';

/** Version prefix. An unrecognised one is a fresh game, not an error. */
const VERSION = '1';

/** Empty first, then the seven types in bag order. */
const CELL_CHARS = '.IOTSZJL';

function encodeWell(well: Int8Array): string {
  let out = '';
  for (let i = 0; i < ROWS * WELL_W; i++) {
    const value = well[i] ?? EMPTY;
    out += CELL_CHARS[value === EMPTY ? 0 : value + 1] ?? '.';
  }
  return out;
}

function decodeWell(text: string): Int8Array | null {
  if (text.length !== ROWS * WELL_W) return null;
  const well = new Int8Array(ROWS * WELL_W);
  for (let i = 0; i < text.length; i++) {
    const at = CELL_CHARS.indexOf(text[i]!);
    if (at === -1) return null;
    well[i] = at === 0 ? EMPTY : at - 1;
  }
  return well;
}

const int = (value: number): string => String(Math.round(value));

export function encodeRun(run: Run): string {
  return [
    VERSION,
    int(run.game),
    encodeWell(run.well),
    run.piece ? [run.piece.type, run.piece.rot, run.piece.x, run.piece.y].map(int).join(',') : '',
    run.hold === null ? '' : int(run.hold),
    run.holdUsed ? '1' : '0',
    [run.bag.dealt, run.bag.bagLevel].map(int).join(','),
    int(run.lines),
    int(run.score),
    int(run.placed),
  ].join('|');
}

const number = (text: string | undefined): number | null => {
  if (text === undefined || text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? Math.round(value) : null;
};

const inRange = (value: number | null, min: number, max: number): value is number =>
  value !== null && value >= min && value <= max;

/**
 * Reads a snapshot back, or returns null.
 *
 * Null for anything that does not parse *and* anything that parses into a run
 * that could not have happened — a piece type of nine, a well of the wrong
 * length, a hold slot holding something that is not a piece. A save code is a
 * string a player can paste, so this is a trust boundary: the cost of being
 * strict is starting a fresh game, and the cost of being lax is a board the
 * rules cannot describe.
 *
 * A snapshot is never written for a finished run, so anything claiming to be
 * one arrives here with a live piece that fits where it says it is. A run that
 * ended is refused on one of those two counts: a top out leaves no piece at
 * all, and a block out leaves one overlapping the well it could not spawn into.
 */
export function decodeRun(
  text: string,
  seed: string,
  game: number,
): Run | null {
  if (typeof text !== 'string') return null;
  const parts = text.split('|');
  if (parts[0] !== VERSION || parts.length !== 10) return null;

  const savedGame = number(parts[1]);
  // The run belongs to a game number, and the caller says which one is open.
  // A mismatch is an imported code from a different point in someone's history.
  if (savedGame === null || savedGame !== game) return null;

  const well = decodeWell(parts[2] ?? '');
  if (!well) return null;

  const pieceParts = (parts[3] ?? '').split(',');
  if (pieceParts.length !== 4) return null;
  const type = number(pieceParts[0]);
  const rot = number(pieceParts[1]);
  const x = number(pieceParts[2]);
  const y = number(pieceParts[3]);
  if (!inRange(type, 0, PIECE_COUNT - 1)) return null;
  if (!inRange(rot, 0, 3)) return null;
  if (!inRange(x, -4, WELL_W)) return null;
  if (!inRange(y, -4, ROWS)) return null;

  const holdText = parts[4] ?? '';
  const hold = holdText === '' ? null : number(holdText);
  if (hold !== null && !inRange(hold, 0, PIECE_COUNT - 1)) return null;

  const bagParts = (parts[6] ?? '').split(',');
  if (bagParts.length !== 2) return null;
  const dealt = number(bagParts[0]);
  const bagLevel = number(bagParts[1]);
  if (!inRange(dealt, 0, 1e7)) return null;
  if (!inRange(bagLevel, 1, 1e5)) return null;

  const lines = number(parts[7]);
  const score = number(parts[8]);
  const placed = number(parts[9]);
  if (!inRange(lines, 0, 1e7)) return null;
  if (!inRange(score, 0, 1e12)) return null;
  if (!inRange(placed, 0, 1e7)) return null;

  const piece = { type, rot, x, y };
  // The last check, and the one that is about the game rather than the format:
  // a piece sitting inside the stack is not a run anybody can carry on.
  if (!canPlace(well, piece)) return null;

  const bag: BagState = { dealt, bagLevel };

  return {
    seed,
    game,
    well,
    piece,
    bag,
    hold,
    holdUsed: parts[5] === '1',
    lines,
    score,
    placed,
    over: false,
  };
}
