/**
 * Castle game controller.
 *
 * Owns all state and persistence; knows nothing about the DOM.
 *
 * The saved move list is every placement, removal and Go, one integer each.
 * Generation is deterministic and so is the wave, so replaying that list
 * rebuilds the map, the layout and — if Go was pressed — the outcome, exactly.
 * Nothing about the wave itself is ever stored.
 *
 * Four phases worth naming: `planning` while towers are being placed,
 * `watching` while the wave the player launched is being shown to them, then
 * `won` or `lost`. The outcome is known the instant Go is pressed; `watching`
 * exists only so that the sheet waits for the show to finish, and undo is as
 * available during it as at any other time.
 */

import { LevelSource } from '../shared/levelSource';
import {
  type SaveData,
  completeLevel,
  createSaveWriter,
  defaultSave,
  loadSave,
} from '../shared/progress';
import { type GeneratedLevel, generateLevel } from './generate';
import {
  type GameStateCore,
  type Layout,
  type Move,
  type MoveResult,
  type Outcome,
  type TowerKind,
  EMPTY,
  TOWER_KINDS,
  applyMove,
  createState,
  packMove,
  remaining,
  simulate,
  unpackMove,
} from './model';
import { closestWinner, search } from './solve';

export const GAME_ID = 'castle';

export type GamePhase = 'loading' | 'planning' | 'watching' | 'won' | 'lost';

export type HintTarget =
  | { kind: 'place'; plot: number; tower: TowerKind }
  | { kind: 'remove'; plot: number }
  | { kind: 'go' };

/** What just happened, so the renderer can animate rather than snap. */
export type Effect =
  | { kind: 'none' }
  | { kind: 'reset' }
  | { kind: 'place'; plot: number }
  | { kind: 'remove'; plot: number }
  | { kind: 'reject'; plot: number | null; reason: MoveResult }
  | { kind: 'launch' }
  | { kind: 'hint'; target: HintTarget };

export interface GameState {
  phase: GamePhase;
  level: number;
  generated: GeneratedLevel | null;
  layout: Layout;
  /** Towers still in the tray, per kind. */
  left: number[];
  /** The tray's current choice: what a tap on an empty plot will build. */
  selected: TowerKind;
  /** Set once Go has been pressed, and carries the frames while watching. */
  outcome: Outcome | null;
  moveCount: number;
  canUndo: boolean;
  effect: Effect;
}

type Listener = (state: GameState) => void;

export class CastleGame {
  /**
   * Seeded with a default rather than left undefined until `start()`, because
   * `subscribe` notifies synchronously and the first render happens before the
   * save has loaded. See `shared/first-render.test.ts`.
   */
  private save: SaveData<number> = defaultSave<number>(GAME_ID);
  private writer = createSaveWriter<number>(GAME_ID);
  private source!: LevelSource<GeneratedLevel>;

  private generated: GeneratedLevel | null = null;
  private core: GameStateCore | null = null;
  private history: Move[] = [];
  private outcome: Outcome | null = null;
  private selected: TowerKind = 0;
  private phase: GamePhase = 'loading';
  private effect: Effect = { kind: 'none' };

  /** A winning layout to follow. See `requestHint`. */
  private hintPlan: Layout | null = null;

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
    const layout = this.core?.layout.slice() ?? [];
    return {
      phase: this.phase,
      level: this.save?.level ?? 1,
      generated: this.generated,
      layout,
      left: this.generated ? remaining(this.generated, layout) : [0, 0, 0],
      selected: this.selected,
      outcome: this.outcome,
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

  private async loadLevel(level: number, replay: number[] = []): Promise<void> {
    this.phase = 'loading';
    this.generated = null;
    this.core = null;
    this.outcome = null;
    this.history = [];
    this.notify({ kind: 'reset' });

    const generated = await this.source.get(level);
    this.generated = generated;
    this.core = createState(generated);
    this.hintPlan = null;

    // Restore a level in progress. A move that no longer applies ends the
    // replay rather than throwing: a corrupt tail should cost the tail, not
    // the level.
    for (const packed of replay) {
      const move = unpackMove(packed);
      if (!move || applyMove(generated, this.core, move) !== 'ok') break;
      this.history.push(move);
    }

    // A wave launched before the app closed is not shown again — its result
    // is. The show is a courtesy to someone watching, and nobody was.
    if (this.core.launched) {
      this.outcome = simulate(generated, this.core.layout);
      this.phase = this.outcome.won ? 'won' : 'lost';
    } else {
      this.phase = 'planning';
    }
    this.selected = this.firstAvailable(this.selected);

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

  /** The tray's choice if any are left, otherwise the first kind that has some. */
  private firstAvailable(preferred: TowerKind): TowerKind {
    if (!this.generated || !this.core) return preferred;
    const left = remaining(this.generated, this.core.layout);
    if ((left[preferred] as number) > 0) return preferred;
    for (let kind = 0; kind < TOWER_KINDS; kind++) {
      if ((left[kind] as number) > 0) return kind as TowerKind;
    }
    return preferred;
  }

  private play(move: Move): MoveResult {
    const spec = this.generated;
    const core = this.core;
    if (this.phase !== 'planning' || !spec || !core) return 'launched';
    const result = applyMove(spec, core, move);
    if (result !== 'ok') return result;
    this.history.push(move);
    this.advanceHintPlan();
    return 'ok';
  }

  /** Picks which tower an empty plot will get. Not a move: nothing is saved. */
  select(kind: TowerKind): void {
    if (this.phase !== 'planning' || !this.generated) return;
    if ((remaining(this.generated, this.core?.layout ?? [])[kind] as number) <= 0) {
      this.notify({ kind: 'reject', plot: null, reason: 'none-left' });
      return;
    }
    this.selected = kind;
    this.notify();
  }

  /** A tap on a plot: build the selected tower there, or take one back. */
  tapPlot(plot: number): void {
    const core = this.core;
    if (this.phase !== 'planning' || !core) return;

    if (core.layout[plot] !== EMPTY) {
      const result = this.play({ kind: 'remove', plot });
      if (result !== 'ok') {
        this.notify({ kind: 'reject', plot, reason: result });
        return;
      }
      this.persist();
      this.notify({ kind: 'remove', plot });
      return;
    }

    this.selected = this.firstAvailable(this.selected);
    const result = this.play({ kind: 'place', plot, tower: this.selected });
    if (result !== 'ok') {
      this.notify({ kind: 'reject', plot, reason: result });
      return;
    }
    this.selected = this.firstAvailable(this.selected);
    this.persist();
    this.notify({ kind: 'place', plot });
  }

  /** Launches the wave. The outcome is decided here; the show is decoration. */
  launch(): void {
    const spec = this.generated;
    const core = this.core;
    if (this.phase !== 'planning' || !spec || !core) return;
    if (this.play({ kind: 'go' }) !== 'ok') return;

    this.outcome = simulate(spec, core.layout, true);
    this.phase = 'watching';
    this.persist();
    this.notify({ kind: 'launch' });
  }

  /** The show is over (or was skipped). */
  finishWatching(): void {
    if (this.phase !== 'watching' || !this.outcome) return;
    this.phase = this.outcome.won ? 'won' : 'lost';
    this.notify();
  }

  undo(): void {
    const spec = this.generated;
    if (this.history.length === 0 || !spec) return;

    this.history.pop();
    this.hintPlan = null;
    this.outcome = null;

    // Replayed from the start rather than unwound: these lists are a dozen
    // integers, and replaying cannot drift.
    this.core = createState(spec);
    for (const move of this.history) applyMove(spec, this.core, move);
    this.phase = 'planning';
    this.selected = this.firstAvailable(this.selected);

    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalUndos: this.save.stats.totalUndos + 1 },
    };
    this.persist();
    this.notify({ kind: 'reset' });
  }

  restart(): void {
    const spec = this.generated;
    if (!spec) return;
    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalRestarts: this.save.stats.totalRestarts + 1 },
    };
    this.core = createState(spec);
    this.history = [];
    this.outcome = null;
    this.hintPlan = null;
    this.phase = 'planning';
    this.selected = this.firstAvailable(0);
    this.persist();
    this.notify({ kind: 'reset' });
  }

  /**
   * Keeps the cached winning layout in step with the map: it stays for as long
   * as every tower on the map is where the plan put it, and goes the moment one
   * is not.
   */
  private advanceHintPlan(): void {
    if (this.hintPlan && this.core && !agrees(this.core.layout, this.hintPlan)) {
      this.hintPlan = null;
    }
  }

  /**
   * The next step towards a winning layout. Free and unlimited.
   *
   * One winning layout is found and then followed, rather than re-solved after
   * every tap: two searches from neighbouring positions can land on different
   * layouts, and a hint that alternates between them walks a tower back and
   * forth forever. When the towers already down cannot be part of any win, the
   * hint names one to take back — chosen from the winning layout that keeps
   * the most of what the player built.
   */
  requestHint(): HintTarget | null {
    const spec = this.generated;
    const core = this.core;
    if (this.phase !== 'planning' || !spec || !core) return null;

    if (!this.hintPlan) {
      const completion = search(spec, core.layout);
      this.hintPlan =
        completion.status === 'solved' ? completion.layout : closestWinner(spec, core.layout);
    }
    const plan = this.hintPlan;
    if (!plan) return null;

    const target = nextStep(core.layout, plan, this.selected);
    if (target.kind === 'place') this.selected = target.tower;

    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalHints: this.save.stats.totalHints + 1 },
    };
    this.persist();
    this.notify({ kind: 'hint', target });
    return target;
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
}

/** Every tower on the map stands where the plan has the same kind. */
export function agrees(layout: readonly number[], plan: readonly number[]): boolean {
  return layout.every((kind, plot) => kind === EMPTY || plan[plot] === kind);
}

/**
 * One step from `layout` towards `plan`.
 *
 * Removals first — a tower in the wrong place is in the way of everything
 * else. Then placements, preferring the kind already selected in the tray so a
 * run of hints does not flick the tray back and forth. Then Go.
 */
export function nextStep(
  layout: readonly number[],
  plan: readonly number[],
  selected: TowerKind,
): HintTarget {
  for (let plot = 0; plot < layout.length; plot++) {
    const kind = layout[plot] as number;
    if (kind !== EMPTY && plan[plot] !== kind) return { kind: 'remove', plot };
  }

  let fallback: HintTarget | null = null;
  for (let plot = 0; plot < layout.length; plot++) {
    const want = plan[plot] as number;
    if (want === EMPTY || layout[plot] !== EMPTY) continue;
    if (want === selected) return { kind: 'place', plot, tower: want as TowerKind };
    fallback ??= { kind: 'place', plot, tower: want as TowerKind };
  }
  return fallback ?? { kind: 'go' };
}
