/**
 * Five Dice: what the hint engine actually averages, and what it prices boxes at.
 *
 * The house lesson from the other games is to measure the signal before
 * calibrating anything to it. There is no difficulty band here, but there is one
 * number worth knowing: the hint follows a within-turn-exact, across-turn-greedy
 * policy, and if that policy is weak the button is not worth pressing. Human
 * players average roughly 200-220; perfect play is about 254. Anything in the
 * low 200s means the opportunity-cost term is doing its job.
 *
 *   npx vitest run --config tools/vitest.dice.config.ts --root .
 */

import { appendFileSync, writeFileSync } from 'node:fs';

import { test } from 'vitest';

import { autoPlay, boxPrices } from '../src/fivedice/advise';
import { CATEGORIES, totals } from '../src/fivedice/model';

const OUT = 'tools/dice.txt';
const log = (line: string): void => appendFileSync(OUT, `${line}\n`);

const ROUNDS = 400;

test('the hint engine plays a respectable card', () => {
  writeFileSync(OUT, '');

  log('What each box is priced at — the cost of closing it');
  for (const { name, expected } of boxPrices()) {
    log(`  ${name.padEnd(18)} ${expected.toFixed(2)}`);
  }

  const scores: number[] = [];
  const bonuses: number[] = [];
  const zeros: number[] = CATEGORIES.map(() => 0);

  for (let round = 1; round <= ROUNDS; round++) {
    const { state } = autoPlay(`probe-${round}`);
    const result = totals(state.scores);
    scores.push(result.grand);
    bonuses.push(result.bonus > 0 ? 1 : 0);
    for (const [index, value] of state.scores.entries()) if (value === 0) zeros[index]++;
  }

  scores.sort((a, b) => a - b);
  const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  const at = (fraction: number): number => scores[Math.floor(fraction * (scores.length - 1))] as number;

  log('');
  log(`${ROUNDS} rounds`);
  log(`  mean            ${mean.toFixed(1)}`);
  log(`  min / max       ${at(0)} / ${at(1)}`);
  log(`  p10 p50 p90     ${at(0.1)} ${at(0.5)} ${at(0.9)}`);
  log(`  upper bonus     ${((bonuses.reduce((a, b) => a + b, 0) / ROUNDS) * 100).toFixed(0)}%`);
  log('');
  log('How often each box is scratched for nothing');
  for (const [index, count] of zeros.entries()) {
    log(`  ${(CATEGORIES[index]?.name ?? '').padEnd(18)} ${((count / ROUNDS) * 100).toFixed(0)}%`);
  }
});
