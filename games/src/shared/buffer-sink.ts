/**
 * Limited buffer feeding colour-capacity sinks.
 *
 * This is the engine underneath two of the three games, which turn out to be
 * the same game wearing different art:
 *
 *   Screw Land — four open boxes, each taking three matching screws; a five
 *                slot tray for screws that match nothing open. Tray overflows
 *                and the level is lost.
 *   Bus Jam    — a bus at the stop taking matching passengers; a bench for
 *                passengers who cannot board yet. Bench fills, level lost.
 *
 * Pure and immutable: the solver walks thousands of these, and the states are
 * small enough that copying beats the bookkeeping of apply/undo.
 */

export interface SinkConfig {
  /** Sinks open at once. Four for Screw Land, one or two for Bus Jam. */
  openSinks: number;
  /** Tokens a sink holds before it completes and is replaced. */
  sinkCapacity: number;
  /** Tokens that can be parked while they match nothing open. */
  bufferCapacity: number;
}

export interface Sink {
  color: number;
  filled: number;
}

export interface SinkState {
  /** null where the queue has run dry. */
  sinks: (Sink | null)[];
  /** Colours waiting to open, index 0 next. */
  queue: number[];
  buffer: number[];
}

export interface AcceptResult {
  state: SinkState;
  /** Where the token went. 'lost' means the buffer had no room. */
  placed: 'sink' | 'buffer' | 'lost';
  /** Sinks completed by this token, including any completed by the flush after. */
  completed: number;
}

export function createSinkState(config: SinkConfig, queue: readonly number[]): SinkState {
  const pending = queue.slice();
  const sinks: (Sink | null)[] = [];
  for (let i = 0; i < config.openSinks; i++) {
    const color = pending.shift();
    sinks.push(color === undefined ? null : { color, filled: 0 });
  }
  return { sinks, queue: pending, buffer: [] };
}

function cloneState(state: SinkState): SinkState {
  return {
    sinks: state.sinks.map((sink) => (sink ? { ...sink } : null)),
    queue: state.queue.slice(),
    buffer: state.buffer.slice(),
  };
}

function openSinkIndexFor(state: SinkState, color: number, capacity: number): number {
  return state.sinks.findIndex(
    (sink) => sink !== null && sink.color === color && sink.filled < capacity,
  );
}

/**
 * Drains the buffer into whatever is open, repeatedly — parking a token can
 * complete a sink, which opens a new one, which may take more parked tokens.
 * Without the loop a level can look lost while the buffer is actually clearable.
 */
function flush(state: SinkState, config: SinkConfig): number {
  let completed = 0;
  let progressed = true;

  while (progressed) {
    progressed = false;
    for (let i = 0; i < state.buffer.length; i++) {
      const color = state.buffer[i] as number;
      const index = openSinkIndexFor(state, color, config.sinkCapacity);
      if (index === -1) continue;

      state.buffer.splice(i, 1);
      const sink = state.sinks[index] as Sink;
      sink.filled++;
      if (sink.filled >= config.sinkCapacity) {
        const next = state.queue.shift();
        state.sinks[index] = next === undefined ? null : { color: next, filled: 0 };
        completed++;
      }
      progressed = true;
      break; // indices shifted; restart the scan
    }
  }

  return completed;
}

/** Offers one token. Never mutates the state passed in. */
export function accept(state: SinkState, config: SinkConfig, color: number): AcceptResult {
  const next = cloneState(state);
  const index = openSinkIndexFor(next, color, config.sinkCapacity);

  if (index !== -1) {
    const sink = next.sinks[index] as Sink;
    sink.filled++;
    let completed = 0;
    if (sink.filled >= config.sinkCapacity) {
      const upcoming = next.queue.shift();
      next.sinks[index] = upcoming === undefined ? null : { color: upcoming, filled: 0 };
      completed++;
    }
    completed += flush(next, config);
    return { state: next, placed: 'sink', completed };
  }

  if (next.buffer.length >= config.bufferCapacity) {
    return { state, placed: 'lost', completed: 0 };
  }

  next.buffer.push(color);
  return { state: next, placed: 'buffer', completed: flush(next, config) };
}

/** True once every sink is closed and nothing is parked. */
export function isDrained(state: SinkState): boolean {
  return state.buffer.length === 0 && state.sinks.every((sink) => sink === null);
}

/** Colours that can be absorbed right now without parking anything. */
export function acceptedColors(state: SinkState, config: SinkConfig): Set<number> {
  const colors = new Set<number>();
  for (const sink of state.sinks) {
    if (sink && sink.filled < config.sinkCapacity) colors.add(sink.color);
  }
  return colors;
}

/** Compact identity for memoising search. Sink order is not meaningful. */
export function sinkStateKey(state: SinkState): string {
  const sinks = state.sinks
    .map((sink) => (sink ? `${sink.color}.${sink.filled}` : '-'))
    .sort()
    .join(',');
  const buffer = state.buffer.slice().sort((a, b) => a - b).join('.');
  return `${sinks}|${buffer}|${state.queue.length}`;
}
