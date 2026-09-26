/**
 * The solver, and the naive player the difficulty is measured with.
 *
 * **Complete, not budgeted.** A board is sixteen words, and the only groups
 * that exist are four-word subsets of some bank category's members on the
 * board — a few dozen at most. Exact cover over that set is walked
 * exhaustively every time, so "one partition" means one, across every category
 * in the bank, not "one found before the budget ran out".
 *
 * What the solver cannot see is a category that is not in the bank. That is
 * the limit of the guarantee, and `categories.ts` is written with it in mind.
 */

import { CATEGORIES, MEMBERSHIP } from './categories';
import { GROUP_SIZE, WORDS, bitCount } from './model';
import type { Rng } from '../shared/rng';

/** A four-word set some category would accept. */
export interface Candidate {
  mask: number;
  /** The easiest category that accepts it — how obvious the set looks. */
  tier: number;
  /** Every category that accepts it. */
  categories: number[];
}

/**
 * Every four-word set on the board that some category accepts.
 *
 * A category with six members on the board contributes all fifteen of its
 * four-subsets; two categories that accept the same four words collapse into
 * one candidate, since the player guesses words and not labels.
 */
export function candidates(words: readonly string[]): Candidate[] {
  const members = new Map<number, number[]>();
  words.forEach((word, index) => {
    for (const id of MEMBERSHIP.get(word) ?? []) {
      const list = members.get(id);
      if (list) list.push(index);
      else members.set(id, [index]);
    }
  });

  const found = new Map<number, Candidate>();
  for (const [id, indices] of members) {
    if (indices.length < GROUP_SIZE) continue;
    const tier = (CATEGORIES[id] as (typeof CATEGORIES)[number]).tier;
    forEachSubset(indices, GROUP_SIZE, (mask) => {
      const existing = found.get(mask);
      if (existing) {
        existing.tier = Math.min(existing.tier, tier);
        existing.categories.push(id);
      } else {
        found.set(mask, { mask, tier, categories: [id] });
      }
    });
  }
  return [...found.values()];
}

function forEachSubset(items: readonly number[], size: number, visit: (mask: number) => void): void {
  const walk = (start: number, left: number, mask: number): void => {
    if (left === 0) {
      visit(mask);
      return;
    }
    for (let i = start; i <= items.length - left; i++) {
      walk(i + 1, left - 1, mask | (1 << (items[i] as number)));
    }
  };
  walk(0, size, 0);
}

/**
 * Every way to split the board into four accepted groups, up to `limit`.
 *
 * Exact cover by lowest uncovered word: each partition is found exactly once,
 * because the group holding the lowest free word is chosen first and that
 * choice is never revisited in another order.
 */
export function partitions(pool: readonly Candidate[], limit = 2): number[][] {
  const full = (1 << WORDS) - 1;
  const byWord: number[][] = Array.from({ length: WORDS }, () => []);
  for (const candidate of pool) {
    for (let index = 0; index < WORDS; index++) {
      if (candidate.mask & (1 << index)) byWord[index]!.push(candidate.mask);
    }
  }

  const out: number[][] = [];
  const chosen: number[] = [];

  const walk = (covered: number): void => {
    if (out.length >= limit) return;
    if (covered === full) {
      out.push(chosen.slice());
      return;
    }
    let lowest = 0;
    while (covered & (1 << lowest)) lowest++;
    for (const mask of byWord[lowest] as number[]) {
      if (mask & covered) continue;
      chosen.push(mask);
      walk(covered | mask);
      chosen.pop();
    }
  };

  walk(0);
  return out;
}

/* ------------------------------------------------------------------ */
/* The naive player                                                    */
/* ------------------------------------------------------------------ */

/**
 * How readily a naive player reaches for a set, by the tier of the easiest
 * category that accepts it. Five fish on the board are a trap anybody walks
 * into; four words that all follow FIRE are one only a few people see.
 */
const REACH = [0, 8, 4, 2, 1];

/**
 * How much of the mistake allowance a naive player burns, on average: 0 when
 * it never guesses wrong, 1 when every run ends out of mistakes.
 *
 * Not the share of runs *lost*, which is what the other puzzles measure. The
 * naive player never repeats a guess, so it cannot lose on a board with fewer
 * than four decoy sets — and nearly every fair board has fewer. Loss rate came
 * out zero at the median even at the top of the curve; mistakes spent is the
 * same idea measured finely enough to steer by.
 *
 * The naive player guesses any accepted set still on the board that it has not
 * already tried, weighted by how obvious it looks, and learns nothing from a
 * miss beyond not repeating it. That is deliberately worse than a person — no
 * "one away", no reasoning about what is left — because what it measures is
 * how many plausible wrong answers the board holds, not how clever the player
 * is. A board with no decoys scores zero however hard its categories are, and
 * `score` in `generate.ts` covers that half.
 */
export function trapRate(
  rng: Rng,
  pool: readonly Candidate[],
  solution: readonly number[],
  rollouts: number,
  maxMistakes: number,
): number {
  const answers = new Set(solution);
  let spent = 0;

  for (let run = 0; run < rollouts; run++) {
    let remaining = (1 << WORDS) - 1;
    let mistakes = 0;
    let found = 0;
    const tried = new Set<number>();

    while (found < solution.length && mistakes < maxMistakes) {
      const options: Candidate[] = [];
      let total = 0;
      for (const candidate of pool) {
        if ((candidate.mask & remaining) !== candidate.mask) continue;
        if (tried.has(candidate.mask)) continue;
        options.push(candidate);
        total += REACH[candidate.tier] as number;
      }
      if (options.length === 0) break;

      let roll = rng.next() * total;
      let pick = options[options.length - 1] as Candidate;
      for (const option of options) {
        roll -= REACH[option.tier] as number;
        if (roll < 0) {
          pick = option;
          break;
        }
      }

      tried.add(pick.mask);
      if (answers.has(pick.mask)) {
        remaining &= ~pick.mask;
        found++;
      } else {
        mistakes++;
      }
    }

    spent += mistakes;
  }

  return spent / (rollouts * maxMistakes);
}

/** Sets that look like a group but are not one. The raw decoy count. */
export function decoys(pool: readonly Candidate[], solution: readonly number[]): number {
  const answers = new Set(solution);
  return pool.filter((candidate) => !answers.has(candidate.mask)).length;
}

/** Sanity helper for tests: every mask in a partition is a four-word set. */
export function isPartition(masks: readonly number[]): boolean {
  let covered = 0;
  for (const mask of masks) {
    if (bitCount(mask) !== GROUP_SIZE || mask & covered) return false;
    covered |= mask;
  }
  return covered === (1 << WORDS) - 1;
}
