/**
 * Mexican Train game controller.
 *
 * Owns all state and persistence; knows nothing about the DOM.
 *
 * **The third two-player game here, and the first with something to hide.**
 * Backgammon and Mancala can be passed across a table because everything about
 * them is on the board. A hand of dominoes is not, so this one has a curtain:
 * the turn begins with the hand face down and the player taps to lift it. That
 * is the whole of the privacy model, and it is the same one a real table uses.
 *
 * Two consequences follow, and they are both about undo:
 *
 *  - **Undo never crosses a handover.** Taking back a move after the next
 *    player has seen their tiles would be taking back a decision made with
 *    information you did not have.
 *  - **Undo never crosses a draw.** The tile off the boneyard is news. Undoing
 *    past it would let a player peek at the top of the pile, put it back, and
 *    play differently — so `model.ts` moves the undo floor past every draw, and
 *    this file just reads it.
 *
 * Inside a turn undo is free, which matters more here than it sounds: laying a
 * double commits you to answering it, and a player who has not met that rule
 * before will lay one and want the tile back.
 *
 * There is no hint, for the reason given in Backgammon's header. What replaces
 * it is that the tiles you could play are marked, which is the half of a hint
 * that helps somebody learn the game rather than the half that plays it.
 */

import {
  type Move,
  type Play,
  type Position,
  MAX_PLAYERS,
  MIN_PLAYERS,
  applyMove,
  isLegalMove,
  legalPlays,
  mexicanIndex,
  replay,
  scores,
} from './model';
import {
  type SaveData,
  completeLevel,
  createSaveWriter,
  defaultSave,
  loadSave,
} from '../shared/progress';

export const GAME_ID = 'dominoes';

export const DEFAULT_PLAYERS = 3;

/**
 * `handover` is the curtain: the round is live, but the hand is face down until
 * the player whose turn it is says they are the one holding the phone.
 */
export type GamePhase = 'loading' | 'handover' | 'playing' | 'finished';

export type Effect =
  | { kind: 'none' }
  | { kind: 'reset' }
  | { kind: 'played'; tile: number; train: number }
  | { kind: 'drew'; tile: number }
  | { kind: 'undo' }
  | { kind: 'handover' }
  | { kind: 'round'; wentOut: number | null }
  /** A tap that could not be played, and the one short line saying why. */
  | { kind: 'reject'; note: string };

export interface GameView {
  phase: GamePhase;
  /** The round being played. Named `level` because the shared chrome asks for it. */
  level: number;
  position: Position | null;
  /** Whose turn it is. */
  seat: number;
  /** The hand on screen. Empty behind the curtain — nothing to leak. */
  hand: number[];
  /** Tiles in that hand with somewhere to go. */
  playable: number[];
  selected: number | null;
  /** Trains the selected tile may be laid on. */
  targets: number[];
  /** How many tiles everybody holds. Public at a real table, so public here. */
  handCounts: number[];
  boneyard: number;
  canDraw: boolean;
  canPass: boolean;
  canUndo: boolean;
  /** Running totals across rounds. Lowest wins, so these count against you. */
  totals: number[];
  /** This round's pips, once it is over. */
  roundScores: number[] | null;
  effect: Effect;
}

type Listener = (view: GameView) => void;

export const clampPlayers = (value: number): number =>
  Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(value) || DEFAULT_PLAYERS));

export class DominoesGame {
  /**
   * Seeded with a default rather than left undefined until `start()`, because
   * `subscribe` notifies synchronously and the first render therefore happens
   * before the save has loaded. See `shared/first-render.test.ts`.
   */
  private save: SaveData<Move> = defaultSave<Move>(GAME_ID);
  private writer = createSaveWriter<Move>(GAME_ID);

  private position: Position | null = null;
  /** The round number on screen. Not `save.level`, which runs ahead once one is banked. */
  private displayRound = 1;
  private moves: Move[] = [];
  private selected: number | null = null;
  private phase: GamePhase = 'loading';
  private effect: Effect = { kind: 'none' };

  private listeners = new Set<Listener>();

  async start(): Promise<void> {
    this.save = await loadSave<Move>(GAME_ID);
    this.load(this.save.level, this.save.inProgress?.moves ?? []);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  private notify(effect: Effect = { kind: 'none' }): void {
    this.effect = effect;
    const view = this.snapshot();
    for (const listener of this.listeners) listener(view);
  }

  get settings() {
    return this.save.settings;
  }

  get currentSave(): SaveData<Move> {
    return this.save;
  }

  get players(): number {
    return clampPlayers(this.save.settings.players ?? DEFAULT_PLAYERS);
  }

  /* ------------------------------------------------------------ state */

  private plays(): Play[] {
    if (!this.position || this.phase !== 'playing') return [];
    return legalPlays(this.position);
  }

  private snapshot(): GameView {
    const position = this.position;
    const plays = this.plays();
    const players = position?.players ?? this.players;

    // The curtain is not a rendering trick. The hand is withheld from the view
    // itself, so there is nothing on screen to peek at with a devtools panel.
    const revealed = this.phase === 'playing' || this.phase === 'finished';
    const hand = revealed && position ? ((position.hands[position.turn] ?? []).slice()) : [];

    const totals = this.save.stats.seatScores ?? [];

    return {
      phase: this.phase,
      level: this.displayRound,
      position,
      seat: position?.turn ?? 0,
      hand,
      playable: [...new Set(plays.map((play) => play.tile))],
      selected: this.selected,
      targets:
        this.selected === null
          ? []
          : plays.filter((play) => play.tile === this.selected).map((play) => play.train),
      handCounts: position ? position.hands.map((each) => each.length) : [],
      boneyard: position?.boneyard.length ?? 0,
      canDraw: this.phase === 'playing' && position !== null && isLegalMove(position, { kind: 'draw' }),
      canPass: this.phase === 'playing' && position !== null && isLegalMove(position, { kind: 'pass' }),
      canUndo: this.phase === 'playing' && this.moves.length > (position?.undoFloor ?? 0),
      totals: Array.from({ length: players }, (_, index) => totals[index] ?? 0),
      roundScores: this.phase === 'finished' && position ? scores(position) : null,
      effect: this.effect,
    };
  }

  private load(round: number, saved: readonly Move[] = []): void {
    this.phase = 'loading';
    this.displayRound = round;
    this.selected = null;
    this.notify({ kind: 'reset' });

    const players = this.players;
    const { position, applied } = replay(this.save.seed, round, players, saved);

    this.position = position;
    this.moves = applied;

    // A saved list that already ends the round means the bank never landed.
    // Treat it as finished rather than as playable, and bank it now.
    if (position.over) {
      this.phase = 'finished';
      this.bank(position);
    } else {
      this.phase = 'handover';
      this.persist();
    }

    this.notify({ kind: 'reset' });
  }

  private persist(): void {
    // A banked round has already cleared `inProgress`; writing again here would
    // put the finished round back on disk and replay it on the next open.
    if (this.phase === 'finished') return;
    this.writer.schedule({
      ...this.save,
      inProgress: this.moves.length > 0 ? { level: this.displayRound, moves: this.moves } : null,
    });
  }

  /* -------------------------------------------------------------- play */

  /** Lifts the curtain. The one thing that can be done while it is down. */
  reveal(): void {
    if (this.phase !== 'handover') return;
    this.phase = 'playing';
    this.autoSelect();
    this.notify();
  }

  /**
   * Picks the tile up when there is only one it could be.
   *
   * An unanswered double is the case that matters: the board has exactly one
   * open end and the player often has exactly one tile for it, and making them
   * tap it first is asking them to confirm a choice they do not have.
   */
  private autoSelect(): void {
    const tiles = [...new Set(this.plays().map((play) => play.tile))];
    this.selected = tiles.length === 1 ? (tiles[0] as number) : null;
  }

  /**
   * Taps a tile in your hand.
   *
   * A tile with exactly one place to go is played on the spot — there is no
   * choice to confirm, and undo is free inside a turn if the tap was a slip.
   * A tile with several waits for the train.
   */
  tapTile(tile: number): void {
    if (this.phase !== 'playing') return;

    if (this.selected === tile) {
      this.selected = null;
      this.notify();
      return;
    }

    const targets = this.plays().filter((play) => play.tile === tile);
    if (targets.length === 0) {
      this.notify({ kind: 'reject', note: this.refusalFor() });
      return;
    }

    if (targets.length === 1) {
      this.play(tile, (targets[0] as Play).train);
      return;
    }

    this.selected = tile;
    this.notify();
  }

  /** Taps a train. Lays the selected tile there, or says why not. */
  tapTrain(train: number): void {
    if (this.phase !== 'playing') return;

    if (this.selected === null) {
      this.notify({ kind: 'reject', note: 'Pick a tile first' });
      return;
    }

    const match = this.plays().find(
      (play) => play.tile === this.selected && play.train === train,
    );
    if (!match) {
      this.notify({ kind: 'reject', note: this.refusalFor(train) });
      return;
    }

    this.play(match.tile, match.train);
  }

  /** The one short line that says why a tap did nothing. */
  private refusalFor(train?: number): string {
    const position = this.position;
    if (!position) return '';
    if (position.pending) return 'Answer the double first';
    if (train === undefined) return 'Nowhere to play that';

    const target = position.trains[train];
    if (target && target.owner !== null && target.owner !== position.turn && !target.open) {
      return 'That train is not open';
    }
    return 'That tile does not fit there';
  }

  private play(tile: number, train: number): void {
    const position = this.position;
    if (!position) return;

    const move: Move = { kind: 'play', tile, train };
    if (!isLegalMove(position, move)) return;

    const before = position.turn;
    this.apply(move);
    this.selected = null;

    const next = this.position as Position;
    if (next.over) {
      this.finish({ kind: 'round', wentOut: next.wentOut });
      return;
    }

    if (next.turn !== before) {
      this.phase = 'handover';
      this.notify({ kind: 'handover' });
      return;
    }

    this.autoSelect();
    this.notify({ kind: 'played', tile, train });
  }

  /** Takes one tile off the boneyard. Only offered when nothing will go. */
  draw(): void {
    const position = this.position;
    if (this.phase !== 'playing' || !position) return;
    if (!isLegalMove(position, { kind: 'draw' })) {
      this.notify({ kind: 'reject', note: 'You have a tile you can play' });
      return;
    }

    const drawn = position.boneyard[0] as number;
    this.apply({ kind: 'draw' });

    // The turn does not end here even when the tile is no use — see the note on
    // `applyMove`. The player looks at what they drew and taps Pass.
    this.autoSelect();
    this.notify({ kind: 'drew', tile: drawn });
  }

  /** Gives up the turn. Only offered when the boneyard cannot help either. */
  pass(): void {
    const position = this.position;
    if (this.phase !== 'playing' || !position) return;
    if (!isLegalMove(position, { kind: 'pass' })) {
      this.notify({ kind: 'reject', note: 'Draw a tile first' });
      return;
    }

    this.apply({ kind: 'pass' });
    this.selected = null;

    const next = this.position as Position;
    if (next.over) {
      this.finish({ kind: 'round', wentOut: null });
      return;
    }

    this.phase = 'handover';
    this.notify({ kind: 'handover' });
  }

  private apply(move: Move): void {
    const position = this.position as Position;
    this.position = applyMove(position, move, this.moves.length);
    this.moves.push(move);
    this.persist();
  }

  private finish(effect: Effect): void {
    this.selected = null;
    this.phase = 'finished';
    this.bank(this.position as Position);
    this.notify(effect);
  }

  /**
   * Takes back the last tile, replaying from the move list rather than keeping
   * a stack of positions.
   *
   * The floor comes from the model and is never argued with here: it sits above
   * the start of the turn and above every draw, so nothing this undoes was
   * decided with information somebody else has since seen.
   */
  undo(): void {
    const position = this.position;
    if (this.phase !== 'playing' || !position || this.moves.length <= position.undoFloor) {
      this.notify({ kind: 'reject', note: 'Nothing to take back' });
      return;
    }

    this.moves = this.moves.slice(0, -1);
    this.position = replay(this.save.seed, this.displayRound, this.players, this.moves).position;
    this.selected = null;
    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalUndos: this.save.stats.totalUndos + 1 },
    };
    this.autoSelect();
    this.persist();
    this.notify({ kind: 'undo' });
  }

  /* ----------------------------------------------------------- rounds */

  /**
   * Banks a finished round.
   *
   * Done the moment the round ends rather than when the players tap past the
   * result, and `inProgress` is cleared in the same breath: a round that is
   * over should be recorded even if the app is closed on the result sheet, and
   * it must not still be on disk to be replayed and counted twice.
   *
   * The totals are pips *against* each player, so they add up and the lowest
   * wins — which is how the game is scored and is also why they are not called
   * wins anywhere in this file.
   */
  private bank(position: Position): void {
    const advanced = completeLevel(this.save);
    const round = scores(position);
    const previous = advanced.stats.seatScores ?? [];
    // A table that has changed size has no running total worth keeping: the
    // numbers were against a different set of people. Starting over is the only
    // reading of them that is not a lie.
    const carried = previous.length === position.players ? previous : round.map(() => 0);
    const totals = round.map((pips, index) => (carried[index] ?? 0) + pips);

    this.save = { ...advanced, stats: { ...advanced.stats, seatScores: totals } };
    this.writer.schedule(this.save);
    this.writer.flush();
  }

  /** Moves on to the next round, and the next engine down. */
  advance(): void {
    if (this.phase !== 'finished') return;
    this.load(this.save.level);
  }

  /**
   * Deals again.
   *
   * Unlike Mancala this is a fresh deal rather than a restart, for the reason
   * Backgammon deals rather than restarts: replaying the round would hand
   * everybody the tiles they have just seen. An abandoned round is not scored,
   * so it costs the round number and nothing else.
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
    this.load(this.save.level);
  }

  /**
   * Changes how many people are playing.
   *
   * The deal is a function of the table size, so this cannot apply to a round
   * already under way — it deals a new one. The running totals go with it; see
   * `bank`.
   */
  setPlayers(count: number): void {
    const players = clampPlayers(count);
    if (players === this.players) return;

    this.save = {
      ...this.save,
      settings: { ...this.save.settings, players },
      inProgress: null,
      stats: { ...this.save.stats, seatScores: Array.from({ length: players }, () => 0) },
    };
    this.writer.schedule(this.save);
    this.load(this.displayRound);
  }

  goToRound(round: number): void {
    const target = Math.max(1, Math.floor(round));
    this.save = { ...this.save, level: target, inProgress: null };
    this.writer.schedule(this.save);
    this.load(target);
  }

  async replaceSave(save: SaveData<Move>): Promise<void> {
    this.save = save;
    this.writer.schedule(save);
    this.writer.flush();
    this.load(save.level, save.inProgress?.moves ?? []);
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

/** What a seat is called. One-indexed, because nobody is Player 0 at a table. */
export const seatName = (seat: number): string => `Player ${seat + 1}`;

/** Re-exported so the renderer need not reach into the model for one constant. */
export { mexicanIndex };
