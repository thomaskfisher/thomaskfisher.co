/**
 * Sudoku game controller.
 *
 * Owns all state and persistence; knows nothing about the DOM.
 *
 * The saved move list is one packed integer per keypad press — pencil marks
 * included, because both have to come back off in the order they went on. Since
 * generation is deterministic, replaying that list against
 * `(seed, level)` reproduces the sheet exactly, so neither the grid nor the
 * notes are ever written to disk and neither can drift out of step with the
 * other.
 *
 * **There is no losing phase in the rules.** A wrong digit is marked, not
 * refused, and taking it out costs a tap; `lost` here only ever means the
 * optional clock ran out, and even then the move list on disk is still a legal,
 * partly-filled grid.
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
  CELLS,
  type Move,
  type Sheet,
  applyMove,
  conflicts,
  correctCount,
  emptySheet,
  isComplete,
  isSolved,
  packMove,
  unpackMove,
} from './model';
import { type TechniqueId, nextPlacement } from './solve';

export { GAME_ID };

export type GamePhase = 'loading' | 'playing' | 'won' | 'lost';

/** What just happened, so the renderer can flash rather than snap. */
export type Effect =
  | { kind: 'none' }
  | { kind: 'reset' }
  | { kind: 'write'; cell: number; digit: number; wrong: boolean }
  | { kind: 'erase'; cell: number }
  | { kind: 'note'; cell: number }
  | { kind: 'reject'; cell: number }
  | { kind: 'hint'; cell: number; digit: number; because: number[]; technique: TechniqueId }
  | { kind: 'mistake'; cell: number };

export interface GameState {
  phase: GamePhase;
  outOfTime: boolean;
  level: number;
  generated: GeneratedLevel | null;
  /** What is on the board right now. */
  sheet: Sheet;
  /** Cells holding a digit that repeats in one of their units. */
  conflicts: Set<number>;
  /** The cell the keypad writes into, or null. */
  selected: number | null;
  /** Keypad presses write notes rather than answers. */
  pencilMode: boolean;
  /** Blanks still to fill. */
  remaining: number;
  /** Non-given cells holding the right digit. The clock pays out on this. */
  correct: number;
  /** Digits already placed nine times, so the keypad can retire them. */
  finishedDigits: Set<number>;
  moveCount: number;
  canUndo: boolean;
  effect: Effect;
}

type Listener = (state: GameState) => void;

const EMPTY_SHEET: Sheet = {
  grid: new Array<number>(CELLS).fill(0),
  notes: new Array<number>(CELLS).fill(0),
};

export class SudokuGame {
  /**
   * Seeded with a default rather than left undefined until `start()`, because
   * `subscribe` notifies synchronously and the first render happens before the
   * save has loaded. See `shared/first-render.test.ts`.
   */
  private save: SaveData<number> = defaultSave<number>(GAME_ID);
  private writer = createSaveWriter<number>(GAME_ID);
  private source!: LevelSource<GeneratedLevel>;

  private generated: GeneratedLevel | null = null;
  private sheet: Sheet = EMPTY_SHEET;
  private history: Move[] = [];
  private phase: GamePhase = 'loading';
  private outOfTime = false;
  private effect: Effect = { kind: 'none' };
  private selected: number | null = null;
  private pencil = false;

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
    const givens = this.generated?.givens;
    const solution = this.generated?.solution;

    let remaining = 0;
    const tally = new Array<number>(10).fill(0);
    for (let cell = 0; cell < CELLS; cell++) {
      const digit = this.sheet.grid[cell] as number;
      if (digit) tally[digit] = (tally[digit] as number) + 1;
      else remaining++;
    }

    const finishedDigits = new Set<number>();
    for (let digit = 1; digit <= 9; digit++) {
      if ((tally[digit] as number) >= 9) finishedDigits.add(digit);
    }

    return {
      phase: this.phase,
      outOfTime: this.outOfTime,
      level: this.save?.level ?? 1,
      generated: this.generated,
      sheet: this.sheet,
      conflicts: this.generated ? conflicts(this.sheet.grid) : new Set<number>(),
      selected: this.selected,
      pencilMode: this.pencil,
      remaining: this.generated ? remaining : 0,
      correct: givens && solution ? correctCount(this.sheet.grid, solution, givens) : 0,
      finishedDigits,
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
    this.sheet = EMPTY_SHEET;
    this.history = [];
    this.selected = null;
    this.notify({ kind: 'reset' });

    const generated = await this.source.get(level);

    this.generated = generated;
    this.sheet = emptySheet(generated.givens);
    this.history = [];

    // Restore a level in progress. A press that no longer applies is dropped
    // rather than throwing — a corrupt tail should cost the tail, not the level.
    for (const packed of replayMoves) {
      const move = unpackMove(packed);
      if (move.cell < 0 || move.cell >= CELLS) break;
      if (move.value < 0 || move.value > 9) break;
      if (generated.givens[move.cell]) break;
      this.sheet = applyMove(this.sheet, generated.givens, move);
      this.history.push(move);
    }

    this.phase = isSolved(this.sheet.grid) ? 'won' : 'playing';

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

  /**
   * Puts the caret on a cell.
   *
   * A given can be selected even though it cannot be written to: tapping a 7
   * that is already on the board is how a player asks "where are the other
   * sevens", and the renderer lights every matching digit. Refusing the tap
   * would take that away to protect against nothing.
   */
  select(cell: number): void {
    if (this.phase === 'loading' || cell < 0 || cell >= CELLS) return;
    this.selected = this.selected === cell ? null : cell;
    this.notify();
  }

  setPencilMode(on: boolean): void {
    if (this.pencil === on) return;
    this.pencil = on;
    this.notify();
  }

  /**
   * Presses a keypad digit against the selected cell.
   *
   * The digit is written whether or not it is right. Marking a mistake is the
   * board's job — see `conflicts` — and refusing the entry instead would turn
   * the grid into an oracle you could brute-force a digit at a time.
   */
  enter(digit: number): void {
    if (this.phase !== 'playing' || !this.generated) return;

    const cell = this.selected;
    if (cell === null) return;

    if (this.generated.givens[cell]) {
      this.notify({ kind: 'reject', cell });
      return;
    }

    const move: Move = { cell, value: digit, pencil: this.pencil && digit !== 0 };
    const before = this.sheet;
    this.sheet = applyMove(this.sheet, this.generated.givens, move);

    // A press that changed nothing is not a move and does not go in the list —
    // otherwise undo spends taps putting nothing back.
    if (this.sheet === before) return;

    this.history.push(move);

    const solved = isSolved(this.sheet.grid);
    if (solved) this.phase = 'won';

    this.persist();

    if (move.pencil) {
      this.notify({ kind: 'note', cell });
    } else if (digit === 0 || this.sheet.grid[cell] === 0) {
      this.notify({ kind: 'erase', cell });
    } else {
      this.notify({
        kind: 'write',
        cell,
        digit,
        wrong: this.sheet.grid[cell] !== this.generated.solution[cell],
      });
    }
  }

  /** The keypad's erase key. Same path as entering a digit, with value 0. */
  erase(): void {
    this.enter(0);
  }

  undo(): void {
    if (this.history.length === 0 || !this.generated) return;

    this.outOfTime = false;
    this.history.pop();

    // Replayed from the givens rather than inverted. Inverting a pencil toggle
    // is easy; inverting a write that swept a digit out of twenty peers' notes
    // is not, and replaying cannot drift.
    this.sheet = emptySheet(this.generated.givens);
    for (const move of this.history) {
      this.sheet = applyMove(this.sheet, this.generated.givens, move);
    }

    this.phase = isSolved(this.sheet.grid) ? 'won' : 'playing';
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
    this.sheet = emptySheet(this.generated.givens);
    this.history = [];
    this.selected = null;
    this.outOfTime = false;
    this.phase = 'playing';
    this.persist();
    this.notify({ kind: 'reset' });
  }

  /**
   * The next digit reasoning can put on the board. Free and unlimited.
   *
   * **A wrong digit already on the board is pointed out first.** Handing over a
   * deduction that a mistake twenty cells away has already invalidated is worse
   * than useless — the player follows it, the contradiction spreads, and the
   * hint looks broken. Naming the bad cell is the honest answer to "what should
   * I do next", and it is the only thing the hint ever says about a cell the
   * player filled in.
   *
   * There is no cached plan here, and no ping-pong to guard against: every hint
   * *adds* a digit that reasoning has proved, so two answers to the same
   * question are the same answer and no hint can undo the last one. The games
   * with a search behind the hint cache a winning line for exactly that reason.
   */
  requestHint(): { cell: number; digit: number } | null {
    if (this.phase !== 'playing' || !this.generated) return null;

    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalHints: this.save.stats.totalHints + 1 },
    };
    this.persist();

    const mistake = this.findMistake();
    if (mistake !== null) {
      this.selected = mistake;
      this.notify({ kind: 'mistake', cell: mistake });
      return null;
    }

    const next = nextPlacement(this.sheet.grid);
    if (!next) return null;

    this.selected = next.cell;
    this.notify({
      kind: 'hint',
      cell: next.cell,
      digit: next.digit,
      because: next.because,
      technique: next.technique,
    });
    return { cell: next.cell, digit: next.digit };
  }

  /** The first cell holding a digit the answer disagrees with. */
  private findMistake(): number | null {
    const generated = this.generated;
    if (!generated) return null;

    for (let cell = 0; cell < CELLS; cell++) {
      const digit = this.sheet.grid[cell] as number;
      if (!digit || generated.givens[cell]) continue;
      if (digit !== generated.solution[cell]) return cell;
    }
    return null;
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
   * is still a legal, partly-filled grid, so reopening the app puts the player
   * back where they were rather than on a fresh loss.
   */
  loseToTime(): void {
    if (this.phase !== 'playing') return;
    this.outOfTime = true;
    this.phase = 'lost';
    this.notify();
  }
}

/** How many blanks a level opens with — the clock's reward count. */
export function blanksOf(generated: GeneratedLevel): number {
  return CELLS - generated.clues;
}

/** True once every cell holds a digit, right or wrong. Used for the "check" copy. */
export function isFull(state: GameState): boolean {
  return state.generated !== null && isComplete(state.sheet.grid);
}
