import { defineConfig } from 'vitest/config';

/** Standalone config so the probe never runs with `npm test`. */
export default defineConfig({
  root: '.',
  test: { environment: 'node', include: ['tools/tetris.ts'], testTimeout: 1_800_000 },
});
