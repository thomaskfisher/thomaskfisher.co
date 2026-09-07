/**
 * Spider level generation.
 *
 * Two levers, and they do different jobs. **Suits** is the ladder everybody
 * already knows — one suit is a game about ordering, two suits is a game about
 * ordering while half of what you build is welded to the wrong partner — and it
 * is the coarse step, taken once, at `TWO_SUIT_FROM`. **Deal selection** is the
 * fine one, and it is measured: the generator deals until it finds a board
 * whose score lands where the curve asked, then verifies it is winnable before
 * it ships it.
 *
 * The score is not the trap rate the rest of the collection runs on. It is
 * *how far short naive play falls*, which is the same rollouts read differently
 * and is the only version of the question that says anything about a two-suit
 * board. See `shortfall`.
 *
 * Four suits is deliberately not here. See `games/README.md`.
 *
 * Like Solitaire next door, this scores before it verifies: scoring a deal is
 * tens of milliseconds and a Spider search is hundreds, so scoring first throws
 * away most candidates cheaply.
 */

import { makeCard, rankOf, suitOf } from '../shared/cards';
import { type Rng, createRng, hashSeed } from '../shared/rng';
import { pressureForLevel } from '../shared/difficulty';
import {
  type Column,
  type Move,
  type Spider,
  COLUMNS,
  DEAL_MOVE,
  SETS,
  applyMove,
  cloneState,
  deal,
  isLegal,
  isRun,
  isWon,
  packMove,
  stateKey,
} from './model';
import { solve } from './solve';

export interface GeneratedLevel {
  level: number;
  /** The shuffled pack. Everything else replays from it. */
  pack: number[];
  /** One or two. The only rule that changes between levels. */
  suits: number;
  /** Measured shortfall. Never shown; it exists to hit the curve's band. */
  difficulty: number;
  /** Length of the solver's line. Not shown; the win sheet counts your moves. */
  moves: number;
  /** A winning line, packed. The first hint on a level is therefore free. */
  solution: number[];
  attempts: number;
}

const MAX_ATTEMPTS = 150;
const MAX_SEARCHES = 26;

/**
 * Close enough to the band to stop looking.
 *
 * Without this the loop keeps dealing and scoring right through its attempt
 * budget whenever the band is a shade out of reach, which turned a level that
 * had a perfectly good board in hand after three deals into a minute of work —
 * on a phone, with a player watching "Preparing…". The number is inside the
 * noise the curve already carries: the band is 0.26 wide and the jitter on
 * pressure is plus or minus 0.06, so a miss this small is smaller than the
 * difference between one level and the next.
 */
export const GOOD_ENOUGH = 0.06;
const ROLLOUTS = 20;
const VERIFY_BUDGET = 60_000;

/* ------------------------------------------------------------------- pack */

/** Eight sets of thirteen, drawn from `suits` suits in equal shares. */
export function packFor(suits: number): number[] {
  const cards: number[] = [];
  for (let set = 0; set < SETS; set++) {
    const suit = set % suits;
    for (let rank = 1; rank <= 13; rank++) cards.push(makeCard(suit, rank));
  }
  return cards;
}

/**
 * The level two suits start at.
 *
 * Measured rather than chosen, and the measurement is unusually blunt: a
 * one-suit board scores anywhere from 0.1 to 0.98 on the signal below, and a
 * two-suit board scores 0.98 whatever else is true about it. Two suits does not
 * sit *on* this scale — it sits above the top of it.
 *
 * So the step goes where the curve first asks for the top of the scale, which
 * is where the band's upper edge saturates at 1.0. Earlier than that and the
 * generator would be dealing two-suit boards that score above the band it was
 * given and throwing every one of them away — the two-levers-cancelling failure
 * that cost Screw Land a week. See `tools/spider.ts`.
 *
 * On the level number rather than on the band, because the band carries jitter:
 * deciding from it would flip a player between one suit and two on consecutive
 * levels, which reads as the game breaking rather than as a ladder.
 */
export const TWO_SUIT_FROM = 28;

export const suitsFor = (level: number): number => (level >= TWO_SUIT_FROM ? 2 : 1);

/* -------------------------------------------------------------- shortfall */

/**
 * How a rollout weighs its options.
 *
 * Multipliers rather than points, because the pick is proportional: a move
 * worth six times another should come up six times as often, not six points
 * higher on a scale nobody can read.
 *
 * The player these describe is a real one having a go, not a search. They can
 * see which eight to build on — that is on the board — and they will not take a
 * run they have already built apart to get at what is under it. What they will
 * not do is plan three moves ahead, and that is the whole difference between
 * this file and `solve.ts`.
 *
 * **The run-length term is why two suits scores anything at all.** Without it
 * this player never won a two-suit deal in two hundred, so every two-suit board
 * measured 1.00 and the signal had nothing left to say. A player who cannot
 * tell one eight from another is not the player this game is for.
 */
const WEIGHTS = {
  join: 6,
  perJoinedCard: 0.35,
  flip: 5,
  empty: 4,
  breaksSuit: 0.25,
  usesGap: 0.4,
  deal: 3,
  strangers: 1,
} as const;

const ROLLOUT_CAP = 900;

/**
 * How far short naive play falls: 0 when it always goes out, 1 when it never
 * lifts a single set off the board.
 *
 * Everywhere else in this collection the signal is a **trap rate** — the share
 * of naive playthroughs that dead-end. Spider is the one game where that
 * question has no answer worth having: this player wins about a quarter of
 * one-suit deals and, measured over two hundred boards, essentially none at two
 * suits. Every two-suit level scored 1.00 and the whole back half of the curve
 * was a coin with the same face on both sides.
 *
 * Grading the same rollouts by **how many of the eight sets they finished**
 * fixes that without changing what is being modelled. A two-suit board where a
 * player usually gets five sets out is plainly easier than one where they
 * usually get one, and now the generator can tell those apart. A run that wins
 * scores all eight, so on a one-suit board this still tracks the trap rate it
 * replaces — it just keeps saying something after that runs out.
 *
 * A rollout ends when every move leads to a position it has already been in.
 * Spider has no redeal, so that condition is reached honestly: once the stock
 * is spent, shuffling face-up runs between columns comes back round to itself.
 */
export function shortfall(
  start: Spider,
  rng: Rng,
  rollouts = ROLLOUTS,
  band?: readonly [number, number],
): number {
  const most = rollouts * SETS;
  let finished = 0;

  for (let i = 0; i < rollouts; i++) {
    finished += naivePlaythrough(start, rng);

    // Most deals are not pitched near the level being built, and one that
    // cannot reach the band however the rest of its rollouts go is already
    // answered. Stopping there is most of what this scoring costs.
    if (band) {
      const best = (finished + (rollouts - i - 1) * SETS) / most;
      const ceiling = 1 - finished / most;
      const floor = 1 - best;
      if (floor > band[1]) return floor;
      if (ceiling < band[0]) return ceiling;
    }
  }

  return 1 - finished / most;
}

interface Weighted {
  move: Move;
  weight: number;
}

/** How many of the eight sets this run got off the board. */
function naivePlaythrough(start: Spider, rng: Rng): number {
  let state = cloneState(start);
  const seen = new Set<string>([stateKey(state)]);

  for (let step = 0; step < ROLLOUT_CAP; step++) {
    if (isWon(state)) return SETS;

    const options = naiveOptions(state);
    let advanced = false;

    while (options.length > 0) {
      const chosen = pickWeighted(options, rng);
      const next = cloneState(state);
      if (!applyMove(next, options[chosen]?.move as Move)) {
        options.splice(chosen, 1);
        continue;
      }

      const key = stateKey(next);
      if (seen.has(key)) {
        options.splice(chosen, 1);
        continue;
      }

      seen.add(key);
      state = next;
      advanced = true;
      break;
    }

    if (!advanced) return state.completed;
  }

  return state.completed;
}

function pickWeighted(options: readonly Weighted[], rng: Rng): number {
  let total = 0;
  for (const option of options) total += option.weight;

  let roll = rng.next() * total;
  for (let i = 0; i < options.length; i++) {
    roll -= (options[i] as Weighted).weight;
    if (roll <= 0) return i;
  }
  return options.length - 1;
}

function naiveOptions(state: Spider): Weighted[] {
  const options: Weighted[] = [];
  const firstEmpty = state.columns.findIndex((column) => column.cards.length === 0);

  for (let from = 0; from < COLUMNS; from++) {
    const column = state.columns[from] as Column;
    const faceUp = column.cards.length - column.down;

    for (let count = 1; count <= faceUp; count++) {
      const start = column.cards.length - count;
      if (!isRun(column.cards, start)) break;
      const head = column.cards[start] as number;

      for (let to = 0; to < COLUMNS; to++) {
        const target = state.columns[to] as Column;
        if (target.cards.length === 0 && to !== firstEmpty) continue;

        const move: Move = { kind: 'move', from, to, count };
        if (!isLegal(state, move)) continue;
        options.push({ move, weight: naiveWeight(column, target, start, head) });
      }
    }
  }

  if (isLegal(state, DEAL_MOVE)) options.push({ move: DEAL_MOVE, weight: WEIGHTS.deal });
  return options;
}

function naiveWeight(source: Column, target: Column, start: number, head: number): number {
  let weight = 1;

  if (start === 0) weight *= WEIGHTS.empty;
  else if (start === source.down && source.down > 0) weight *= WEIGHTS.flip;

  const beneath = start > source.down ? (source.cards[start - 1] as number) : -1;
  if (beneath >= 0 && suitOf(beneath) === suitOf(head) && rankOf(beneath) === rankOf(head) + 1) {
    weight *= WEIGHTS.breaksSuit;
  }

  const landing = target.cards[target.cards.length - 1];
  if (landing === undefined) return weight * WEIGHTS.usesGap;
  if (suitOf(landing) !== suitOf(head)) return weight * WEIGHTS.strangers;

  // Which eight to build on: the one that already has a nine, ten and jack
  // under it. That is visible from the board, so this player can see it.
  let runStart = target.cards.length - 1;
  while (runStart > target.down && isRun(target.cards, runStart - 1)) runStart--;
  const joined = target.cards.length - runStart;

  return weight * WEIGHTS.join * (1 + WEIGHTS.perJoinedCard * joined);
}

/* ------------------------------------------------------------- generation */

export function generateLevel(profileSeed: string, level: number): GeneratedLevel {
  const pressureRng = createRng(hashSeed(profileSeed, 'spider', 'pressure', level));
  const pressure = pressureForLevel(level, pressureRng);
  const [lo, hi] = pressure.band;
  const suits = suitsFor(level);
  const ordered = packFor(suits);

  let closest: GeneratedLevel | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  let searches = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rng = createRng(hashSeed(profileSeed, 'spider', level, attempt));
    const pack = rng.shuffle(ordered.slice());
    const start = deal(pack);
    if (isWon(start)) continue;

    const difficulty = shortfall(start, rng, ROLLOUTS, pressure.band);
    const distance = difficulty < lo ? lo - difficulty : difficulty > hi ? difficulty - hi : 0;

    const worthSearching =
      searches < MAX_SEARCHES ? distance === 0 || distance < closestDistance : closest === null;
    if (!worthSearching) continue;

    searches++;
    const result = solve(start, {
      budget: VERIFY_BUDGET,
      // Seeded from the level, so a board and the line through it are the same
      // on every device and reproducible from a bug report.
      seed: hashSeed(profileSeed, 'spider', 'solve', level, attempt),
    });
    if (result.status !== 'solved') continue;

    const candidate: GeneratedLevel = {
      level,
      pack,
      suits,
      difficulty,
      moves: result.moves.length,
      solution: result.moves.map(packMove),
      attempts: attempt + 1,
    };

    if (distance === 0) return candidate;
    closestDistance = distance;
    closest = candidate;
    if (distance <= GOOD_ENOUGH) return candidate;
  }

  if (closest) return closest;
  throw new Error(`Unable to generate a solvable Spider level ${level}`);
}

/** Rebuilds the board a level number stands for. Pure, and the same everywhere. */
export const boardFor = (generated: GeneratedLevel): Spider => deal(generated.pack);
