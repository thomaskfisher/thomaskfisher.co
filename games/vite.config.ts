import { defineConfig } from 'vitest/config';

/**
 * Multi-page build: one entry per game plus the launcher.
 *
 * Everything emits to `dist/`, which is what the `games` Firebase Hosting
 * target serves. `examples/` sits outside the build graph, so the ~4MB of
 * reference mp4/gif never ships.
 *
 * Paths are relative to `root` (the games/ directory) on purpose — Vite
 * bundles this config before running it, which makes __dirname unreliable.
 */
export default defineConfig({
  root: '.',
  publicDir: 'public',
  base: '/',

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    // These games are small; inlining keeps the offline cache to fewer requests.
    assetsInlineLimit: 8192,
    rollupOptions: {
      input: {
        launcher: 'index.html',
        colorsort: 'colorsort/index.html',
        screwland: 'screwland/index.html',
        busjam: 'busjam/index.html',
        survival: 'survival/index.html',
        fivedice: 'fivedice/index.html',
        gridlock: 'gridlock/index.html',
      },
    },
  },

  worker: {
    format: 'es',
  },

  server: {
    port: 5273,
    host: true,
  },

  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
