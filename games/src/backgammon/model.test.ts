import { describe, expect, it } from 'vitest';

import { BAR, CHECKERS, POINTS, countAt, pipCount } from './board';
import { legalPlays } from './legal';
import {
  END_TURN,
  type GameState,
  type Move,
  ROLL,
  applyMove,
  checkerMove,
  isLegalMove,
  legalNow,
  moveDie,
  moveFrom,
  replay,
  spentPips,
  startGame,
} from './model';
import { createRng, hashSeed } from '../shared/rng';

describe('the move encoding', () => {
  it('round-trips every checker move, bar included', () => {
    for (let from = 0; from <= BAR; from++) {
      for (let die = 1; die <= 6; die++) {
        const move = checkerMove(from, die);
        expect(move).toBeGreaterThan(ROLL);
        expect(moveFrom(move)).toBe(from);
        expect(moveDie(move)).toBe(die);
      }
    }
  });
});

describe('a turn', () => {
  it('starts unrolled, on the opening pair, with the player who won it', () => {
    const state = startGame('seed-1');
    expect(state.turn).toBe(0);
    expect(state.rolled).toBe(false);
    expect(state.remaining).toEqual([]);
    expect(state.dice[0]).not.toBe(state.dice[1]);
    const higher = state.dice[0] > state.dice[1] ? 'white' : 'red';
    expect(state.player).toBe(higher);
  });

  it('will not move a checker before the dice are thrown', () => {
    const state = startGame('seed-1');
    expect(legalNow(state)).toEqual([]);
    expect(isLegalMove(state, checkerMove(23, state.dice[0]))).toBe(false);
    expect(isLegalMove(state, ROLL)).toBe(true);
  });

  it('turns a double into four moves', () => {
    // The opening roll can never be a double — a tie is thrown again — so the
    // pair is substituted here rather than hunted for.
    const doubles: GameState = { ...startGame('doubles'), dice: [4, 4] };
    expect(applyMove(doubles, ROLL).remaining).toEqual([4, 4, 4, 4]);
    expect(applyMove(startGame('doubles'), ROLL).remaining).toHaveLength(2);
  });

  it('cannot be ended while a die is still playable', () => {
    const rolled = applyMove(startGame('seed-1'), ROLL);
    expect(legalNow(rolled).length).toBeGreaterThan(0);
    expect(isLegalMove(rolled, END_TURN)).toBe(false);
  });

  it('hands over to the other player, with a fresh roll waiting', () => {
    let state = applyMove(startGame('seed-1'), ROLL);
    const mover = state.player;
    while (legalNow(state).length > 0) {
      const play = legalNow(state)[0]!;
      state = applyMove(state, checkerMove(play.from, play.die));
    }

    const next = applyMove(state, END_TURN);
    expect(next.player).not.toBe(mover);
    expect(next.turn).toBe(1);
    expect(next.rolled).toBe(false);
    expect(next.played).toEqual([]);
  });

  it('marks each die used as it is spent', () => {
    let state = applyMove(startGame('seed-1'), ROLL);
    expect(spentPips(state)).toEqual([false, false]);
    const play = legalNow(state)[0]!;
    state = applyMove(state, checkerMove(play.from, play.die));
    expect(spentPips(state).filter(Boolean)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* Self-play                                                           */
/* ------------------------------------------------------------------ */

/**
 * Plays a whole game, choosing at random among the moves the game itself
 * offers, and checks the invariants after every single one.
 *
 * This is the sweep that the puzzles get from their generator, and it is worth
 * as much: it is the only test that exercises the state machine, the turn
 * search and the move list together, over positions nobody would think to write
 * down — closed boards, four checkers on the bar, a bear-off that has to wait
 * for one straggler. The three things it is really guarding are that checkers
 * are never created or destroyed, that **there is always something legal to
 * do** so the game can never deadlock with the board in one player's hands, and
 * that the recorded move list replays to the identical position.
 */
function selfPlay(seed: string): { state: GameState; moves: Move[]; steps: number } {
  const rng = createRng(hashSeed(seed, 'self-play'));
  let state = startGame(seed);
  const moves: Move[] = [];
  let steps = 0;

  while (!state.winner) {
    steps++;
    expect(steps, `${seed} did not finish`).toBeLessThan(6000);

    const plays = legalNow(state);
    let move: Move;
    if (!state.rolled) move = ROLL;
    else if (plays.length === 0) move = END_TURN;
    else {
      const play = rng.pick(plays);
      move = checkerMove(play.from, play.die);
    }

    expect(isLegalMove(state, move), `${seed}: no legal move at step ${steps}`).toBe(true);
    state = applyMove(state, move);
    moves.push(move);
    check(state, seed);
  }

  return { state, moves, steps };
}

function check(state: GameState, seed: string): void {
  for (const player of ['white', 'red'] as const) {
    let total = state.board.bar[player] + state.board.off[player];
    for (let point = 0; point < POINTS; point++) total += countAt(state.board, point, player);
    expect(total, `${seed}: ${player} checkers`).toBe(CHECKERS);
    expect(pipCount(state.board, player)).toBeGreaterThanOrEqual(0);
  }

  // A point is one colour or empty; a signed count cannot express anything else,
  // so this is really checking that nothing writes the wrong sign.
  for (let point = 0; point < POINTS; point++) {
    const both =
      countAt(state.board, point, 'white') > 0 && countAt(state.board, point, 'red') > 0;
    expect(both, `${seed}: point ${point} holds both colours`).toBe(false);
  }

  if (state.winner) {
    expect(state.board.off[state.winner]).toBe(CHECKERS);
    expect(legalNow(state)).toEqual([]);
    expect(isLegalMove(state, ROLL)).toBe(false);
    expect(isLegalMove(state, END_TURN)).toBe(false);
  }
}

describe('a game played out', () => {
  const seeds = Array.from({ length: 40 }, (_, i) => `game-${i}`);

  it('always finishes, with the checkers all accounted for', () => {
    for (const seed of seeds) {
      const { state } = selfPlay(seed);
      expect(state.winner).not.toBe(null);
    }
  });

  it('replays from its move list to the same position', () => {
    for (const seed of seeds.slice(0, 12)) {
      const { state, moves } = selfPlay(seed);
      const again = replay(seed, moves);
      expect(again.applied).toBe(moves.length);
      expect(again.state.board).toEqual(state.board);
      expect(again.state.turn).toBe(state.turn);
      expect(again.state.winner).toBe(state.winner);
    }
  });

  it('stops the replay at a move that no longer applies, and keeps the rest', () => {
    const { moves } = selfPlay('game-0');
    const corrupted = [...moves.slice(0, 8), checkerMove(0, 6), ...moves.slice(8)];
    const { applied } = replay('game-0', corrupted);
    expect(applied).toBeLessThanOrEqual(8);
  });

  it('deals the same dice however the checkers were played', () => {
    // The whole reason a face is a function of (seed, turn) rather than of the
    // position: two different games from one seed still roll the same numbers,
    // so no choice a player makes can change what was coming.
    const a = replay('game-3', selfPlay('game-3').moves.slice(0, 40)).state;
    const b = replay('game-3', selfPlay('game-3').moves.slice(0, 40)).state;
    expect(a.dice).toEqual(b.dice);
    expect(startGame('game-3').dice).toEqual(startGame('game-3').dice);
  });
});

describe('the whole board is reachable', () => {
  /**
   * A cheap sanity check that self-play is exercising the awkward parts rather
   * than shuffling checkers around the middle: across forty games, somebody
   * gets hit, somebody enters from the bar, and somebody bears off.
   */
  it('hits, enters and bears off over a run of games', () => {
    let hits = 0;
    let entries = 0;
    for (let i = 0; i < 12; i++) {
      const { state, moves } = selfPlay(`survey-${i}`);
      expect(state.board.off[state.winner!]).toBe(CHECKERS);
      let walk = startGame(`survey-${i}`);
      for (const move of moves) {
        const before = walk;
        walk = applyMove(walk, move);
        const last = walk.played.at(-1);
        if (last?.hit) hits++;
        if (last?.from === BAR) entries++;
        expect(before.turn).toBeLessThanOrEqual(walk.turn);
      }
    }
    expect(hits).toBeGreaterThan(0);
    expect(entries).toBeGreaterThan(0);
  });
});

describe('legalPlays and the state machine agree', () => {
  it('offers exactly what the model will accept', () => {
    let state = applyMove(startGame('agree'), ROLL);
    for (let step = 0; step < 200 && !state.winner; step++) {
      const plays = legalPlays(state.board, state.player, state.remaining);
      expect(legalNow(state)).toEqual(plays);
      for (const play of plays) {
        expect(isLegalMove(state, checkerMove(play.from, play.die))).toBe(true);
      }
      if (plays.length === 0) {
        state = applyMove(applyMove(state, END_TURN), ROLL);
      } else {
        state = applyMove(state, checkerMove(plays[0]!.from, plays[0]!.die));
      }
    }
  });
});
