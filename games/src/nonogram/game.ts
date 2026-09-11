/**
 * Nonogram game controller.
 *
 * Owns all state and persistence; knows nothing about the DOM.
 *
 * The saved move list is one packed integer per cell touched. Because generation
 * is deterministic, replaying that list against `(seed, level)` reproduces the
 * board exactly, so the grid itself is never written to disk and cannot drift
 * out of step with the clues.
 *
 * **There is no losing phase in the rules.** A wrong cell is marked, not
 * refused, and taking it out costs a tap; `lost` here only ever means the
 * optional clock ran out.
 */

import { LevelSource } from '../shared/levelSource';
import {
  type SaveData,
  completeLevel,
  createSaveWriter,
  defaultSave,
  loadSave,
} from '../shared/progress';
import { GAME_ID, type GeneratedLevel, generateLevel } from './generate';
import {
  type Board,
  Mark,
  type Move,
  applyMove,
  completedLines,
  correctIn,
  emptyBoard,
  isSolved,
  mistakesIn,
  packMove,
  unpackMove,
} from './model';
import { type Line, findMistake, nextDeduction } from './solve';

export { GAME_ID };

export type GamePhase = 'loading' | 'playing' | 'won' | 'lost';

export type Effect =
  | { kind: 'none' }
  | { kind: 'reset' }
  | { kind: 'paint'; cells: number[]; mark: Mark; wrong: boolean }
  | { kind: 'hint'; cell: number; mark: Mark; line: Line }
  | { kind: 'mistake'; cell: number };

export interface GameState {
  phase: GamePhase;
  outOfTime: boolean;
  level: number;
  generated: GeneratedLevel | null;
  board: Board;
  /** What a drag paints: Filled, or Cross. */
  brush: Mark.Filled | Mark.Cross;
  /** Rows and columns whose painted cells already match the picture. */
  done: { rows: Set<number>; cols: Set<number> };
  /** Painted cells that do not belong. */
  mistakes: number;
  /** Correctly painted cells. The clock pays out on this. */
  correct: number;
  /** Painted cells still to find. */
  remaining: number;
  moveCount: number;
  canUndo: boolean;
  effect: Effect;
}

type Listener = (state: GameState) => void;

const EMPTY_BOARD: Board = [];
const NO_LINES = { rows: new Set<number>(), cols: new Set<number>() };

export class NonogramGame {
  /**
   * Seeded with a default rather than left undefined until `start()`, because
   * `subscribe` notifies synchronously and the first render happens before the
   * save has loaded. See `shared/first-render.test.ts`.
   */
  private save: SaveData<number> = defaultSave<number>(GAME_ID);
  private writer = createSaveWriter<number>(GAME_ID);
  private source!: LevelSource<GeneratedLevel>;

  private generated: GeneratedLevel | null = null;
  private board: Board = EMPTY_BOARD;
  private history: Move[] = [];
  private phase: GamePhase = 'loading';
  private outOfTime = false;
  private effect: Effect = { kind: 'none' };
  private brush: Mark.Filled | Mark.Cross = Mark.Filled;

  private listeners = new Set<Listener>();

  async start(): Promise<void> {
    this.save = await loadSave<number>(GAME_ID);
    this.source = this.createSource();
    await this.loadLevel(this.save.level, this.save.inProgress?.moves ?? []);
  }

  private createSource(): LevelSource<GeneratedLevel> {
    return new LevelSource<GeneratedLevel>({
      seed: this.save.seed,
      createWorker: () =>
        new Worker(new URL('./generate.worker.ts', import.meta.url), { type: 'module' }),
      generate: generateLevel,
    });
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
    const generated = this.generated;

    const correct = generated ? correctIn(this.board, generated.picture) : 0;

    return {
      phase: this.phase,
      outOfTime: this.outOfTime,
      level: this.save?.level ?? 1,
      generated,
      board: this.board,
      brush: this.brush,
      done: generated
        ? completedLines(this.board, generated.picture, generated.puzzle)
        : NO_LINES,
      mistakes: generated ? mistakesIn(this.board, generated.picture) : 0,
      correct,
      remaining: generated ? generated.painted - correct : 0,
      moveCount: this.history.length,
      canUndo: this.history.length > 0,
      effect: this.effect,
    };
  }

  get settings() {
    return this.save.settings;
  }

  get currentSave(): SaveData<number> {
    return this.save;
  }

  private async loadLevel(level: number, replayMoves: number[] = []): Promise<void> {
    this.phase = 'loading';
    this.outOfTime = false;
    this.generated = null;
    this.board = EMPTY_BOARD;
    this.history = [];
    this.notify({ kind: 'reset' });

    const generated = await this.source.get(level);

    this.generated = generated;
    this.board = emptyBoard(generated.puzzle);
    this.history = [];

    // Restore a level in progress. A mark that no longer applies is dropped
    // rather than throwing — a corrupt tail should cost the tail, not the level.
    for (const packed of replayMoves) {
      const move = unpackMove(packed);
      if (move.cell < 0 || move.cell >= this.board.length) break;
      if (move.mark !== Mark.Blank && move.mark !== Mark.Filled && move.mark !== Mark.Cross) break;
      this.board = applyMove(this.board, move);
      this.history.push(move);
    }

    this.phase = isSolved(this.board, generated.picture) ? 'won' : 'playing';

    this.source.prefetch(level + 1);
    this.persist();
    this.notify({ kind: 'reset' });
  }

  private persist(): void {
    this.writer.schedule({
      ...this.save,
      inProgress:
        this.history.length > 0
          ? { level: this.save.level, moves: this.history.map(packMove) }
          : null,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Input                                                               */
  /* ------------------------------------------------------------------ */

  setBrush(brush: Mark.Filled | Mark.Cross): void {
    if (this.brush === brush) return;
    this.brush = brush;
    this.notify();
  }

  /**
   * What tapping a cell should do, given the brush.
   *
   * Tapping a cell that already carries the brush's mark clears it, which is the
   * only erase gesture anybody finds without being told. Returned separately
   * from `paint` because a *drag* has to commit one decision and then repeat it
   * — working this out per cell mid-drag is how a swipe across a row ends up
   * alternating on and off.
   */
  markFor(cell: number): Mark {
    return this.board[cell] === this.brush ? Mark.Blank : this.brush;
  }

  /**
   * Paints a run of cells with one mark. A tap is a run of one.
   *
   * The whole run is a single entry in the effect but a separate move each, so
   * undo takes a drag back one cell at a time. That is deliberate: a drag across
   * a fifteen-cell row that goes wrong at the end should not cost the whole row.
   */
  paint(cells: readonly number[], mark: Mark): void {
    if (this.phase !== 'playing' || !this.generated) return;

    const changed: number[] = [];
    for (const cell of cells) {
      if (cell < 0 || cell >= this.board.length) continue;
      if (this.board[cell] === mark) continue;
      const move: Move = { cell, mark };
      this.board = applyMove(this.board, move);
      this.history.push(move);
      changed.push(cell);
    }

    if (changed.length === 0) return;

    const solved = isSolved(this.board, this.generated.picture);
    if (solved) this.phase = 'won';

    const wrong =
      mark === Mark.Filled && changed.some((cell) => !this.generated?.picture[cell]);

    this.persist();
    this.notify({ kind: 'paint', cells: changed, mark, wrong });
  }

  undo(): void {
    if (this.history.length === 0 || !this.generated) return;

    this.outOfTime = false;
    this.history.pop();

    // Replayed from an empty board rather than inverted: replaying cannot drift,
    // and these lists are a few hundred entries at the very most.
    this.board = emptyBoard(this.generated.puzzle);
    for (const move of this.history) this.board = applyMove(this.board, move);

    this.phase = isSolved(this.board, this.generated.picture) ? 'won' : 'playing';
    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalUndos: this.save.stats.totalUndos + 1 },
    };
    this.persist();
    this.notify({ kind: 'reset' });
  }

  restart(): void {
    if (!this.generated) return;
    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalRestarts: this.save.stats.totalRestarts + 1 },
    };
    this.board = emptyBoard(this.generated.puzzle);
    this.history = [];
    this.outOfTime = false;
    this.phase = 'playing';
    this.persist();
    this.notify({ kind: 'reset' });
  }

  /**
   * The next cell reasoning can decide. Free and unlimited.
   *
   * **A painted cell that does not belong is pointed out first.** A nonogram
   * punishes one wrong cell harder than any other puzzle here — everything
   * deduced downstream of it is poisoned — and a deduction offered on top of a
   * contradiction sends the player further into it. Naming the bad cell is the
   * honest answer to "what now", and it is the only thing the hint ever says
   * about a cell the player filled in.
   *
   * No cached plan and no ping-pong to guard against: a deduction is a pure
   * function of the position and every hint decides one more cell, so two
   * answers to the same question are the same answer.
   */
  requestHint(): { cell: number; mark: Mark } | null {
    if (this.phase !== 'playing' || !this.generated) return null;

    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalHints: this.save.stats.totalHints + 1 },
    };
    this.persist();

    const mistake = findMistake(this.board, this.generated.picture);
    if (mistake !== null) {
      this.notify({ kind: 'mistake', cell: mistake });
      return null;
    }

    const next = nextDeduction(this.generated.puzzle, this.board);
    if (!next) return null;

    /*
     * The hint hands over the brush it is asking for.
     *
     * Half of all deductions in a nonogram are "this one is empty", and without
     * this the hint rings a cell, says nothing about which of the two marks it
     * means, and the player paints it — turning a correct hint into a mistake.
     * Switching the brush states the answer in the one place the next tap will
     * read it from.
     */
    this.brush = next.mark === Mark.Cross ? Mark.Cross : Mark.Filled;

    this.notify({ kind: 'hint', cell: next.cell, mark: next.mark, line: next.line });
    return { cell: next.cell, mark: next.mark };
  }

  async advance(): Promise<void> {
    if (this.phase !== 'won') return;
    this.save = completeLevel(this.save);
    this.writer.schedule(this.save);
    await this.loadLevel(this.save.level);
  }

  async replaceSave(save: SaveData<number>): Promise<void> {
    this.save = save;
    this.writer.schedule(save);
    this.writer.flush();
    this.source.dispose();
    this.source = this.createSource();
    await this.loadLevel(save.level, save.inProgress?.moves ?? []);
  }

  /**
   * Notes that the rules sheet has been offered. Not routed through
   * `updateSettings`: it is not a preference, and it must not fire a redraw of
   * the board behind the sheet.
   */
  markHowToPlaySeen(): void {
    if (this.save.seenHowToPlay) return;
    this.save = { ...this.save, seenHowToPlay: true };
    this.writer.schedule(this.save);
  }

  updateSettings(patch: Partial<SaveData<number>['settings']>): void {
    this.save = { ...this.save, settings: { ...this.save.settings, ...patch } };
    this.writer.schedule(this.save);
    this.notify();
  }

  async goToLevel(level: number): Promise<void> {
    const target = Math.max(1, Math.floor(level));
    this.save = { ...this.save, level: target, inProgress: null };
    this.writer.schedule(this.save);
    await this.loadLevel(target);
  }

  /**
   * Ends the level because the clock ran out — the only way this game can be
   * lost. Deliberately not persisted as anything special: the move list on disk
   * is still a legal, partly-painted board.
   */
  loseToTime(): void {
    if (this.phase !== 'playing') return;
    this.outOfTime = true;
    this.phase = 'lost';
    this.notify();
  }
}
