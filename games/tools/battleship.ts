/**
 * Battleship calibration probe, run before the band was trusted.
 *
 * **The lever survey** builds twenty boards per size and spare-given count and
 * prints what they measure: givens, the first signal tried (solver work per
 * square, which came out flat at 0.6-1.0 everywhere and was dropped), how
 * often each placement rule was needed, and openness — the mean number of
 * deductions on offer per step, which is the signal the score uses. Writes
 * tools/battleship.txt.
 *
 * **The curve** is what the finished generator ships level by level, against
 * the band it was asked for. Writes tools/battleship-curve.txt.
 *
 *   npx vitest run --config tools/vitest.battleship.config.ts --root .
 */

import { writeFileSync } from 'node:fs';
import { it } from 'vitest';

import { createRng } from '../src/shared/rng';
import { MAX_SIZE, MIN_SIZE, build } from '../src/battleship/generate';

it('lever survey', () => {
  const lines: string[] = [];
  const log = (s: string): void => {
    lines.push(s);
  };
  log('size spare | ok  givens  depth [range]  ext reach last | openness narrow [range] | ms/build');
  for (let size = MIN_SIZE; size <= MAX_SIZE; size++) {
    for (const spare of [0, 2, 4]) {
      const rng = createRng(size * 1000 + spare);
      const rows: { givens: number; depth: number; ext: number; reach: number; last: number; open: number; narrow: number }[] = [];
      const t0 = performance.now();
      const N = 20;
      for (let i = 0; i < N; i++) {
        const level = build(rng, 1, size, spare);
        if (!level) continue;
        rows.push({
          givens: level.puzzle.givens.length,
          depth: level.depth,
          ext: level.uses.extend,
          reach: level.uses.reach,
          last: level.uses.last,
          open: level.openness,
          narrow: level.narrow,
        });
      }
      const ms = (performance.now() - t0) / N;
      const mean = (k: keyof (typeof rows)[number]): string =>
        (rows.reduce((s, r) => s + r[k], 0) / Math.max(1, rows.length)).toFixed(2);
      const opens = rows.map((r) => r.open).sort((a, b) => a - b);
      const depths = rows.map((r) => r.depth).sort((a, b) => a - b);
      log(
        `${String(size).padStart(4)} ${String(spare).padStart(5)} | ${String(rows.length).padStart(3)} ${mean('givens').padStart(6)} ` +
          `${mean('depth').padStart(6)} [${depths[0]?.toFixed(2)}..${depths[depths.length - 1]?.toFixed(2)}] ` +
          `${mean('ext')} ${mean('reach')} ${mean('last')} | open ${mean('open')} narrow ${mean('narrow')} ` +
          `[${opens[0]?.toFixed(2)}..${opens[opens.length - 1]?.toFixed(2)}] | ${ms.toFixed(0)}`,
      );
    }
  }
  writeFileSync('tools/battleship.txt', lines.join('\n') + '\n');
});

it('curve', async () => {
  const { generateLevel } = await import('../src/battleship/generate');
  const { pressureForLevel } = await import('../src/shared/difficulty');
  const { hashSeed } = await import('../src/shared/rng');
  const lines: string[] = ['level size givens sweep open  diff  band        hit  ms'];
  let hits = 0;
  let total = 0;
  for (let level = 1; level <= 80; level += level < 20 ? 1 : 5) {
    const { band } = pressureForLevel(level, createRng(hashSeed('curve', 'battleship', level)));
    const t0 = performance.now();
    const g = generateLevel('curve', level);
    const ms = performance.now() - t0;
    const hit = g.difficulty >= band[0] && g.difficulty <= band[1];
    if (hit) hits++;
    total++;
    lines.push(
      `${String(level).padStart(5)} ${String(g.puzzle.size).padStart(4)} ${String(g.puzzle.givens.length).padStart(6)} ${String(g.uses.reach + g.uses.last).padStart(5)} ` +
        `${g.openness.toFixed(2)} ${g.difficulty.toFixed(2)} [${band[0].toFixed(2)},${band[1].toFixed(2)}] ${hit ? 'yes' : ' no'} ${ms.toFixed(0)}`,
    );
  }
  lines.push(`hits ${hits}/${total}`);
  writeFileSync('tools/battleship-curve.txt', lines.join('\n') + '\n');
});
