/// <reference lib="webworker" />

/**
 * Level generation off the main thread.
 *
 * A hard level can cost a few dozen solver runs. That is only milliseconds, but
 * it lands exactly when the player taps "Next", which is the worst moment to
 * drop a frame.
 */

import { generateLevel } from './generate';

import type { LevelRequest, LevelResponse } from '../shared/levelSource';

type Response = LevelResponse<ReturnType<typeof generateLevel>>;

self.addEventListener('message', (event: MessageEvent<LevelRequest>) => {
  const { id, seed, level, difficultyOffset } = event.data;
  try {
    const generated = generateLevel(seed, level, difficultyOffset);
    const response: Response = { id, ok: true, level: generated };
    (self as DedicatedWorkerGlobalScope).postMessage(response);
  } catch (error) {
    const response: Response = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    (self as DedicatedWorkerGlobalScope).postMessage(response);
  }
});
