/**
 * Connections entry point. Wires the controller to the renderer and the chrome.
 */

import '../shared/shell.css';
import './connections.css';

import { setSoundEnabled, sfx } from '../shared/audio';
import { createHowToPlay, shouldAutoShow } from '../shared/how-to-play';
import { registerServiceWorker } from '../shared/pwa';
import { openSettings } from '../shared/settings-sheet';
import { applyTheme, el, icons, openSheet, prefersReducedMotion } from '../shared/ui';
import { pinViewportHeight } from '../shared/viewport';
import { ConnectionsGame, GAME_ID, type GameState } from './game';
import { GROUP_SIZE } from './model';
import { BoardRenderer, describeProgress } from './render';
import { RULES } from './rules';

const app = document.getElementById('app');
if (!app) throw new Error('#app is missing');

// Before anything measures the board. See viewport.ts.
pinViewportHeight();

/* ------------------------------------------------------------------ chrome */

const levelLabel = el('b', {}, 'Puzzle 1');
const subLabel = el('span', {}, '');
const settingsButton = el('button', { class: 'icon-button', 'aria-label': 'Settings' }, icons.settings);

const topbar = el('header', { class: 'topbar' });
const levelBlock = el('div', { class: 'topbar-level' });
levelBlock.append(levelLabel, subLabel);

const howTo = createHowToPlay({
  rules: RULES,
  onSeen: () => game.markHowToPlaySeen(),
});

const topbarActions = el('div', { class: 'topbar-actions' });
topbarActions.append(howTo.button, settingsButton);
topbar.append(levelBlock, topbarActions);

const boardEl = el('main', { class: 'board', 'aria-label': 'Puzzle' });

const actionsEl = el('div', { class: 'cn-actions' });
const dotsHost = el('div', { class: 'cn-dots-host' });
const shuffleButton = el('button', { class: 'cn-action', type: 'button' }, 'Shuffle');
const deselectButton = el('button', { class: 'cn-action', type: 'button' }, 'Deselect');
const submitButton = el('button', { class: 'cn-action cn-action--primary', type: 'button' }, 'Submit');
const actionRow = el('div', { class: 'cn-action-row' });
actionRow.append(shuffleButton, deselectButton, submitButton);
actionsEl.append(dotsHost, actionRow);

const undoButton = controlButton('Undo', icons.undo);
const restartButton = controlButton('Restart', icons.restart);
const hintButton = controlButton('Hint', icons.hint);
const controls = el('footer', { class: 'controls' });
controls.append(undoButton, restartButton, hintButton);

app.append(topbar, boardEl, actionsEl, controls);
app.classList.add('app--connections');

function controlButton(label: string, icon: string): HTMLButtonElement {
  return el('button', { class: 'control', type: 'button' }, `${icon}<span>${label}</span>`);
}

/* -------------------------------------------------------------------- game */

const game = new ConnectionsGame();

const renderer = new BoardRenderer(boardEl, dotsHost, {
  reducedMotion: prefersReducedMotion(),
  onTile: (index) => {
    if (game.toggle(index)) sfx.select();
    else sfx.reject();
  },
});

/* --------------------------------------------------------------------- fit */

const GAP = 8;
/** Past this a tile is a slab; a phone never gets here, a tablet does. */
const MAX_TILE = 130;
const MAX_ROW = 96;

/**
 * Sizes the four rows so the board fits without scrolling. The rows are always
 * four — a solved bar takes a row of tiles' place — so the fit never changes
 * mid-puzzle and nothing jumps when a group is found.
 */
function fitBoard(): void {
  const style = getComputedStyle(boardEl);
  const width = boardEl.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const height = boardEl.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  if (width <= 0 || height <= 0) return;

  const tile = Math.min((width - 3 * GAP) / 4, MAX_TILE);
  const row = Math.min((height - 3 * GAP) / 4, tile * 0.9, MAX_ROW);
  renderer.setSize(Math.floor(tile), Math.max(40, Math.floor(row)));
}

/* ------------------------------------------------------- state -> screen */

let lastPhase: GameState['phase'] = 'loading';
let currentState: GameState | null = null;

/**
 * The end-of-puzzle sheet waits for the last bar to land. The handle is kept
 * and cancelled on every reset, so an undo inside that window cannot pop a
 * sheet about a puzzle that is no longer over.
 */
let pendingSheet: number | null = null;

function clearPendingSheet(): void {
  if (pendingSheet !== null) {
    window.clearTimeout(pendingSheet);
    pendingSheet = null;
  }
}

const SHEET_DELAY_MS = 900;

game.subscribe((state) => {
  currentState = state;

  levelLabel.textContent = `Puzzle ${state.level}`;
  subLabel.textContent = describeProgress(state);

  fitBoard();
  renderer.render(state);

  const playing = state.phase === 'playing';
  shuffleButton.disabled = !playing;
  deselectButton.disabled = !playing || state.selected.size === 0;
  submitButton.disabled = !playing || state.selected.size !== GROUP_SIZE;
  undoButton.disabled = !state.canUndo || state.phase === 'loading';
  restartButton.disabled = state.phase === 'loading' || state.moveCount === 0;
  hintButton.disabled = !playing;

  if (state.effect.kind === 'reset') clearPendingSheet();
  handleEffect(state);

  if (state.phase === 'won' && lastPhase !== 'won') {
    renderer.celebrate();
    sfx.win();
    clearPendingSheet();
    pendingSheet = window.setTimeout(() => showWin(state), SHEET_DELAY_MS);
  }

  if (state.phase === 'lost' && lastPhase !== 'lost') {
    sfx.lose();
    clearPendingSheet();
    pendingSheet = window.setTimeout(() => showLoss(), SHEET_DELAY_MS);
  }

  lastPhase = state.phase;
});

function handleEffect(state: GameState): void {
  const { effect } = state;
  if (effect.kind !== 'guess') {
    if (effect.kind === 'hint') sfx.complete();
    return;
  }

  const { verdict } = effect;
  if (verdict.kind === 'correct') {
    if (state.phase !== 'won') sfx.complete();
  } else if (verdict.kind === 'one-away') {
    sfx.reject();
    say('One away…');
  } else if (verdict.kind === 'wrong') {
    sfx.reject();
  } else if (verdict.kind === 'repeat') {
    sfx.reject();
    say('Already guessed');
  }
}

/* -------------------------------------------------------------- the toast */

/** One at a time, handle kept — see Wordle's `say`, which this copies. */
let toastEl: HTMLElement | null = null;
let toastTimer: number | null = null;

function say(message: string): void {
  toastEl?.remove();
  if (toastTimer !== null) window.clearTimeout(toastTimer);

  const node = el('div', { class: 'toast', role: 'status' }, message);
  toastEl = node;
  boardEl.append(node);

  toastTimer = window.setTimeout(() => {
    node.remove();
    if (toastEl === node) toastEl = null;
  }, 1400);
}

/* ---------------------------------------------------------------- overlays */

function showWin(state: GameState): void {
  const mistakes = state.progress.mistakes;

  openSheet(
    (sheet) => {
      sheet.content.append(el('h2', { class: 'win-title' }, mistakes === 0 ? 'Perfect' : 'Solved'));
      sheet.content.append(
        el(
          'div',
          { class: 'result-line' },
          `<b>${mistakes}</b><span>${mistakes === 1 ? 'mistake' : 'mistakes'}</span>`,
        ),
      );

      const next = el('button', { class: 'button button--full' }, 'Next puzzle');
      next.addEventListener('click', () => {
        sheet.close();
        void game.advance();
      });
      sheet.content.append(next);
    },
    { dismissible: false },
  );
}

/**
 * Out of mistakes. The board behind the sheet already shows every group, so
 * the sheet says nothing about them. Undo is offered first and costs nothing.
 */
function showLoss(): void {
  openSheet(
    (sheet) => {
      sheet.content.append(el('h2', { class: 'lose-title' }, 'Out of mistakes'));

      const back = el('button', { class: 'button button--full' }, 'Undo');
      back.addEventListener('click', () => {
        sheet.close();
        game.undo();
      });

      const restart = el('button', { class: 'button button--ghost button--full' }, 'Restart');
      restart.addEventListener('click', () => {
        sheet.close();
        game.restart();
      });

      sheet.content.append(back, restart);
    },
    { dismissible: false },
  );
}

/* ---------------------------------------------------------------- controls */

shuffleButton.addEventListener('click', () => game.shuffle());
deselectButton.addEventListener('click', () => game.deselectAll());
submitButton.addEventListener('click', () => game.submit());
undoButton.addEventListener('click', () => game.undo());
restartButton.addEventListener('click', () => game.restart());
hintButton.addEventListener('click', () => {
  if (!game.requestHint()) sfx.reject();
});

settingsButton.addEventListener('click', () => {
  openSettings({
    gameId: GAME_ID,
    gameName: 'Connections',
    save: game.currentSave,
    currentLevel: game.currentSave.level,
    levelNoun: 'Puzzle',
    progressLine: `${game.currentSave.stats.levelsCleared} puzzles solved`,
    showTimer: false,
    shapesLabel: 'Shapes on groups',
    shapesDescription: 'A shape marks each group’s colour.',
    onSettingsChange: (patch) => {
      if (patch.colorBlindShapes !== undefined) applyShapes(patch.colorBlindShapes);
      game.updateSettings(patch);
    },
    onHowToPlay: () => howTo.open(),
    onImport: (save) => {
      applyShapes(save.settings.colorBlindShapes);
      return game.replaceSave(save);
    },
    onGoToLevel: (level) => game.goToLevel(level),
  });
});

function applyShapes(on: boolean): void {
  if (on) document.documentElement.setAttribute('data-shapes', 'on');
  else document.documentElement.removeAttribute('data-shapes');
}

/** Enter submits, for anyone playing on a laptop. */
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || document.querySelector('.overlay')) return;
  const target = event.target;
  if (target instanceof Element && target.closest('input, textarea, button')) return;
  game.submit();
  event.preventDefault();
});

const refit = (): void => {
  if (!currentState) return;
  fitBoard();
  renderer.render({ ...currentState, effect: { kind: 'none' } });
};
window.addEventListener('resize', refit);
window.addEventListener('orientationchange', () => window.setTimeout(refit, 220));

/* -------------------------------------------------------------------- boot */

void (async () => {
  await game.start();
  applyTheme(game.settings.theme);
  applyShapes(game.settings.colorBlindShapes);
  setSoundEnabled(game.settings.sound);
  if (currentState) refit();

  if (shouldAutoShow(game.currentSave)) howTo.open(true);
})();

registerServiceWorker();
