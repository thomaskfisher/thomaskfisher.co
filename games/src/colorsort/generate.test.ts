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

  it('responds to the hidden difficulty offset', () => {
    const normal = generateLevel(SEED, 80, 0);
    const eased = generateLevel(SEED, 80, -30);
    expect(eased.shape.colors).toBeLessThanOrEqual(normal.shape.colors);
  });
});

describe('difficulty curve', () => {
  it('starts gentle', () => {
    for (let level = 1; level <= 5; level++) {
      const { shape } = generateLevel(SEED, level);
      expect(shape.colors).toBeLessThanOrEqual(5);
      expect(shape.emptyTubes).toBe(2);
      expect(shape.height).toBe(4);
    }
  });

  it('rises monotonically across windows, despite per-level jitter', () => {
    const windowMean = (from: number, to: number): number => {
      let sum = 0;
      for (let level = from; level <= to; level++) sum += generateLevel(SEED, level).difficulty;
      return sum / (to - from + 1);
    };

    const windows = [
      windowMean(1, 15),
      windowMean(35, 50),
      windowMean(80, 95),
      windowMean(160, 175),
    ];

    for (let i = 1; i < windows.length; i++) {
      expect(windows[i]!, `window ${i} did not exceed window ${i - 1}`).toBeGreaterThan(
        windows[i - 1]!,
      );
    }

    // Guards the calibration: the format tops out near 0.9, so a late window
    // collapsing toward the floor means the target band went unreachable again.
    expect(windows[0]!).toBeLessThan(0.25);
    expect(windows[3]!).toBeGreaterThan(0.45);
  }, 120_000);

  it('finds levels within the target band without exhausting its attempts', () => {
    let attempts = 0;
    const levels = 60;
    for (let level = 150; level < 150 + levels; level++) {
      attempts += generateLevel(SEED, level).attempts;
    }
    // Falling back to "closest" every time would push this to the 60 cap.
    expect(attempts / levels).toBeLessThan(15);
  }, 120_000);

  it('uses single-spare boards as a difficulty lever at high levels', () => {
    let tight = 0;
    for (let level = 150; level <= 350; level++) {
      if (generateLevel(SEED, level).shape.emptyTubes === 1) tight++;
    }
    // Rare but present: these are the hardest boards in the game.
    expect(tight).toBeGreaterThan(4);
  }, 120_000);

  it('never exceeds what fits on a phone screen', () => {
    for (const level of [200, 400, 700, 1000]) {
      const { shape } = generateLevel(SEED, level);
      expect(shape.colors).toBeLessThanOrEqual(12);
      expect(shape.colors + shape.emptyTubes).toBeLessThanOrEqual(14);
      expect(shape.height).toBeLessThanOrEqual(5);
    }
  }, 60_000);

  it('includes breather levels so hard boards do not stack up', () => {
    // Levels 7k+3 and 11k are deliberately eased.
    const breathers = [3, 10, 11, 17].map((n) => generateLevel(SEED, n).difficulty);
    const neighbours = [5, 13, 26, 38].map((n) => generateLevel(SEED, n).difficulty);
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(breathers)).toBeLessThan(mean(neighbours));
  }, 60_000);
});
