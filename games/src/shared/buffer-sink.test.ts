import { describe, expect, it } from 'vitest';
import {
  type SinkConfig,
  accept,
  acceptedColors,
  createSinkState,
  isDrained,
  sinkStateKey,
} from './buffer-sink';

/** Screw Land's shape: four open boxes of three, five tray slots. */
const CONFIG: SinkConfig = { openSinks: 4, sinkCapacity: 3, bufferCapacity: 5 };

/** Bus Jam's shape: one bus of three, five bench slots. */
const BUS: SinkConfig = { openSinks: 1, sinkCapacity: 3, bufferCapacity: 5 };

describe('opening sinks', () => {
  it('opens as many sinks as the config allows, in queue order', () => {
    const state = createSinkState(CONFIG, [0, 1, 2, 3, 4, 5]);
    expect(state.sinks.map((s) => s?.color)).toEqual([0, 1, 2, 3]);
    expect(state.queue).toEqual([4, 5]);
  });

  it('leaves sinks closed when the queue is shorter than the slots', () => {
    const state = createSinkState(CONFIG, [7]);
    expect(state.sinks.map((s) => s?.color ?? null)).toEqual([7, null, null, null]);
  });
});

describe('accepting tokens', () => {
  it('fills a matching sink', () => {
    const start = createSinkState(CONFIG, [0, 1, 2, 3]);
    const { state, placed } = accept(start, CONFIG, 1);
    expect(placed).toBe('sink');
    expect(state.sinks[1]?.filled).toBe(1);
  });

  it('parks a token no open sink wants', () => {
    const start = createSinkState(CONFIG, [0, 1, 2, 3, 9]);
    const { state, placed } = accept(start, CONFIG, 9);
    expect(placed).toBe('buffer');
    expect(state.buffer).toEqual([9]);
  });

  it('completes a sink and opens the next from the queue', () => {
    let state = createSinkState(CONFIG, [0, 1, 2, 3, 8]);
    let completed = 0;
    for (let i = 0; i < 3; i++) {
      const result = accept(state, CONFIG, 0);
      state = result.state;
      completed += result.completed;
    }
    expect(completed).toBe(1);
    expect(state.sinks[0]?.color).toBe(8); // replaced by the queued colour
    expect(state.queue).toHaveLength(0);
  });

  it('never mutates the state it is given', () => {
    const start = createSinkState(CONFIG, [0, 1, 2, 3]);
    const snapshot = JSON.stringify(start);
    accept(start, CONFIG, 0);
    accept(start, CONFIG, 9);
    expect(JSON.stringify(start)).toBe(snapshot);
  });
});

describe('buffer overflow', () => {
  it('reports lost rather than exceeding capacity', () => {
    let state = createSinkState(CONFIG, [0, 1, 2, 3]);
    // Five unmatched tokens fill the tray exactly.
    for (let i = 0; i < 5; i++) {
      const result = accept(state, CONFIG, 9);
      expect(result.placed).toBe('buffer');
      state = result.state;
    }
    expect(state.buffer).toHaveLength(5);

    const overflow = accept(state, CONFIG, 9);
    expect(overflow.placed).toBe('lost');
    expect(overflow.state.buffer).toHaveLength(5); // unchanged
  });

  it('still accepts a token a sink wants when the tray is full', () => {
    let state = createSinkState(CONFIG, [0, 1, 2, 3]);
    for (let i = 0; i < 5; i++) state = accept(state, CONFIG, 9).state;
    expect(accept(state, CONFIG, 0).placed).toBe('sink');
  });
});

describe('flushing the buffer', () => {
  it('drains parked tokens into a newly opened sink', () => {
    // Park two 8s, then complete a sink so an 8 box opens.
    let state = createSinkState(CONFIG, [0, 1, 2, 3, 8]);
    state = accept(state, CONFIG, 8).state;
    state = accept(state, CONFIG, 8).state;
    expect(state.buffer).toEqual([8, 8]);

    for (let i = 0; i < 3; i++) state = accept(state, CONFIG, 0).state;

    expect(state.buffer).toEqual([]); // both flushed into the new box
    expect(state.sinks.find((s) => s?.color === 8)?.filled).toBe(2);
  });

  /**
   * A parked token can complete a sink, which opens another, which may take
   * more parked tokens. Without looping, a level looks lost while the tray is
   * actually clearable.
   */
  it('cascades when a flush completes another sink', () => {
    let state = createSinkState(CONFIG, [0, 1, 2, 3, 8, 9]);
    // Park three 8s and two 9s.
    for (const color of [8, 8, 8, 9, 9]) state = accept(state, CONFIG, color).state;
    expect(state.buffer).toHaveLength(5);

    for (let i = 0; i < 3; i++) state = accept(state, CONFIG, 0).state;

    // The 8 box opens, takes all three 8s, completes, opens the 9 box,
    // which then takes both 9s — all from one token.
    expect(state.buffer).toEqual([]);
    expect(state.sinks.find((s) => s?.color === 9)?.filled).toBe(2);
  });
});

describe('bus jam shape', () => {
  it('works with a single open sink', () => {
    let state = createSinkState(BUS, [0, 1]);
    expect(state.sinks).toHaveLength(1);

    const parked = accept(state, BUS, 1);
    expect(parked.placed).toBe('buffer');
    state = parked.state;

    for (let i = 0; i < 3; i++) state = accept(state, BUS, 0).state;
    expect(state.sinks[0]?.color).toBe(1);
    expect(state.buffer).toEqual([]); // the parked passenger boarded
  });
});

describe('helpers', () => {
  it('reports which colours can be absorbed right now', () => {
    const state = createSinkState(CONFIG, [0, 1, 2, 3]);
    expect(acceptedColors(state, CONFIG)).toEqual(new Set([0, 1, 2, 3]));
  });

  it('excludes a full sink from accepted colours', () => {
    let state = createSinkState(CONFIG, [0, 1, 2, 3]);
    state = accept(state, CONFIG, 0).state;
    state = accept(state, CONFIG, 0).state;
    expect(acceptedColors(state, CONFIG).has(0)).toBe(true); // 2 of 3
  });

  it('is drained only when nothing is open or parked', () => {
    let state = createSinkState(CONFIG, [0]);
    expect(isDrained(state)).toBe(false);
    for (let i = 0; i < 3; i++) state = accept(state, CONFIG, 0).state;
    expect(isDrained(state)).toBe(true);
  });

  it('keys equal states equally regardless of sink or buffer order', () => {
    const a = createSinkState(CONFIG, [0, 1, 2, 3]);
    const b = createSinkState(CONFIG, [3, 2, 1, 0]);
    expect(sinkStateKey(a)).toBe(sinkStateKey(b));
  });
});
