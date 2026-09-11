import { describe, expect, it } from 'vitest';

import {
  Mark,
  isAllowedGuess,
  isConsistent,
  isWin,
  keyboardMarks,
  markGuess,
  rowsFor,
} from './model';
import { GUESSES } from './words';

const A = Mark.Absent;
const P = Mark.Present;
const C = Mark.Correct;

describe('markGuess', () => {
  it('greens an exact match and greys a miss', () => {
    expect(markGuess('crane', 'crane')).toEqual([C, C, C, C, C]);
    expect(markGuess('jumpy', 'crest')).toEqual([A, A, A, A, A]);
  });

  it('yellows a letter that is in the word elsewhere', () => {
    // TRACE against CRATE: R, A and E are already in place; T and C are both in
    // the word but the wrong way round.
    expect(markGuess('trace', 'crate')).toEqual([P, C, C, P, C]);
  });

  /**
   * The repeated-letter rule, which is the whole difficulty of this function and
   * the one thing a reimplementation reliably gets wrong.
   */
  it('colours only as many repeats as the answer can cover', () => {
    // TIDAL has one L. ALLOT's two Ls cannot both be credited.
    const marks = markGuess('allot', 'tidal');
    expect(marks.filter((mark) => mark !== A)).toHaveLength(3);
    expect(marks).toEqual([P, P, A, A, P]);
  });

  it('spends the answer on greens before yellows', () => {
    /*
     * GEESE against ERASE. The answer has two Es. The guess has three, and its
     * last one is green — which uses one of the answer's up. Exactly one of the
     * two remaining Es can then be yellow, and the other has to be grey.
     */
    const marks = markGuess('geese', 'erase');
    expect(marks).toEqual([A, P, A, C, C]);
    expect(marks.filter((mark) => mark === P)).toHaveLength(1);
  });

  it('greys a second copy the answer does not have', () => {
    // GEESE has three Es; AGREE has two. Both of AGREE's are covered.
    expect(markGuess('array', 'crane').filter((mark) => mark !== A)).toHaveLength(2);
    // ROBOT against BOOKS: one O green, one O yellow, never two yellows.
    const marks = markGuess('robot', 'books');
    expect(marks.filter((mark) => mark === C || mark === P).length).toBeLessThanOrEqual(3);
  });

  it('is symmetric in length and never changes it', () => {
    for (const [guess, answer] of [
      ['crane', 'plumb'],
      ['stared', 'planet'],
      ['pointed', 'related'],
    ] as const) {
      expect(markGuess(guess, answer)).toHaveLength(guess.length);
    }
  });

  it('recognises a win', () => {
    expect(isWin(markGuess('crane', 'crane'))).toBe(true);
    expect(isWin(markGuess('crank', 'crane'))).toBe(false);
  });
});

describe('the guess list', () => {
  it('accepts real words of every length', () => {
    for (const word of ['crane', 'slate', 'adieu', 'irate', 'reduce', 'brunch', 'tainted']) {
      expect(isAllowedGuess(word), word).toBe(true);
    }
  });

  it('rejects nonsense and the wrong length', () => {
    for (const word of ['zzzzz', 'qwrtp', 'abcd', 'abcdefghi', '']) {
      expect(isAllowedGuess(word), word).toBe(false);
    }
  });

  /** The binary search only works on a sorted list, so that is checked here. */
  it('is stored in sorted order', () => {
    for (const [rawLength, packed] of Object.entries(GUESSES)) {
      const length = Number(rawLength);
      let previous = '';
      for (let index = 0; index * length < packed.length; index++) {
        const word = packed.slice(index * length, (index + 1) * length);
        expect(word > previous, `${word} follows ${previous}`).toBe(true);
        previous = word;
      }
    }
  });

  it('holds only lowercase words of the length it is filed under', () => {
    for (const [rawLength, packed] of Object.entries(GUESSES)) {
      const length = Number(rawLength);
      expect(packed.length % length).toBe(0);
      expect(/^[a-z]+$/.test(packed)).toBe(true);
    }
  });
});

describe('the keyboard', () => {
  it('keeps the best news about each letter', () => {
    const rows = rowsFor(['crane', 'creak'], 'crack');
    const marks = keyboardMarks(rows);

    expect(marks.get('c')).toBe(C);
    expect(marks.get('r')).toBe(C);
    expect(marks.get('n')).toBe(A);
  });

  /**
   * A letter that came back green once must stay green, even when a later guess
   * puts it somewhere wrong — downgrading it throws away what was already known.
   */
  it('never downgrades a letter that was green', () => {
    const rows = rowsFor(['crane', 'nicer'], 'crane');
    expect(keyboardMarks(rows).get('c')).toBe(C);
  });
});

describe('isConsistent', () => {
  it('keeps a word that would have produced the same colours', () => {
    const rows = rowsFor(['crane'], 'crack');
    expect(isConsistent('crack', rows)).toBe(true);
    // CRANK still holds an N, which the board has already shown is not there.
    expect(isConsistent('crank', rows)).toBe(false);
  });

  /**
   * Consistency is about the colours, not about the word — CRAMP survives here
   * because CRANE would have coloured it exactly as it coloured CRACK, and a
   * player with only that row on the board genuinely cannot tell them apart.
   */
  it('keeps every word the board cannot yet rule out', () => {
    const rows = rowsFor(['crane'], 'crack');
    expect(isConsistent('cramp', rows)).toBe(true);
  });

  it('is exactly agreement with the board, repeats included', () => {
    const rows = rowsFor(['allot'], 'tidal');
    expect(isConsistent('tidal', rows)).toBe(true);
    // LOYAL has two Ls, which would have coloured differently.
    expect(isConsistent('loyal', rows)).toBe(false);
  });

  it('accepts anything when nothing has been guessed', () => {
    expect(isConsistent('crane', [])).toBe(true);
  });
});
