/**
 * Mancala game controller.
 *
 * Owns all state and persistence; knows nothing about the DOM.
 *
 * **The second two-player game here, and it borrows Backgammon's shape**: no
 * level to generate, no solver deciding whether a board can be finished, no
 * difficulty. The opponent is the person holding the other end of the phone,
 * and what the collection's rules leave behind still applies — no ads, no
 * servers, nothing locked, nothing bought.
 *
 * Two things differ from Backgammon, and both come from the same fact: **there
 * is no randomness in this game at all.**
 *
 * **Undo is unlimited.** In Backgammon undo stops at the handover, because the
 * dice are the unknown and an undo that crossed one would be an oracle: play,
 * see the reply, take your own move back knowing the answer. Here both players
 * can already see everything — the board is the whole game — so rewinding tells
 * neither of them anything they could not have worked out. What it does instead
 * is let two people take a move back the way they would across a real board.
 *
 * **Restart is Restart, not New game.** Backgammon has to deal a fresh game
 * rather than replay one, or it would hand both players the dice they have just
 * seen. Twelve pits of four is the same opening every time regardless, so the
 * honest button is the one that just tips the seeds back in.
 *
 * There is no hint, for the reason given in Backgammon's header: every other
 * game here has one because a stuck player has nobody to ask, and a hint at a
 * two-player board is an engine quietly playing one side better than the other.
 */

import {
  type Board,
  type Move,
  type Position,
  type Seat,
  type SowResult,
  OTHER,
  isLegalMove,
  legalMoves,
  openingPosition,
  replay,
  scoreOf,
  step,
  winnerOf,
} from './model';
import {
  type SaveData,
  completeLevel,
  createSaveWriter,
  defaultSave,
  loadSave,
} from '../shared/progress';

export const GAME_ID = 'mancala';

export type GamePhase = 'loading' | 'playing' | 'finished';

/** What just happened, so the renderer can show it rather than snap. */
export type Effect =
  | { kind: 'none' }
  | { kind: 'reset' }
  | { kind: 'sown'; result: SowResult }
  | { kind: 'undo' }
  | { kind: 'win'; winner: Seat | null }
  /** A tap that could not be played, and the one short line saying why. */
  | { kind: 'reject'; note: string };

export interface Tally {
  /** Games finished. An abandoned game is not counted. */
  games: number;
  south: number;
  north: number;
}

export interface GameView {
  phase: GamePhase;
  /** The game being played. Named `level` because the shared chrome asks for it. */
  level: number;
  board: Board;
  turn: Seat;
  /** Pits the player to move may pick up. */
  legal: Move[];
  /** The move just played, for the renderer to animate. Null after a reset. */
  last: SowResult | null;
  scores: Record<Seat, number>;
  record: Tally;
  canUndo: boolean;
  winner: Seat | null;
  effect: Effect;
}

type Listener = (view: GameView) => void;

/** Seat order for the tally in the save. Fixed, because the save outlives the code. */
const SEAT_ORDER: readonly Seat[] = ['south', 'north'];

export class MancalaGame {
  /**
   * Seeded with a default rather than left undefined until `start()`, because
   * `subscribe` notifies synchronously and the first render therefore happens
   * before the save has loaded. See `shared/first-render.test.ts`.
   */
  private save: SaveData<Move> = defaultSave<Move>(GAME_ID);
  private writer = createSaveWriter<Move>(GAME_ID);

  private position: Position = openingPosition();
  /** The game number on screen. Not `save.level`, which runs ahead once one is banked. */
  private displayGame = 1;
  private moves: Move[] = [];
  private last: SowResult | null = null;
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

  /* ------------------------------------------------------------ state */

  private snapshot(): GameView {
    const { board, turn, over } = this.position;
    const stats = this.save.stats;
    const tally = stats.seatScores ?? [];

    return {
      phase: this.phase,
      level: this.displayGame,
      board,
      turn,
      legal: this.phase === 'playing' ? legalMoves(board, turn) : [],
      last: this.last,
      scores: { south: scoreOf(board, 'south'), north: scoreOf(board, 'north') },
      record: {
        games: stats.levelsCleared,
        south: tally[0] ?? 0,
        north: tally[1] ?? 0,
      },
      canUndo: this.phase === 'playing' && this.moves.length > 0,
      winner: over ? winnerOf(board) : null,
      effect: this.effect,
    };
  }

  private load(game: number, saved: readonly Move[] = []): void {
    this.phase = 'loading';
    this.displayGame = game;
    this.last = null;
    this.notify({ kind: 'reset' });

    let position = openingPosition();
    const moves: Move[] = [];
    for (const pit of saved) {
      const played = step(position, pit);
      if (!played) break;
      position = played.position;
      moves.push(pit);
    }

    this.position = position;
    this.moves = moves;

    // A saved list that already ends the game means the bank never landed.
    // Treat it as finished rather than as playable, and bank it now.
    this.phase = position.over ? 'finished' : 'playing';
    if (position.over) this.bank(winnerOf(position.board));
    else this.persist();

    this.notify({ kind: 'reset' });
  }

  private persist(): void {
    // A banked game has already cleared `inProgress`; writing again here would
    // put the finished game back on disk and replay it on the next open.
    if (this.phase === 'finished') return;
    this.writer.schedule({
      ...this.save,
      inProgress: this.moves.length > 0 ? { level: this.displayGame, moves: this.moves } : null,
    });
  }

  /* -------------------------------------------------------------- play */

  /**
   * Picks up a pit.
   *
   * There is nothing to select and nothing to confirm: a pit is a whole move,
   * so one tap plays it. That is why the board can afford to mark every legal
   * pit — the marks are the whole of what a hint would have been, and they cost
   * the player nothing to read.
   */
  tapPit(pit: Move): void {
    if (this.phase !== 'playing') return;

    if (!isLegalMove(this.position.board, this.position.turn, pit)) {
      this.notify({ kind: 'reject', note: this.refusalFor(pit) });
      return;
    }

    const played = step(this.position, pit);
    if (!played) return;

    this.position = played.position;
    this.moves.push(pit);
    this.last = played.result;

    if (played.result.over) {
      this.phase = 'finished';
      const winner = winnerOf(played.result.board);
      this.bank(winner);
      this.notify({ kind: 'win', winner });
      return;
    }

    this.persist();
    this.notify({ kind: 'sown', result: played.result });
  }

  private refusalFor(pit: Move): string {
    const { board, turn } = this.position;
    if ((board[pit] ?? 0) === 0) return 'That pit is empty';
    return `${NAMES[OTHER[turn]]}'s side — ${NAMES[turn]} to play`;
  }

  /**
   * Takes the last move back, replaying from the move list rather than keeping
   * a stack of boards. A whole game is a few dozen integers, so this costs less
   * than the tap that asked for it, and there is only ever one definition of
   * what the position is.
   */
  undo(): void {
    if (this.phase !== 'playing' || this.moves.length === 0) {
      this.notify({ kind: 'reject', note: 'Nothing to take back' });
      return;
    }

    this.moves = this.moves.slice(0, -1);
    this.position = replay(this.moves);
    this.last = null;
    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalUndos: this.save.stats.totalUndos + 1 },
    };
    this.persist();
    this.notify({ kind: 'undo' });
  }

  /* ------------------------------------------------------------ games */

  /**
   * Banks a finished game.
   *
   * Done the moment the last seed lands rather than when the players tap past
   * the result, and `inProgress` is cleared in the same breath: a game that is
   * over should be recorded even if the app is closed on the result sheet, and
   * it must not still be on disk to be replayed and counted twice.
   *
   * A draw counts as a game finished and goes to neither tally, which is the
   * only reading of a draw that leaves the two numbers meaning what they say.
   */
  private bank(winner: Seat | null): void {
    const advanced = completeLevel(this.save);
    const tally = SEAT_ORDER.map((seat, index) => {
      const current = advanced.stats.seatScores?.[index] ?? 0;
      return seat === winner ? current + 1 : current;
    });

    this.save = { ...advanced, stats: { ...advanced.stats, seatScores: tally } };
    this.writer.schedule(this.save);
    this.writer.flush();
  }

  /** Moves on from a finished game. */
  advance(): void {
    if (this.phase !== 'finished') return;
    this.load(this.save.level);
  }

  /**
   * Tips the seeds back in.
   *
   * Unlike Backgammon this really is a restart rather than a fresh deal — the
   * opening is the same twelve pits of four every time — so an abandoned game
   * keeps its number instead of burning one. Only finished games move the
   * counter, and only finished games are counted.
   */
  restart(): void {
    if (this.phase === 'finished') {
      this.advance();
      return;
    }

    this.save = {
      ...this.save,
      inProgress: null,
      stats: { ...this.save.stats, totalRestarts: this.save.stats.totalRestarts + 1 },
    };
    this.writer.schedule(this.save);
    this.load(this.displayGame);
  }

  goToGame(game: number): void {
    const target = Math.max(1, Math.floor(game));
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

/** Both names, in one place, so no string in the UI has to guess. */
export const NAMES: Readonly<Record<Seat, string>> = { south: 'South', north: 'North' };
