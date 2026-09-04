/**
 * Settings, including the save backup.
 *
 * The backup section is the answer to the one genuine weakness of a
 * server-free design: iOS can evict local storage under disk pressure or when
 * Safari data is cleared, and local data never follows you to a new phone.
 * A copied code costs nothing and prevents losing hundreds of levels.
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
  /** Fired however the sheet is dismissed — Done, backdrop or Escape. */
  onClose?: () => void;
}

export function openSettings<M>(options: SettingsSheetOptions<M>): void {
  const { save, settings } = { save: options.save, settings: options.save.settings };

  openSheet((sheet) => {
    sheet.content.append(el('h2', {}, 'Settings'));
    sheet.content.append(
      el('p', {}, 'No ads, no accounts, no tracking. Everything stays on this device.'),
    );

    sheet.content.append(
      segmentedRow(
        'Theme',
        'Match your phone, or pick one.',
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

    sheet.content.append(
      toggleRow(
        'Shapes on colors',
        'Adds a distinct symbol to every color, so the puzzle never depends on telling colors apart.',
        settings.colorBlindShapes,
        (colorBlindShapes) => options.onSettingsChange({ colorBlindShapes }),
      ),
    );

    sheet.content.append(
      toggleRow(
        'Timed play',
        'Puts a clock on every level. Solving something adds time back. The board is ' +
          'exactly the same either way — this only changes whether you get to sit with it. ' +
          'Also on the clock in the top bar.',
        settings.timed,
        (timed) => options.onSettingsChange({ timed }),
      ),
    );

    sheet.content.append(
      toggleRow('Sound', 'Soft pours and chimes.', settings.sound, (sound) => {
        setSoundEnabled(sound);
        options.onSettingsChange({ sound });
      }),
    );

    sheet.content.append(buildLevelJump(options));
    sheet.content.append(buildBackup(options, save));
    sheet.content.append(buildStats(save));

    const done = el('button', { class: 'button button--full' }, 'Done');
    done.addEventListener('click', sheet.close);
    sheet.content.append(done);
  }, { onClose: options.onClose });
}

function buildLevelJump<M>(options: SettingsSheetOptions<M>): HTMLElement {
  const row = el('div', { class: 'sheet-row' });
  row.append(
    el(
      'div',
      { class: 'sheet-row-label' },
      `Level<small>Currently on ${options.currentLevel}. Jump anywhere — nothing is locked.</small>`,
    ),
  );

  const input = el('input', {
    class: 'field',
    type: 'number',
    min: '1',
    inputmode: 'numeric',
    style: 'width:88px;text-align:center',
    value: String(options.currentLevel),
    'aria-label': 'Go to level',
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
      'Back up your progress<small>Your level lives only on this phone. Copy this code somewhere safe, ' +
        'or paste one in to restore progress on another device.</small>',
    ),
  );

  const note = el('p', { class: 'note' });

  const copy = el('button', { class: 'button button--ghost button--full' }, 'Copy save code');
  copy.addEventListener('click', () => {
    const code = exportSave(save);
    void writeToClipboard(code).then((ok) => {
      note.className = ok ? 'note note--ok' : 'note';
      note.textContent = ok
        ? 'Copied. Paste it somewhere you will still have in a year.'
        : 'Could not reach the clipboard — the code is in the box below.';
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
    placeholder: 'Paste a save code to restore',
    style: 'margin-top:10px',
    'aria-label': 'Save code to restore',
  }) as HTMLInputElement;

  const restore = el('button', { class: 'button button--ghost button--full' }, 'Restore from code');
  restore.addEventListener('click', () => {
    const code = input.value.trim();
    if (!code) return;
    try {
      const restored = importSave<M>(code, options.gameId);
      note.className = 'note note--ok';
      note.textContent = `Restored — level ${restored.level}.`;
      void options.onImport(restored);
    } catch (error) {
      note.className = 'note note--error';
      note.textContent = error instanceof Error ? error.message : 'That code could not be read.';
    }
  });

  section.append(copy, input, restore, note);
  return section;
}

function buildStats<M>(save: SaveData<M>): HTMLElement {
  const { levelsCleared, totalUndos, totalHints } = save.stats;
  return el(
    'div',
    { class: 'sheet-row' },
    `<div class="sheet-row-label">Progress<small>${levelsCleared} levels cleared · ` +
      `${totalUndos} undos · ${totalHints} hints</small></div>`,
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
