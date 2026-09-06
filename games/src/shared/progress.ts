/**
 * Save format and progress tracking.
 *
 * Because level generation is seeded and deterministic, an in-progress level is
 * stored as nothing but its move list — the board itself replays from
 * (seed, level, difficultyOffset). A complete save is well under a kilobyte,
 * which is what makes the paste-a-code backup in Settings practical.
 */

import { createPersister, decodeSaveCode, encodeSaveCode, load } from './storage';
import { newProfileSeed } from './rng';

/**
 * Bumped to 2 when the difficulty curve was rebuilt.
 *
 * Levels 1-50 now cover the ground the old curve spread over 300, so an
 * existing save pointing at level 300 is not a hard save — it is a save that
 * skips the entire game. `migrate` sends any v1 save back to level 1, which is
 * the only reading of that number that means anything now.
 */
export const SAVE_VERSION = 2;

export interface Settings {
  /** Overlay a distinct shape on every color, for color vision deficiency. */
  colorBlindShapes: boolean;
  theme: 'system' | 'light' | 'dark';
  sound: boolean;
  /** Run the clock. Off by default; see `shared/timer.ts`. */
  timed: boolean;
}

export interface SaveData<M> {
  v: number;
  game: string;
  seed: string;
  /** The level about to be played. */
  level: number;
  /** Moves made so far on `level`, or null if the level is untouched. */
  inProgress: { level: number; moves: M[] } | null;
  /**
   * The rules sheet has been opened at least once. Not a setting — there is
   * nothing to choose here, it is just a note that the explanation has been
   * offered, so it is never forced on the same player twice.
   */
  seenHowToPlay: boolean;
  settings: Settings;
  stats: {
    levelsCleared: number;
    totalUndos: number;
    totalHints: number;
    totalRestarts: number;
    /**
     * Five Dice only, and optional because no other game has anything to put
     * here. It is the one game whose outcome is a number rather than cleared or
     * not: a round always finishes, so `levelsCleared` counts rounds played and
     * says nothing about how they went. Both live in `stats` rather than in a
     * store of their own so that the save code in Settings — the whole backup
     * story for a server-free game — carries a player's record with it.
     */
    bestScore?: number;
    /** Every finished round added up, so an average needs no history kept. */
    scoreTotal?: number;
    /**
     * Backgammon only, and optional for the same reason. It is the one game
     * with two players in it, so "cleared" counts games finished and says
     * nothing about who won them. The running tally rides in the save so that
     * the code in Settings carries it too — an evening's score is exactly the
     * thing a pair of players would be annoyed to lose to a cleared browser.
     */
    whiteWins?: number;
    redWins?: number;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  colorBlindShapes: false,
  theme: 'system',
  sound: true,
  timed: false,
};

export function defaultSave<M>(game: string): SaveData<M> {
  return {
    v: SAVE_VERSION,
    game,
    seed: newProfileSeed(),
    level: 1,
    inProgress: null,
    seenHowToPlay: false,
    settings: { ...DEFAULT_SETTINGS },
    stats: { levelsCleared: 0, totalUndos: 0, totalHints: 0, totalRestarts: 0 },
  };
}

/**
 * Coerces whatever is on disk into the current shape. Anything unrecognised
 * falls back to a default rather than throwing — losing a setting is a nuisance,
 * losing a level number is the end of the game.
 *
 * The one exception is a pre-v2 save, whose level number refers to a curve that
 * no longer exists. Settings and the profile seed are kept; the level goes back
 * to 1. See `SAVE_VERSION`.
 */
export function migrate<M>(raw: unknown, game: string): SaveData<M> {
  const base = defaultSave<M>(game);
  if (!raw || typeof raw !== 'object') return base;

  const data = raw as Partial<SaveData<M>> & { settings?: Partial<Settings>; v?: number };
  const rebuilt = Number(data.v) < SAVE_VERSION;
  const level = rebuilt ? 1 : Number(data.level);
  const inProgress =
    data.inProgress && Array.isArray(data.inProgress.moves)
      ? { level: Number(data.inProgress.level), moves: data.inProgress.moves }
      : null;

  return {
    v: SAVE_VERSION,
    game,
    seed: typeof data.seed === 'string' && data.seed ? data.seed : base.seed,
    level: Number.isFinite(level) && level >= 1 ? Math.floor(level) : 1,
    inProgress: rebuilt || !inProgress || !Number.isFinite(inProgress.level) ? null : inProgress,
    seenHowToPlay: data.seenHowToPlay === true,
    settings: { ...base.settings, ...(data.settings ?? {}) },
    stats: { ...base.stats, ...(data.stats ?? {}) },
  };
}

const keyFor = (game: string): string => `save:${game}`;

export async function loadSave<M>(game: string): Promise<SaveData<M>> {
  const raw = await load<unknown>(keyFor(game));
  return raw ? migrate<M>(raw, game) : defaultSave<M>(game);
}

export function createSaveWriter<M>(game: string) {
  return createPersister<SaveData<M>>(keyFor(game));
}

/**
 * Records a clear and advances to the next level.
 *
 * There is deliberately no notion here of *how* the level was cleared. An
 * earlier version fed clean/assisted/failed into a hidden difficulty
 * adjustment; that adjustment is gone, so the distinction has nothing left to
 * drive. Level N is level N. See `shared/difficulty.ts`.
 */
export function completeLevel<M>(save: SaveData<M>): SaveData<M> {
  return {
    ...save,
    level: save.level + 1,
    inProgress: null,
    stats: { ...save.stats, levelsCleared: save.stats.levelsCleared + 1 },
  };
}

/* ------------------------------------------------------------------ */
/* Backup codes                                                        */
/* ------------------------------------------------------------------ */

export function exportSave<M>(save: SaveData<M>): string {
  return encodeSaveCode(save);
}

/** Throws with a message worth showing the user if the code is not usable. */
export function importSave<M>(code: string, game: string): SaveData<M> {
  const decoded = decodeSaveCode<SaveData<M>>(code);
  if (!decoded || typeof decoded !== 'object') {
    throw new Error('That save code could not be read.');
  }
  if (decoded.game && decoded.game !== game) {
    throw new Error(`That save code is for ${decoded.game}, not ${game}.`);
  }
  return migrate<M>(decoded, game);
}
