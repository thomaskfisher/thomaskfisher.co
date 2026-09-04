/**
 * Reading and writing a car park as six lines of six characters.
 *
 * `X` is the target, `.` is empty tarmac, and every other letter names one
 * vehicle. It is the notation this puzzle has always been written in, which
 * makes a failing test or a probe dump something you can read at a glance
 * instead of a list of offsets:
 *
 * ```
 * ..B...
 * ..B...
 * XXB...
 * ......
 * ......
 * ......
 * ```
 *
 * Imported only by the tests and by `tools/`, never by a game entry point, so
 * none of this reaches the bundle.
 */

import { type Board, type Orientation, type Vehicle, SIZE, TARGET } from './model';

export interface ParsedLevel {
  board: Board;
  position: number[];
  /** The letter each vehicle was written as, parallel to `board.vehicles`. */
  labels: string[];
}

/**
 * Parses a park. Throws on anything malformed rather than guessing — every
 * caller is a test or a tool, and a silently misread board is a wasted hour.
 */
export function parse(art: string): ParsedLevel {
  const rows = art
    .trim()
    .split('\n')
    .map((row) => row.trim());

  if (rows.length !== SIZE) throw new Error(`Expected ${SIZE} rows, got ${rows.length}`);
  for (const row of rows) {
    if (row.length !== SIZE) throw new Error(`Expected ${SIZE} columns in "${row}"`);
  }

  const cells = new Map<string, { row: number; column: number }[]>();
  for (let row = 0; row < SIZE; row++) {
    for (let column = 0; column < SIZE; column++) {
      const letter = (rows[row] as string)[column] as string;
      if (letter === '.') continue;
      const existing = cells.get(letter) ?? [];
      existing.push({ row, column });
      cells.set(letter, existing);
    }
  }

  // The target has to be index 0; the rest keep the order they first appear in,
  // which makes the offsets in a failure message follow the reading order.
  const letters = [...cells.keys()].sort((a, b) => (a === 'X' ? -1 : b === 'X' ? 1 : 0));
  if (letters[TARGET] !== 'X') throw new Error('No target (X) on the board');

  const vehicles: Vehicle[] = [];
  const position: number[] = [];

  for (const letter of letters) {
    const owned = cells.get(letter) as { row: number; column: number }[];
    const rowsUsed = new Set(owned.map((cell) => cell.row));
    const columnsUsed = new Set(owned.map((cell) => cell.column));

    if (rowsUsed.size !== 1 && columnsUsed.size !== 1) {
      throw new Error(`Vehicle ${letter} is not a straight line`);
    }

    const orientation: Orientation = rowsUsed.size === 1 ? 'h' : 'v';
    const cross = orientation === 'h' ? (owned[0] as { row: number }).row : (owned[0] as { column: number }).column;
    const along = owned.map((cell) => (orientation === 'h' ? cell.column : cell.row));
    const start = Math.min(...along);

    if (Math.max(...along) - start + 1 !== owned.length) {
      throw new Error(`Vehicle ${letter} has a gap in it`);
    }

    vehicles.push({ orientation, length: owned.length, cross });
    position.push(start);
  }

  return { board: { vehicles }, position, labels: letters };
}

/**
 * The inverse, for a failure message that shows the board rather than
 * describing it. Pass the `labels` from `parse` to get the same letters back;
 * without them vehicles are named in order, which is what a generated board
 * wants since it never had letters of its own.
 */
export function format(board: Board, position: readonly number[], labels?: readonly string[]): string {
  const grid = Array.from({ length: SIZE }, () => Array<string>(SIZE).fill('.'));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWZ';

  for (let id = 0; id < board.vehicles.length; id++) {
    const vehicle = board.vehicles[id] as Vehicle;
    const letter = labels?.[id] ?? (id === TARGET ? 'X' : (alphabet[id - 1] ?? '?'));
    const start = position[id] as number;
    for (let step = 0; step < vehicle.length; step++) {
      const row = vehicle.orientation === 'h' ? vehicle.cross : start + step;
      const column = vehicle.orientation === 'h' ? start + step : vehicle.cross;
      (grid[row] as string[])[column] = letter;
    }
  }

  return grid.map((row) => row.join('')).join('\n');
}
