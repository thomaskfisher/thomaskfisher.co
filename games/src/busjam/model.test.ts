import { describe, expect, it } from 'vitest';
import {
  type Board,
  allBoarded,
  boardPassenger,
  cellIndex,
  createBoardState,
  exitDistances,
  indexBoard,
  isClearable,
  isReachable,
  isWellFormed,
  pathToExit,
  reachableIds,
  remainingCount,
  restorePassenger,
} from './model';

/**
 * Boards from a picture. `#` is a wall, `.` an empty cell, and a digit is a
 * passenger of that colour. Row 0 — the top row — is the exit.
 */
function parse(rows: string[]): Board {
  const width = (rows[0] as string).length;
  const open: boolean[] = [];
  const passengers: Board['passengers'] = [];
  let colors = 0;

  rows.forEach((row, y) => {
    expect(row.length, 'ragged test board').toBe(width);
    for (let x = 0; x < width; x++) {
      const ch = row[x] as string;
      open.push(ch !== '#');
      if (ch >= '0' && ch <= '9') {
        const color = Number(ch);
        passengers.push({ id: passengers.length, color, x, y });
        colors = Math.max(colors, color + 1);
      }
    }
  });

  return { width, height: rows.length, open, passengers, colors: Math.max(colors, 1) };
}

describe('reachability', () => {
  it('lets anyone on the exit row leave', () => {
    const board = parse(['0.', '..']);
    const index = indexBoard(board);
    const state = createBoardState(board);
    expect(isReachable(board, index, state, 0)).toBe(true);
  });

  it('walks someone up a clear corridor', () => {
    const board = parse(['.#', '0#']);
    expect(isReachable(board, indexBoard(board), createBoardState(board), 0)).toBe(true);
  });

  it('blocks someone walled in on every side', () => {
    // Walls, not people, so no order of boarding ever frees them.
    const board = parse(['..#', '.#0']);
    expect(isReachable(board, indexBoard(board), createBoardState(board), 0)).toBe(false);
  });

  it('blocks someone whose only exit cell is occupied', () => {
    const board = parse(['11', '.0']);
    const zero = board.passengers.findIndex((p) => p.color === 0);
    expect(isReachable(board, indexBoard(board), createBoardState(board), zero)).toBe(false);
  });

  it('opens a route once whoever was in the way has boarded', () => {
    const board = parse(['1#', '0#']);
    const index = indexBoard(board);
    const state = createBoardState(board);
    const front = board.passengers.findIndex((p) => p.y === 0);
    const back = board.passengers.findIndex((p) => p.y === 1);

    expect(isReachable(board, index, state, back)).toBe(false);
    boardPassenger(board, state, front);
    expect(isReachable(board, index, state, back)).toBe(true);
  });

  it('agrees across all three implementations of the rule', () => {
    const board = parse(['.1.2', '3#4.', '.5#6', '78.9']);
    const index = indexBoard(board);
    const state = createBoardState(board);

    // One rule, three callers: the sweep decides whether the level is lost, the
    // single-passenger search restores a save, and the route decides whether a
    // tap is legal. If they can disagree, the game can refuse a tap it has just
    // told the player is available. Walk a whole board comparing all three.
    while (remainingCount(state) > 0) {
      const swept = reachableIds(board, index, state).sort((a, b) => a - b);

      const individually = board.passengers
        .map((p) => p.id)
        .filter((id) => isReachable(board, index, state, id));
      expect(swept).toEqual(individually);

      const routed = board.passengers
        .map((p) => p.id)
        .filter((id) => pathToExit(board, index, state, id) !== null);
      expect(swept).toEqual(routed);

      if (swept.length === 0) break;
      boardPassenger(board, state, swept[0] as number);
    }
  });

  it('walks a route that only uses empty cells and ends at the exit row', () => {
    const board = parse(['..#.', '#.#.', '#0#.', '####']);
    const index = indexBoard(board);
    const state = createBoardState(board);

    const path = pathToExit(board, index, state, 0);
    expect(path).not.toBeNull();
    const route = path as number[];

    expect(route[0]).toBe(cellIndex(board, 0 + 1, 2));
    expect(Math.floor((route[route.length - 1] as number) / board.width)).toBe(0);

    // Every step is orthogonal, walkable, and unoccupied apart from the start.
    for (let i = 1; i < route.length; i++) {
      const from = route[i - 1] as number;
      const to = route[i] as number;
      const dx = Math.abs((to % board.width) - (from % board.width));
      const dy = Math.abs(Math.floor(to / board.width) - Math.floor(from / board.width));
      expect(dx + dy).toBe(1);
      expect(board.open[to]).toBe(true);
      expect(state.occupant[to]).toBe(-1);
    }
  });
});

describe('board state', () => {
  it('restores a passenger exactly, so search can backtrack', () => {
    const board = parse(['12', '34']);
    const state = createBoardState(board);
    const before = JSON.stringify(state);

    boardPassenger(board, state, 2);
    expect(JSON.stringify(state)).not.toBe(before);
    restorePassenger(board, state, 2);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('counts down to won', () => {
    const board = parse(['12']);
    const state = createBoardState(board);
    expect(allBoarded(state)).toBe(false);
    boardPassenger(board, state, 0);
    boardPassenger(board, state, 1);
    expect(allBoarded(state)).toBe(true);
  });
});

describe('exit distances', () => {
  it('measures from the exit row through empty cells only', () => {
    const board = parse(['....', '.##.', '....']);
    const index = indexBoard(board);
    const state = createBoardState(board);
    const distance = exitDistances(board, index, state);

    expect(distance[cellIndex(board, 0, 0)]).toBe(0);
    expect(distance[cellIndex(board, 0, 1)]).toBe(1);
    expect(distance[cellIndex(board, 0, 2)]).toBe(2);
    // Walls are never reachable, whatever is around them.
    expect(distance[cellIndex(board, 1, 1)]).toBe(-1);
  });

  it('reports -1 for free cells sealed off by the crowd', () => {
    const board = parse(['11', '.#']);
    const index = indexBoard(board);
    const state = createBoardState(board);
    expect(exitDistances(board, index, state)[cellIndex(board, 0, 1)]).toBe(-1);
  });
});

describe('well-formedness', () => {
  it('accepts a plain board', () => {
    expect(isWellFormed(parse(['12', '.3']))).toBe(true);
  });

  it('rejects a board with no way off the top', () => {
    expect(isWellFormed(parse(['##', '12']))).toBe(false);
  });

  it('rejects a passenger standing in a wall', () => {
    const board = parse(['1.', '..']);
    (board.passengers[0] as { x: number }).x = 0;
    board.open[cellIndex(board, 0, 0)] = false;
    expect(isWellFormed(board)).toBe(false);
  });

  it('rejects a colour outside the palette in play', () => {
    const board = parse(['1.', '..']);
    (board.passengers[0] as { color: number }).color = 9;
    expect(isWellFormed(board)).toBe(false);
  });
});

describe('clearability', () => {
  it('accepts a crowd that peels front to back', () => {
    expect(isClearable(parse(['11', '22', '33']))).toBe(true);
  });

  it('rejects anyone walled off from the exit for good', () => {
    // The bottom-right passenger is boxed in by walls, not by people, so no
    // order of boarding ever frees them.
    const board = parse(['..#', '..#', '##1']);
    expect(isClearable(board)).toBe(false);
  });
});
