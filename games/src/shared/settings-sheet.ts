/**
 * Settings, including the save backup.
 *
 * The backup section is the answer to the one genuine weakness of a
 * server-free design: iOS can evict local storage under disk pressure or when
 * Safari data is cleared, and local data never follows you to a new phone.
 * A copied code costs nothing and prevents losing hundreds of levels.
 *
 * Rows carry an explanatory line only where the label alone would leave a real
 * question. Most of them do not.
 */

import { setSoundEnabled } from './audio';
import type { SaveData, Settings } from './progress';
import { exportSave, importSave } from './progress';
import { applyTheme, el, openSheet, segmentedRow, toggleRow } from './ui';

export interface SettingsSheetOptions<M> {
  gameId: string;
  gameName: string;
  save: SaveData<M>;
  currentLevel: number;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onImport: (save: SaveData<M>) => void | Promise<void>;
  onGoToLevel: (level: number) => void | Promise<void>;
  /**
   * Opens the rules sheet on top of this one. The `?` in the top bar is the
   * primary way in; this row exists because Settings is where a lot of people
   * look for help first, and the sheet stacks, so backing out of it lands them
   * where they were rather than back on the board.
   */
  onHowToPlay?: () => void;
  /** Fired however the sheet is dismissed — Done, backdrop or Escape. */
  onClose?: () => void;

  /*
   * The rest of these exist for Yahtzee, which is a dice game rather than a
   * puzzle: it counts rounds instead of levels, has no clock, and has no colour
   * carrying information. Defaulting them to the puzzle behaviour keeps the
   * other four games' call sites unchanged, and offering a row that does nothing
   * is worse than not offering it.
   */

  /** What a level is called here. 'Level' unless a game says otherwise. */
  levelNoun?: string;
  /** Replaces the Progress line, whose default talks about levels cleared. */
  progressLine?: string;
  /** Offer the clock. See `shared/timer.ts`. */
  showTimer?: boolean;
  /** Offer the shape-on-colour overlay. Pointless where no colour means anything. */
  showShapes?: boolean;
}

export function openSettings<M>(options: SettingsSheetOptions<M>): void {
  const { save, settings } = { save: options.save, settings: options.save.settings };

  openSheet((sheet) => {
    sheet.content.append(el('h2', {}, 'Settings'));

    sheet.content.append(
      segmentedRow(
        'Theme',
        '',
        [
          { value: 'system' as const, label: 'Auto' },
          { value: 'light' as const, label: 'Light' },
          { value: 'dark' as const, label: 'Dark' },
        ],
        settings.theme,
        (theme) => {
          applyTheme(theme);
          options.onSettingsChange({ theme });
        },
      ),
    );

    if (options.showShapes !== false) {
      sheet.content.append(
        toggleRow(
          'Shapes on colors',
          'A symbol on each color.',
          settings.colorBlindShapes,
          (colorBlindShapes) => options.onSettingsChange({ colorBlindShapes }),
        ),
      );
    }

    if (options.showTimer !== false) {
      sheet.content.append(
        toggleRow(
          'Timed play',
          'A clock on every level.',
          settings.timed,
          (timed) => options.onSettingsChange({ timed }),
        ),
      );
    }

    sheet.content.append(
      toggleRow('Sound', '', settings.sound, (sound) => {
        setSoundEnabled(sound);
        options.onSettingsChange({ sound });
      }),
    );

    if (options.onHowToPlay) sheet.content.append(buildHowToPlayRow(options.onHowToPlay));

    sheet.content.append(buildLevelJump(options));
    sheet.content.append(buildBackup(options, save));
    sheet.content.append(buildStats(save, options.progressLine));

    const done = el('button', { class: 'button button--full' }, 'Done');
    done.addEventListener('click', sheet.close);
    sheet.content.append(done);
  }, { onClose: options.onClose });
}

function buildHowToPlayRow(open: () => void): HTMLElement {
  const row = el('div', { class: 'sheet-row' });
  row.append(el('div', { class: 'sheet-row-label' }, 'How to play'));

  const button = el('button', { class: 'button button--ghost' }, 'Show');
  button.addEventListener('click', open);
  row.append(button);
  return row;
}

function buildLevelJump<M>(options: SettingsSheetOptions<M>): HTMLElement {
  const noun = options.levelNoun ?? 'Level';
  const row = el('div', { class: 'sheet-row' });
  row.append(el('div', { class: 'sheet-row-label' }, noun));

  const input = el('input', {
    class: 'field',
    type: 'number',
    min: '1',
    inputmode: 'numeric',
    style: 'width:88px;text-align:center',
    value: String(options.currentLevel),
    'aria-label': `Go to ${noun.toLowerCase()}`,
  }) as HTMLInputElement;

  input.addEventListener('change', () => {
    const target = Number(input.value);
    if (Number.isFinite(target) && target >= 1) void options.onGoToLevel(Math.floor(target));
  });

  row.append(input);
  return row;
}

function buildBackup<M>(options: SettingsSheetOptions<M>, save: SaveData<M>): HTMLElement {
  const section = el('div', { class: 'sheet-row', style: 'display:block' });
  section.append(
    el(
      'div',
      { class: 'sheet-row-label' },
      'Backup<small>Keep a code to restore your progress.</small>',
    ),
  );

  const note = el('p', { class: 'note' });

  const copy = el('button', { class: 'button button--ghost button--full' }, 'Copy code');
  copy.addEventListener('click', () => {
    const code = exportSave(save);
    void writeToClipboard(code).then((ok) => {
      note.className = ok ? 'note note--ok' : 'note';
      note.textContent = ok ? 'Copied.' : 'Clipboard unavailable — the code is below.';
      if (!ok) {
        const box = el('textarea', { class: 'field', rows: '3', readonly: 'readonly' });
        (box as HTMLTextAreaElement).value = code;
        section.append(box);
        (box as HTMLTextAreaElement).select();
      }
    });
  });

  const input = el('input', {
    class: 'field',
    type: 'text',
    placeholder: 'Paste a code to restore',
    style: 'margin-top:10px',
    'aria-label': 'Save code to restore',
  }) as HTMLInputElement;

  const restore = el('button', { class: 'button button--ghost button--full' }, 'Restore');
  restore.addEventListener('click', () => {
    const code = input.value.trim();
    if (!code) return;
    try {
      const restored = importSave<M>(code, options.gameId);
      note.className = 'note note--ok';
      note.textContent = `Restored to ${(options.levelNoun ?? 'Level').toLowerCase()} ${restored.level}.`;
      void options.onImport(restored);
    } catch (error) {
      note.className = 'note note--error';
      note.textContent = error instanceof Error ? error.message : 'That code could not be read.';
    }
  });

  section.append(copy, input, restore, note);
  return section;
}

function buildStats<M>(save: SaveData<M>, line?: string): HTMLElement {
  const { levelsCleared, totalUndos, totalHints } = save.stats;
  const summary = line ?? `${levelsCleared} cleared · ${totalUndos} undos · ${totalHints} hints`;
  return el(
    'div',
    { class: 'sheet-row' },
    `<div class="sheet-row-label">Progress<small>${summary}</small></div>`,
  );
}

async function writeToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
