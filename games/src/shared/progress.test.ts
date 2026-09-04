import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, SAVE_VERSION, completeLevel, defaultSave, migrate } from './progress';

describe('migrate', () => {
  /**
   * The reason `SAVE_VERSION` moved to 2.
   *
   * Levels 1-50 now cover ground the old curve spread across 300, so a save
   * pointing at level 300 does not describe a player who is far ahead — it
   * describes one who would never see the game. Sending it back to 1 is the
   * only reading of that number that still means something.
   */
  it('sends a pre-v2 save back to level 1', () => {
    const old = {
      v: 1,
      game: 'busjam',
      seed: 'abcdef0123456789',
      level: 300,
      difficultyOffset: 12,
      recentOutcomes: ['clean', 'clean'],
      inProgress: { level: 300, moves: [4, 9] },
      settings: { theme: 'dark', sound: false, colorBlindShapes: true },
      stats: { levelsCleared: 299, totalUndos: 40, totalHints: 3, totalRestarts: 7 },
    };

    const migrated = migrate<number>(old, 'busjam');

    expect(migrated.v).toBe(SAVE_VERSION);
    expect(migrated.level).toBe(1);
    // A move list for a board that no longer exists would replay into nonsense.
    expect(migrated.inProgress).toBeNull();
  });

  /** Losing the level number is the point; losing everything else is not. */
  it('keeps settings, seed and lifetime stats across the reset', () => {
    const old = {
      v: 1,
      game: 'busjam',
      seed: 'abcdef0123456789',
      level: 300,
      settings: { theme: 'dark', sound: false, colorBlindShapes: true },
      stats: { levelsCleared: 299, totalUndos: 40, totalHints: 3, totalRestarts: 7 },
    };

    const migrated = migrate<number>(old, 'busjam');

    expect(migrated.seed).toBe('abcdef0123456789');
    expect(migrated.settings.theme).toBe('dark');
    expect(migrated.settings.sound).toBe(false);
    expect(migrated.settings.colorBlindShapes).toBe(true);
    expect(migrated.stats.levelsCleared).toBe(299);
  });

  it('defaults the timed setting to off for an existing save', () => {
    const migrated = migrate<number>(
      { v: 1, game: 'busjam', level: 4, settings: { theme: 'light' } },
      'busjam',
    );
    expect(migrated.settings.timed).toBe(false);
    expect(DEFAULT_SETTINGS.timed).toBe(false);
  });

  it('leaves a current save level and in-progress moves alone', () => {
    const current = {
      ...defaultSave<number>('busjam'),
      level: 17,
      inProgress: { level: 17, moves: [1, 2, 3] },
    };
    const migrated = migrate<number>(current, 'busjam');
    expect(migrated.level).toBe(17);
    expect(migrated.inProgress?.moves).toEqual([1, 2, 3]);
  });

  it('falls back to a fresh save for junk', () => {
    expect(migrate<number>(null, 'busjam').level).toBe(1);
    expect(migrate<number>('nonsense', 'busjam').level).toBe(1);
  });
});

describe('completeLevel', () => {
  it('advances the level and clears the in-progress board', () => {
    const save = { ...defaultSave<number>('busjam'), level: 8, inProgress: { level: 8, moves: [1] } };
    const next = completeLevel(save);
    expect(next.level).toBe(9);
    expect(next.inProgress).toBeNull();
    expect(next.stats.levelsCleared).toBe(1);
  });
});
