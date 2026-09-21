/**
 * The piece stream, and the only place difficulty comes from once the speed
 * ramp has hit its floor.
 *
 * **The bag gets meaner, not bigger.** Every other game here is told that
 * difficulty comes from constrained choice rather than from more stuff, and a
 * falling-block game has nowhere to put more stuff: the well is ten wide
 * because a phone is, and a taller one is a longer game rather than a harder
 * one. What is left is *which* pieces arrive. Bias the stream towards the
 * awkward ones and the same well, at the same speed, becomes a different
 * problem — because S and Z cannot be laid flat beside each other, and every
 * pair of them laid badly is a hole.
 *
 * **It is substitution, not reweighting, and that is the safety argument.** The
 * standard seven-bag deals each piece once per seven, which bounds the longest
 * drought at twelve. A naive "weight S and Z up" throws that away: the tail of
 * a geometric distribution will eventually deal thirty pieces with no I in
 * them, and the run ends to a coin rather than to a mistake. So a biased bag is
 * still seven pieces. Some of them are simply swapped — a donor out, a
 * duplicate S or Z in.
 *
 * **The I is never a donor.** It is the only piece that clears four rows and
 * the only one that digs a four-deep well back out, so withholding it does not
 * make the game harder in an interesting way, it makes it arbitrary. Keeping it
 * out of the donor pool means every bag still contains exactly one, the
 * standard twelve-piece drought bound survives intact, and the player always
 * has the tool — what they lose is everything they would rather use it with.
 *
 * **The depth was measured before it was set, and the first design failed.**
 * See the header of `tools/tetris.ts` and the *Tetris* section of the README. The
 * original was one swap with a rising probability, and it moved naive survival
 * by twelve percent, non-monotonically, and stopped moving at all by level 13 —
 * a lever that read as deliberate and did almost nothing. Swapping *more of the
 * bag* rather than swapping *more often* spans 135 pieces down to 70.
 */

import { createRng, hashSeed } from '../shared/rng';
import { J, L, O, PIECE_COUNT, S, T, Z } from './model';

/**
 * The donor pool, in no particular order — it is shuffled.
 *
 * The four pieces that make a stack tidy: the square, the two that cap a
 * staircase, and the one that fills a notch. Not the I. See the header.
 */
const DONORS = [O, J, L, T] as const;

/** The replacements. Neither can lie flat beside itself. */
const NASTY = [S, Z] as const;

/** Every donor gone is the meanest bag there is: one I and six of S and Z. */
export const MAX_SUBSTITUTIONS = DONORS.length;

/**
 * How many of the seven pieces a bag at this level gives up, as a fraction.
 *
 * Fractional so the ramp is smooth: a bag takes the whole part for certain and
 * the remainder as a chance, which spreads four discrete steps across twenty
 * levels instead of lurching between them. This project has a note about not
 * stacking four thresholds at the same pressure; this is the same lesson
 * applied to one lever.
 *
 * Nothing happens for the first three levels — the opening of a run is where a
 * player is finding the controls, and a stream that is already hostile there
 * reads as the game being broken. It passes half depth at about the level the
 * gravity curve hits its floor, and saturates at level 22, so the two levers
 * hand over to each other rather than firing together.
 */
export function biasDepth(level: number): number {
  if (level <= 3) return 0;
  return Math.min(MAX_SUBSTITUTIONS, (level - 3) * 0.22);
}

export interface BagState {
  /** Pieces dealt so far this run. The stream is a pure function of this. */
  dealt: number;
  /**
   * The level at the moment the current bag was opened.
   *
   * It has to be stored rather than read live. A bag is regenerated from its
   * index every time it is looked at — that is what lets a save be a count
   * instead of a generator's internals — so if the level were read live, the
   * line that takes a player from 9 to 10 would re-deal the pieces still
   * sitting in the open bag. The preview would change in front of them, and
   * the piece that arrived would not be the one shown.
   */
  bagLevel: number;
}

export const newBagState = (): BagState => ({ dealt: 0, bagLevel: 1 });

/**
 * One bag of seven, shuffled, with `biasDepth(level)` of it substituted.
 *
 * Seeded on the bag's index rather than carried forward from the last one, so
 * a bag is reproducible on its own and a snapshot needs to store a count rather
 * than a generator's internal state.
 */
export function bagAt(
  profileSeed: string,
  game: number,
  bagIndex: number,
  level: number,
): number[] {
  const rng = createRng(hashSeed(profileSeed, 'tetris', game, 'bag', bagIndex));
  const pieces = rng.shuffle([...Array(PIECE_COUNT).keys()]);

  const depth = biasDepth(level);
  const whole = Math.floor(depth);
  const swaps = whole + (rng.chance(depth - whole) ? 1 : 0);
  if (swaps === 0) return pieces;

  // Shuffled rather than taken in order, so a shallow bag gives up a different
  // piece each time. A bag that always loses its O first is one a player learns
  // to read, and a lever you can plan around is not a difficulty.
  const donors = rng.shuffle([...DONORS]);
  for (const donor of donors.slice(0, swaps)) {
    const at = pieces.indexOf(donor);
    // Cannot miss — the bag is a permutation of all seven, and a donor is only
    // taken once. A silent no-op here would be a difficulty lever that stopped
    // firing, which is the failure this project has had twice.
    if (at === -1) throw new Error(`Bag ${bagIndex} is missing piece ${donor}`);
    pieces[at] = rng.pick(NASTY);
  }

  return pieces;
}

/**
 * The next `count` pieces of the stream, from `state` onward.
 *
 * Deals whole bags and slices. The open bag uses the level it was opened at;
 * bags beyond it are not open yet, so they use the level now — which is the
 * best guess available and the one that will be right unless a line clears
 * first, at which point the preview is only three pieces deep anyway.
 */
export function upcoming(
  profileSeed: string,
  game: number,
  state: BagState,
  level: number,
  count: number,
): number[] {
  const out: number[] = [];
  let index = Math.floor(state.dealt / PIECE_COUNT);
  let offset = state.dealt % PIECE_COUNT;
  let bagLevel = offset === 0 ? level : state.bagLevel;

  while (out.length < count) {
    out.push(...bagAt(profileSeed, game, index, bagLevel).slice(offset));
    bagLevel = level;
    offset = 0;
    index++;
  }

  return out.slice(0, count);
}

/** Takes one piece off the stream and reports the state that follows it. */
export function deal(
  profileSeed: string,
  game: number,
  state: BagState,
  level: number,
): { piece: number; state: BagState } {
  const index = Math.floor(state.dealt / PIECE_COUNT);
  const offset = state.dealt % PIECE_COUNT;
  // A bag is opened by the deal of its first piece, and takes the level as it
  // stands at that moment.
  const bagLevel = offset === 0 ? level : state.bagLevel;
  const piece = bagAt(profileSeed, game, index, bagLevel)[offset]!;

  return { piece, state: { dealt: state.dealt + 1, bagLevel } };
}
