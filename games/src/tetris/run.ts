/**
 * A run in progress, and every way it can change. Pure, and deliberately
 * ignorant of time.
 *
 * The split with `clock.ts` is the thing to keep hold of: this file knows that
 * gravity moves a piece down one row and locks it if it cannot go, and knows
 * nothing whatever about *when* that happens. So the whole game is testable as
 * a list of actions, a bot can play a thousand runs in a second with no timers
 * in sight, and there is exactly one place — the clock — where a real-time game
 * can go wrong in a way a unit test cannot see.
 *
 * Lock delay lives in the clock for the same reason: "half a second after it
 * comes to rest" is a fact about time. What this file offers instead is
 * `isResting`, and a `lockDown` the clock calls when the wait is over.
 */

import { type BagState, deal, newBagState, upcoming } from './bag';
import {
  HARD_DROP_POINTS,
  SOFT_DROP_POINTS,
  type Piece,
  type Well,
  canPlace,
  collapse,
  dropDistance,
  emptyWell,
  levelOf,
  lineScore,
  lock,
  moved,
  rotated,
  spawnPiece,
} from './model';

/** How many pieces ahead the player can see. See the header of `bag.ts`. */
export const PREVIEW = 3;

export interface Run {
  /** Identifies the piece stream. Both ride in the run so it is self-contained. */
  seed: string;
  game: number;

  well: Well;
  /** The falling piece. Null only once the run is over. */
  piece: Piece | null;
  bag: BagState;

  /** The piece set aside, or null if nothing is. */
  hold: number | null;
  /** Hold has been used for this piece. Cleared by a lock, never by a move. */
  holdUsed: boolean;

  lines: number;
  score: number;
  /** Pieces locked. The run's length, and what the bot measures. */
  placed: number;
  over: boolean;

  /**
   * Pins the level instead of deriving it from lines cleared.
   *
   * Never set in play, and the probe's reason for existing. Bag bias is a
   * function of level and so is gravity, so a sweep that let the level float
   * would be measuring the two levers stirred together — which is how this
   * project has twice calibrated a curve against the wrong thing. Holding it
   * fixed is what lets `tools/tetris.ts` say what the bag alone is worth.
   */
  fixedLevel?: number;
}

export type Action = 'left' | 'right' | 'cw' | 'ccw' | 'soft' | 'hard' | 'hold' | 'gravity';

export type RunEvent =
  | { kind: 'moved' }
  | { kind: 'rotated' }
  | { kind: 'held' }
  /** The piece is down. `lines` is how many rows went with it. */
  | { kind: 'locked'; lines: number; rows: number[]; level: number }
  | { kind: 'over' }
  /** The action was not legal. A nudge, not a penalty. */
  | { kind: 'refused' };

export const levelIn = (run: Run): number => run.fixedLevel ?? levelOf(run.lines);

/** The next `PREVIEW` pieces, as the player will actually receive them. */
export const previewOf = (run: Run): number[] =>
  upcoming(run.seed, run.game, run.bag, levelIn(run), PREVIEW);

/**
 * Takes the next piece off the stream.
 *
 * A spawn that does not fit is a block out and ends the run. The piece is still
 * written into the run so the renderer can show it sitting in the rubble — a
 * game that ends on an empty-looking board teaches nothing about why.
 */
function spawnNext(run: Run, type?: number): Run {
  const drawn =
    type === undefined ? deal(run.seed, run.game, run.bag, levelIn(run)) : null;
  const piece = spawnPiece(drawn ? drawn.piece : type!);
  const bag = drawn ? drawn.state : run.bag;

  return { ...run, piece, bag, holdUsed: false, over: !canPlace(run.well, piece) };
}

/**
 * A fresh run.
 *
 * `fixedLevel` is set here rather than by the caller afterwards, because the
 * first bag is opened by the first deal — which happens inside this function.
 * Pinning the level after the fact would leave the opening bag dealt at level
 * one whatever the sweep asked for, and a probe whose first seven pieces are
 * always unbiased reports a bias that is weaker than it is.
 */
export function startRun(seed: string, game: number, fixedLevel?: number): Run {
  const base: Run = {
    seed,
    game,
    well: emptyWell(),
    piece: null,
    bag: newBagState(),
    hold: null,
    holdUsed: false,
    lines: 0,
    score: 0,
    placed: 0,
    over: false,
    ...(fixedLevel === undefined ? {} : { fixedLevel }),
  };
  return spawnNext(base);
}

/**
 * Puts the piece down, clears what it filled, and brings on the next.
 *
 * Called by gravity when a resting piece runs out of lock delay, and directly
 * by a hard drop. Every path into it is a path out of the player's control, so
 * it is the only place `placed` and `lines` move.
 */
export function lockDown(run: Run): { run: Run; events: RunEvent[] } {
  if (run.over || !run.piece) return { run, events: [] };

  const { well, cleared, toppedOut } = lock(run.well, run.piece);
  const level = levelIn(run);
  const lines = run.lines + cleared.length;
  const score = run.score + lineScore(cleared.length, level);

  const landed: Run = {
    ...run,
    well: collapse(well, cleared),
    lines,
    score,
    placed: run.placed + 1,
  };

  const events: RunEvent[] = [
    { kind: 'locked', lines: cleared.length, rows: cleared, level },
  ];

  // A piece that came to rest without any part of it reaching the well is a
  // well that is full. Checked here rather than at the next spawn so the board
  // on screen when the sheet opens is the board that beat them.
  if (toppedOut) {
    events.push({ kind: 'over' });
    return { run: { ...landed, piece: null, over: true }, events };
  }

  const next = spawnNext(landed);
  if (next.over) events.push({ kind: 'over' });
  return { run: next, events };
}

/**
 * Swaps the falling piece for the held one.
 *
 * Once per piece, which is the rule that keeps hold a decision rather than a
 * way to rummage through the stream. The swapped-in piece arrives at spawn
 * rather than where the old one was: dropping an I into the hole an S was
 * occupying would be a free placement.
 */
function swapHold(run: Run): { run: Run; events: RunEvent[] } {
  if (!run.piece || run.holdUsed) return { run, events: [{ kind: 'refused' }] };

  const outgoing = run.piece.type;
  const incoming = run.hold;
  const next = incoming === null ? spawnNext(run) : spawnNext(run, incoming);
  const held: Run = { ...next, hold: outgoing, holdUsed: true };

  return {
    run: held,
    events: held.over ? [{ kind: 'held' }, { kind: 'over' }] : [{ kind: 'held' }],
  };
}

/**
 * One action against the run.
 *
 * Every action is total: an illegal one returns the run unchanged with a
 * `refused`, rather than throwing. Fingers land on the wrong button and a
 * gravity tick can arrive on the same millisecond a sheet opens.
 */
export function apply(run: Run, action: Action): { run: Run; events: RunEvent[] } {
  if (run.over || !run.piece) return { run, events: [] };
  const piece = run.piece;

  switch (action) {
    case 'left':
    case 'right': {
      const next = moved(run.well, piece, action === 'left' ? -1 : 1, 0);
      return next
        ? { run: { ...run, piece: next }, events: [{ kind: 'moved' }] }
        : { run, events: [{ kind: 'refused' }] };
    }

    case 'cw':
    case 'ccw': {
      const next = rotated(run.well, piece, action === 'cw' ? 1 : -1);
      return next
        ? { run: { ...run, piece: next }, events: [{ kind: 'rotated' }] }
        : { run, events: [{ kind: 'refused' }] };
    }

    case 'soft': {
      const next = moved(run.well, piece, 0, 1);
      if (!next) return { run, events: [{ kind: 'refused' }] };
      return {
        run: { ...run, piece: next, score: run.score + SOFT_DROP_POINTS },
        events: [{ kind: 'moved' }],
      };
    }

    case 'hard': {
      const distance = dropDistance(run.well, piece);
      const dropped: Run = {
        ...run,
        piece: { ...piece, y: piece.y + distance },
        score: run.score + distance * HARD_DROP_POINTS,
      };
      return lockDown(dropped);
    }

    case 'hold':
      return swapHold(run);

    case 'gravity': {
      const next = moved(run.well, piece, 0, 1);
      // Gravity on a resting piece is the lock. The clock only sends this once
      // the lock delay has run out, so there is no second timer here.
      return next
        ? { run: { ...run, piece: next }, events: [{ kind: 'moved' }] }
        : lockDown(run);
    }
  }
}

/** Runs a list of actions in order. The bot, the probe and the tests all use it. */
export function playAll(run: Run, actions: readonly Action[]): Run {
  let current = run;
  for (const action of actions) current = apply(current, action).run;
  return current;
}
