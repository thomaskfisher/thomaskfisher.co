/**
 * Color Sort game controller.
 *
 * Owns all state and persistence; knows nothing about the DOM. The renderer
 * subscribes and redraws on change, which keeps rendering off any timer — these
 * are turn-based games and there is no reason to run an animation loop, or to
 * drain a phone battery the way the games this replaces do.
 */

import {
  type SaveData,
  completeLevel,
  createSaveWriter,
  defaultSave,
  loadSave,
} from '../shared/progress';
import { type GeneratedLevel, generateLevel } from './generate';
import { LevelSource } from '../shared/levelSource';
import {
  type Board,
  type Color,
  type Move,
  type Tube,
  applyMove,
  canonicalKey,
  cloneBoard,
  isComplete,
  isSolved,
  legalMoves,
  topColor,
} from './model';
import { findSolution } from './solve';

export const GAME_ID = 'colorsort';

export type GamePhase = 'loading' | 'playing' | 'won' | 'stuck';

/** What just happened, so the renderer can animate rather than snap. */
export type Effect =
  | { kind: 'none' }
  | { kind: 'pour'; from: number; to: number; amount: number; color: Color }
  | { kind: 'reject'; tube: number }
  | { kind: 'reset' }
  | { kind: 'hint'; move: Move };

export interface GameState {
  phase: GamePhase;
  /**
   * True when the level ended because the clock ran out rather than because of
   * anything on the board. Only ever set while the optional timer is on.
   */
  outOfTime: boolean;
  level: number;
  /**
   * The generated level behind `board`, for anything that needs to know how big
   * a job this is rather than what it currently looks like — the clock sizes
   * itself from `solutionLength`. The other three games have always exposed
   * this; Color Sort did not need it until now.
   */
  generated: GeneratedLevel | null;
  board: Board;
  moveCount: number;
  selected: number | null;
  canUndo: boolean;
  effect: Effect;
}

type Listener = (state: GameState) => void;

export class ColorSortGame {
  /**
   * Seeded with a default rather than left undefined until `start()`.
   *
   * `subscribe` notifies its listener synchronously, so the first render
   * happens before the save has loaded — and anything that reaches through
   * `settings` from inside that listener would hit an undefined save and throw,
   * leaving the game stuck on "Preparing…" forever with no board. The timer's
   * on/off check does exactly that. A default here costs one discarded profile
   * seed and removes the whole class of bug.
   */
  private save: SaveData<Move> = defaultSave<Move>(GAME_ID);
  private writer = createSaveWriter<Move>(GAME_ID);
  private source!: LevelSource<GeneratedLevel>;
  private generated: GeneratedLevel | null = null;

  private board: Board = { tubes: [], height: 4, colors: 0 };
  private moves: Move[] = [];
  private selected: number | null = null;
  private phase: GamePhase = 'loading';
  private outOfTime = false;
  private effect: Effect = { kind: 'none' };


  /** A winning line to follow, keyed by the position it was computed from. */
  private hintPlan: { key: string; moves: Move[] } | null = null;

  private listeners = new Set<Listener>();

  async start(): Promise<void> {
    this.save = await loadSave<Move>(GAME_ID);
    this.source = this.createSource();
    await this.loadLevel(this.save.level, this.save.inProgress?.moves ?? []);
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
    return {
      phase: this.phase,
      outOfTime: this.outOfTime,
      generated: this.generated,
      level: this.save?.level ?? 1,
      board: this.board,
      moveCount: this.moves.length,
      selected: this.selected,
      canUndo: this.moves.length > 0,
      effect: this.effect,
    };
  }

  get settings() {
    return this.save.settings;
  }

  get stats() {
    return this.save.stats;
  }

  get currentSave(): SaveData<Move> {
    return this.save;
  }

  /** Best-known solution length for the current level, for a difficulty readout. */
  get parMoves(): number {
    return this.generated?.solutionLength ?? 0;
  }

  private createSource(): LevelSource<GeneratedLevel> {
    return new LevelSource<GeneratedLevel>({
      seed: this.save.seed,
      createWorker: () =>
        new Worker(new URL('./generate.worker.ts', import.meta.url), { type: 'module' }),
      generate: generateLevel,
    });
  }

  private async loadLevel(level: number, replay: Move[] = []): Promise<void> {
    this.phase = 'loading';
    this.outOfTime = false;
    this.selected = null;
    this.notify({ kind: 'reset' });
    const generated = await this.source.get(level);

    this.generated = generated;
    this.board = cloneBoard(generated.board);
    this.moves = [];
    this.hintPlan = null;

    // Restore a partially played level. Any move that no longer applies is
    // dropped rather than throwing — a corrupt tail should not cost the level.
    for (const move of replay) {
      if (applyMove(this.board, move) > 0) this.moves.push(move);
      else break;
    }

    this.phase = this.evaluatePhase();
    this.source.prefetch(level + 1);
    this.persist();
    this.notify({ kind: 'reset' });
  }

  private evaluatePhase(): GamePhase {
    if (isSolved(this.board)) return 'won';
    return legalMoves(this.board).length === 0 ? 'stuck' : 'playing';
  }

  /**
   * Keeps the cached winning line in step with the board: consume the head when
   * the player plays it, discard the plan when they go their own way.
   */
  private advanceHintPlan(played: Move): void {
    const next = this.hintPlan?.moves[0];
    if (!next || next.from !== played.from || next.to !== played.to) {
      this.hintPlan = null;
      return;
    }
    const remaining = this.hintPlan!.moves.slice(1);
    this.hintPlan = remaining.length
      ? { key: canonicalKey(this.board), moves: remaining }
      : null;
  }

  private persist(): void {
    this.writer.schedule({
      ...this.save,
      inProgress: this.moves.length > 0 ? { level: this.save.level, moves: this.moves } : null,
    });
  }

  /** A tube worth picking up: has liquid, and is not already finished. */
  private isSelectable(index: number): boolean {
    const tube = this.board.tubes[index] as Tube | undefined;
    if (!tube || tube.length === 0) return false;
    return !isComplete(tube, this.board.height);
  }

  tapTube(index: number): void {
    if (this.phase !== 'playing') return;

    if (this.selected === null) {
      if (!this.isSelectable(index)) {
        this.notify({ kind: 'reject', tube: index });
        return;
      }
      this.selected = index;
      this.notify();
      return;
    }

    if (this.selected === index) {
      this.selected = null;
      this.notify();
      return;
    }

    const from = this.selected;
    const color = topColor(this.board.tubes[from] as Tube);
    const amount = applyMove(this.board, { from, to: index });

    if (amount === 0) {
      // Not a legal pour. If the tapped tube could itself be picked up, treat
      // the tap as changing selection rather than as an error — that is what
      // the player almost always meant.
      if (this.isSelectable(index)) {
        this.selected = index;
        this.notify();
      } else {
        this.selected = null;
        this.notify({ kind: 'reject', tube: index });
      }
      return;
    }

    this.moves.push({ from, to: index });
    this.selected = null;
    this.advanceHintPlan({ from, to: index });
    this.phase = this.evaluatePhase();

    this.persist();
    this.notify({ kind: 'pour', from, to: index, amount, color: color as Color });
  }

  undo(): void {
    if (this.moves.length === 0 || !this.generated) return;

    this.moves.pop();
    this.hintPlan = null;
    this.save = { ...this.save, stats: { ...this.save.stats, totalUndos: this.save.stats.totalUndos + 1 } };

    // Replay from the generated board. Undo and the save format are then the
    // same thing — a move list — and neither needs a separate history stack.
    this.board = cloneBoard(this.generated.board);
    for (const move of this.moves) applyMove(this.board, move);

    this.selected = null;
    this.outOfTime = false;
    this.phase = this.evaluatePhase();
    this.persist();
    this.notify({ kind: 'reset' });
  }

  restart(): void {
    if (!this.generated) return;
    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalRestarts: this.save.stats.totalRestarts + 1 },
    };
    this.board = cloneBoard(this.generated.board);
    this.moves = [];
    this.hintPlan = null;
    this.selected = null;
    this.outOfTime = false;
    this.phase = this.evaluatePhase();
    this.persist();
    this.notify({ kind: 'reset' });
  }

  /**
   * The next move on a winning line. Free and unlimited — the solver already
   * computes it, and the games this replaces charge for it.
   *
   * A whole solution is computed once and then followed. Asking the solver for
   * a single move after each pour looks equivalent but is not: two searches
   * from adjacent positions can return different winning lines, and the second
   * line's opening move may undo the first's, so repeated hints ping-pong
   * between two positions forever without ever finishing the board.
   */
  requestHint(): Move | null {
    if (this.phase !== 'playing') return null;

    const key = canonicalKey(this.board);
    if (!this.hintPlan || this.hintPlan.key !== key) {
      const moves = findSolution(this.board);
      this.hintPlan = moves ? { key, moves } : null;
    }

    const move = this.hintPlan?.moves[0];
    if (!move) return null;

    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalHints: this.save.stats.totalHints + 1 },
    };
    this.selected = move.from;
    this.persist();
    this.notify({ kind: 'hint', move });
    return move;
  }


  /** Advances to the next level. Only meaningful once the board is solved. */
  async advance(): Promise<void> {
    if (this.phase !== 'won') return;
    this.save = completeLevel(this.save);
    this.writer.schedule(this.save);
    await this.loadLevel(this.save.level);
  }

  /** Replaces the whole profile, e.g. after pasting a backup code. */
  async replaceSave(save: SaveData<Move>): Promise<void> {
    this.save = save;
    this.writer.schedule(save);
    this.writer.flush();
    this.source.dispose();
    this.source = this.createSource();
    await this.loadLevel(save.level, save.inProgress?.moves ?? []);
  }

  updateSettings(patch: Partial<SaveData<Move>['settings']>): void {
    this.save = { ...this.save, settings: { ...this.save.settings, ...patch } };
    this.writer.schedule(this.save);
    this.notify();
  }

  /** Jump to a specific level. Progress is a number, not a gate. */
  async goToLevel(level: number): Promise<void> {
    const target = Math.max(1, Math.floor(level));
    this.save = { ...this.save, level: target, inProgress: null };
    this.writer.schedule(this.save);
    await this.loadLevel(target);
  }

  /**
   * Ends the level because the clock ran out. See `shared/timer.ts`.
   *
   * Deliberately not persisted as anything special: the move list on disk is
   * still a legal, partly-solved board, so reopening the app puts the player
   * back where they were rather than on a fresh loss. Running out of time is a
   * reason to stop, not a state to save.
   */
  loseToTime(): void {
    if (this.phase !== 'playing') return;
    this.outOfTime = true;
    this.phase = 'stuck';
    this.notify();
  }

}
