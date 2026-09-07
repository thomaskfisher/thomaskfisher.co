/**
 * Does this deal go out, and what is the line?
 *
 * ## Why this is not a search
 *
 * The first version of this file was Solitaire's: depth-first, transposition
 * table, move ordering, node budget. It solved **nothing** — not one deal in
 * forty, at one suit or at two, at any budget. Spider is why. A mid-game
 * position offers something like a hundred legal moves of which two are worth
 * making, and a depth-first search that guesses wrong at move ten spends its
 * entire budget three hundred moves further down a line that was dead before it
 * started. There is no ordering good enough to rescue that shape.
 *
 * So this is a **player**, run over and over. One playout follows a heuristic
 * greedily most of the time and takes something else the rest of the time; if it
 * gets stuck, the next playout starts again from the deal and diverges within a
 * few moves. A hundred of them cost less than one depth-first search did, and
 * they win.
 *
 * ## What that costs, and why it is the right trade
 *
 * A playout that wins *is* a winning line — `generate.ts` replays it and checks
 * — so `solved` means exactly what it means everywhere else in this collection.
 * What is gone is the other answer: playouts can never establish that no line
 * exists, so **there is no `unsolvable` here**, and this file will not pretend
 * otherwise. The promise a player actually needs is the one-directional one: a
 * level is shipped only when a line through it has been found and replayed.
 *
 * The one thing that promise does not buy is Solitaire's trick of using the
 * hint button to announce that a position is dead. Spider does not need it:
 * there is no redeal, so running out really does produce a position with no
 * legal move in it at all, and `isDead` catches that exactly and for free.
 */

import type { Rng } from '../shared/rng';
import { createRng } from '../shared/rng';
import { rankOf, suitOf } from '../shared/cards';
import {
  type Column,
  type Move,
  type Spider,
  applyMove,
  cloneState,
  isRun,
  isWon,
  legalMoves,
  stateKey,
} from './model';

export type SolveResult = { status: 'solved'; moves: Move[] } | { status: 'unknown' };

export interface SolveOptions {
  /** Total moves played across every playout. The whole cost control. */
  budget?: number;
  /** Seeded, so a level is the same board and the same line on every device. */
  seed?: number;
  /** How often a playout takes the move it likes best. The rest is divergence. */
  greed?: number;
}

export const DEFAULT_BUDGET = 90_000;

/** A playout that has gone this far is not going anywhere. */
const PLAYOUT_CAP = 700;

export function solve(start: Spider, options: SolveOptions = {}): SolveResult {
  const budget = options.budget ?? DEFAULT_BUDGET;
  const greed = options.greed ?? 0.78;
  const rng = createRng(options.seed ?? 0x5b1de4);

  let spent = 0;
  while (spent < budget) {
    const attempt = playout(start, rng, greed, budget - spent);
    if (attempt.moves) return { status: 'solved', moves: attempt.moves };

    // A playout that could not make a single move found a position with nothing
    // legal in it, and restarting will find the same thing: the root does not
    // change between attempts. Without this the loop spends nothing, so the
    // budget never runs down and the search never returns — which on a dead
    // board is a frozen tab rather than a slow one.
    if (attempt.steps === 0) break;
    spent += attempt.steps;
  }

  return { status: 'unknown' };
}

/** One game, played to a win or to a standstill. */
function playout(
  start: Spider,
  rng: Rng,
  greed: number,
  allowance: number,
): { moves: Move[] | null; steps: number } {
  let state = cloneState(start);
  const seen = new Set<string>([stateKey(state)]);
  const line: Move[] = [];
  const cap = Math.min(PLAYOUT_CAP, allowance);

  for (let step = 0; step < cap; step++) {
    if (isWon(state)) return { moves: line, steps: step };

    const ranked = rankMoves(state);
    let advanced = false;

    // Drop a move that only leads somewhere this playout has already been, and
    // pick again. Almost always the first pick stands.
    while (ranked.length > 0) {
      const chosen = choose(ranked, rng, greed);
      const next = cloneState(state);
      if (!applyMove(next, ranked[chosen]?.move as Move)) {
        ranked.splice(chosen, 1);
        continue;
      }

      const key = stateKey(next);
      if (seen.has(key)) {
        ranked.splice(chosen, 1);
        continue;
      }

      seen.add(key);
      state = next;
      line.push(ranked[chosen]?.move as Move);
      advanced = true;
      break;
    }

    if (!advanced) return { moves: null, steps: step };
  }

  return { moves: isWon(state) ? line : null, steps: cap };
}

/** Best most of the time, and something near the top the rest of it. */
function choose(ranked: readonly Scored[], rng: Rng, greed: number): number {
  if (ranked.length === 1 || rng.next() < greed) return 0;
  // Rank weights rather than score weights: the scores are on an arbitrary
  // scale and a softmax over them would need a temperature nobody can defend.
  const reach = Math.min(ranked.length, 6);
  let total = 0;
  for (let i = 0; i < reach; i++) total += reach - i;
  let roll = rng.next() * total;
  for (let i = 0; i < reach; i++) {
    roll -= reach - i;
    if (roll <= 0) return i;
  }
  return 0;
}

interface Scored {
  move: Move;
  score: number;
}

/*
 * What a good Spider player is actually looking at, in the order they weigh it.
 *
 * These numbers are the whole solver. They were tuned against `tools/spider.ts`
 * rather than picked: the measure is what share of deals a hundred playouts
 * win, at one suit and at two.
 */
const SCORE = {
  /** Thirteen cards leaving the board. Nothing else is close. */
  completesSet: 120,
  /** Turning a card over is the only thing that reliably changes the board. */
  flipsCard: 14,
  /** An empty column is the most valuable thing in Spider. */
  emptiesColumn: 11,
  /** Landing on your own suit is what keeps a run in one piece. */
  joinsSuit: 6,
  /**
   * Per card of the run already sitting under the landing card.
   *
   * The single most valuable line in this table, and the one the first version
   * was missing entirely. With three eights showing, every move of a seven
   * scored the same — and the whole game is choosing the eight that already has
   * a nine, ten and jack under it. Without this the player scatters its cards
   * across ten columns and finishes a deal with thirty cards still face down.
   */
  perJoinedCard: 1.3,
  /** Landing on a column with cards still buried under it. */
  perBuried: -0.55,
  /** Taking a same-suit run apart to get at what is under it. Rarely right. */
  breaksSuit: -8,
  /** Spending an empty column. Sometimes necessary, never free. */
  usesGap: -4,
  /** Moving a stranger onto a stranger. Mostly rearranging. */
  strangers: -1.5,
  /** Bigger pieces move more of the board at once. */
  perCard: 0.25,
  /** The stock. Above the junk moves and below everything worth doing. */
  deal: 0,
} as const;

function rankMoves(state: Spider): Scored[] {
  const ranked = legalMoves(state).map((move) => ({ move, score: scoreMove(state, move) }));
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

function scoreMove(state: Spider, move: Move): number {
  if (move.kind === 'deal') return SCORE.deal;

  const source = state.columns[move.from] as Column;
  const target = state.columns[move.to] as Column;
  const start = source.cards.length - move.count;
  const head = source.cards[start] as number;

  let score = SCORE.perCard * move.count;

  if (start === 0) score += SCORE.emptiesColumn;
  else if (start === source.down && source.down > 0) score += SCORE.flipsCard;

  const beneath = start > source.down ? (source.cards[start - 1] as number) : -1;
  if (beneath >= 0 && suitOf(beneath) === suitOf(head) && rankOf(beneath) === rankOf(head) + 1) {
    score += SCORE.breaksSuit;
  }

  const landing = target.cards[target.cards.length - 1];
  if (landing === undefined) return score + SCORE.usesGap;

  score += SCORE.perBuried * target.down;
  if (suitOf(landing) !== suitOf(head)) return score + SCORE.strangers;

  score += SCORE.joinsSuit;

  // How much same-suit run the landing card already sits on. This answers both
  // "is this the right eight" and "does this finish a set".
  let runStart = target.cards.length - 1;
  while (runStart > target.down && isRun(target.cards, runStart - 1)) runStart--;
  const joined = target.cards.length - runStart;
  score += SCORE.perJoinedCard * joined;

  if (joined + move.count === 13 && rankOf(target.cards[runStart] as number) === 13) {
    score += SCORE.completesSet;
  }

  return score;
}

/**
 * The next move on a winning line, for the hint button.
 *
 * Callers keep the whole line and follow it. Solving again after every tap can
 * return a different winning order whose opening move undoes the last one,
 * which is how a hint button ends up ping-ponging between two columns forever.
 */
export function findSolution(state: Spider, options: SolveOptions = {}): Move[] | null {
  const result = solve(state, options);
  return result.status === 'solved' ? result.moves : null;
}
