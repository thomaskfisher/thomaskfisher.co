import { describe, expect, it } from 'vitest';

import {
  type Board,
  FULL_MASK,
  MAX_MISTAKES,
  bitCount,
  indicesOf,
  initialProgress,
  judge,
  maskOf,
  play,
  replay,
} from './model';

/** Words 0-3 are group 0, 4-7 group 1, and so on. */
const board: Board = {
  words: Array.from({ length: 16 }, (_v, i) => `W${i}`),
  groups: [0, 1, 2, 3].map((g) => ({
    name: `G${g}`,
    color: g,
    tier: g + 1,
    mask: maskOf([g * 4, g * 4 + 1, g * 4 + 2, g * 4 + 3]),
  })),
};

const group = (g: number) => maskOf([g * 4, g * 4 + 1, g * 4 + 2, g * 4 + 3]);

describe('masks', () => {
  it('round-trips indices', () => {
    expect(indicesOf(maskOf([1, 5, 9, 15]))).toEqual([1, 5, 9, 15]);
    expect(bitCount(maskOf([0, 3, 7]))).toBe(3);
    expect(bitCount(FULL_MASK)).toBe(16);
  });
});

describe('judging a guess', () => {
  it('finds a group', () => {
    expect(judge(board, initialProgress(), group(2))).toEqual({ kind: 'correct', group: 2 });
  });

  it('says one away when three of four are right', () => {
    expect(judge(board, initialProgress(), maskOf([0, 1, 2, 4]))).toEqual({ kind: 'one-away' });
  });

  it('says wrong otherwise', () => {
    expect(judge(board, initialProgress(), maskOf([0, 1, 4, 5]))).toEqual({ kind: 'wrong' });
  });

  it('refuses anything but four words', () => {
    expect(judge(board, initialProgress(), maskOf([0, 1, 2])).kind).toBe('invalid');
    expect(judge(board, initialProgress(), maskOf([0, 1, 2, 3, 4])).kind).toBe('invalid');
  });

  it('refuses a repeat, and words already solved, without charging', () => {
    const wrong = maskOf([0, 1, 4, 5]);
    const after = play(board, initialProgress(), wrong)!;
    expect(judge(board, after, wrong).kind).toBe('repeat');
    expect(play(board, after, wrong)).toBeNull();

    const solved = play(board, initialProgress(), group(0))!;
    expect(judge(board, solved, maskOf([0, 4, 5, 6])).kind).toBe('repeat');
  });
});

describe('playing', () => {
  it('wins on the fourth group', () => {
    let progress = initialProgress();
    for (const g of [3, 1, 0, 2]) progress = play(board, progress, group(g))!;
    expect(progress.won).toBe(true);
    expect(progress.solved).toEqual([3, 1, 0, 2]);
    expect(progress.remaining).toBe(0);
  });

  it('loses on the fourth mistake', () => {
    let progress = initialProgress();
    const wrongs = [maskOf([0, 1, 4, 5]), maskOf([0, 1, 4, 6]), maskOf([0, 1, 4, 7]), maskOf([0, 2, 4, 5])];
    for (const [i, wrong] of wrongs.entries()) {
      progress = play(board, progress, wrong)!;
      expect(progress.lost).toBe(i + 1 === MAX_MISTAKES);
    }
    expect(judge(board, progress, group(0)).kind).toBe('invalid');
  });

  it('replays a move list, dropping a corrupt tail', () => {
    const moves = [group(0), maskOf([4, 5, 8, 9]), group(1), maskOf([4, 5, 6, 7])];
    const { progress, moves: kept } = replay(board, moves);
    // The last move re-guesses solved words, so it is refused and dropped.
    expect(kept).toEqual(moves.slice(0, 3));
    expect(progress.solved).toEqual([0, 1]);
    expect(progress.mistakes).toBe(1);
  });
});
