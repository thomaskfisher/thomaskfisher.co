import { defineConfig } from 'vitest/config';

/** Standalone config so the probe never runs with `npm test`. */
export default defineConfig({
  root: '.',
  test: { environment: 'node', include: ['tools/sample.ts'], testTimeout: 900_000 },
});
