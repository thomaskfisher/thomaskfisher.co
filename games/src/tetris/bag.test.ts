import { describe, expect, it } from 'vitest';

import {
  type BagState,
  MAX_SUBSTITUTIONS,
  bagAt,
  biasDepth,
  deal,
  newBagState,
  upcoming,
} from './bag';
import { I, J, L, O, PIECE_COUNT, S, T, Z } from './model';

/** Deals `count` pieces of one run and returns them in order. */
function stream(seed: string, game: number, count: number, level: number): number[] {
  let state = newBagState();
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const { piece, state: next } = deal(seed, game, state, level);
    out.push(piece);
    state = next;
  }
  return out;
}

const share = (pieces: number[], of: number[]): number =>
  pieces.filter((p) => of.includes(p)).length / pieces.length;

describe('the bag', () => {
  it('deals the same stream for the same seed, every time', () => {
    const first = stream('alpha', 3, 200, 8);
    expect(stream('alpha', 3, 200, 8)).toEqual(first);
    expect(stream('beta', 3, 200, 8)).not.toEqual(first);
    expect(stream('alpha', 4, 200, 8)).not.toEqual(first);
  });

  it('always deals seven pieces, whatever the bias', () => {
    for (let level = 1; level <= 40; level++) {
      for (let index = 0; index < 30; index++) {
        const pieces = bagAt('seed', 1, index, level);
        expect(pieces, `L${level} bag ${index}`).toHaveLength(PIECE_COUNT);
        for (const piece of pieces) {
          expect(piece).toBeGreaterThanOrEqual(0);
          expect(piece).toBeLessThan(PIECE_COUNT);
        }
      }
    }
  });

  it('only ever swaps an O, J, L or T out, and an S or a Z in', () => {
    for (let index = 0; index < 400; index++) {
      const pieces = bagAt('seed', 1, index, 40);
      const missing = [...Array(PIECE_COUNT).keys()].filter((p) => !pieces.includes(p));
      for (const gone of missing) expect([O, J, L, T]).toContain(gone);

      // Whatever went missing was replaced by an extra S or Z, one for one.
      const extra = pieces.filter((p) => p === S || p === Z).length - 2;
      expect(extra).toBe(missing.length);
    }
  });
});

describe('the fairness floor', () => {
  /*
   * The guarantee the whole substitution scheme exists to keep, and the reason
   * the I is not in the donor pool. It is the only piece that clears four rows
   * and the only one that digs a four-deep well back out; a stream that
   * withholds it is not harder in an interesting way, it is arbitrary.
   */
  it('never touches the I, at any depth', () => {
    for (let level = 1; level <= 60; level++) {
      for (let index = 0; index < 20; index++) {
        const pieces = bagAt('seed', 1, index, level);
        expect(pieces.filter((p) => p === I), `L${level} bag ${index}`).toHaveLength(1);
      }
    }
  });

  it('keeps the standard seven-bag drought bound of twelve', () => {
    const pieces = stream('drought', 1, 4000, 60);
    let gap = 0;
    let worst = 0;
    for (const piece of pieces) {
      if (piece === I) {
        worst = Math.max(worst, gap);
        gap = 0;
      } else gap++;
    }
    expect(worst).toBeLessThanOrEqual(12);
  });

  it('leaves the opening levels alone entirely', () => {
    for (let level = 1; level <= 3; level++) expect(biasDepth(level)).toBe(0);
    for (let index = 0; index < 60; index++) {
      expect(new Set(bagAt('seed', 1, index, 3)).size).toBe(PIECE_COUNT);
    }
  });

  it('ramps smoothly and stops at the whole donor pool', () => {
    let previous = -1;
    for (let level = 1; level <= 60; level++) {
      const depth = biasDepth(level);
      expect(depth, `level ${level}`).toBeGreaterThanOrEqual(previous);
      expect(depth).toBeLessThanOrEqual(MAX_SUBSTITUTIONS);
      previous = depth;
    }
    expect(biasDepth(1000)).toBe(MAX_SUBSTITUTIONS);
  });

  /*
   * The two levers have to hand over to each other rather than fire together.
   * Gravity floors at level 11; if the bag saturated there too, the game would
   * simply stop getting harder — which is exactly what the first design did,
   * and what the probe caught. See the *Tetris* section of the README.
   */
  it('is still climbing after the speed ramp has stopped', () => {
    expect(biasDepth(11)).toBeLessThan(biasDepth(16));
    expect(biasDepth(16)).toBeLessThan(biasDepth(21));
  });
});

describe('the lever', () => {
  /*
   * The point of the whole file. If these numbers are the same, the bag is
   * decoration and the difficulty is entirely the speed ramp — which is not
   * what was asked for. The measured effect on *survival* is the probe's job
   * (`tools/tetris.ts`); this asserts the mechanism fires, and fires by as much
   * as the curve claims.
   */
  it('deals far more S and Z at depth than at the start', () => {
    const early = stream('lever', 1, 7000, 1);
    const mid = stream('lever', 1, 7000, 12);
    const late = stream('lever', 1, 7000, 30);

    // A clean bag is two of seven, exactly.
    expect(share(early, [S, Z])).toBeCloseTo(2 / 7, 2);
    // Two swaps at level 12 is four of seven; four swaps at the cap is six.
    expect(share(mid, [S, Z])).toBeGreaterThan(share(early, [S, Z]) + 0.15);
    expect(share(late, [S, Z])).toBeGreaterThan(share(mid, [S, Z]) + 0.15);
    expect(share(late, [S, Z])).toBeCloseTo(6 / 7, 1);
  });

  it('still deals a bar every bag, however mean it gets', () => {
    const late = stream('lever', 2, 7000, 40);
    expect(share(late, [I])).toBeCloseTo(1 / 7, 2);
    // And nothing else survives the cap.
    expect(share(late, [O, J, L, T])).toBe(0);
  });
});

describe('an open bag', () => {
  /*
   * The bug this guards against is invisible and nasty: a bag is regenerated
   * from its index every time it is looked at, so if its bias were read from
   * the live level, the line that takes a player from level 9 to level 10 would
   * re-deal the pieces still sitting in the open bag. The preview would change
   * in front of them and the piece that arrived would not be the one shown.
   */
  it('keeps its pieces when the level turns over mid-bag', () => {
    let state: BagState = newBagState();
    for (let i = 0; i < 3; i++) state = deal('mid', 1, state, 9).state;

    const shownAt9 = upcoming('mid', 1, state, 9, 4);
    expect(upcoming('mid', 1, state, 10, 4)).toEqual(shownAt9);

    // And the piece that actually arrives is the one that was shown.
    expect(deal('mid', 1, state, 10).piece).toBe(shownAt9[0]);
  });

  it('shows exactly the pieces that are about to be dealt', () => {
    let state = newBagState();
    for (let step = 0; step < 40; step++) {
      const shown = upcoming('preview', 5, state, 12, 3);
      const actual: number[] = [];
      let probe = state;
      for (let i = 0; i < 3; i++) {
        const { piece, state: next } = deal('preview', 5, probe, 12);
        actual.push(piece);
        probe = next;
      }
      expect(shown, `step ${step}`).toEqual(actual);
      state = deal('preview', 5, state, 12).state;
    }
  });

  it('takes its bias from the level it was opened at, and holds it', () => {
    let state = newBagState();
    state = deal('open', 7, state, 4).state;
    expect(state.bagLevel).toBe(4);

    // Six more pieces at a wildly different level must not move it.
    for (let i = 0; i < 6; i++) state = deal('open', 7, state, 40).state;
    expect(state.dealt).toBe(PIECE_COUNT);

    // The next deal opens a fresh bag, which does take the level as it stands.
    expect(deal('open', 7, state, 40).state.bagLevel).toBe(40);
  });
});
