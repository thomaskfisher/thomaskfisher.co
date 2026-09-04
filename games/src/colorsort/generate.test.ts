import { describe, expect, it } from 'vitest';
import { generateLevel } from './generate';
import { applyMove, cloneBoard, isSolved, isWellFormed } from './model';
import { search } from './solve';

const SEED = 'a1b2c3d4e5f60718';

/** Levels 1..N, plus a thinner sweep of the deep end. */
function levelSweep(dense: number, sparseTo: number, step: number): number[] {
  const levels = Array.from({ length: dense }, (_, i) => i + 1);
  for (let level = dense + step; level <= sparseTo; level += step) levels.push(level);
  return levels;
}

describe('generated levels are always playable', () => {
  const levels = levelSweep(150, 1000, 25);

  it(`produces a well-formed, unsolved, solvable board for ${levels.length} levels`, () => {
    for (const level of levels) {
      const generated = generateLevel(SEED, level);
      const { board } = generated;

      expect(isWellFormed(board), `level ${level} is malformed`).toBe(true);
      expect(isSolved(board), `level ${level} starts already solved`).toBe(false);

      const result = search(board, { nodeBudget: 150_000 });
      expect(result.status, `level ${level} is not solvable`).toBe('solved');

      // The recorded solution must actually win.
      const replayed = cloneBoard(board);
      for (const move of result.moves) {
        expect(applyMove(replayed, move), `illegal move on level ${level}`).toBeGreaterThan(0);
      }
      expect(isSolved(replayed), `solution for level ${level} does not win`).toBe(true);
    }
  }, 120_000);
});

describe('determinism', () => {
  it('returns an identical board for the same seed and level', () => {
    for (const level of [1, 17, 64, 210]) {
      const a = generateLevel(SEED, level);
      const b = generateLevel(SEED, level);
      expect(a.board.tubes).toEqual(b.board.tubes);
      expect(a.difficulty).toBe(b.difficulty);
    }
  });

  it('returns different boards for different profile seeds', () => {
    const a = generateLevel(SEED, 40);
    const b = generateLevel('ffffffffffffffff', 40);
    expect(a.board.tubes).not.toEqual(b.board.tubes);
  });
});

describe('difficulty curve', () => {
  /**
   * The opposite of the test this replaces, which asserted level 1 was a
   * three-colour four-band board with two spares — a warm-up. It is not one any
   * more, on purpose: the curve reaches full intensity by level 50 and has to
   * start a quarter of the way up to get there.
   */
  it('opens hard rather than gentle', () => {
    for (let level = 1; level <= 5; level++) {
      const { shape, difficulty } = generateLevel(SEED, level);
      expect(shape.colors, `level ${level} deals too few colours`).toBeGreaterThanOrEqual(5);
      expect(shape.height, `level ${level} is too shallow`).toBeGreaterThanOrEqual(4);
      expect(difficulty, `level ${level} is a walkover`).toBeGreaterThan(0.15);
    }
  }, 60_000);

  it('rises monotonically across windows, despite per-level jitter', () => {
    const windowMean = (from: number, to: number): number => {
      let sum = 0;
      for (let level = from; level <= to; level++) sum += generateLevel(SEED, level).difficulty;
      return sum / (to - from + 1);
    };

    // Windows sit inside the ramp, which is now levels 1-50 rather than 1-500.
    //
    // Three windows, not four: Color Sort's format tops out near 0.88 measured
    // and gets there by roughly level 30, so 26-38 and 39-50 are both sitting
    // on the ceiling and splitting them asserts a difference that does not and
    // should not exist. The plateau is its own test below.
    const windows = [windowMean(1, 12), windowMean(13, 25), windowMean(26, 50)];

    for (let i = 1; i < windows.length; i++) {
      expect(windows[i]!, `window ${i} did not exceed window ${i - 1}`).toBeGreaterThan(
        windows[i - 1]!,
      );
    }

    // Guards the calibration from both ends. The opening is meant to be a
    // quarter of the way up rather than at the floor — the previous curve put
    // this window at 0.10 and that is the bug this whole ramp exists to fix —
    // and a top window collapsing means the target band went unreachable again.
    expect(windows[0]!, 'the opening window is a walkover').toBeGreaterThan(0.2);
    expect(windows[2]!, 'the curve does not reach its ceiling').toBeGreaterThan(0.75);
  }, 300_000);

  /**
   * Past level 50 the curve stops climbing on purpose: levels keep coming
   * forever and are all pitched at the ceiling, so what varies is the board
   * rather than the pressure. This is the "50 good levels, not 500 mild ones"
   * decision, asserted.
   */
  it('plateaus past the peak instead of creeping on', () => {
    const windowMean = (from: number, to: number): number => {
      let sum = 0;
      for (let level = from; level <= to; level++) sum += generateLevel(SEED, level).difficulty;
      return sum / (to - from + 1);
    };

    expect(Math.abs(windowMean(50, 62) - windowMean(200, 212))).toBeLessThan(0.1);
  }, 300_000);

  it('finds levels within the target band without exhausting its attempts', () => {
    let attempts = 0;
    const levels = 60;
    for (let level = 150; level < 150 + levels; level++) {
      attempts += generateLevel(SEED, level).attempts;
    }
    // Falling back to "closest" every time would push this to the 60 cap.
    //
    // The bar is looser than it was (15) because the band is now deliberately
    // asking for more than this format comfortably delivers at the plateau:
    // Color Sort tops out near 0.88 measured and the band centres on 0.92, so a
    // fair share of attempts miss high and the best of them is taken. That
    // costs attempts and buys the hardest board available, which is the trade
    // we want — and at ~140ms for the worst level it is well inside the budget
    // the background worker has. See tools/timing.ts.
    expect(attempts / levels).toBeLessThan(35);
  }, 300_000);

  it('uses single-spare boards as a difficulty lever at high levels', () => {
    let tight = 0;
    for (let level = 30; level <= 90; level++) {
      if (generateLevel(SEED, level).shape.emptyTubes === 1) tight++;
    }
    // These are the hardest boards in the game, and they are now a large
    // minority at the top of the curve rather than a rarity past level 150.
    expect(tight).toBeGreaterThan(12);
  }, 300_000);

  it('never exceeds what fits on a phone screen', () => {
    for (const level of [200, 400, 700, 1000]) {
      const { shape } = generateLevel(SEED, level);
      expect(shape.colors).toBeLessThanOrEqual(12);
      expect(shape.colors + shape.emptyTubes).toBeLessThanOrEqual(14);
      expect(shape.height).toBeLessThanOrEqual(6);
    }
  }, 60_000);

  it('includes breather levels so hard boards do not stack up', () => {
    // Levels 9k+4 are deliberately eased. See shared/difficulty.ts.
    const breathers = [13, 22, 31, 40].map((n) => generateLevel(SEED, n).difficulty);
    const neighbours = [16, 25, 34, 43].map((n) => generateLevel(SEED, n).difficulty);
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(breathers)).toBeLessThan(mean(neighbours));
  }, 60_000);
});
