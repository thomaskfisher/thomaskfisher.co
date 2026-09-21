import { describe, expect, it } from 'vitest';

import { ROWS, SPAWN_H, WELL_W, emptyWell } from './model';
import { type Action, type Run, apply, playAll, startRun } from './run';
import { decodeRun, encodeRun } from './snapshot';

const SEED = 'snap';
const GAME = 6;

/** A run with some history on it, so the round trip has something to lose. */
function played(): Run {
  const moves: Action[] = [
    'left', 'cw', 'hard', 'right', 'right', 'hard', 'hold', 'ccw', 'hard',
    'soft', 'soft', 'left', 'hard', 'hard', 'cw', 'hard',
  ];
  return playAll(startRun(SEED, GAME), moves);
}

const same = (a: Run, b: Run): void => {
  expect([...b.well]).toEqual([...a.well]);
  expect(b.piece).toEqual(a.piece);
  expect(b.bag).toEqual(a.bag);
  expect(b.hold).toBe(a.hold);
  expect(b.holdUsed).toBe(a.holdUsed);
  expect(b.lines).toBe(a.lines);
  expect(b.score).toBe(a.score);
  expect(b.placed).toBe(a.placed);
};

describe('a saved run', () => {
  it('comes back exactly as it went in', () => {
    const run = played();
    const restored = decodeRun(encodeRun(run), SEED, GAME);
    expect(restored).not.toBeNull();
    same(run, restored!);
  });

  it('carries on identically from where it was reopened', () => {
    const run = played();
    const rest: Action[] = ['cw', 'left', 'hard', 'hold', 'hard', 'right', 'hard'];

    const straight = playAll(run, rest);
    const reopened = playAll(decodeRun(encodeRun(run), SEED, GAME)!, rest);
    same(straight, reopened);
  });

  it('survives a second round trip unchanged, byte for byte', () => {
    const once = encodeRun(played());
    const twice = encodeRun(decodeRun(once, SEED, GAME)!);
    expect(twice).toBe(once);
  });

  it('stays short enough to paste', () => {
    // The save code in Settings is the whole backup story for a game with no
    // server, so a run has to fit in something somebody can copy.
    expect(encodeRun(played()).length).toBeLessThan(320);
  });

  it('keeps a full well, which is the biggest one there is', () => {
    // Every visible cell filled — an artificial maximum, since the game would
    // have cleared these rows — with the spawn buffer left clear so the piece
    // still fits and this measures the encoder rather than the fit check.
    const well = emptyWell();
    for (let y = SPAWN_H; y < ROWS; y++) {
      for (let x = 0; x < WELL_W; x++) well[y * WELL_W + x] = (x + y) % 7;
    }
    const run: Run = { ...startRun(SEED, GAME), well, lines: 91, score: 48_200, placed: 410 };
    const restored = decodeRun(encodeRun(run), SEED, GAME)!;
    same(run, restored);
  });
});

describe('a save code that cannot be trusted', () => {
  /*
   * A code is a string a player can paste, so this is a trust boundary. Every
   * one of these has to come back null rather than throw or, worse, produce a
   * board the rules cannot describe. The cost of being strict is a fresh game.
   */
  const empty = '.'.repeat(ROWS * WELL_W);
  const rubbish = [
    ['nothing at all', ''],
    ['not a save code', 'nonsense'],
    ['a version this build does not know', `2|${GAME}|${empty}|0,0,3,0||0|0,1|0|0|0`],
    ['a well of the wrong length', `1|${GAME}|short|0,0,3,0||0|0,1|0|0|0`],
    ['a well full of characters that are not cells', `1|${GAME}|${'X'.repeat(ROWS * WELL_W)}|0,0,3,0||0|0,1|0|0|0`],
    ['a piece type that does not exist', `1|${GAME}|${empty}|9,0,3,0||0|0,1|0|0|0`],
    ['a fifth rotation', `1|${GAME}|${empty}|0,7,3,0||0|0,1|0|0|0`],
    ['a piece off the side of the well', `1|${GAME}|${empty}|0,0,99,0||0|0,1|0|0|0`],
    ['a hold slot holding nothing that is a piece', `1|${GAME}|${empty}|0,0,3,0|12|0|0,1|0|0|0`],
    ['no falling piece', `1|${GAME}|${empty}||0|0|0,1|0|0|0`],
    ['a field short', `1|${GAME}|${empty}|0,0,3,0||0|0,1|0|0`],
    ['a bag count that is not a number', `1|${GAME}|${empty}|0,0,3,0||0|nope,1|0|0|0`],
    ['a bag missing its level', `1|${GAME}|${empty}|0,0,3,0||0|0|0|0|0`],
    ['a negative score', `1|${GAME}|${empty}|0,0,3,0||0|0,1|0|-5|0`],
  ] as const;

  for (const [what, code] of rubbish) {
    it(`refuses ${what}`, () => {
      expect(decodeRun(code, SEED, GAME)).toBeNull();
    });
  }

  it('accepts the same shape once nothing is wrong with it', () => {
    // The control for the list above: without this, a decoder that refused
    // everything would pass every one of those and prove nothing.
    const fine = `1|${GAME}|${empty}|0,0,3,0||0|0,1|0|0|0`;
    expect(decodeRun(fine, SEED, GAME)).not.toBeNull();
  });

  it('refuses a run belonging to a different game number', () => {
    const code = encodeRun(played());
    expect(decodeRun(code, SEED, GAME)).not.toBeNull();
    expect(decodeRun(code, SEED, GAME + 1)).toBeNull();
  });

  it('takes the seed from the caller, never from the code', () => {
    // The seed is the profile's, and the profile is whoever is holding the
    // phone. A pasted code must not be able to change it.
    const restored = decodeRun(encodeRun(played()), 'a-different-profile', GAME)!;
    expect(restored.seed).toBe('a-different-profile');
  });
});

describe('a run that has ended', () => {
  it('is never written as one that is still going', () => {
    let run = startRun(SEED, GAME);
    while (!run.over) run = apply(run, 'hard').run;
    // The controller clears `inProgress` on a loss rather than encoding this,
    // but if one ever reached the decoder it must not come back playable.
    const restored = decodeRun(encodeRun(run), SEED, GAME);
    expect(restored).toBeNull();
  });
});
