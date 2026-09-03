/**
 * Save format and progress tracking.
 *
 * Because level generation is seeded and deterministic, an in-progress level is
 * stored as nothing but its move list — the board itself replays from
 * (seed, level, difficultyOffset). A complete save is well under a kilobyte,
 * which is what makes the paste-a-code backup in Settings practical.
 */

import { type Outcome, nextDifficultyOffset, pushOutcome } from './difficulty';
import { createPersister, decodeSaveCode, encodeSaveCode, load } from './storage';
import { newProfileSeed } from './rng';

export const SAVE_VERSION = 1;

export interface Settings {
  /** Overlay a distinct shape on every color, for color vision deficiency. */
  colorBlindShapes: boolean;
  theme: 'system' | 'light' | 'dark';
  sound: boolean;
}

export interface SaveData<M> {
  v: number;
  game: string;
  seed: string;
  /** The level about to be played. */
  level: number;
  /** Hidden rubber-band adjustment. Never shown in the UI. */
  difficultyOffset: number;
  recentOutcomes: Outcome[];
  /** Moves made so far on `level`, or null if the level is untouched. */
  inProgress: { level: number; moves: M[] } | null;
  settings: Settings;
  stats: {
    levelsCleared: number;
    totalUndos: number;
    totalHints: number;
    totalRestarts: number;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  colorBlindShapes: false,
  theme: 'system',
  sound: true,
};

export function defaultSave<M>(game: string): SaveData<M> {
  return {
    v: SAVE_VERSION,
    game,
    seed: newProfileSeed(),
    level: 1,
    difficultyOffset: 0,
    recentOutcomes: [],
    inProgress: null,
    settings: { ...DEFAULT_SETTINGS },
    stats: { levelsCleared: 0, totalUndos: 0, totalHints: 0, totalRestarts: 0 },
  };
}

/**
 * Coerces whatever is on disk into the current shape. Anything unrecognised
 * falls back to a default rather than throwing — losing a setting is a nuisance,
 * losing a level number is the end of the game.
 */
export function migrate<M>(raw: unknown, game: string): SaveData<M> {
  const base = defaultSave<M>(game);
  if (!raw || typeof raw !== 'object') return base;

  const data = raw as Partial<SaveData<M>> & { settings?: Partial<Settings> };
  const level = Number(data.level);
  const inProgress =
    data.inProgress && Array.isArray(data.inProgress.moves)
      ? { level: Number(data.inProgress.level), moves: data.inProgress.moves }
      : null;

  return {
    v: SAVE_VERSION,
    game,
    seed: typeof data.seed === 'string' && data.seed ? data.seed : base.seed,
    level: Number.isFinite(level) && level >= 1 ? Math.floor(level) : 1,
    difficultyOffset: Number.isFinite(data.difficultyOffset)
      ? Math.max(-40, Math.min(40, Number(data.difficultyOffset)))
      : 0,
    recentOutcomes: Array.isArray(data.recentOutcomes)
      ? (data.recentOutcomes.filter(
          (o) => o === 'clean' || o === 'assisted' || o === 'failed',
        ) as Outcome[])
      : [],
    inProgress: inProgress && Number.isFinite(inProgress.level) ? inProgress : null,
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
 * Records how a level ended and advances the profile.
 *
 * `assisted` covers clearing with undos or a hint — worth distinguishing from a
 * clean clear, because a run of them means the difficulty is drifting past
 * where the player is comfortable even though they are technically winning.
 */
export function completeLevel<M>(save: SaveData<M>, outcome: Outcome): SaveData<M> {
  const recentOutcomes = pushOutcome(save.recentOutcomes, outcome);
  return {
    ...save,
    level: save.level + 1,
    inProgress: null,
    recentOutcomes,
    difficultyOffset: nextDifficultyOffset(save.difficultyOffset, recentOutcomes),
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
