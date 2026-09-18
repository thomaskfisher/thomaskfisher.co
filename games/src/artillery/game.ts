/**
 * Artillery game controller.
 *
 * Owns all state and persistence; knows nothing about the DOM.
 *
 * **The third two-player game here, and it borrows Backgammon's and Mancala's
 * shape**: there is a battlefield to generate but no level to solve, no
 * difficulty to curve, and no hint — a hint at a two-player board is an engine
 * quietly playing one side better than the other. Matches are numbered rather
 * than levelled, and the running tally rides in the save so an evening's score
 * survives closing the app.
 *
 * Two things here are its own.
 *
 * **A shot is resolved before it is shown.** `fire()` computes the whole
 * outcome — every shell's flight, the craters, the damage — and holds it while
 * the renderer walks the arcs in real time. The state changes once, when the
 * renderer reports back. That is what keeps the rule in the house style ("render
 * on state change only") honest in a game with a projectile in it: the frame
 * loop is a camera, not a simulation, and it decides nothing.
 *
 * **Nothing is written to disk until the shell lands.** The window between
 * pulling the trigger and the burst is a second and a half, and a save written
 * inside it would have to be either the position before the shot — which invites
 * the player to fire the same weapon twice — or the position after one nobody
 * saw. So the turn is atomic: close the app mid-flight and the turn is simply
 * still yours, weapon unspent.
 */

import {
  type DraftState,
  type MatchState,
  type Opening,
  type Resolution,
  type Seat,
  type Snapshot,
  type Tank,
  MOVE_BUDGET,
  OTHER,
  arsenalsFrom,
  atColumn,
  available,
  canStep,
  chooseWeapon,
  decode,
  draftComplete,
  draftPick,
  draftPicksMade,
  encode,
  firstPickerFor,
  isOver,
  openingDraft,
  openingState,
  POOL_IDS,
  refusalFor,
  resolveShot,
  setAngle,
  setPower,
  stepTank,
  winnerOf,
} from './model';
import { generateOpening } from './generate';
import { createTerrain } from './terrain';
import { type Weapon, ARSENAL_SIZE, weaponById } from './weapons';
import {
  type SaveData,
  completeLevel,
  createSaveWriter,
  defaultSave,
  loadSave,
} from '../shared/progress';

export const GAME_ID = 'artillery';

export type GamePhase = 'loading' | 'draft' | 'aiming' | 'firing' | 'finished';

export type Effect =
  | { kind: 'none' }
  | { kind: 'reset' }
  | { kind: 'moved' }
  | { kind: 'aimed' }
  | { kind: 'picked'; weapon: Weapon; seat: Seat }
  | { kind: 'fired'; resolution: Resolution }
  | { kind: 'landed'; damage: [number, number] }
  | { kind: 'win'; winner: Seat | null }
  | { kind: 'undo' }
  /** Something that could not be done, and the one line saying why. */
  | { kind: 'reject'; note: string };

export interface DraftView {
  pool: Weapon[];
  taken: (Seat | null)[];
  picker: Seat;
  /** Picks still to make. Shown as "n remaining", as the original does. */
  remaining: number;
  /** What each side has taken so far, in pick order. */
  arsenals: [Weapon[], Weapon[]];
}

export interface Tally {
  /** Matches finished. An abandoned match is not counted. */
  matches: number;
  left: number;
  right: number;
}

export interface GameView {
  phase: GamePhase;
  /** The match number. Named `level` because the shared chrome asks for it. */
  level: number;
  draft: DraftView | null;
  match: MatchState;
  /** What the seat on the move can fire, plain shell first. */
  arsenal: Weapon[];
  chosen: Weapon;
  canUndo: boolean;
  canMove: { left: boolean; right: boolean };
  /** The shot in the air, while there is one. */
  firing: Resolution | null;
  winner: Seat | null;
  record: Tally;
  effect: Effect;
}

type Listener = (view: GameView) => void;

/** Seat order for the tally in the save. Fixed, because the save outlives the code. */
const SEAT_ORDER: readonly Seat[] = [0, 1];

export class ArtilleryGame {
  /**
   * Seeded with a default rather than left undefined until `start()`, because
   * `subscribe` notifies synchronously and the first render therefore happens
   * before the save has loaded. See `shared/first-render.test.ts`.
   */
  private save: SaveData<Snapshot> = defaultSave<Snapshot>(GAME_ID);
  private writer = createSaveWriter<Snapshot>(GAME_ID);

  /**
   * A placeholder battlefield, replaced by the real one in `load()`.
   *
   * Flat rather than generated: `subscribe` notifies synchronously, so this
   * exists only to give that first "Preparing…" frame something to read, and
   * running the generator at construction would spend ten milliseconds on a
   * battlefield nobody will ever see. See `shared/first-render.test.ts`.
   */
  private opening: Opening = { terrain: createTerrain(40), columns: [9, 86], pool: [...POOL_IDS] };
  private match: MatchState = openingState(this.opening, [[], []], 0);
  private draft: DraftState | null = null;

  /** The match number on screen. Not `save.level`, which runs ahead once one is banked. */
  private displayMatch = 1;
  private phase: GamePhase = 'loading';
  private effect: Effect = { kind: 'none' };

  /**
   * Positions this turn, oldest first, for undo.
   *
   * Cleared the moment a shot resolves. Undo stops at the trigger for the same
   * reason Backgammon's stops at the handover — see the header of `model.ts` —
   * so there is never anything in here from a previous turn.
   */
  private rewind: MatchState[] = [];

  private pending: Resolution | null = null;

  private listeners = new Set<Listener>();

  async start(): Promise<void> {
    this.save = await loadSave<Snapshot>(GAME_ID);
    this.load(this.save.level, this.save.inProgress?.moves?.[0] ?? null);
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

  get currentSave(): SaveData<Snapshot> {
    return this.save;
  }

  /* ------------------------------------------------------------ state */

  private snapshot(): GameView {
    const stats = this.save.stats;
    const tally = stats.seatScores ?? [];
    const seat = this.match.turn;
    const playable = this.phase === 'aiming';

    return {
      phase: this.phase,
      level: this.displayMatch,
      draft: this.draft && !draftComplete(this.draft) ? this.draftView(this.draft) : null,
      match: this.match,
      arsenal: available(this.match, seat),
      chosen: weaponById(this.match.chosen[seat] as string),
      canUndo: playable && this.rewind.length > 0,
      canMove: {
        left: playable && canStep(this.match, -1),
        right: playable && canStep(this.match, 1),
      },
      firing: this.phase === 'firing' ? this.pending : null,
      winner: isOver(this.match) ? winnerOf(this.match) : null,
      record: {
        matches: stats.levelsCleared,
        left: tally[0] ?? 0,
        right: tally[1] ?? 0,
      },
      effect: this.effect,
    };
  }

  private draftView(draft: DraftState): DraftView {
    const arsenals = arsenalsFrom(draft);
    return {
      pool: draft.pool.map(weaponById),
      taken: draft.taken,
      picker: draft.picker,
      remaining: draft.pool.length - draftPicksMade(draft),
      arsenals: [arsenals[0].map(weaponById), arsenals[1].map(weaponById)],
    };
  }

  /**
   * Opens a match, restoring a snapshot if one was left behind.
   *
   * The battlefield is regenerated from the seed rather than stored, so a
   * restored snapshot is checked against the ground it claims to be standing
   * on. Anything that does not line up starts the match again rather than
   * half-applying — see `decode` in `model.ts`.
   */
  private load(match: number, saved: Snapshot | null = null): void {
    this.phase = 'loading';
    this.displayMatch = match;
    this.rewind = [];
    this.pending = null;
    this.notify({ kind: 'reset' });

    this.opening = generateOpening(this.save.seed, match);
    // The seat that fires first alternates by match, and the other one drafts
    // first. One fairness trade rather than two.
    const firstFirer = ((match - 1) % 2) as Seat;

    const restored = saved ? decode(saved, this.opening, firstFirer) : null;

    if (restored) {
      this.match = restored.state;
      this.draft = restored.draft;
      // The move budget at step i is always MOVE_BUDGET - i, so the whole
      // stack rebuilds from the columns alone. See `Snapshot.p`.
      this.rewind = restored.history.map((col, index) =>
        atColumn(restored.state, restored.state.turn, col, MOVE_BUDGET - index),
      );
    } else {
      this.draft = openingDraft(this.opening.pool, firstPickerFor(firstFirer));
      this.match = openingState(this.opening, [[], []], firstFirer);
    }

    if (this.draft && !draftComplete(this.draft)) this.phase = 'draft';
    else if (isOver(this.match)) this.phase = 'finished';
    else this.phase = 'aiming';

    // A restored snapshot that is already decided means the bank never landed.
    if (this.phase === 'finished') this.bank(winnerOf(this.match));
    else this.persist();

    this.notify({ kind: 'reset' });
  }

  private persist(): void {
    // A banked match has already cleared `inProgress`; writing again here would
    // put the finished match back on disk and reopen it next time.
    if (this.phase === 'finished' || this.phase === 'loading') return;
    const history = this.rewind.map((position) => (position.tanks[this.match.turn] as Tank).col);
    this.writer.schedule({
      ...this.save,
      inProgress: {
        level: this.displayMatch,
        moves: [encode(this.match, this.draft, history)],
      },
    });
  }

  /* ------------------------------------------------------------- draft */

  /**
   * Takes a weapon out of the shop.
   *
   * One tap, no confirmation: the pool is in front of both players and a pick
   * is a whole decision, which is why the shop can afford to show every
   * arsenal as it fills. Once the last one is gone the match opens on the
   * battlefield with both sides' aim already pointed at each other.
   */
  pick(index: number): void {
    if (this.phase !== 'draft' || !this.draft) return;

    const next = draftPick(this.draft, index);
    if (!next) {
      this.notify({ kind: 'reject', note: 'Already taken' });
      return;
    }

    const weapon = weaponById(this.draft.pool[index] as string);
    const seat = this.draft.picker;
    this.draft = next;

    if (draftComplete(next)) {
      this.match = openingState(this.opening, arsenalsFrom(next), this.match.first);
      this.phase = 'aiming';
      this.persist();
      this.notify({ kind: 'reset' });
      return;
    }

    this.persist();
    this.notify({ kind: 'picked', weapon, seat });
  }

  /* -------------------------------------------------------------- turn */

  move(dir: -1 | 1): void {
    if (this.phase !== 'aiming') return;

    const next = stepTank(this.match, dir);
    if (!next) {
      this.notify({ kind: 'reject', note: refusalFor(this.match, dir) });
      return;
    }

    this.rewind.push(this.match);
    this.match = next;
    this.persist();
    this.notify({ kind: 'moved' });
  }

  /** Nudges the angle. The dial is absolute degrees; see `physics.ts`. */
  nudgeAngle(delta: number): void {
    if (this.phase !== 'aiming') return;
    const tank = this.match.tanks[this.match.turn] as Tank;
    this.aimTo(setAngle(this.match, tank.angle + delta));
  }

  nudgePower(delta: number): void {
    if (this.phase !== 'aiming') return;
    const tank = this.match.tanks[this.match.turn] as Tank;
    this.aimTo(setPower(this.match, tank.power + delta));
  }

  setAim(angle: number, power: number): void {
    if (this.phase !== 'aiming') return;
    this.aimTo(setPower(setAngle(this.match, angle), power));
  }

  /**
   * Aim is not pushed onto the rewind stack.
   *
   * Undo exists for the thing a player cannot simply put back, and a dial is
   * not that: turning it the other way is the undo. Filling the stack with
   * every degree would also bury the one move somebody actually wants back
   * under forty taps of the angle button.
   */
  private aimTo(next: MatchState): void {
    if (next === this.match) return;
    this.match = next;
    this.persist();
    this.notify({ kind: 'aimed' });
  }

  selectWeapon(id: string): void {
    if (this.phase !== 'aiming') return;
    const next = chooseWeapon(this.match, id);
    if (next === this.match) {
      this.notify({ kind: 'reject', note: 'Already fired that one' });
      return;
    }
    this.match = next;
    this.persist();
    this.notify({ kind: 'picked', weapon: weaponById(id), seat: this.match.turn });
  }

  /**
   * Pulls the trigger.
   *
   * The outcome is worked out here and held. Nothing about the match changes
   * until `shotLanded` — including the save, so a match closed mid-flight
   * reopens with the turn still to play.
   */
  fire(): void {
    if (this.phase !== 'aiming') return;

    this.pending = resolveShot(this.match);
    this.phase = 'firing';
    this.notify({ kind: 'fired', resolution: this.pending });
  }

  /**
   * The renderer has finished drawing the flight.
   *
   * Idempotent, and it has to be: the animation reports back on its own, and
   * the page reports for it when it is hidden mid-flight or the animation is
   * cut short. Two reports for one shot would resolve the next player's turn
   * on the previous player's aim.
   */
  shotLanded(): void {
    if (this.phase !== 'firing' || !this.pending) return;

    const { damage, next } = this.pending;
    this.match = next;
    this.pending = null;
    this.rewind = [];

    if (isOver(next)) {
      this.phase = 'finished';
      const winner = winnerOf(next);
      this.bank(winner);
      this.notify({ kind: 'win', winner });
      return;
    }

    this.phase = 'aiming';
    this.persist();
    this.notify({ kind: 'landed', damage });
  }

  /** Takes back one column of movement. Never a shot — see `model.ts`. */
  undo(): void {
    if (this.phase !== 'aiming' || this.rewind.length === 0) {
      this.notify({ kind: 'reject', note: 'Nothing to take back' });
      return;
    }

    this.match = this.rewind.pop() as MatchState;
    this.save = {
      ...this.save,
      stats: { ...this.save.stats, totalUndos: this.save.stats.totalUndos + 1 },
    };
    this.persist();
    this.notify({ kind: 'undo' });
  }

  /* ----------------------------------------------------------- matches */

  /**
   * Banks a finished match.
   *
   * Done the moment the last shell lands rather than when the players tap past
   * the result, and `inProgress` is cleared in the same breath: a match that is
   * over should be recorded even if the app is closed on the result sheet, and
   * it must not still be on disk to be reopened and counted twice.
   *
   * A draw — one shell finishing both tanks — counts as a match finished and
   * goes to neither tally, which is the only reading of it that leaves the two
   * numbers meaning what they say.
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

  /** Moves on from a finished match. */
  advance(): void {
    if (this.phase !== 'finished') return;
    this.load(this.save.level);
  }

  /**
   * A fresh battlefield.
   *
   * Unlike Mancala there is nothing to restart *to*: the battlefield is a
   * function of the match number, so replaying one would hand both players the
   * same ground with the same draft they have just seen. So this is New match,
   * and an abandoned match burns its number rather than being counted.
   */
  restart(): void {
    if (this.phase === 'finished') {
      this.advance();
      return;
    }

    const next = this.displayMatch + 1;
    this.save = {
      ...this.save,
      level: next,
      inProgress: null,
      stats: { ...this.save.stats, totalRestarts: this.save.stats.totalRestarts + 1 },
    };
    this.writer.schedule(this.save);
    this.load(next);
  }

  goToMatch(match: number): void {
    const target = Math.max(1, Math.floor(match));
    this.save = { ...this.save, level: target, inProgress: null };
    this.writer.schedule(this.save);
    this.load(target);
  }

  async replaceSave(save: SaveData<Snapshot>): Promise<void> {
    this.save = save;
    this.writer.schedule(save);
    this.writer.flush();
    this.load(save.level, save.inProgress?.moves?.[0] ?? null);
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

  updateSettings(patch: Partial<SaveData<Snapshot>['settings']>): void {
    this.save = { ...this.save, settings: { ...this.save.settings, ...patch } };
    this.writer.schedule(this.save);
    this.notify();
  }
}

/**
 * Both seats' names, in one place, so no string in the UI has to guess.
 *
 * Left and Right rather than two colours, because that is the one thing about
 * this board nothing can change: the seats never swap ends. It also means
 * colour never carries information on its own, which is why the shape overlay
 * the other games offer has nothing to do here.
 */
export const NAMES: Readonly<Record<Seat, string>> = { 0: 'Left', 1: 'Right' };

export { ARSENAL_SIZE, MOVE_BUDGET, OTHER };
