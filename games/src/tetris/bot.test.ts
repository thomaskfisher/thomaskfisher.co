import { describe, expect, it } from 'vitest';

import { rollout, runAtLevel } from './bot';
import { EMPTY, ROWS, SPAWN_H, WELL_W, canPlace } from './model';
import { type Run, apply, levelIn, startRun } from './run';

/**
 * The nearest thing this game has to the other games' generator sweep.
 *
 * There is no generator to sweep — a run is built by the player, not dealt —
 * so what stands in for "every level is well-formed, not already solved, and
 * solvable" is this: every run a naive player can have stays well-formed at
 * every step, ends, and ends because the well filled up rather than because
 * something threw. The *range* of the difficulty lever is measured in
 * `tools/tetris.ts`; these are the invariants that have to hold whatever that
 * measurement turns out to say.
 *
 * Kept deliberately small — the bot enumerates every placement for every piece,
 * and this has to stay inside `npm test`. The sweep that takes minutes lives in
 * the probe.
 */

const RUNS = 12;
const CAP = 160;

function checkWell(run: Run, where: string): void {
  expect(run.well, where).toHaveLength(ROWS * WELL_W);

  for (let i = 0; i < run.well.length; i++) {
    const cell = run.well[i]!;
    expect(cell === EMPTY || (cell >= 0 && cell < 7), `${where}: cell ${i} is ${cell}`).toBe(true);
  }

  // A full row is one the lock should have taken out. One left behind means
  // `collapse` and `lock` have drifted apart.
  for (let y = 0; y < ROWS; y++) {
    let full = true;
    for (let x = 0; x < WELL_W; x++) {
      if (run.well[y * WELL_W + x] === EMPTY) {
        full = false;
        break;
      }
    }
    expect(full, `${where}: row ${y} was left full`).toBe(false);
  }

  // A live piece is always somewhere it could legally be. The one exception is
  // a block out, which is precisely a piece that is not — and that run is over.
  if (run.piece && !run.over) {
    expect(run.piece.rot).toBeGreaterThanOrEqual(0);
    expect(run.piece.rot).toBeLessThan(4);
    expect(canPlace(run.well, run.piece), `${where}: piece is inside the stack`).toBe(true);
  }
}

describe('a naive run', () => {
  it('always ends, and ends by filling the well', () => {
    for (let game = 0; game < RUNS; game++) {
      const result = rollout(startRun(`inv-${game}`, game), { maxPieces: CAP });
      expect(result.placed, `game ${game}`).toBeGreaterThan(0);
      expect(result.placed).toBeLessThanOrEqual(CAP);
      expect(result.lines).toBeGreaterThanOrEqual(0);
      // Four rows is the most one piece can ever take out.
      expect(result.lines).toBeLessThanOrEqual(result.placed * 4);
    }
  });

  it('never leaves the well in a state the rules cannot describe', () => {
    for (let game = 0; game < 4; game++) {
      let run = startRun(`shape-${game}`, game);
      checkWell(run, `game ${game} start`);

      // Hard-dropped a piece at a time rather than run through `rollout`, so
      // the invariants are checked after every lock and not only at the end.
      for (let step = 0; step < 90 && !run.over; step++) {
        const before = run.placed;
        run = apply(run, 'hard').run;
        expect(run.placed, `game ${game} step ${step}`).toBe(before + 1);
        checkWell(run, `game ${game} step ${step}`);
      }
    }
  });

  it('is reproducible, piece for piece', () => {
    const a = rollout(startRun('repeat', 9), { maxPieces: CAP });
    const b = rollout(startRun('repeat', 9), { maxPieces: CAP });
    expect(b).toEqual(a);
  });

  it('plays the pinned levels the probe sweeps', () => {
    for (const level of [1, 12, 30]) {
      const run = runAtLevel('pinned', 1, level);
      expect(levelIn(run)).toBe(level);
      expect(rollout(run, { maxPieces: CAP }).placed, `level ${level}`).toBeGreaterThan(0);
    }
  });

  it('places more carefully than it places at random', () => {
    // The bot has to be a player rather than a coin, or every number the probe
    // reports is about the coin.
    const careful = rollout(startRun('care', 1), { sloppiness: 0, maxPieces: 400 });
    const random = rollout(startRun('care', 1), { sloppiness: 1, maxPieces: 400 });
    expect(careful.placed).toBeGreaterThan(random.placed);
  });

  /*
   * Not a calibration — that is the probe's job, and it takes minutes. This is
   * the claim the calibration depends on: a careless player survives markedly
   * fewer pieces on a meaner stream than on a clean one.
   *
   * The margin is a third rather than a whisker on purpose. The first design of
   * the bag passed a "just less than" version of this test while moving naive
   * survival by twelve percent, non-monotonically — which is to say it passed
   * on noise. `tools/tetris.ts` measures 135 pieces at level 1 against 70 at the
   * cap, so a third is comfortably inside the real effect and well outside the
   * run-to-run spread. If this ever fails, the lever has stopped firing; if it
   * only just passes, it has weakened, which is the more interesting failure.
   */
  it('lasts markedly longer on a clean stream than on a mean one', () => {
    const survival = (level: number): number => {
      let total = 0;
      for (let game = 0; game < 24; game++) {
        total += rollout(runAtLevel(`sign-${game}`, game, level), { maxPieces: 400 }).placed;
      }
      return total / 24;
    };

    const clean = survival(1);
    const mean = survival(26);
    expect(mean).toBeLessThan(clean * 0.67);
  });
});

describe('the spawn buffer', () => {
  it('is deep enough for every piece to arrive in', () => {
    // Two rows, because SRS spawns a piece lying flat in the row above the
    // playfield and a kick can push it one higher.
    expect(SPAWN_H).toBeGreaterThanOrEqual(2);
  });
});
