import { describe, expect, it } from 'vitest';

import { flashMs, gapMs, newRun, press, resume, scoreOf, sequenceFor, type Run } from './model';

describe('sequenceFor', () => {
  it('is deterministic', () => {
    expect(sequenceFor('abc', 3, 30)).toEqual(sequenceFor('abc', 3, 30));
  });

  it('grows by extending, never by reshuffling', () => {
    const long = sequenceFor('abc', 7, 40);
    for (let length = 1; length < 40; length++) {
      expect(sequenceFor('abc', 7, length)).toEqual(long.slice(0, length));
    }
  });

  it('differs between games and between profiles', () => {
    expect(sequenceFor('abc', 1, 20)).not.toEqual(sequenceFor('abc', 2, 20));
    expect(sequenceFor('abc', 1, 20)).not.toEqual(sequenceFor('xyz', 1, 20));
  });

  it('uses every pad, and only real pads', () => {
    for (const pads of [4, 6, 8]) {
      const sequence = sequenceFor('abc', 1, 400, pads);
      expect(new Set(sequence).size).toBe(pads);
      expect(sequence.every((pad) => Number.isInteger(pad) && pad >= 0 && pad < pads)).toBe(true);
    }
  });
});

/** Plays `rounds` rounds perfectly and returns where that leaves the run. */
function playPerfectly(sequence: readonly number[], rounds: number): Run {
  let run = newRun();
  for (let r = 1; r <= rounds; r++) {
    for (let i = 0; i < r; i++) {
      const next = press(run, sequence, sequence[i]!);
      expect(next.result).toBe(i === r - 1 ? 'round' : 'ok');
      run = next.run;
    }
  }
  return run;
}

describe('press', () => {
  const sequence = sequenceFor('abc', 1, 50);

  it('adds one to the sequence each round', () => {
    const run = playPerfectly(sequence, 12);
    expect(run).toEqual({ round: 13, entered: 0, over: false });
    expect(scoreOf(run)).toBe(12);
  });

  it('ends the game on a wrong pad, keeping the rounds already finished', () => {
    let run = playPerfectly(sequence, 4);
    run = press(run, sequence, sequence[0]!).run;
    const wrong = (sequence[1]! + 1) % 4;
    const result = press(run, sequence, wrong);
    expect(result.result).toBe('wrong');
    expect(result.run.over).toBe(true);
    expect(scoreOf(result.run)).toBe(4);
  });

  it('scores nothing for a first-round miss', () => {
    const result = press(newRun(), sequence, (sequence[0]! + 1) % 4);
    expect(result.result).toBe('wrong');
    expect(scoreOf(result.run)).toBe(0);
  });

  it('ignores taps once the game is over', () => {
    const over: Run = { round: 3, entered: 1, over: true };
    expect(press(over, sequence, sequence[1]!)).toEqual({ run: over, result: null });
  });
});

describe('resume', () => {
  const sequence = sequenceFor('abc', 1, 50);

  it('picks up at the round after the last one finished', () => {
    expect(resume(sequence, sequence.slice(0, 9))).toEqual({ round: 10, entered: 0, over: false });
    expect(resume(sequence, [])).toEqual(newRun());
  });

  it('keeps only the prefix that still matches the game', () => {
    const saved = sequence.slice(0, 9);
    saved[5] = (saved[5]! + 1) % 4;
    expect(resume(sequence, saved).round).toBe(6);
  });
});

describe('timing', () => {
  it('speeds up and never stops being visible', () => {
    let last = Infinity;
    for (let round = 1; round <= 60; round++) {
      expect(flashMs(round)).toBeLessThanOrEqual(last);
      expect(flashMs(round)).toBeGreaterThanOrEqual(250);
      expect(gapMs(round)).toBeGreaterThan(50);
      last = flashMs(round);
    }
  });
});
