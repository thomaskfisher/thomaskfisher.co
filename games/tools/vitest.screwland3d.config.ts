import { defineConfig } from 'vitest/config';

/** Standalone config so the Screw Land 3D probe never runs with `npm test`. */
export default defineConfig({
  root: '.',
  test: { environment: 'node', include: ['tools/screwland3d.ts'], testTimeout: 900_000 },
});
