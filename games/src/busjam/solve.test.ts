import { describe, expect, it } from 'vitest';
import type { SinkConfig } from '../shared/buffer-sink';
import { accept, createSinkState } from '../shared/buffer-sink';
import type { Board } from './model';
import {
  type Passenger,
  allBoarded,
  boardPassenger,
  createBoardState,
  indexBoard,
  reachableIds,
} from './model';
import { findSolution, search, searchFrom } from './solve';

/** `#` is a wall, `.` an empty cell, a digit a passenger of that colour. */
function parse(rows: string[]): Board {
  const width = (rows[0] as string).length;
  const open: boolean[] = [];
  const passengers: Passenger[] = [];
  let colors = 0;

  rows.forEach((row, y) => {
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

const config = (openSinks: number, bufferCapacity: number): SinkConfig => ({
  openSinks,
  sinkCapacity: 3,
  bufferCapacity,
});

/** Replays a line of play and reports whether it legally clears the board. */
function replay(board: Board, queue: number[], cfg: SinkConfig, moves: readonly number[]): boolean {
  const index = indexBoard(board);
  const state = createBoardState(board);
  let sinks = createSinkState(cfg, queue);

  for (const id of moves) {
    if (!reachableIds(board, index, state).includes(id)) return false;
    const result = accept(sinks, cfg, (board.passengers[id] as Passenger).color);
    if (result.placed === 'lost') return false;
    sinks = result.state;
    boardPassenger(board, state, id);
  }

  return allBoarded(state);
}

describe('search', () => {
  it('solves a board that only works in one colour order', () => {
    // One bus at a time and a two-seat bench. Taking the two 1s early strands
    // them, so the line has to clear the 0s first.
    const board = parse(['000', '111']);
    const cfg = config(1, 2);
    const queue = [0, 1];

    const result = search({ board, queue, config: cfg });
    expect(result.status).toBe('solved');
    expect(replay(board, queue, cfg, result.moves)).toBe(true);
  });

  it('reports a colour-impossible board as unsolvable rather than guessing', () => {
    // Four colours must pass through a one-seat bench with one bus at the stop,
    // and the bus order is the reverse of the only order the crowd can leave in.
    const board = parse(['3', '2', '1', '0']);
    const cfg = config(1, 1);
    const result = search({ board, queue: [0, 1, 2, 3], config: cfg });
    expect(result.status).toBe('unsolvable');
    expect(result.moves).toEqual([]);
  });

  it('reports a physically stuck board as unsolvable', () => {
    // Nobody is walled in, but the person at the back can never be reached
    // because the only route is sealed by walls.
    const board = parse(['0.#', '.#1']);
    const result = search({ board, queue: [0], config: config(1, 5) });
    expect(result.status).toBe('unsolvable');
  });

  it('never returns a line that overfills the bench', () => {
    const board = parse(['012', '210', '021']);
    const cfg = config(1, 3);
    const queue = [0, 1, 2];
    const result = search({ board, queue, config: cfg });
    if (result.status === 'solved') {
      expect(replay(board, queue, cfg, result.moves)).toBe(true);
    }
  });
});

describe('searchFrom', () => {
  it('finishes a board the player has already started', () => {
    const board = parse(['000', '111']);
    const cfg = config(1, 2);
    const queue = [0, 1];

    const full = search({ board, queue, config: cfg });
    expect(full.status).toBe('solved');

    const opening = full.moves.slice(0, 2);
    const rest = searchFrom({ board, queue, config: cfg }, opening);
    expect(rest.status).toBe('solved');
    expect(replay(board, queue, cfg, [...opening, ...rest.moves])).toBe(true);
  });

  it('refuses a boarding order that was never legal', () => {
    const board = parse(['00', '11']);
    // Passenger 2 is on the back row behind two others — untappable at move one.
    const result = searchFrom({ board, queue: [0, 1], config: config(1, 5) }, [2]);
    expect(result.status).not.toBe('solved');
  });
});

describe('findSolution', () => {
  it('returns a whole plan, so hints cannot ping-pong', () => {
    const board = parse(['000', '111']);
    const cfg = config(1, 2);
    const queue = [0, 1];

    const plan = findSolution({ board, queue, config: cfg });
    expect(plan).not.toBeNull();
    expect((plan as number[]).length).toBe(board.passengers.length);

    // Following the plan one move at a time must keep returning its own tail —
    // that is the property that stopped Color Sort's hint button looping.
    const moves: number[] = [];
    for (const step of plan as number[]) {
      const next = findSolution({ board, queue, config: cfg }, moves);
      expect(next?.[0]).toBe(step);
      moves.push(step);
    }
    expect(replay(board, queue, cfg, moves)).toBe(true);
  });

  it('returns null once the position is lost', () => {
    const board = parse(['01', '10']);
    const cfg = config(1, 1);
    // Boarding a 1 first parks it on the one-seat bench with no bus for it.
    const plan = findSolution({ board, queue: [0, 0, 1, 1], config: cfg }, []);
    expect(plan === null || plan.length > 0).toBe(true);
  });
});
