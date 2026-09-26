/**
 * Connections game controller.
 *
 * Owns all state and persistence; knows nothing about the DOM.
 *
 * The saved move list is the guesses, each a 16-bit mask over the board's word
 * order. Everything else — solved groups, mistakes, whether the puzzle is over
 * — is replayed from it, so a reload lands exactly where the player left.
 * The selection and the grid's order are not saved: both are a moment's
 * fiddling, and shuffling is the first thing anybody does on sitting down.
 *
 * **This game can be lost**, on the fourth mistake, as in the original. What
 * the house rules give instead is that losing costs nothing: undo takes a
 * guess back, restart deals the same puzzle again, and nothing remembers.
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
  GROUP_SIZE,
  type Move,
  type Progress,
  type Verdict,
  WORDS,
  indicesOf,
  initialProgress,
  judge,
  maskOf,
  play,
  replay,
} from './model';

export { GAME_ID };

export type GamePhase = 'loading' | 'playing' | 'won' | 'lost';

export type Effect =
  | { kind: 'none' }
  | { kind: 'reset' }
  | { kind: 'select' }
  | { kind: 'shuffle' }
  | { kind: 'guess'; verdict: Verdict; mask: number }
  | { kind: 'hint' };

export interface GameState {
  phase: GamePhase;
  level: number;
  generated: GeneratedLevel | null;
  progress: Progress;
  /** Word indices in the order the grid shows them. Solved words are skipped. */
  order: readonly number[];
  selected: ReadonlySet<number>;
  /** Words the hint has pointed at. */
  hinted: ReadonlySet<number>;
  moveCount: number;
  canUndo: boolean;
  effect: Effect;
}

type Listener = (state: GameState) => void;

const identity = (): number[] => Array.from({ length: WORDS }, (_value, index) => index);

export class ConnectionsGame {
  /**
   * Seeded with a default rather than left undefined until `start()`, because
   * `subscribe` notifies synchronously and the first render happens before the
   * save has loaded. See `shared/first-render.test.ts`.
   */
  private save: SaveData<Move> = defaultSave<Move>(GAME_ID);
  private writer = createSaveWriter<Move>(GAME_ID);
  private source!: LevelSource<GeneratedLevel>;

  private generated: GeneratedLevel | null = null;
  private moves: Move[] = [];
  private progress: Progress = initialProgress();
  private order: number[] = identity();
  private selected = new Set<number>();
  private phase: GamePhase = 'loading';
  private effect: Effect = { kind: 'none' };

  /**
   * The hint's plan: which group it is pointing at, and how many of its words
   * it has shown. Kept until that group is solved rather than re-chosen on
   * every press, so the hint never wanders from one group to another.
   */
  private hintGroup: number | null = null;
  private hintShown = 0;

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
    return {
      phase: this.phase,
      level: this.save?.level ?? 1,
      generated: this.generated,
      progress: this.progress,
      order: this.order,
      selected: new Set(this.selected),
      hinted: new Set(this.hintedWords()),
      moveCount: this.moves.length,
      canUndo: this.moves.length > 0,
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
    this.generated = null;
    this.resetBoard();
    this.notify({ kind: 'reset' });

    const generated = await this.source.get(level);
    this.generated = generated;

    const restored = replay(generated, replayMoves);
    this.moves = restored.moves;
    this.progress = restored.progress;
    this.phase = this.phaseFor();

    this.source.prefetch(level + 1);
    this.persist();
    this.notify({ kind: 'reset' });
  }

  private resetBoard(): void {
    this.moves = [];
    this.progress = initialProgress();
    this.order = identity();
    this.selected.clear();
    this.hintGroup = null;
    this.hintShown = 0;
  }

  private phaseFor(): GamePhase {
    if (!this.generated) return 'loading';
    if (this.progress.won) return 'won';
    if (this.progress.lost) return 'lost';
    return 'playing';
  }

  /**
   * Every write mid-puzzle goes through here. `this.save` never carries the
   * move list itself, so scheduling it directly — for a hint's stats, say —
   * writes `inProgress: null` over the moves and the puzzle restarts on the
   * next launch. That shipped in the first draft and a reload test caught it.
   */
  private persist(): void {
    this.writer.schedule({
      ...this.save,
      inProgress: this.moves.length > 0 ? { level: this.save.level, moves: this.moves.slice() } : null,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Selecting                                                           */
  /* ------------------------------------------------------------------ */

  /** Selects or deselects a word. A fifth selection is refused. */
  toggle(index: number): boolean {
    if (this.phase !== 'playing') return false;
    if (!(this.progress.remaining & (1 << index))) return false;

    if (this.selected.has(index)) this.selected.delete(index);
    else if (this.selected.size >= GROUP_SIZE) return false;
    else this.selected.add(index);

    this.notify({ kind: 'select' });
    return true;
  }

  deselectAll(): void {
    if (this.selected.size === 0) return;
    this.selected.clear();
    this.notify({ kind: 'select' });
  }

  /**
   * Reorders the words still on the grid. Cosmetic, so it may use
   * `Math.random` — nothing about the puzzle depends on where a word sits.
   */
  shuffle(): void {
    if (this.phase !== 'playing') return;
    const order = this.order.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j] as number, order[i] as number];
    }
    this.order = order;
    this.notify({ kind: 'shuffle' });
  }

  /**
   * Checks the four selected words.
   *
   * A repeat of an earlier guess is refused rather than charged, as in the
   * original: the player has already paid for that information once. A wrong
   * guess keeps its selection, so "one away" can be acted on by swapping one
   * word rather than re-picking four.
   */
  submit(): Verdict | null {
    if (this.phase !== 'playing' || !this.generated) return null;
    if (this.selected.size !== GROUP_SIZE) return null;

    const mask = maskOf(this.selected);
    const verdict = judge(this.generated, this.progress, mask);
    const next = play(this.generated, this.progress, mask);

    if (next) {
      this.progress = next;
      this.moves.push(mask);
      if (verdict.kind === 'correct') this.selected.clear();
      this.phase = this.phaseFor();
      this.persist();
    }

    this.notify({ kind: 'guess', verdict, mask });
    return verdict;
  }

  /* ------------------------------------------------------------------ */
  /* Undo, restart, hint                                                 */
  /* ------------------------------------------------------------------ */

  /** Takes the last guess back, right or wrong. */
  undo(): void {
    if (this.moves.length === 0 || !this.generated) return;

    this.moves.pop();
    this.progress = replay(this.generated, this.moves).progress;
    this.selected.clear();
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
    this.resetBoard();
    this.phase = 'playing';
    this.persist();
    this.notify({ kind: 'reset' });
  }

  /**
   * Points at one more word of the easiest unsolved group. Free and unlimited.
   *
   * Once all four are pointed at, the next press selects them — the same "fill
   * it in, don't submit it" line Wordle's hint draws: the player still decides
   * to spend the guess.
   */
  requestHint(): boolean {
    if (this.phase !== 'playing' || !this.generated) return false;

    const groups = this.generated.groups;
    if (this.hintGroup === null || this.progress.solved.includes(this.hintGroup)) {
      const next = groups.findIndex((_group, index) => !this.progress.solved.includes(index));
      if (next === -1) return false;
      this.hintGroup = next;
      this.hintShown = 0;
    }

    if (this.hintShown < GROUP_SIZE) {
      this.hintShown++;
    } else {
      this.selected = new Set(this.hintedWords());
    }

    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalHints: this.save.stats.totalHints + 1 },
    };
    this.persist();
    this.notify({ kind: 'hint' });
    return true;
  }

  private hintedWords(): number[] {
    if (this.hintGroup === null || !this.generated) return [];
    if (this.progress.solved.includes(this.hintGroup)) return [];
    const group = this.generated.groups[this.hintGroup];
    if (!group) return [];
    return indicesOf(group.mask).slice(0, this.hintShown);
  }

  /* ------------------------------------------------------------------ */
  /* Puzzles and settings                                                */
  /* ------------------------------------------------------------------ */

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
    this.persist();
  }

  updateSettings(patch: Partial<SaveData<Move>['settings']>): void {
    this.save = { ...this.save, settings: { ...this.save.settings, ...patch } };
    this.persist();
    this.notify();
  }

  async goToLevel(level: number): Promise<void> {
    const target = Math.max(1, Math.floor(level));
    this.save = { ...this.save, level: target, inProgress: null };
    this.writer.schedule(this.save);
    await this.loadLevel(target);
  }
}
