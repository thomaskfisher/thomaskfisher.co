/**
 * Difficulty calibration harness. Not part of the app or the test suite.
 *
 * Generates a span of levels for one game and prints what the generator
 * actually produced — measured difficulty, the shape levers, and how many
 * attempts it burned. Tuning these curves by reading the constants does not
 * work; the levers interact through the solver, and the only honest signal is
 * what comes out the far end.
 *
 *   npx vitest run --reporter=basic tools/calibrate.ts
 */

import { appendFileSync, writeFileSync } from 'node:fs';

import { test } from 'vitest';

const OUT = process.env.CALIB_OUT ?? 'tools/calibration.txt';
const log = (line: string): void => appendFileSync(OUT, `${line}\n`);

import { generateLevel as colorsort } from '../src/colorsort/generate';
import { generateLevel as screwland } from '../src/screwland/generate';
import { generateLevel as busjam } from '../src/busjam/generate';
import { generateLevel as survival } from '../src/survival/generate';

const LEVELS = [1, 2, 3, 5, 8, 12, 16, 20, 25, 30, 35, 40, 45, 50, 60, 75, 100];
const SEEDS = ['calib-a', 'calib-b', 'calib-c'];

type Row = Record<string, string | number>;

function table(name: string, rows: Row[]): void {
  const cols = Object.keys(rows[0] ?? {});
  const width = (c: string): number =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length));
  const line = (cells: string[]): string =>
    cells.map((cell, i) => cell.padStart(width(cols[i] as string))).join('  ');

  log(`\n===== ${name} =====`);
  log(line(cols));
  for (const row of rows) log(line(cols.map((c) => String(row[c] ?? ''))));
}

const mean = (ns: number[]): number => ns.reduce((a, b) => a + b, 0) / ns.length;
const f2 = (n: number): string => n.toFixed(2);

test('calibrate', () => {
  writeFileSync(OUT, '');

  /* ---------------------------------------------------------- color sort */
  table(
    'COLOR SORT',
    LEVELS.map((level) => {
      const runs = SEEDS.map((seed) => colorsort(seed, level));
      return {
        lvl: level,
        diff: f2(mean(runs.map((r) => r.difficulty))),
        colors: f2(mean(runs.map((r) => r.shape.colors))),
        height: f2(mean(runs.map((r) => r.shape.height))),
        empty: f2(mean(runs.map((r) => r.shape.emptyTubes))),
        moves: f2(mean(runs.map((r) => r.solutionLength))),
        tries: f2(mean(runs.map((r) => r.attempts))),
      };
    }),
  );

  /* ---------------------------------------------------------- screw land */
  table(
    'SCREW LAND',
    LEVELS.map((level) => {
      const runs = SEEDS.map((seed) => screwland(seed, level));
      return {
        lvl: level,
        diff: f2(mean(runs.map((r) => r.difficulty))),
        colors: f2(mean(runs.map((r) => r.shape.colors))),
        boxes: f2(mean(runs.map((r) => r.shape.openBoxes))),
        tray: f2(mean(runs.map((r) => r.shape.trayCapacity))),
        screws: f2(mean(runs.map((r) => r.shape.screwCount))),
        plates: f2(mean(runs.map((r) => r.shape.plateCount))),
        tries: f2(mean(runs.map((r) => r.attempts))),
      };
    }),
  );

  /* ------------------------------------------------------------- bus jam */
  table(
    'BUS JAM',
    LEVELS.map((level) => {
      const runs = SEEDS.map((seed) => busjam(seed, level));
      return {
        lvl: level,
        diff: f2(mean(runs.map((r) => r.difficulty))),
        colors: f2(mean(runs.map((r) => r.shape.colors))),
        buses: f2(mean(runs.map((r) => r.shape.openBuses))),
        bench: f2(mean(runs.map((r) => r.shape.benchCapacity))),
        people: f2(mean(runs.map((r) => r.shape.passengerCount))),
        walls: f2(mean(runs.map((r) => r.shape.wallCount))),
        tries: f2(mean(runs.map((r) => r.attempts))),
      };
    }),
  );

  /* ------------------------------------------------------------ survival */
  table(
    'SURVIVAL',
    LEVELS.map((level) => {
      const runs = SEEDS.map((seed) => survival(seed, level));
      return {
        lvl: level,
        diff: f2(mean(runs.map((r) => r.difficulty))),
        lanes: f2(mean(runs.map((r) => r.shape.lanes))),
        rows: f2(mean(runs.map((r) => r.shape.rows))),
        reach: f2(mean(runs.map((r) => r.shape.reach))),
        winT: f2(mean(runs.map((r) => r.shape.winTarget))),
        hostl: f2(mean(runs.map((r) => r.shape.hostileShare))),
        tries: f2(mean(runs.map((r) => r.attempts))),
      };
    }),
  );
}, 600_000);
