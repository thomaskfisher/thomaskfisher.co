import { defineConfig } from 'vitest/config';

/** Standalone config so the calibration harness never runs with `npm test`. */
export default defineConfig({
  root: '.',
  test: { environment: 'node', include: ['tools/calibrate.ts'], testTimeout: 900_000 },
});
