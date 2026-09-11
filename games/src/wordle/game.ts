/**
 * Wordle game controller.
 *
 * Owns all state and persistence; knows nothing about the DOM.
 *
 * The saved move list is the guessed words themselves. Every other game here
 * packs its moves into integers, and this one does not because it has no reason
 * to: six seven-letter strings is forty-two bytes, which is smaller than the
 * indices into a word list would be once they were JSON.
 *
 * **This game can be lost, and the loss is real.** Running out of rows is the
 * whole tension of Wordle and removing it would leave nothing. What the house
 * rules give instead is that losing costs nothing but the level: undo takes a
 * row back, restart deals the same word again, and there is no counter
 * anywhere that remembers.
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
  type Mark,
  type Move,
  type Row,
  isAllowedGuess,
  isWin,
  keyboardMarks,
  lettersKnown,
  markGuess,
  rowsFor,
} from './model';
import { candidateCount, suggest } from './solve';

export { GAME_ID };

export type GamePhase = 'loading' | 'playing' | 'won' | 'lost';

export type Effect =
  | { kind: 'none' }
  | { kind: 'reset' }
  | { kind: 'typing' }
  | { kind: 'submit'; row: number; marks: Mark[] }
  | { kind: 'reject'; reason: 'short' | 'unknown' }
  | { kind: 'hint'; word: string };

export interface GameState {
  phase: GamePhase;
  outOfTime: boolean;
  level: number;
  generated: GeneratedLevel | null;
  /** Rows already submitted, with their colours. */
  rows: Row[];
  /** What is being typed into the next row. */
  draft: string;
  /** The best thing known about each letter, for the keyboard. */
  keys: Map<string, Mark>;
  /** Green letters found. The clock pays out on this. */
  found: number;
  /** Rows left after the one being typed. */
  rowsLeft: number;
  moveCount: number;
  canUndo: boolean;
  effect: Effect;
}

type Listener = (state: GameState) => void;

const NO_KEYS = new Map<string, Mark>();

export class WordleGame {
  /**
   * Seeded with a default rather than left undefined until `start()`, because
   * `subscribe` notifies synchronously and the first render happens before the
   * save has loaded. See `shared/first-render.test.ts`.
   */
  private save: SaveData<Move> = defaultSave<Move>(GAME_ID);
  private writer = createSaveWriter<Move>(GAME_ID);
  private source!: LevelSource<GeneratedLevel>;

  private generated: GeneratedLevel | null = null;
  private guesses: string[] = [];
  private draft = '';
  private phase: GamePhase = 'loading';
  private outOfTime = false;
  private effect: Effect = { kind: 'none' };

  private listeners = new Set<Listener>();

  async start(): Promise<void> {
    this.save = await loadSave<Move>(GAME_ID);
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
    const rows = generated ? rowsFor(this.guesses, generated.answer) : [];

    return {
      phase: this.phase,
      outOfTime: this.outOfTime,
      level: this.save?.level ?? 1,
      generated,
      rows,
      draft: this.draft,
      keys: generated ? keyboardMarks(rows) : NO_KEYS,
      found: generated ? lettersKnown(rows, generated.length) : 0,
      rowsLeft: generated ? generated.tries - this.guesses.length : 0,
      moveCount: this.guesses.length,
      canUndo: this.guesses.length > 0,
      effect: this.effect,
    };
  }

  get settings() {
    return this.save.settings;
  }

  get currentSave(): SaveData<Move> {
    return this.save;
  }

  private async loadLevel(level: number, replayMoves: Move[] = []): Promise<void> {
    this.phase = 'loading';
    this.outOfTime = false;
    this.generated = null;
    this.guesses = [];
    this.draft = '';
    this.notify({ kind: 'reset' });

    const generated = await this.source.get(level);

    this.generated = generated;
    this.guesses = [];

    // Restore a level in progress. A guess that no longer fits — a save written
    // by a build with a different word length — ends the replay rather than
    // throwing: a corrupt tail should cost the tail, not the level.
    for (const guess of replayMoves) {
      if (typeof guess !== 'string') break;
      if (guess.length !== generated.length) break;
      if (this.guesses.length >= generated.tries) break;
      this.guesses.push(guess);
      if (guess === generated.answer) break;
    }

    this.phase = this.phaseFor();

    this.source.prefetch(level + 1);
    this.persist();
    this.notify({ kind: 'reset' });
  }

  private phaseFor(): GamePhase {
    const generated = this.generated;
    if (!generated) return 'loading';
    if (this.guesses.includes(generated.answer)) return 'won';
    if (this.guesses.length >= generated.tries) return 'lost';
    return 'playing';
  }

  private persist(): void {
    this.writer.schedule({
      ...this.save,
      inProgress:
        this.guesses.length > 0 ? { level: this.save.level, moves: this.guesses.slice() } : null,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Typing                                                              */
  /* ------------------------------------------------------------------ */

  type(letter: string): void {
    if (this.phase !== 'playing' || !this.generated) return;
    if (this.draft.length >= this.generated.length) return;
    if (!/^[a-z]$/.test(letter)) return;

    this.draft += letter;
    this.notify({ kind: 'typing' });
  }

  backspace(): void {
    if (this.phase !== 'playing' || this.draft.length === 0) return;
    this.draft = this.draft.slice(0, -1);
    this.notify({ kind: 'typing' });
  }

  /**
   * Submits the row.
   *
   * A word that is not in the list is refused rather than spent, which is the
   * one place this game says no to the player. It has to: a guess is the only
   * resource in Wordle, and letting a typo burn one would be the single most
   * annoying thing the game could do.
   */
  submit(): void {
    if (this.phase !== 'playing' || !this.generated) return;

    if (this.draft.length < this.generated.length) {
      this.notify({ kind: 'reject', reason: 'short' });
      return;
    }

    if (!isAllowedGuess(this.draft)) {
      this.notify({ kind: 'reject', reason: 'unknown' });
      return;
    }

    const word = this.draft;
    this.guesses.push(word);
    this.draft = '';
    this.phase = this.phaseFor();

    this.persist();
    this.notify({
      kind: 'submit',
      row: this.guesses.length - 1,
      marks: markGuess(word, this.generated.answer),
    });
  }

  /**
   * Takes the last row back.
   *
   * Undo in a guessing game is a stronger kindness than it is elsewhere, and it
   * is deliberate: the information a row revealed is still on the board in the
   * player's head either way, so all this really returns is the row itself. It
   * is the difference between a typo-shaped mistake costing a level and costing
   * a tap.
   */
  undo(): void {
    if (this.guesses.length === 0 || !this.generated) return;

    this.outOfTime = false;
    this.guesses.pop();
    this.draft = '';
    this.phase = this.phaseFor();

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
    this.guesses = [];
    this.draft = '';
    this.outOfTime = false;
    this.phase = 'playing';
    this.persist();
    this.notify({ kind: 'reset' });
  }

  /**
   * Types a word that could still be the answer into the row. Free and unlimited.
   *
   * **It fills the row rather than submitting it**, which is the whole
   * difference between a hint and a cheat button. The player still decides
   * whether to spend the guess, and can back the letters out again.
   *
   * No cached plan and no ping-pong: the suggestion is a pure function of the
   * board, so two answers to the same question are the same answer.
   */
  requestHint(): string | null {
    if (this.phase !== 'playing' || !this.generated) return null;

    const rows = rowsFor(this.guesses, this.generated.answer);
    const word = suggest(this.generated.length, rows);
    if (!word) return null;

    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalHints: this.save.stats.totalHints + 1 },
    };
    this.draft = word;
    this.persist();
    this.notify({ kind: 'hint', word });
    return word;
  }

  /** How many words could still be the answer. Shown on the loss sheet only. */
  remainingCandidates(): number {
    if (!this.generated) return 0;
    return candidateCount(this.generated.length, rowsFor(this.guesses, this.generated.answer));
  }

  async advance(): Promise<void> {
    if (this.phase !== 'won') return;
    this.save = completeLevel(this.save);
    this.writer.schedule(this.save);
    await this.loadLevel(this.save.level);
  }

  async replaceSave(save: SaveData<Move>): Promise<void> {
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

  updateSettings(patch: Partial<SaveData<Move>['settings']>): void {
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

  loseToTime(): void {
    if (this.phase !== 'playing') return;
    this.outOfTime = true;
    this.phase = 'lost';
    this.notify();
  }
}

/** True once the board holds the answer. Used by the win sheet's wording. */
export function wonOnRow(state: GameState): number {
  for (let index = 0; index < state.rows.length; index++) {
    if (isWin((state.rows[index] as Row).marks)) return index + 1;
  }
  return 0;
}
