/**
 * Calibration harness for Mexican Train.
 *
 * There is no difficulty here to curve — the opponents are the other people
 * holding the phone — so the two things worth measuring are the two that decide
 * whether a round is a game at all:
 *
 * **1. How often a round ends blocked.** Everybody stuck with the boneyard
 * spent and nobody out. It is a real ending in the rules and it still scores,
 * but a game that ends in a shrug half the time is not one anybody plays twice.
 * This is what set `handSize`, and it moved that number the opposite way from
 * the intuition it was written with.
 *
 * **2. How long a round runs.** Counted in turns rather than moves, because a
 * turn is what a player waits through. Forty-something turns across the table
 * is fifteen each at three players, which is about right for a phone.
 *
 * Both sweeps play with a fixed policy — shed the heaviest tile you can, on
 * your own train where there is a choice — which is roughly what somebody
 * sensible does and well short of what somebody good does. Real tables will
 * block less often than these numbers, not more.
 */

import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';

import {
  type Move,
  type Position,
  MAX_PLAYERS,
  MIN_PLAYERS,
  TILE_COUNT,
  applyMove,
  deal,
  handSize,
  isLegalMove,
  legalPlays,
  scores,
  valueOf,
} from '../src/dominoes/model';

const lines: string[] = [];
const log = (line = ''): void => {
  lines.push(line);
  console.log(line);
};

const TRIALS = 300;
const COUNTS = Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i);

/** Shed the heaviest tile you can, on your own train where there is a choice. */
function sensible(position: Position): Move {
  const plays = legalPlays(position);
  if (plays.length > 0) {
    const best = plays.slice().sort((a, b) => {
      const own = Number(b.train === position.turn) - Number(a.train === position.turn);
      return own !== 0 ? own : valueOf(b.tile) - valueOf(a.tile);
    })[0] as { tile: number; train: number };
    return { kind: 'play', ...best };
  }
  if (!position.drawn && position.boneyard.length > 0) return { kind: 'draw' };
  return { kind: 'pass' };
}

interface Shape {
  turns: number;
  blocked: number;
  draws: number;
  held: number;
}

/**
 * Plays `TRIALS` rounds and reports what they looked like.
 *
 * `hand` and `bone` override the shipped deal so the sweeps can ask what would
 * have happened at other settings; passing neither measures the real thing.
 */
function measure(players: number, hand = 0, bone = 0): Shape {
  let turns = 0;
  let blocked = 0;
  let draws = 0;
  let held = 0;

  for (let trial = 0; trial < TRIALS; trial++) {
    let position = deal(`probe-${trial}`, (trial % 10) + 1, players);

    if (hand > 0 || bone > 0) {
      const size = hand || handSize(players);
      const pool = position.hands.flat().concat(position.boneyard);
      position = {
        ...position,
        hands: Array.from({ length: players }, (_, p) => pool.slice(p * size, (p + 1) * size)),
        boneyard: pool.slice(players * size, bone > 0 ? players * size + bone : undefined),
      };
    }

    let moves = 0;
    let seen = 0;
    let previous = -1;

    while (!position.over && moves < 800) {
      if (position.turn !== previous) {
        seen++;
        previous = position.turn;
      }
      const move = sensible(position);
      if (!isLegalMove(position, move)) break;
      if (move.kind === 'draw') draws++;
      position = applyMove(position, move, moves);
      moves++;
    }

    turns += seen;
    if (position.wentOut === null) blocked++;
    held += scores(position).reduce((sum, pips) => sum + pips, 0);
  }

  return {
    turns: turns / TRIALS,
    blocked: blocked / TRIALS,
    draws: draws / TRIALS,
    held: held / TRIALS,
  };
}

const row = (label: string, shape: Shape): string =>
  `${label.padStart(10)}  ${(shape.blocked * 100).toFixed(0).padStart(7)}%  ` +
  `${shape.turns.toFixed(1).padStart(6)}  ${shape.draws.toFixed(1).padStart(6)}  ` +
  `${shape.held.toFixed(0).padStart(5)}`;

const HEAD = `${''.padStart(10)}  blocked   turns   draws   pips`;

describe('Mexican Train calibration', () => {
  it(
    'sweeps the hand size and the boneyard, then reports the shipped settings',
    () => {
      log('## 1. Hand size');
      log();
      log('The number that decides whether a round finishes. Bigger hands do not');
      log('make a longer game, they make a *blocked* one: the tile that would have');
      log('unstuck somebody is in a hand rather than on a train.');
      log();
      for (const players of COUNTS) {
        log(`${players} players`);
        log(HEAD);
        for (const hand of [14, 12, 10, 8, 6]) {
          log(row(`hand ${hand}`, measure(players, hand)));
        }
        log();
      }

      log('## 2. Trimming the boneyard instead');
      log();
      log('The other way to shorten a round, and it runs the wrong way: blocking is');
      log('what happens once the boneyard is empty, so taking tiles out of it buys a');
      log('shorter round by ending more of them in a shrug.');
      log();
      for (const players of COUNTS) {
        log(`${players} players, hand 8`);
        log(HEAD);
        for (const bone of [10, 14, 18, 0]) {
          log(row(bone === 0 ? 'all' : `bone ${bone}`, measure(players, 8, bone)));
        }
        log();
      }

      log('## 3. What ships');
      log();
      log(`Double-nine set, ${TILE_COUNT} tiles, hand of ${handSize(3)} whatever the table size.`);
      log();
      log(HEAD);
      for (const players of COUNTS) {
        log(row(`${players} players`, measure(players)));
      }

      writeFileSync('tools/dominoes.txt', `${lines.join('\n')}\n`);
    },
    600_000,
  );
});
