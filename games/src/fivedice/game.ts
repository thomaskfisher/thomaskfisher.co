/**
 * Yahtzee game controller.
 *
 * Owns all state and persistence; knows nothing about the DOM.
 *
 * Two house rules are deliberately absent here, and this is the file where that
 * decision lives.
 *
 * **There is no undo.** In the puzzles, undo exists so that a wrong move is not
 * a punishment; the board is fully known and rewinding tells you nothing you
 * could not already see. Dice are the opposite. Every face in a round is a pure
 * function of (turn, throw, slot) — that is what makes a save a move list and a
 * bug report reproducible — and the consequence is that a rewind is an oracle:
 * throw all five, read the faces, rewind, and throw back only the ones that
 * disappointed you. The information is already spent. A player who undid twice
 * would never lose again and would never enjoy it either. So the throws stand,
 * and what would have been undo is spent instead on the mistake undo was
 * actually protecting against — see below.
 *
 * **There is no restart.** For the same reason, harder: a round replays
 * identically, so restarting one is reading the whole deck. What replaces it is
 * *a new round*, which is free, unnumbered and always one tap away, because
 * rounds are not a ladder and abandoning one costs nothing.
 *
 * What undo was protecting against was the misfire — the stray tap that writes a
 * zero in Yahtzee and spoils a card twenty minutes in. That is a real
 * risk on a phone and it is handled directly: tapping a box selects it and shows
 * what it would pay, and it takes a second, deliberate tap to write it down.
 */

import { type Advice, advise } from './advise';
import {
  CATEGORIES,
  DICE,
  type Move,
  type RoundState,
  type Totals,
  applyMove,
  canScore,
  isFinished,
  isLegalMove,
  previews,
  rerollMove,
  rollsLeft,
  scoreMove,
  startRound,
  totals,
} from './model';
import {
  type SaveData,
  completeLevel,
  createSaveWriter,
  defaultSave,
  loadSave,
} from '../shared/progress';

export const GAME_ID = 'fivedice';

export type GamePhase = 'loading' | 'playing' | 'finished';

/**
 * Which dice the player is holding back, saved alongside the moves.
 *
 * Holds are not moves — they change nothing and can be toggled freely — but they
 * are part of where a player was when they put the phone down, and the house rule
 * is that mid-round state survives being closed rather than just the round
 * number. So the list on disk may end with one of these, above every real move,
 * and it is read back as a hold rather than replayed. Anything the model would
 * reject stays the model's business, and this stays out of its way.
 */
const HOLD_BASE = 64;

/** What just happened, so the renderer can animate rather than snap. */
export type Effect =
  | { kind: 'none' }
  | { kind: 'reset' }
  /** Slots that just changed face. */
  | { kind: 'threw'; slots: number[] }
  | { kind: 'wrote'; category: number; points: number }
  | { kind: 'reject' }
  | { kind: 'hint'; advice: Advice };

export interface Record {
  /** Rounds finished. Abandoned ones are not counted. */
  rounds: number;
  best: number;
  average: number;
}

export interface GameState {
  phase: GamePhase;
  /** The round being played. Named `level` because the shared chrome asks for it. */
  level: number;
  round: RoundState | null;
  /** Per slot: held back from the next throw. */
  held: boolean[];
  throwsLeft: number;
  /** A box tapped once, waiting for the tap that writes it down. */
  selected: number | null;
  /** What each open box would pay for the dice on the table. Null where filled. */
  previews: (number | null)[];
  totals: Totals;
  record: Record;
  canThrow: boolean;
  canWrite: boolean;
  /** Boxes still open. Empty on a finished card. */
  openBoxes: number[];
  effect: Effect;
}

type Listener = (state: GameState) => void;

export class FiveDiceGame {
  /**
   * Seeded with a default rather than left undefined until `start()`, because
   * `subscribe` notifies synchronously and the first render therefore happens
   * before the save has loaded. See `shared/first-render.test.ts`.
   */
  private save: SaveData<Move> = defaultSave<Move>(GAME_ID);
  private writer = createSaveWriter<Move>(GAME_ID);

  private round: RoundState | null = null;
  /** The round number on screen. Not `save.level`, which runs ahead of it once a card is banked. */
  private displayRound = 1;
  private moves: Move[] = [];
  private held: boolean[] = new Array(DICE).fill(false);
  private selected: number | null = null;
  private phase: GamePhase = 'loading';
  private effect: Effect = { kind: 'none' };

  /**
   * The last advice, keyed by the position it was given for.
   *
   * Not a plan — there is nothing to plan, the future is unknown. Advice is a
   * pure function of the position (see `advise.ts`), so this saves a few
   * milliseconds of recomputation and cannot go out of step with anything. It is
   * also why this game cannot have the hint ping-pong the others had to guard
   * against: two answers to the same question are the same answer.
   */
  private advice: { key: string; value: Advice } | null = null;

  private listeners = new Set<Listener>();

  async start(): Promise<void> {
    this.save = await loadSave<Move>(GAME_ID);
    this.loadRound(this.save.level, this.save.inProgress?.moves ?? []);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  private notify(effect: Effect = { kind: 'none' }): void {
    this.effect = effect;
    const state = this.snapshot();
    for (const listener of this.listeners) listener(state);
  }

  private snapshot(): GameState {
    const round = this.round;
    const scores = round?.scores ?? CATEGORIES.map(() => null);
    const throwsLeft = round ? rollsLeft(round) : 0;
    const stats = this.save.stats;

    return {
      phase: this.phase,
      level: this.displayRound,
      round,
      held: [...this.held],
      throwsLeft,
      selected: this.selected,
      previews: round ? previews(round) : CATEGORIES.map(() => null),
      totals: totals(scores),
      record: {
        rounds: stats.levelsCleared,
        best: stats.bestScore ?? 0,
        average: stats.levelsCleared > 0 ? (stats.scoreTotal ?? 0) / stats.levelsCleared : 0,
      },
      canThrow: this.phase === 'playing' && throwsLeft > 0 && this.held.some((hold) => !hold),
      canWrite: this.phase === 'playing' && this.selected !== null,
      openBoxes:
        this.phase === 'playing' && round
          ? CATEGORIES.map((_, index) => index).filter((index) => round.scores[index] === null)
          : [],
      effect: this.effect,
    };
  }

  get settings() {
    return this.save.settings;
  }

  get currentSave(): SaveData<Move> {
    return this.save;
  }

  /** The round's dice come from the profile seed and the round number, nothing else. */
  private seedFor(round: number): string {
    return `${this.save.seed}:${round}`;
  }

  private loadRound(round: number, saved: readonly Move[] = []): void {
    this.phase = 'loading';
    this.displayRound = round;
    this.selected = null;
    this.advice = null;
    this.notify({ kind: 'reset' });

    let state = startRound(this.seedFor(round));
    const moves: Move[] = [];

    // A hold marker only ever sits at the end of the list; anything else there is
    // from a build that wrote the format differently, and is simply ignored.
    for (const move of saved) {
      if (move >= HOLD_BASE) continue;
      if (!isLegalMove(state, move)) break;
      state = applyMove(state, move);
      moves.push(move);
    }

    this.round = state;
    this.moves = moves;
    this.held = new Array(DICE).fill(false);

    const holds = [...saved].reverse().find((move) => move >= HOLD_BASE);
    if (holds !== undefined && rollsLeft(state) > 0) {
      for (let slot = 0; slot < DICE; slot++) {
        this.held[slot] = ((holds - HOLD_BASE) & (1 << slot)) !== 0;
      }
    }

    // A saved list that already fills the card would mean a round was banked and
    // the write never landed. Treat it as finished rather than as playable.
    this.phase = isFinished(state) ? 'finished' : 'playing';
    if (this.phase === 'finished') this.bank(state);
    else this.persist();

    this.notify({ kind: 'reset' });
  }

  private heldMask(): number {
    return this.held.reduce((mask, hold, slot) => (hold ? mask | (1 << slot) : mask), 0);
  }

  private persist(): void {
    // A banked round has already cleared `inProgress`; writing again here would
    // put the finished card back on disk and replay it on the next open.
    if (this.phase === 'finished') return;

    const moves: Move[] = [...this.moves];
    const holds = this.heldMask();
    if (holds) moves.push(HOLD_BASE + holds);

    this.writer.schedule({
      ...this.save,
      inProgress: moves.length > 0 ? { level: this.displayRound, moves } : null,
    });
  }

  /* ---------------------------------------------------------------- play */

  /** Hold a die back, or let it go. Free: holding is not a move. */
  toggleHold(slot: number): void {
    if (this.phase !== 'playing' || !this.round) return;
    if (slot < 0 || slot >= DICE) return;
    // With no throws left there is nothing to hold back from.
    if (rollsLeft(this.round) <= 0) {
      this.notify({ kind: 'reject' });
      return;
    }

    this.held[slot] = !this.held[slot];
    this.persist();
    this.notify();
  }

  /** Throw everything not being held. */
  throwDice(): void {
    const round = this.round;
    if (this.phase !== 'playing' || !round) return;

    const mask = (1 << DICE) - 1 - this.heldMask();
    if (!isLegalMove(round, rerollMove(mask))) {
      this.notify({ kind: 'reject' });
      return;
    }

    const before = [...round.dice];
    this.round = applyMove(round, rerollMove(mask));
    this.moves.push(rerollMove(mask));
    this.selected = null;

    const slots = this.round.dice
      .map((die, slot) => (die === before[slot] && !(mask & (1 << slot)) ? -1 : slot))
      .filter((slot) => slot >= 0);

    // Holding means nothing once the turn's throws are gone, and leaving three
    // dice lit up in the accent colour reads as a decision that is still live.
    if (rollsLeft(this.round) <= 0) this.held = new Array(DICE).fill(false);

    this.persist();
    this.notify({ kind: 'threw', slots });
  }

  /**
   * Taps a box.
   *
   * The first tap selects it and shows what it would pay; a second tap on the
   * same box writes it down. This is what stands in for undo — see the file
   * header — so it is deliberately not configurable and deliberately not
   * skippable on the last turn.
   */
  tapBox(category: number): void {
    const round = this.round;
    if (this.phase !== 'playing' || !round) return;

    if (!canScore(round, category)) {
      this.notify({ kind: 'reject' });
      return;
    }

    if (this.selected === category) {
      this.write(category);
      return;
    }

    this.selected = category;
    this.notify();
  }

  /** Writes the selected box down. The Score button and the second tap both land here. */
  commit(): void {
    if (this.selected === null) {
      this.notify({ kind: 'reject' });
      return;
    }
    this.write(this.selected);
  }

  private write(category: number): void {
    const round = this.round;
    if (this.phase !== 'playing' || !round || !canScore(round, category)) {
      this.notify({ kind: 'reject' });
      return;
    }

    const points = previews(round)[category] ?? 0;
    const next = applyMove(round, scoreMove(category));

    this.round = next;
    this.moves.push(scoreMove(category));
    this.selected = null;
    this.held = new Array(DICE).fill(false);
    this.advice = null;

    if (isFinished(next)) {
      this.phase = 'finished';
      this.bank(next);
    } else {
      this.persist();
    }

    this.notify({ kind: 'wrote', category, points });
  }

  /**
   * Banks a finished card.
   *
   * Done the moment the last box is written rather than when the player taps
   * past the result, and `inProgress` is cleared in the same breath: a card that
   * is over should be recorded even if the app is closed on the result sheet,
   * and it must not still be on disk to be replayed and counted twice.
   */
  private bank(round: RoundState): void {
    const score = totals(round.scores).grand;
    const advanced = completeLevel(this.save);

    this.save = {
      ...advanced,
      stats: {
        ...advanced.stats,
        bestScore: Math.max(advanced.stats.bestScore ?? 0, score),
        scoreTotal: (advanced.stats.scoreTotal ?? 0) + score,
      },
    };

    this.writer.schedule(this.save);
    this.writer.flush();
  }

  /* --------------------------------------------------------------- hint */

  /**
   * What to do with the dice on the table. Free and unlimited.
   *
   * It sets the holds it is recommending rather than only describing them, so
   * "press Hint, then press what it points at" is a complete move. That is also
   * what makes a whole round playable from the Hint button, which is the browser
   * check that exercises generation, input, scoring, persistence and the round
   * advance in one loop.
   */
  requestHint(): Advice | null {
    const round = this.round;
    if (this.phase !== 'playing' || !round) return null;

    const key = `${round.scores.join(',')}|${round.dice.join('')}|${round.rollsUsed}`;
    if (this.advice?.key !== key) {
      const value = advise(round);
      this.advice = value ? { key, value } : null;
    }
    const advice = this.advice?.value;
    if (!advice) return null;

    if (advice.kind === 'roll') {
      this.held = Array.from({ length: DICE }, (_, slot) => advice.keep.includes(slot));
      this.selected = null;
    } else {
      this.selected = advice.category;
    }

    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalHints: this.save.stats.totalHints + 1 },
    };
    this.persist();
    this.notify({ kind: 'hint', advice });
    return advice;
  }

  /* ------------------------------------------------------------- rounds */

  /** Moves on from a finished card. */
  advance(): void {
    if (this.phase !== 'finished') return;
    this.loadRound(this.save.level);
  }

  /**
   * Abandons the round in progress and deals the next one.
   *
   * This is what a dice game has instead of Restart: replaying the same round
   * would hand the player every throw in it. Nothing is lost by walking away —
   * rounds are not a ladder, and only finished ones count towards the record.
   */
  newRound(): void {
    if (this.phase === 'finished') {
      this.advance();
      return;
    }

    this.save = {
      ...this.save,
      level: this.displayRound + 1,
      inProgress: null,
      stats: { ...this.save.stats, totalRestarts: this.save.stats.totalRestarts + 1 },
    };
    this.writer.schedule(this.save);
    this.loadRound(this.save.level);
  }

  goToRound(round: number): void {
    const target = Math.max(1, Math.floor(round));
    this.save = { ...this.save, level: target, inProgress: null };
    this.writer.schedule(this.save);
    this.loadRound(target);
  }

  async replaceSave(save: SaveData<Move>): Promise<void> {
    this.save = save;
    this.writer.schedule(save);
    this.writer.flush();
    this.loadRound(save.level, save.inProgress?.moves ?? []);
    return Promise.resolve();
  }

  /**
   * Notes that the rules sheet has been offered. Not routed through
   * `updateSettings`: it is not a preference, and it must not redraw the board
   * behind the sheet.
   */
  markHowToPlaySeen(): void {
    if (this.save.seenHowToPlay) return;
    this.save = { ...this.save, seenHowToPlay: true };
    this.writer.schedule(this.save);
  }

  updateSettings(patch: Partial<SaveData<Move>['settings']>): void {
    this.save = { ...this.save, settings: { ...this.save.settings, ...patch } };
    this.writer.schedule(this.save);
    this.notify();
  }
}
