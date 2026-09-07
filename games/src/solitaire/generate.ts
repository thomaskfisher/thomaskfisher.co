/**
 * Solitaire level generation.
 *
 * The deal is the only thing there is to vary — draw one, unlimited redeals, so
 * the rules are the same on level 1 and level 400 — which makes this file
 * unusually simple and puts all the weight on the difficulty signal.
 *
 * That signal is **trap rate**: the share of naive playthroughs that get stuck.
 * See `trapRate` for what "naive" means and why it is the right model of the
 * player rather than of the search.
 *
 * ## Why this one measures before it verifies
 *
 * Every other game in the collection solves a candidate first and scores it
 * second. Here it is the other way round, because the costs are the other way
 * round: scoring a deal is tens of milliseconds and searching one is hundreds,
 * and a Klondike search is the most expensive thing anything in this project
 * does. Scoring first throws away the great majority of candidates cheaply, and
 * only a deal that is already pitched right pays for a search.
 */

import { orderedDeck, suitOf } from '../shared/cards';
import { type Rng, createRng, hashSeed } from '../shared/rng';
import { pressureForLevel } from '../shared/difficulty';
import {
  type Klondike,
  type Move,
  type Pile,
  FOUNDATION_0,
  PILES,
  STOCK_MOVE,
  WASTE,
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
  /** The shuffled deck. Everything else replays from it. */
  deck: number[];
  /** Measured trap rate. Never shown; it exists to hit the curve's band. */
  difficulty: number;
  /** Length of the solver's line. Not shown; the win sheet counts your moves. */
  moves: number;
  /**
   * A winning line, packed. The generator has already paid for it, so the first
   * hint on a level costs nothing and the plan is one the player can follow to
   * the end.
   */
  solution: number[];
  attempts: number;
}

/**
 * Deals looked at, and searches paid for, before the generator settles for the
 * closest thing it found.
 *
 * The two are separate because the two costs are: scoring a deal is tens of
 * milliseconds and searching one is hundreds, so the loop is free to be picky
 * about which deals it looks at and has to be careful about which it verifies.
 */
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

/** Rollouts per candidate. A twentieth is finer than the band is wide. */
const ROLLOUTS = 20;

/**
 * Search budget when verifying a candidate.
 *
 * Measured rather than picked. A deal this search *can* win is won in a
 * fraction of this — the mean was around 560ms against a budget five times
 * larger — so almost all of a bigger budget is spent proving nothing about
 * deals that were going to be discarded either way. Failing cheaply is worth
 * more here than failing conclusively: the only answer that ships a level is
 * `solved`.
 */
const VERIFY_BUDGET = 12_000;

/* ------------------------------------------------------------- trap rate */

/**
 * How a rollout weighs its options.
 *
 * Not a ranking with a tie-break — a weighting, sampled from. A player who
 * always takes the best-looking move is a search, and every deal then scores
 * the same; a player who picks at random loses every deal and scores the same
 * the other way. The spread between deals only appears when the same position
 * gets played differently on different runs, which is what these numbers are
 * for. Turning a card over is the move anyone sees; rearranging face-up columns
 * three moves ahead is the move this player is being defined as not making.
 */
const WEIGHTS = {
  flip: 40,
  fromWaste: 16,
  emptyColumn: 12,
  stock: 10,
  shuffle: 3,
  bank: 1,
} as const;

/** Longest a rollout runs before it is called a draw. Never reached in practice. */
const ROLLOUT_CAP = 900;

/**
 * The share of naive playthroughs that get stuck.
 *
 * The player modelled here turns over a face-down card when one is there,
 * plays the waste when it fits, frees a column when it can, and otherwise
 * turns the stock — the moves that are visible from the board rather than the
 * ones that need a plan. `WEIGHTS` says how often they take each.
 *
 * **A rollout is lost when every move leads to a position it has already been
 * in.** That is a stronger definition than a move cap and an exact one: a full
 * lap of the stock arrives back at the position it started from, byte for byte,
 * because turning the pile over preserves its order. So "I have been round the
 * whole pack and nothing has changed" needs no special case — it is the same
 * rule, and it is the one that ends almost every lost run.
 */
export function trapRate(
  start: Klondike,
  rng: Rng,
  rollouts = ROLLOUTS,
  band?: readonly [number, number],
): number {
  let lost = 0;

  for (let i = 0; i < rollouts; i++) {
    if (!naivePlaythrough(start, rng)) lost++;

    // Most deals are not pitched anywhere near the level being built, and a
    // deal that cannot reach the band however the rest of its rollouts go is
    // already answered. Stopping there is most of what this scoring costs.
    if (band) {
      const done = i + 1;
      const floor = lost / rollouts;
      const ceiling = (lost + rollouts - done) / rollouts;
      if (floor > band[1]) return floor;
      if (ceiling < band[0]) return ceiling;
    }
  }

  return lost / rollouts;
}

interface Weighted {
  move: Move;
  weight: number;
}

/** True if this run of naive play went out. */
function naivePlaythrough(start: Klondike, rng: Rng): boolean {
  let state = cloneState(start);
  const seen = new Set<string>([stateKey(state)]);

  for (let step = 0; step < ROLLOUT_CAP; step++) {
    if (isWon(state)) return true;

    const options = naiveOptions(state);
    let advanced = false;

    // Drop an option that only leads somewhere this run has already been, and
    // pick again. Almost always the first pick stands.
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

    if (!advanced) return false;
  }

  return isWon(state);
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

/** Everything this player would consider, and how much they favour each. */
function naiveOptions(state: Klondike): Weighted[] {
  const options: Weighted[] = [];

  for (let from = 0; from < PILES; from++) {
    const pile = state.tableau[from] as Pile;
    const faceUp = pile.cards.length - pile.down;

    for (let count = 1; count <= faceUp; count++) {
      const runStart = pile.cards.length - count;
      if (!isRun(pile.cards, runStart)) break;

      for (let to = 0; to < PILES; to++) {
        const move: Move = { kind: 'move', from, to, count };
        if (!isLegal(state, move)) continue;
        const wholeColumn = count === faceUp;
        const weight = wholeColumn
          ? pile.down > 0
            ? WEIGHTS.flip
            : WEIGHTS.emptyColumn
          : WEIGHTS.shuffle;
        options.push({ move, weight });
      }
    }

    const top = pile.cards[pile.cards.length - 1];
    if (top !== undefined && faceUp > 0) {
      const up: Move = { kind: 'move', from, to: FOUNDATION_0 + suitOf(top), count: 1 };
      if (isLegal(state, up)) options.push({ move: up, weight: WEIGHTS.bank });
    }
  }

  const wasteTop = state.waste[state.waste.length - 1];
  if (wasteTop !== undefined) {
    for (let to = 0; to < PILES; to++) {
      const move: Move = { kind: 'move', from: WASTE, to, count: 1 };
      if (isLegal(state, move)) options.push({ move, weight: WEIGHTS.fromWaste });
    }
    const up: Move = { kind: 'move', from: WASTE, to: FOUNDATION_0 + suitOf(wasteTop), count: 1 };
    if (isLegal(state, up)) options.push({ move: up, weight: WEIGHTS.bank });
  }

  if (isLegal(state, STOCK_MOVE)) options.push({ move: STOCK_MOVE, weight: WEIGHTS.stock });
  return options;
}

/* ------------------------------------------------------------- generation */

export function generateLevel(profileSeed: string, level: number): GeneratedLevel {
  const pressureRng = createRng(hashSeed(profileSeed, 'solitaire', 'pressure', level));
  const pressure = pressureForLevel(level, pressureRng);
  const [lo, hi] = pressure.band;

  let closest: GeneratedLevel | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  let searches = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rng = createRng(hashSeed(profileSeed, 'solitaire', level, attempt));
    const deck = rng.shuffle(orderedDeck());
    const start = deal(deck);
    if (isWon(start)) continue;

    const difficulty = trapRate(start, rng, ROLLOUTS, pressure.band);
    const distance = difficulty < lo ? lo - difficulty : difficulty > hi ? difficulty - hi : 0;

    // Once the search budget for this level is spent, the only thing still
    // worth paying for is having *something* to hand back.
    const worthSearching =
      searches < MAX_SEARCHES ? distance === 0 || distance < closestDistance : closest === null;
    if (!worthSearching) continue;

    searches++;
    const result = solve(start, { budget: VERIFY_BUDGET });
    if (result.status !== 'solved') continue;

    const candidate: GeneratedLevel = {
      level,
      deck,
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
  throw new Error(`Unable to generate a solvable Solitaire level ${level}`);
}

/** Rebuilds the board a level number stands for. Pure, and the same everywhere. */
export const boardFor = (generated: GeneratedLevel): Klondike => deal(generated.deck);
