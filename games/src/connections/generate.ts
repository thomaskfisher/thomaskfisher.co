/**
 * Connections generation.
 *
 * A puzzle is four categories from the bank and four words from each, dealt in
 * a shuffled grid. Nothing is built, so like Wordle this file is about
 * *choosing* — and the choice that matters is which words, because that is
 * where the red herrings live.
 *
 * Every board is proven to have exactly one answer before it is shown:
 * `partitions` walks every four-word set any category in the bank accepts and
 * finds every way to split the sixteen words into four of them. One way ships.
 * Two ways is the dead end the original would never let you out of, and is
 * thrown away.
 *
 * **There is no difficulty curve, on purpose.** Every other puzzle here climbs
 * to its ceiling by level 50; this one deals puzzles rather than levels, the way
 * the original does — one plain group, one a little broader, one that needs
 * knowing something, one piece of wordplay, every time. What keeps them fair
 * and alike is a *band* on the measured trap rate rather than a target that
 * moves: every puzzle has herrings, and none is a wall of them.
 */

import { type Rng, createRng, hashSeed } from '../shared/rng';
import { CATEGORIES, type Category } from './categories';
import { type Board, GROUP_SIZE, type Group, MAX_MISTAKES, WORDS } from './model';
import { candidates, decoys, partitions, trapRate } from './solve';

export const GAME_ID = 'connections';

export interface GeneratedLevel extends Board {
  /** The puzzle number. Called a level everywhere the shared code needs one. */
  level: number;
  /** Share of the mistake allowance a naive player burns. See `solve.ts`. */
  trapRate: number;
  /** Four-word sets on the board some category accepts that are not answers. */
  decoys: number;
}

/* ------------------------------------------------------------------ */
/* Shape                                                               */
/* ------------------------------------------------------------------ */

/**
 * One category from each tier, yellow to purple — the original's shape.
 *
 * One per slot rather than four free draws, because the bank has more wordplay
 * categories than plain ones and they share words with each other far more:
 * free draws put two or three FIRE ___ groups on one board.
 */
export const TIER_SLOTS: readonly number[] = [1, 2, 3, 4];

/** Herrings to plant. See `chooseWords`. */
export function herringsFor(rng: Rng): number {
  return rng.pick([1, 2, 2, 3]);
}

/**
 * How strongly category choice prefers one that shares words with those
 * already chosen. Shared words are what a herring is made of: two categories
 * with nothing in common cannot plant one in each other.
 */
const LINK = 2.5;

/**
 * The trap rates a puzzle may ship with.
 *
 * Measured over a thousand boards: with herrings planted, trap rate runs from
 * zero to about 0.9. The floor rules out the boards where every herring missed
 * — four lists to sort, nothing to catch you — and the ceiling the ones so
 * thick with decoys that the fourth mistake is more luck than judgement.
 */
export const TRAP_BAND: readonly [number, number] = [0.12, 0.6];

/* ------------------------------------------------------------------ */
/* Choosing                                                            */
/* ------------------------------------------------------------------ */

function weightedPick<T>(rng: Rng, items: readonly T[], weight: (item: T) => number): T | null {
  let total = 0;
  for (const item of items) total += weight(item);
  if (total <= 0) return null;
  let roll = rng.next() * total;
  for (const item of items) {
    roll -= weight(item);
    if (roll < 0) return item;
  }
  return items[items.length - 1] ?? null;
}

function sharedWords(a: Category, b: Category): number {
  const set = new Set(a.words);
  let count = 0;
  for (const word of b.words) if (set.has(word)) count++;
  return count;
}

/**
 * The category every attempt at this level starts from.
 *
 * Drawn from a deck shuffled once per pass through the bank, so every category
 * leads a puzzle once before any leads a second — variety by construction
 * rather than by hoping the dice spread out.
 */
function leadCategory(seed: string, level: number): Category {
  const size = CATEGORIES.length;
  const pass = Math.floor((level - 1) / size);
  const deck = CATEGORIES.map((category) => category.id);
  createRng(hashSeed(seed, GAME_ID, 'deck', pass)).shuffle(deck);
  return CATEGORIES[deck[(level - 1) % size] as number] as Category;
}

function chooseCategories(
  rng: Rng,
  lead: Category | null,
  slots: readonly number[],
  anchors: readonly Category[],
): Category[] | null {
  const link = LINK;
  const open = slots.slice();
  const chosen: Category[] = [];

  // The lead takes the slot of its own tier; the rest are drawn around it.
  if (lead && open.includes(lead.tier)) {
    chosen.push(lead);
    open.splice(open.indexOf(lead.tier), 1);
  }

  for (const tier of rng.shuffle(open)) {
    const next = weightedPick(rng, CATEGORIES, (category) => {
      if (category.tier !== tier) return 0;
      if (chosen.includes(category)) return 0;
      if (category.family && chosen.some((other) => other.family === category.family)) return 0;

      let shared = 0;
      for (const other of chosen) {
        const overlap = sharedWords(category, other);
        // Near-duplicates (Planets and Roman gods share six of eight) leave too
        // few words that belong to only one of the pair; the solver would throw
        // almost every such board away, so they are not paired at all.
        if (overlap * 2 > Math.min(category.words.length, other.words.length)) return 0;
        shared += overlap;
      }
      // Sharing a word with a decoy is what lets the decoy be planted at all:
      // its four words have to live in four different answer groups.
      let anchored = 0;
      for (const anchor of anchors) {
        if (anchor !== category && sharedWords(category, anchor) > 0) anchored++;
      }
      // Multiplied rather than added: a tier holds eighty categories and only a
      // handful overlap any given decoy, so an additive nudge left the answers
      // missing the decoy on most boards and the herring was never planted.
      return (1 + link * Math.min(3, shared)) * (anchored > 0 ? 40 : 1);
    });
    if (!next) return null;
    chosen.push(next);
  }

  return chosen;
}

/**
 * Four words from each category, with herrings planted first.
 *
 * A herring is a *target* category the board will hold more of than the answer
 * needs, spread across the answer groups:
 *
 *  - an unchosen category with four members on the board, none of them in the
 *    same group, is a decoy group — four words that look like one and are not;
 *  - a chosen category with a fifth member sitting in some other group is the
 *    fifth fish, and turns the group itself into a choice.
 *
 * Random choice almost never builds either — measured, the median trap rate at
 * the top of the curve was zero — so they are placed deliberately, and the rest
 * of each group is filled around them. The solver then decides whether the
 * result still has only one answer.
 */
function chooseWords(
  rng: Rng,
  chosen: readonly Category[],
  anchors: readonly Category[],
  herrings: number,
): string[][] | null {
  const groups: string[][] = chosen.map(() => []);
  const onBoard = new Set<string>();
  const members = chosen.map((category) => new Set(category.words));

  const place = (group: number, word: string): void => {
    (groups[group] as string[]).push(word);
    onBoard.add(word);
  };
  const room = (group: number): boolean => (groups[group] as string[]).length < GROUP_SIZE;
  /** Chosen groups that would accept this word and still have a slot. */
  const homes = (word: string, except: number): number[] => {
    const out: number[] = [];
    members.forEach((set, group) => {
      if (group !== except && set.has(word) && room(group)) out.push(group);
    });
    return out;
  };

  const queue = anchors.slice();

  for (let planted = 0, tries = 0; planted < herrings && tries < 12; tries++) {
    const viable = (category: Category): number => {
      const self = chosen.indexOf(category);
      let spread = 0;
      for (const word of category.words) {
        if (!onBoard.has(word) && homes(word, self).length > 0) spread++;
      }
      // An unchosen target needs four placeable words; a chosen one needs one.
      if (self === -1 ? spread < GROUP_SIZE : spread < 1) return 0;
      return REACH_WEIGHT[category.tier] as number;
    };
    // An anchor the answers failed to overlap falls through to any target.
    const anchor = queue.shift();
    const target =
      (anchor && viable(anchor) > 0 ? anchor : null) ?? weightedPick(rng, CATEGORIES, viable);
    if (!target) break;

    const self = chosen.indexOf(target);
    const words = rng.shuffle(target.words.filter((word) => !onBoard.has(word)));

    if (self !== -1) {
      // The fifth member: one word of the target, housed in another group.
      for (const word of words) {
        const options = homes(word, self);
        if (options.length === 0) continue;
        place(rng.pick(options), word);
        planted++;
        break;
      }
      continue;
    }

    // A decoy group: four of the target's words, in as many different groups
    // as the board allows. A group already holding one is used last.
    const used = new Map<number, number>();
    let count = target.words.filter((word) => onBoard.has(word)).length;
    for (const word of words) {
      if (count >= GROUP_SIZE) break;
      const options = homes(word, -1);
      if (options.length === 0) continue;
      const fewest = Math.min(...options.map((group) => used.get(group) ?? 0));
      const group = rng.pick(options.filter((option) => (used.get(option) ?? 0) === fewest));
      if ((used.get(group) ?? 0) >= 2) continue;
      place(group, word);
      used.set(group, (used.get(group) ?? 0) + 1);
      count++;
    }
    planted++;
  }

  for (let group = 0; group < chosen.length; group++) {
    const category = chosen[group] as Category;
    while (room(group)) {
      const pool = category.words.filter((word) => !onBoard.has(word));
      if (pool.length === 0) return null;
      place(group, rng.pick(pool));
    }
  }

  return groups;
}

/**
 * Decoy categories, chosen before the answers so the answers can be picked to
 * overlap them. Big categories only: a decoy's four words have to be found
 * among four other categories' members, and a six-word list rarely manages it.
 */
function chooseAnchors(rng: Rng, count: number): Category[] {
  const out: Category[] = [];
  for (let i = 0; i < count; i++) {
    const pick = weightedPick(rng, CATEGORIES, (category) =>
      out.includes(category) || (DEGREE[category.id] as number) < 4
        ? 0
        : (REACH_WEIGHT[category.tier] as number),
    );
    if (pick) out.push(pick);
  }
  return out;
}

/**
 * How many other categories each one shares a word with. A decoy needs its
 * four words spread over several answer categories, so one that overlaps
 * almost nothing cannot be planted however the answers are chosen.
 */
const DEGREE: readonly number[] = CATEGORIES.map(
  (category) => CATEGORIES.filter((other) => other !== category && sharedWords(category, other) > 0).length,
);

/** Same scale as the naive player's reach: an obvious decoy is a better trap. */
const REACH_WEIGHT = [0, 4, 3, 2, 2];

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

/** Boards to try with the lead category before going without it. */
const ATTEMPTS = 60;

/** Naive playthroughs behind each trap-rate figure. */
const ROLLOUTS = 60;

export interface Draft {
  chosen: Category[];
  words: string[][];
}

function assemble(
  rng: Rng,
  level: number,
  draft: Draft,
  measured: Pick<GeneratedLevel, 'trapRate' | 'decoys'>,
): GeneratedLevel {
  const flat = draft.words.flat();
  const order = rng.shuffle(flat.map((_word, index) => index));
  const words = order.map((index) => flat[index] as string);
  const position = new Map(order.map((from, to) => [from, to]));

  // Colour by tier, easiest first. Ties are broken by the dice rather than by
  // bank order, so two tier-1 groups do not always colour the same way round.
  const ranked = draft.chosen
    .map((category, index) => ({ category, index, tiebreak: rng.next() }))
    .sort((a, b) => a.category.tier - b.category.tier || a.tiebreak - b.tiebreak);

  const groups: Group[] = ranked.map(({ category, index }, color) => {
    let mask = 0;
    for (let slot = 0; slot < GROUP_SIZE; slot++) {
      mask |= 1 << (position.get(index * GROUP_SIZE + slot) as number);
    }
    return { name: category.name, tier: category.tier, color, mask };
  });

  return { level, words, groups, ...measured };
}

/** One candidate board, measured. Null when it is not unique or not buildable. */
export interface Trial {
  draft: Draft;
  trapped: number;
  decoyCount: number;
}

export function tryBoard(rng: Rng, lead: Category | null): Trial | null {
  const herrings = herringsFor(rng);
  const anchors = chooseAnchors(rng, Math.ceil(herrings / 2));
  const chosen = chooseCategories(rng, lead, TIER_SLOTS, anchors);
  if (!chosen) return null;
  const words = chooseWords(rng, chosen, anchors, herrings);
  if (!words) return null;

  const flat = words.flat();
  if (new Set(flat).size !== WORDS) return null;

  const pool = candidates(flat);
  const found = partitions(pool, 2);
  if (found.length !== 1) return null;

  const solution = found[0] as number[];
  return {
    draft: { chosen, words },
    trapped: trapRate(rng, pool, solution, ROLLOUTS, MAX_MISTAKES),
    decoyCount: decoys(pool, solution),
  };
}

export function generateLevel(seed: string, level: number): GeneratedLevel {
  const rng = createRng(hashSeed(seed, GAME_ID, level));
  const lead = leadCategory(seed, level);
  const [low, high] = TRAP_BAND;

  let best: Trial | null = null;
  let bestMiss = Infinity;

  for (let attempt = 0; attempt < ATTEMPTS * 4; attempt++) {
    // The lead category is a preference, not a promise: past the first round
    // of attempts the rest go without it.
    const trial = tryBoard(rng, attempt < ATTEMPTS ? lead : null);
    if (!trial) continue;

    const miss = trial.trapped < low ? low - trial.trapped : Math.max(0, trial.trapped - high);
    if (miss < bestMiss) {
      bestMiss = miss;
      best = trial;
    }
    if (miss === 0) break;
    if (attempt >= ATTEMPTS && best) break;
  }

  if (!best) throw new Error(`No unique board for puzzle ${level}`);

  return assemble(rng, level, best.draft, { trapRate: best.trapped, decoys: best.decoyCount });
}
