/// <reference lib="webworker" />

/** Screw Land level generation, off the main thread. See shared/levelSource.ts. */

import type { LevelRequest, LevelResponse } from '../shared/levelSource';
import { generateLevel } from './generate';

type Response = LevelResponse<ReturnType<typeof generateLevel>>;

self.addEventListener('message', (event: MessageEvent<LevelRequest>) => {
  const { id, seed, level } = event.data;
  try {
    const generated = generateLevel(seed, level);
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
