/**
 * Connections rules. Pure: no DOM, no randomness.
 *
 * A board is sixteen words and the four groups they split into. A guess is a
 * set of four words, held as a 16-bit mask over the board's word order — which
 * is also the saved move, so a finished level costs a handful of integers.
 *
 * Replaying the move list is the only way state is ever derived: the solved
 * groups, the mistakes, and whether the level is over are all functions of the
 * guesses so far, which is what makes undo and a reload the same operation.
 */

export const GROUPS = 4;
export const GROUP_SIZE = 4;
export const WORDS = GROUPS * GROUP_SIZE;

/** Wrong guesses allowed. The fourth one ends the level, as in the original. */
export const MAX_MISTAKES = 4;

/** A guess: bit i set means word i is in it. Exactly four bits. */
export type Move = number;

export interface Group {
  /** Shown on the solved bar. */
  name: string;
  /** 0 yellow .. 3 purple — easiest first. */
  color: number;
  /** Bank tier of the category, 1..4. */
  tier: number;
  /** Mask of the four words. */
  mask: number;
}

export interface Board {
  /** In the order they are first dealt. */
  words: readonly string[];
  /** Sorted by colour. */
  groups: readonly Group[];
}

export type Verdict =
  | { kind: 'correct'; group: number }
  | { kind: 'one-away' }
  | { kind: 'wrong' }
  /** Already guessed, or overlapping a solved group. Refused, never spent. */
  | { kind: 'repeat' }
  | { kind: 'invalid' };

export interface Progress {
  /** Group indices in the order they were solved. */
  solved: number[];
  mistakes: number;
  /** Every mask guessed so far, right or wrong. */
  guessed: Set<number>;
  /** Words still on the grid. */
  remaining: number;
  won: boolean;
  lost: boolean;
}

export const FULL_MASK = (1 << WORDS) - 1;

export function bitCount(mask: number): number {
  let count = 0;
  let m = mask;
  while (m) {
    m &= m - 1;
    count++;
  }
  return count;
}

export function maskOf(indices: Iterable<number>): number {
  let mask = 0;
  for (const index of indices) mask |= 1 << index;
  return mask;
}

export function indicesOf(mask: number): number[] {
  const out: number[] = [];
  for (let index = 0; index < WORDS; index++) if (mask & (1 << index)) out.push(index);
  return out;
}

export function initialProgress(): Progress {
  return {
    solved: [],
    mistakes: 0,
    guessed: new Set(),
    remaining: FULL_MASK,
    won: false,
    lost: false,
  };
}

/** What a guess would do from here, without doing it. */
export function judge(board: Board, progress: Progress, mask: Move): Verdict {
  if (progress.won || progress.lost) return { kind: 'invalid' };
  if (bitCount(mask) !== GROUP_SIZE || (mask & ~FULL_MASK) !== 0) return { kind: 'invalid' };
  if ((mask & progress.remaining) !== mask) return { kind: 'repeat' };
  if (progress.guessed.has(mask)) return { kind: 'repeat' };

  let best = 0;
  for (let index = 0; index < board.groups.length; index++) {
    const group = board.groups[index] as Group;
    if (group.mask === mask) return { kind: 'correct', group: index };
    best = Math.max(best, bitCount(group.mask & mask));
  }
  return best === GROUP_SIZE - 1 ? { kind: 'one-away' } : { kind: 'wrong' };
}

/**
 * Applies a guess. Returns null for one the game refuses — a repeat, or not
 * four words — which the caller neither records nor charges for.
 */
export function play(board: Board, progress: Progress, mask: Move): Progress | null {
  const verdict = judge(board, progress, mask);
  if (verdict.kind === 'repeat' || verdict.kind === 'invalid') return null;

  const guessed = new Set(progress.guessed);
  guessed.add(mask);

  if (verdict.kind === 'correct') {
    const solved = [...progress.solved, verdict.group];
    const remaining = progress.remaining & ~mask;
    return { ...progress, solved, guessed, remaining, won: solved.length === GROUPS };
  }

  const mistakes = progress.mistakes + 1;
  return { ...progress, guessed, mistakes, lost: mistakes >= MAX_MISTAKES };
}

/**
 * Replays a move list. A move the rules refuse ends the replay, so a corrupt
 * tail costs the tail rather than the level.
 */
export function replay(board: Board, moves: readonly Move[]): { progress: Progress; moves: Move[] } {
  let progress = initialProgress();
  const kept: Move[] = [];
  for (const move of moves) {
    if (typeof move !== 'number') break;
    const next = play(board, progress, move);
    if (!next) break;
    progress = next;
    kept.push(move);
  }
  return { progress, moves: kept };
}
