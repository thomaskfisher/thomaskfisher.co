import { describe, expect, it } from 'vitest';

import { pressureForLevel } from '../shared/difficulty';
import { createRng, hashSeed } from '../shared/rng';
import { buildBoard, generateLevel, shapeFor, trapRate } from './generate';
import { type Board, DEAD, applyNode, evaluate, isWellFormed, nodeAt } from './model';
import { bestContinuation, findSolution, isWinnable, maxFinal } from './solve';

const SEED = 'test-profile-seed';

/** A spread across the whole curve, weighted towards where the shape changes. */
const SWEEP = [
  1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 21, 25, 30, 35, 40, 48, 56, 65, 75, 88, 100,
  120, 140, 165, 190, 220, 260, 300, 360, 430, 520, 640, 800, 1000,
];

/** Finishing count of every route on the board, dead runs included as zero. */
function allRouteFinals(board: Board): number[] {
  const finals: number[] = [];
  const walk = (row: number, lane: number, count: number): void => {
    if (count <= DEAD) {
      finals.push(DEAD);
      return;
    }
    if (row === board.rows) {
      finals.push(count);
      return;
    }
    const lo = lane < 0 ? 0 : Math.max(0, lane - board.reach);
    const hi = lane < 0 ? board.lanes - 1 : Math.min(board.lanes - 1, lane + board.reach);
    for (let next = lo; next <= hi; next++) {
      walk(row + 1, next, applyNode(nodeAt(board, row, next), count));
    }
  };
  walk(0, -1, board.startCount);
  return finals;
}

describe('generated levels', () => {
  /**
   * The one that matters. For every level in the sweep: the board is
   * structurally sound, it is not a walkover, it is winnable, and the route the
   * solver hands back actually wins when it is played.
   *
   * The last clause is the point. A solver that reports "solvable" and a route
   * that does not win are two different bugs, and only replaying catches the
   * second — which is the one that reaches the player as a hint that loses the
   * level for them.
   */
  it('are well formed, winnable, and win when the solver is followed', () => {
    for (const level of SWEEP) {
      const generated = generateLevel(SEED, level);
      const { board } = generated;

      expect(isWellFormed(board), `level ${level} malformed`).toBe(true);
      expect(board.horde, `level ${level} horde`).toBeGreaterThanOrEqual(1);

      // Winnable by construction: the horde is placed below the best finish.
      const best = maxFinal(board);
      expect(best, `level ${level} best finish`).toBeGreaterThan(board.horde);
      expect(isWinnable(board), `level ${level} not winnable`).toBe(true);

      const solution = findSolution(board);
      expect(solution, `level ${level} has no solution`).not.toBeNull();
      expect(solution, `level ${level} solution length`).toHaveLength(board.rows);
      expect(evaluate(board, solution as number[]).phase, `level ${level} solution loses`).toBe('won');
    }
  });

  it('are never already won and never a single forced line', () => {
    for (const level of SWEEP) {
      const { board } = generateLevel(SEED, level);
      const finals = allRouteFinals(board);
      const winning = finals.filter((final) => final > board.horde).length;

      // At least one way through, or the promise is broken...
      expect(winning, `level ${level} unwinnable`).toBeGreaterThan(0);
      // ...and at least one way to get it wrong, or there is no puzzle.
      expect(winning, `level ${level} is a walkover`).toBeLessThan(finals.length);
    }
  });

  it('leave at least one lane alive on every row', () => {
    // The construction invariant. If a row can wipe out every lane the board is
    // unwinnable however generous the horde, and no amount of retrying helps.
    for (const level of SWEEP) {
      const { board } = generateLevel(SEED, level);

      let values = new Array<number>(board.lanes).fill(board.startCount);
      for (let row = 0; row < board.rows; row++) {
        const reach = row === 0 ? board.lanes : board.reach;
        const next = new Array<number>(board.lanes).fill(DEAD);
        for (let lane = 0; lane < board.lanes; lane++) {
          let incoming = DEAD;
          for (let from = Math.max(0, lane - reach); from <= Math.min(board.lanes - 1, lane + reach); from++) {
            incoming = Math.max(incoming, values[from] as number);
          }
          next[lane] = applyNode(nodeAt(board, row, lane), incoming);
        }
        expect(
          next.some((value) => value > DEAD),
          `level ${level} row ${row} wipes out every lane`,
        ).toBe(true);
        values = next;
      }
    }
  });

  it('are a pure function of seed and level', () => {
    for (const level of [1, 17, 64, 210]) {
      const a = generateLevel(SEED, level);
      const b = generateLevel(SEED, level);
      expect(JSON.stringify(a.board)).toBe(JSON.stringify(b.board));

      const other = generateLevel('a-different-profile', level);
      expect(JSON.stringify(other.board)).not.toBe(JSON.stringify(a.board));
    }
  });

  it('fit a portrait phone at every level', () => {
    for (const level of SWEEP) {
      const { board } = generateLevel(SEED, level);
      // Six lanes by eleven rows is the ceiling, up from five by nine. At a
      // 390px width that is still a 58px lane, and `fitBoard` solves for the
      // largest cell that fits rather than assuming one.
      expect(board.lanes, `level ${level} lanes`).toBeLessThanOrEqual(6);
      expect(board.rows, `level ${level} rows`).toBeLessThanOrEqual(11);
      expect(board.lanes).toBeGreaterThanOrEqual(4);
      expect(board.rows).toBeGreaterThanOrEqual(6);
    }
  });

  /**
   * One lane of sideways movement per row, on every board including level 1.
   *
   * Reach 2 across a narrow board meant every lane was always available, so
   * there was no route to plan and the opening levels were pure arithmetic.
   */
  it('never let the squad cross more than one lane per row', () => {
    for (const level of SWEEP) {
      expect(generateLevel(SEED, level).board.reach, `level ${level}`).toBe(1);
    }
  });

  /**
   * The army has to feel like an army. Punishing rows are priced as a fraction
   * of the count reaching them, so they compound downwards; an earlier build
   * spent so many rows on them that deep levels finished on eight soldiers
   * against a horde of seven.
   */
  it('grow the squad into something worth commanding', () => {
    for (const level of SWEEP) {
      const generated = generateLevel(SEED, level);
      expect(generated.best, `level ${level} finishes too small`).toBeGreaterThanOrEqual(40);
      expect(generated.best, `level ${level} outgrew the display`).toBeLessThan(10_000_000);
      expect(generated.board.startCount).toBeLessThanOrEqual(24);
    }
  });

  it('get harder as the level number rises', () => {
    const decade = (from: number, to: number): number => {
      let total = 0;
      for (let level = from; level <= to; level++) total += generateLevel(SEED, level).difficulty;
      return total / (to - from + 1);
    };

    const early = decade(1, 12);      // ~0.05, a warm-up
    const middle = decade(40, 52);    // ~0.32
    const late = decade(150, 162);    // ~0.62
    const far = decade(600, 612);     // ~0.62 — the plateau, not a wall

    expect(early).toBeLessThan(middle);
    expect(middle).toBeLessThan(late);

    // Saturating rather than linear. The ramp is spent by roughly level 150 and
    // everything after it sits on a plateau: still hard, never harder without
    // limit. A monotonic climb is what eventually stops someone playing, and it
    // is the reason `shared/difficulty.ts` exists.
    expect(Math.abs(far - late), 'the curve should plateau, not keep climbing').toBeLessThan(0.12);
  });

  it('generates fast enough to stay ahead of the player', () => {
    const started = Date.now();
    for (let level = 1; level <= 120; level++) generateLevel(SEED, level);
    const elapsed = Date.now() - started;
    // Generation runs on a worker one level ahead, so this is a wide bound on
    // purpose — it is here to catch an accidental blow-up, not to police ms.
    expect(elapsed, `120 levels took ${elapsed}ms`).toBeLessThan(8000);
  });
});

describe('difficulty measurement', () => {
  it('measures both ways the game can actually end', () => {
    // A board nothing survives must read as maximum trap rate, and a board
    // everything survives comfortably as minimum. Getting this backwards is how
    // Screw Land ended up calibrated against a rule it did not enforce.
    const lethal: Board = {
      lanes: 3,
      rows: 2,
      nodes: [
        { kind: 'gate', op: 'sub', value: 99 }, { kind: 'gate', op: 'sub', value: 99 }, { kind: 'gate', op: 'sub', value: 99 },
        { kind: 'gate', op: 'add', value: 1 }, { kind: 'gate', op: 'add', value: 1 }, { kind: 'gate', op: 'add', value: 1 },
      ],
      startCount: 10,
      reach: 1,
      horde: 1,
    };
    expect(trapRate(lethal, createRng(1), 20)).toBe(1);

    const walkover: Board = {
      lanes: 3,
      rows: 2,
      nodes: Array.from({ length: 6 }, () => ({ kind: 'gate' as const, op: 'mul' as const, value: 2 })),
      startCount: 10,
      reach: 1,
      horde: 5,
    };
    expect(trapRate(walkover, createRng(1), 20)).toBe(0);
  });

  /**
   * Isolates the horde percentile from everything else on the board.
   *
   * The fixed shape is deliberately mild — few hostile cells, no barriers. On a
   * board carrying the rest of the curve's pressure the naive trap rate is
   * already 0.85, and a saturated signal cannot show that a lever moves it.
   * That saturation is fine in the game (`scoreDifficulty` blends in structure
   * for exactly this reason) but it makes a lever test measure nothing.
   */
  it('rises as the share of winning routes falls', () => {
    const measure = (winTarget: number): number => {
      const pressure = pressureForLevel(60, createRng(hashSeed('band', winTarget)));
      let total = 0;
      let count = 0;
      for (let attempt = 0; attempt < 60; attempt++) {
        const rng = createRng(hashSeed('band', winTarget, attempt));
        const shape = {
          ...shapeFor(pressure, rng),
          winTarget,
          lanes: 4,
          rows: 6,
          reach: 1,
          barrierRows: 0,
          hostileRows: 0,
          hostileShare: 0.08,
        };
        const built = buildBoard(shape, rng);
        if (!built) continue;
        total += trapRate(built.board, createRng(hashSeed('band', 'roll', winTarget, attempt)), 40);
        count++;
      }
      return total / Math.max(1, count);
    };

    // Sampled across the range `shapeFor` actually produces, which is now
    // 0.30 down to 0.03 — a level-1 board lets about a quarter of routes
    // through, where it used to be more than half.
    const generous = measure(0.3);
    const middling = measure(0.15);
    const mean = measure(0.04);

    expect(generous).toBeLessThan(middling);
    expect(middling).toBeLessThan(mean);
    // Wide enough to calibrate a band against, which is the thing that went
    // wrong in both earlier games.
    expect(mean - generous).toBeGreaterThan(0.2);
  });
});

describe('mid-run recovery', () => {
  it('lets the hint finish a level from wherever the player left it', () => {
    for (const level of [7, 33, 88, 190]) {
      const { board } = generateLevel(SEED, level);
      const route: number[] = [];

      // Walk a few rows off the optimal line, then ask for the rest.
      for (let step = 0; step < Math.min(3, board.rows - 1); step++) {
        const options = bestContinuation(board, route);
        if (!options) break;
        const wanted = options.lanes[0] as number;
        const alternative = wanted > 0 ? wanted - 1 : wanted + 1;
        const lane = alternative < board.lanes ? alternative : wanted;
        if (evaluate(board, [...route, lane]).phase === 'lost') break;
        route.push(lane);
      }

      const rest = findSolution(board, route);
      if (rest) {
        expect(evaluate(board, [...route, ...rest]).phase, `level ${level}`).toBe('won');
      } else {
        // No solution from here is a legitimate answer, and it has to be an
        // honest one: nothing may reach the top above the horde.
        const best = bestContinuation(board, route);
        expect(best === null || best.final <= board.horde).toBe(true);
      }
    }
  });
});
