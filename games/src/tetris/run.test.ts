import { describe, expect, it } from 'vitest';

import { I, O, ROWS, WELL_W, cellsOf, emptyWell } from './model';
import { type Action, type Run, apply, levelIn, lockDown, playAll, previewOf, startRun } from './run';

const fresh = (seed = 'run', game = 1): Run => startRun(seed, game);

/** A run with a well of the test's choosing, and a piece parked in it. */
function staged(well: Int8Array, piece: Run['piece']): Run {
  return { ...fresh(), well, piece };
}

describe('starting a run', () => {
  it('opens with a piece in the air and an empty well', () => {
    const run = fresh();
    expect(run.piece).not.toBeNull();
    expect(run.over).toBe(false);
    expect(run.lines).toBe(0);
    expect(run.score).toBe(0);
    expect(run.placed).toBe(0);
    expect(run.well.every((cell) => cell === -1)).toBe(true);
    expect(previewOf(run)).toHaveLength(3);
  });

  it('is a pure function of its seed and game number', () => {
    const moves: Action[] = ['left', 'cw', 'hard', 'right', 'hard', 'hold', 'hard', 'hard'];
    const a = playAll(fresh('same', 2), moves);
    const b = playAll(fresh('same', 2), moves);
    expect([...a.well]).toEqual([...b.well]);
    expect(a.score).toBe(b.score);
    expect(a.piece).toEqual(b.piece);

    // Forty pieces deep, so this is the two streams differing rather than a
    // lucky difference in where a handful of pieces happened to land.
    const deep = (seed: string): number[] =>
      [...playAll(fresh(seed, 2), new Array(40).fill('hard') as Action[]).well];
    expect(deep('other')).not.toEqual(deep('same'));
  });
});

describe('moving', () => {
  it('refuses a move into the wall rather than throwing', () => {
    let run = fresh();
    for (let i = 0; i < 20; i++) run = apply(run, 'left').run;
    const { run: after, events } = apply(run, 'left');
    expect(events).toEqual([{ kind: 'refused' }]);
    expect(after.piece).toEqual(run.piece);
  });

  it('pays a point a row for a soft drop and two for a hard one', () => {
    const soft = apply(fresh(), 'soft');
    expect(soft.run.score).toBe(1);

    const run = fresh();
    const distance = ROWS - 1 - run.piece!.y - Math.max(...cellsOf(run.piece!).map(([, y]) => y - run.piece!.y));
    const hard = apply(run, 'hard');
    expect(hard.run.score).toBe(distance * 2);
    expect(hard.run.placed).toBe(1);
  });

  it('ignores everything once the run is over', () => {
    const over: Run = { ...fresh(), over: true };
    expect(apply(over, 'left').events).toEqual([]);
    expect(apply(over, 'hard').run).toBe(over);
  });
});

describe('hold', () => {
  it('takes the falling piece and gives back the one that was set aside', () => {
    const run = fresh();
    const first = run.piece!.type;

    const held = apply(run, 'hold');
    expect(held.run.hold).toBe(first);
    expect(held.run.holdUsed).toBe(true);
    expect(held.run.piece!.type).not.toBe(undefined);

    const second = held.run.piece!.type;
    // Used up for this piece.
    expect(apply(held.run, 'hold').events).toEqual([{ kind: 'refused' }]);

    // And released by the next lock, at which point it swaps back.
    const locked = apply(held.run, 'hard').run;
    expect(locked.holdUsed).toBe(false);
    const swapped = apply(locked, 'hold').run;
    expect(swapped.piece!.type).toBe(first);
    expect(swapped.hold).toBe(locked.piece!.type);
    expect(second).toBe(held.run.piece!.type);
  });

  it('brings the swapped piece in at spawn, not where the old one was', () => {
    let run = fresh();
    run = apply(run, 'left').run;
    run = apply(run, 'left').run;
    run = apply(run, 'soft').run;
    const moved = run.piece!;

    const held = apply(run, 'hold').run;
    expect(held.piece!.y).toBe(0);
    expect(held.piece!.x).not.toBe(moved.x);
  });
});

describe('locking', () => {
  it('clears a row and counts it', () => {
    const well = emptyWell();
    const row = ROWS - 1;
    for (let x = 0; x < WELL_W; x++) if (x !== 4 && x !== 5) well[row * WELL_W + x] = 0;

    const run = staged(well, { type: O, rot: 0, x: 4, y: ROWS - 2 });
    const { run: after, events } = lockDown(run);

    expect(events[0]).toMatchObject({ kind: 'locked', lines: 1, rows: [row] });
    expect(after.lines).toBe(1);
    expect(after.score).toBe(100);
    expect(after.over).toBe(false);
    expect(after.piece).not.toBeNull();
  });

  it('pays four at once far better than four singles', () => {
    const well = emptyWell();
    for (let y = ROWS - 4; y < ROWS; y++) {
      for (let x = 0; x < WELL_W; x++) if (x !== 9) well[y * WELL_W + x] = 0;
    }
    const run = staged(well, { type: I, rot: 1, x: 7, y: ROWS - 4 });
    const after = lockDown(run).run;
    expect(after.lines).toBe(4);
    expect(after.score).toBe(800);
  });

  it('ends the run when a piece comes to rest without reaching the well', () => {
    const run = staged(emptyWell(), { type: O, rot: 0, x: 4, y: 0 });
    const { run: after, events } = lockDown(run);
    expect(events.some((event) => event.kind === 'over')).toBe(true);
    expect(after.over).toBe(true);
    expect(after.piece).toBeNull();
  });

  it('ends the run when the next piece has nowhere to spawn', () => {
    // A solid pillar down the middle four columns. Every piece spawns into it,
    // and because the outside columns stay empty no row can ever complete —
    // so what is being tested is the spawn, not a clear that happens to save it.
    const well = emptyWell();
    for (let y = 0; y < ROWS; y++) {
      for (let x = 3; x <= 6; x++) well[y * WELL_W + x] = 0;
    }

    const run = staged(well, { type: O, rot: 0, x: 0, y: ROWS - 2 });
    const { run: after, events } = lockDown(run);
    expect(after.over).toBe(true);
    expect(events.some((event) => event.kind === 'over')).toBe(true);
    // The piece that could not fit is kept, so there is something to look at.
    expect(after.piece).not.toBeNull();
  });
});

describe('gravity', () => {
  it('walks the piece down a row at a time, then locks it', () => {
    let run = fresh();
    const start = run.piece!.y;
    run = apply(run, 'gravity').run;
    expect(run.piece!.y).toBe(start + 1);

    // All the way to the floor and one step past it.
    while (run.placed === 0) run = apply(run, 'gravity').run;
    expect(run.placed).toBe(1);
    expect(run.piece!.y).toBe(0);
  });

  it('takes the level from lines cleared, ten to a level', () => {
    expect(levelIn(fresh())).toBe(1);
    expect(levelIn({ ...fresh(), lines: 9 })).toBe(1);
    expect(levelIn({ ...fresh(), lines: 10 })).toBe(2);
    // And the probe's pin overrides it, which is the only thing it does.
    expect(levelIn({ ...fresh(), lines: 10, fixedLevel: 17 })).toBe(17);
  });
});
