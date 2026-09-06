/**
 * Backgammon game controller.
 *
 * Owns all state and persistence; knows nothing about the DOM.
 *
 * **This is the only game here with two people in it, and most of what is
 * unusual about this file follows from that.** There is no level to generate,
 * no solver deciding whether a board can be finished, and no difficulty: the
 * opponent is the person holding the other end of the phone. What the
 * collection's rules leave behind still applies — no ads, no servers, nothing
 * locked, nothing bought — and the two house rules that do not survive contact
 * with a second player are these.
 *
 * **Undo takes back checkers, not turns.** In the puzzles undo is unlimited
 * because the board is fully known and rewinding tells you nothing you could
 * not already see. Here the roll is the unknown, and the dice are a pure
 * function of the turn number — which is what makes a save a move list — so an
 * undo that crossed a handover would be an oracle: play, see the reply come up
 * on the board, take your own move back and play it again knowing the answer.
 * So a checker can be picked up and put down for as long as the turn is yours,
 * and pressing the button that hands the board over is what spends it. That is
 * also how it works on a real board.
 *
 * **A turn ends on a tap rather than when the dice run out.** It costs a tap
 * and buys the undo above: the moment the last die is played is not the moment
 * the player has finished looking at what they did.
 *
 * There is no hint, either, and that is a deliberate omission rather than an
 * oversight. Every other game here has one because it is playing against a
 * generated board and a stuck player has nobody to ask. A hint here would be an
 * engine sitting at the table, quietly playing one side better than the other.
 * What it is replaced with is the whole of `legal.ts`: the board shows every
 * legal move and refuses none of them, which is the half of a hint that helps
 * somebody learn the game rather than the half that plays it for them.
 */

import {
  type Player,
  type WinKind,
  BAR,
  OFF,
  OPPONENT,
  allHome,
  pipCount,
  winKind,
} from './board';
import {
  type Play,
  canBearOffFrom,
  dieForTarget,
  legalPlays,
  movableSources,
  targetsFrom,
} from './legal';
import {
  END_TURN,
  type GameState as Position,
  type Move,
  ROLL,
  applyMove,
  checkerMove,
  isCheckerMove,
  isLegalMove,
  replay,
  spentPips,
  startGame,
} from './model';
import {
  type SaveData,
  completeLevel,
  createSaveWriter,
  defaultSave,
  loadSave,
} from '../shared/progress';

export const GAME_ID = 'backgammon';

export type GamePhase = 'loading' | 'playing' | 'finished';

/** What just happened, so the renderer can react rather than only redraw. */
export type Effect =
  | { kind: 'none' }
  | { kind: 'reset' }
  | { kind: 'rolled' }
  | { kind: 'moved'; from: number; to: number; hit: boolean }
  | { kind: 'undo' }
  | { kind: 'turn' }
  | { kind: 'win'; player: Player }
  /** A tap that could not be played, and the one short line saying why. */
  | { kind: 'reject'; note: string };

export interface Tally {
  /** Games finished. An abandoned game is not counted. */
  games: number;
  white: number;
  red: number;
}

export interface GameView {
  phase: GamePhase;
  /** The game being played. Named `level` because the shared chrome asks for it. */
  level: number;
  position: Position | null;
  /** Whose way up the board is drawn. Always the player it belongs to. */
  view: Player;
  legal: Play[];
  /** Points with a move in them, for the marks that say where to look. */
  movable: number[];
  /** The point picked up, or null. BAR counts as a point. */
  selected: number | null;
  /** Where the selected checker may land. May include OFF. */
  targets: number[];
  /** One entry per die of the roll: true once it has been spent. */
  spent: boolean[];
  pips: Record<Player, number>;
  record: Tally;
  canRoll: boolean;
  canUndo: boolean;
  canEnd: boolean;
  /** True when the turn is ending with nothing played, so the button says Pass. */
  isPass: boolean;
  winner: Player | null;
  win: WinKind | null;
  effect: Effect;
}

type Listener = (view: GameView) => void;

export class BackgammonGame {
  /**
   * Seeded with a default rather than left undefined until `start()`, because
   * `subscribe` notifies synchronously and the first render therefore happens
   * before the save has loaded. See `shared/first-render.test.ts`.
   */
  private save: SaveData<Move> = defaultSave<Move>(GAME_ID);
  private writer = createSaveWriter<Move>(GAME_ID);

  private position: Position | null = null;
  /** The game number on screen. Not `save.level`, which runs ahead once one is banked. */
  private displayGame = 1;
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

  /* ------------------------------------------------------------ state */

  private legal(): Play[] {
    const position = this.position;
    if (!position || this.phase !== 'playing' || !position.rolled) return [];
    return legalPlays(position.board, position.player, position.remaining);
  }

  private snapshot(): GameView {
    const position = this.position;
    const legal = this.legal();
    const stats = this.save.stats;
    const winner = position?.winner ?? null;

    return {
      phase: this.phase,
      level: this.displayGame,
      position,
      view: winner ?? position?.player ?? 'white',
      legal,
      movable: movableSources(legal),
      selected: this.selected,
      targets: this.selected === null ? [] : targetsFrom(legal, this.selected),
      spent: position ? spentPips(position) : [],
      pips: {
        white: position ? pipCount(position.board, 'white') : 0,
        red: position ? pipCount(position.board, 'red') : 0,
      },
      record: {
        games: stats.levelsCleared,
        white: stats.whiteWins ?? 0,
        red: stats.redWins ?? 0,
      },
      canRoll: this.phase === 'playing' && position !== null && !position.rolled,
      canUndo: this.phase === 'playing' && isCheckerMove(this.moves.at(-1) ?? END_TURN),
      canEnd: this.phase === 'playing' && position !== null && position.rolled && legal.length === 0,
      isPass: (position?.played.length ?? 0) === 0,
      winner,
      win: position && winner ? winKind(position.board, winner) : null,
      effect: this.effect,
    };
  }

  /** The game's dice come from the profile seed and the game number, nothing else. */
  private seedFor(game: number): string {
    return `${this.save.seed}:${game}`;
  }

  private load(game: number, saved: readonly Move[] = []): void {
    this.phase = 'loading';
    this.displayGame = game;
    this.selected = null;
    this.notify({ kind: 'reset' });

    let position = startGame(this.seedFor(game));
    const moves: Move[] = [];
    for (const move of saved) {
      if (!isLegalMove(position, move)) break;
      position = applyMove(position, move);
      moves.push(move);
    }

    this.position = position;
    this.moves = moves;

    // A saved list that already ends in a win means the bank never landed.
    // Treat it as finished rather than as playable, and bank it now.
    this.phase = position.winner ? 'finished' : 'playing';
    if (position.winner) this.bank(position.winner);
    else this.persist();

    this.autoSelect();
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

  /**
   * Picks a checker up when there is only one it could be.
   *
   * Entering from the bar is the case that matters: nothing else may be touched
   * until the bar is clear, so making the player tap the bar first is asking
   * them to confirm a choice they do not have. It applies to any single-source
   * position for the same reason.
   */
  private autoSelect(): void {
    const sources = movableSources(this.legal());
    this.selected = sources.length === 1 ? (sources[0] as number) : null;
  }

  /* -------------------------------------------------------------- play */

  roll(): void {
    const position = this.position;
    if (this.phase !== 'playing' || !position) return;
    if (!isLegalMove(position, ROLL)) {
      this.notify({ kind: 'reject', note: '' });
      return;
    }

    this.position = applyMove(position, ROLL);
    this.moves.push(ROLL);
    this.autoSelect();
    this.persist();
    this.notify({ kind: 'rolled' });
  }

  /**
   * Taps a point, or the bar.
   *
   * One tap picks a checker up, the next puts it down. Tapping another point
   * you could move from picks that one up instead, and tapping anywhere else
   * puts the checker back — so nothing is ever committed by a stray tap on the
   * far side of the board.
   */
  tapPoint(point: number): void {
    const position = this.position;
    if (this.phase !== 'playing' || !position) return;
    if (!position.rolled) {
      this.notify({ kind: 'reject', note: 'Roll first' });
      return;
    }

    const legal = this.legal();

    if (this.selected !== null) {
      const die = dieForTarget(legal, this.selected, point);
      if (die !== null) {
        this.playMove(this.selected, die);
        return;
      }
    }

    if (legal.some((play) => play.from === point)) {
      this.selected = point;
      this.notify();
      return;
    }

    if (this.selected !== null) {
      this.selected = null;
      this.notify();
      return;
    }

    this.notify({ kind: 'reject', note: this.refusalFor(point) });
  }

  /** Taps the near tray: bear the selected checker off. */
  tapOff(): void {
    const position = this.position;
    if (this.phase !== 'playing' || !position || !position.rolled) return;

    const legal = this.legal();
    if (this.selected !== null && canBearOffFrom(legal, this.selected)) {
      // The smallest die that will do it, which is the exact one where there is
      // one — spending a six to take a checker off the two point throws away
      // four pips the player may want.
      const die = Math.min(
        ...legal
          .filter((play) => play.from === this.selected && play.to === OFF)
          .map((play) => play.die),
      );
      this.playMove(this.selected, die);
      return;
    }

    this.notify({
      kind: 'reject',
      note: allHome(position.board, position.player)
        ? 'No checker to bear off'
        : 'Bring every checker home first',
    });
  }

  private refusalFor(point: number): string {
    const position = this.position;
    if (!position) return '';
    if (position.board.bar[position.player] > 0 && point !== BAR) {
      return 'Enter from the bar first';
    }
    return 'No move from there';
  }

  private playMove(from: number, die: number): void {
    const position = this.position;
    if (this.phase !== 'playing' || !position) return;

    const move = checkerMove(from, die);
    if (!isLegalMove(position, move)) {
      this.notify({ kind: 'reject', note: 'No move from there' });
      return;
    }

    const next = applyMove(position, move);
    const played = next.played.at(-1);
    this.position = next;
    this.moves.push(move);

    if (next.winner) {
      this.selected = null;
      this.phase = 'finished';
      this.bank(next.winner);
      this.notify({ kind: 'win', player: next.winner });
      return;
    }

    this.autoSelect();
    this.persist();
    this.notify({
      kind: 'moved',
      from,
      to: played?.to ?? OFF,
      hit: played?.hit === true,
    });
  }

  /** Hands the board over. Only offered once the roll has nothing left in it. */
  endTurn(): void {
    const position = this.position;
    if (this.phase !== 'playing' || !position) return;
    if (!isLegalMove(position, END_TURN)) {
      this.notify({ kind: 'reject', note: 'Play the dice first' });
      return;
    }

    this.position = applyMove(position, END_TURN);
    this.moves.push(END_TURN);
    this.autoSelect();
    this.persist();
    this.notify({ kind: 'turn' });
  }

  /**
   * Takes back the last checker, replaying the game from its move list rather
   * than keeping a stack of boards. A game is a few hundred integers, so this
   * costs less than the tap that asked for it, and there is only ever one
   * definition of what the position is.
   */
  undo(): void {
    if (this.phase !== 'playing') return;
    const last = this.moves.at(-1);
    if (last === undefined || !isCheckerMove(last)) {
      this.notify({ kind: 'reject', note: 'Nothing to take back' });
      return;
    }

    this.moves = this.moves.slice(0, -1);
    this.position = replay(this.seedFor(this.displayGame), this.moves).state;
    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalUndos: this.save.stats.totalUndos + 1 },
    };
    this.autoSelect();
    this.persist();
    this.notify({ kind: 'undo' });
  }

  /* ------------------------------------------------------------ games */

  /**
   * Banks a finished game.
   *
   * Done the moment the last checker comes off rather than when the players tap
   * past the result, and `inProgress` is cleared in the same breath: a game
   * that is over should be recorded even if the app is closed on the result
   * sheet, and it must not still be on disk to be replayed and counted twice.
   */
  private bank(winner: Player): void {
    const advanced = completeLevel(this.save);
    const wins = {
      whiteWins: advanced.stats.whiteWins ?? 0,
      redWins: advanced.stats.redWins ?? 0,
    };
    if (winner === 'white') wins.whiteWins += 1;
    else wins.redWins += 1;

    this.save = { ...advanced, stats: { ...advanced.stats, ...wins } };
    this.writer.schedule(this.save);
    this.writer.flush();
  }

  /** Moves on from a finished game. */
  advance(): void {
    if (this.phase !== 'finished') return;
    this.load(this.save.level);
  }

  /**
   * Abandons the game in progress and deals the next one.
   *
   * This is what a two-player game has instead of Restart: replaying the same
   * game would deal both players the same dice they have just seen. Nothing is
   * lost by walking away — games are not a ladder, and only finished ones count
   * towards the tally.
   */
  newGame(): void {
    if (this.phase === 'finished') {
      this.advance();
      return;
    }

    this.save = {
      ...this.save,
      level: this.displayGame + 1,
      inProgress: null,
      stats: { ...this.save.stats, totalRestarts: this.save.stats.totalRestarts + 1 },
    };
    this.writer.schedule(this.save);
    this.load(this.save.level);
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
export const NAMES: Record<Player, string> = { white: 'White', red: 'Red' };
export const otherName = (player: Player): string => NAMES[OPPONENT[player]];
