/**
 * Castle entry point. Wires the controller to the renderer and the chrome.
 */

import '../shared/shell.css';
import './castle.css';

import { setSoundEnabled, sfx } from '../shared/audio';
import { createHowToPlay, shouldAutoShow } from '../shared/how-to-play';
import { registerServiceWorker } from '../shared/pwa';
import { openSettings } from '../shared/settings-sheet';
import { applyTheme, el, icons, openSheet, prefersReducedMotion } from '../shared/ui';
import { pinViewportHeight } from '../shared/viewport';
import { CastleGame, GAME_ID, type GameState } from './game';
import { BoardRenderer, describeProgress } from './render';
import { RULES } from './rules';

const app = document.getElementById('app');
if (!app) throw new Error('#app is missing');

// Before anything measures the board: the shell is sized from the height this
// writes down, not from the browser's idea of the viewport. See viewport.ts.
pinViewportHeight();

/* ------------------------------------------------------------------ chrome */

const levelLabel = el('b', {}, 'Level 1');
const subLabel = el('span', {}, '');
const settingsButton = el(
  'button',
  { class: 'icon-button', 'aria-label': 'Settings' },
  icons.settings,
);

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

const boardEl = el('main', { class: 'board', 'aria-label': 'The map' });

const undoButton = controlButton('Undo', icons.undo);
const restartButton = controlButton('Restart', icons.restart);
const hintButton = controlButton('Hint', icons.hint);
const controls = el('footer', { class: 'controls' });
controls.append(undoButton, restartButton, hintButton);

app.append(topbar, boardEl, controls);
app.classList.add('app--castle');

function controlButton(label: string, icon: string): HTMLButtonElement {
  return el('button', { class: 'control', type: 'button' }, `${icon}<span>${label}</span>`);
}

/* -------------------------------------------------------------------- game */

const game = new CastleGame();
const reducedMotion = prefersReducedMotion();

const renderer = new BoardRenderer(boardEl, {
  reducedMotion,
  onPlot: (plot) => game.tapPlot(plot),
  onSelect: (kind) => game.select(kind),
  onGo: () => {
    if (renderer.watching) renderer.skipWave();
    else game.launch();
  },
});

/* --------------------------------------------------------------------- fit */

const MAX_CELL = 64;
const MIN_CELL = 30;

/**
 * Sizes the map so the whole screen fits without scrolling.
 *
 * The wave strip and the tray are laid out by the browser — the strip wraps to
 * a second row when a wave has many groups — so their heights are measured
 * rather than assumed, and the map gets whatever is left.
 *
 * Returns true when the size changed, so the caller knows to redraw.
 */
function fitBoard(cols: number, rows: number): boolean {
  const style = getComputedStyle(boardEl);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const gap = parseFloat(style.rowGap) || 0;

  const waveEl = boardEl.querySelector('.wave') as HTMLElement | null;
  const trayEl = boardEl.querySelector('.tray') as HTMLElement | null;
  const around = (waveEl?.offsetHeight ?? 0) + (trayEl?.offsetHeight ?? 0) + gap * 2;

  const availableWidth = boardEl.clientWidth - padX;
  const availableHeight = boardEl.clientHeight - padY - around;
  if (availableWidth <= 0 || availableHeight <= 0) return false;

  const cell = Math.floor(
    Math.max(MIN_CELL, Math.min(availableWidth / cols, availableHeight / rows, MAX_CELL)),
  );
  if (cell === lastCell) return false;
  lastCell = cell;
  renderer.setCell(cell);
  return true;
}

let lastCell = -1;

/* ------------------------------------------------------- state -> screen */

let lastPhase: GameState['phase'] = 'loading';
let currentState: GameState | null = null;

/**
 * A beat between the wave ending and the sheet that talks about it. The handle
 * is kept and cancelled on every reset, so an undo or a new level inside that
 * window cannot pop a sheet about a wave that is no longer over.
 */
let pendingSheet: number | null = null;

function clearPendingSheet(): void {
  if (pendingSheet !== null) {
    window.clearTimeout(pendingSheet);
    pendingSheet = null;
  }
}

game.subscribe((state) => {
  currentState = state;

  levelLabel.textContent = `Level ${state.level}`;
  subLabel.textContent = describeProgress(state);

  renderer.render(state);
  const level = state.generated;
  if (level && fitBoard(level.width, level.height)) renderer.render(state);

  undoButton.disabled = !state.canUndo || state.phase === 'loading';
  restartButton.disabled = state.phase === 'loading' || state.moveCount === 0;
  hintButton.disabled = state.phase !== 'planning';

  if (state.effect.kind === 'reset') {
    // Undo is live during the show. Whatever was playing is for a wave that
    // has just been taken back.
    clearPendingSheet();
    renderer.stopWave();
  }
  handleEffect(state);

  if (state.phase === 'won' && lastPhase !== 'won') {
    sfx.win();
    clearPendingSheet();
    pendingSheet = window.setTimeout(() => showWin(state), 450);
  }

  if (state.phase === 'lost' && lastPhase !== 'lost') {
    sfx.lose();
    clearPendingSheet();
    pendingSheet = window.setTimeout(() => showLoss(), 450);
  }

  lastPhase = state.phase;
});

function handleEffect(state: GameState): void {
  const { effect } = state;
  if (effect.kind === 'place') {
    sfx.select();
    renderer.showPlaced(effect.plot);
  } else if (effect.kind === 'remove') {
    sfx.pour(0);
  } else if (effect.kind === 'reject') {
    sfx.reject();
    renderer.showReject(effect.plot);
  } else if (effect.kind === 'hint') {
    renderer.showHint(effect.target);
  } else if (effect.kind === 'launch' && state.outcome) {
    sfx.complete();
    renderer.playWave(state.outcome, () => game.finishWatching());
  }
}

/* ---------------------------------------------------------------- overlays */

function showWin(state: GameState): void {
  openSheet(
    (sheet) => {
      sheet.content.append(el('h2', { class: 'win-title' }, 'Castle holds'));
      sheet.content.append(
        el(
          'div',
          { class: 'result-line' },
          `<b>${state.outcome?.killed ?? 0}</b><span>enemies</span>`,
        ),
      );

      const next = el('button', { class: 'button button--full' }, 'Next level');
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
 * No explanation under the title. The board behind the sheet already says why
 * — the enemy that got through is standing in the gate, lit red.
 */
function showLoss(): void {
  openSheet(
    (sheet) => {
      sheet.content.append(el('h2', { class: 'lose-title' }, 'Gate breached'));

      const undo = el('button', { class: 'button button--full' }, 'Undo');
      undo.addEventListener('click', () => {
        sheet.close();
        game.undo();
      });

      const restart = el('button', { class: 'button button--ghost button--full' }, 'Restart');
      restart.addEventListener('click', () => {
        sheet.close();
        game.restart();
      });

      sheet.content.append(undo, restart);
    },
    { dismissible: false },
  );
}

/* ---------------------------------------------------------------- controls */

undoButton.addEventListener('click', () => game.undo());
restartButton.addEventListener('click', () => game.restart());
hintButton.addEventListener('click', () => {
  if (game.requestHint() === null) sfx.reject();
});

settingsButton.addEventListener('click', () => {
  openSettings({
    gameId: GAME_ID,
    gameName: 'Castle',
    save: game.currentSave,
    currentLevel: game.currentSave.level,
    // Every tower and enemy is its own shape, so there is nothing for the
    // overlay to add. See `art.ts`.
    showShapes: false,
    // A clock would run while the wave does, which measures nothing.
    showTimer: false,
    onSettingsChange: (patch) => game.updateSettings(patch),
    onHowToPlay: () => howTo.open(),
    onImport: (save) => game.replaceSave(save),
    onGoToLevel: (level) => game.goToLevel(level),
  });
});

/**
 * Keyboard shortcuts. Not while a sheet is open or a field has the caret: the
 * save code in Settings is base64, and typing one must not undo the level.
 */
document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest('input, textarea') || target?.isContentEditable) return;
  if (document.querySelector('.overlay')) return;

  if (event.key === 'z') game.undo();
  else if (event.key === 'r') game.restart();
  else if (event.key === 'h') game.requestHint();
  else if (event.key === '1' || event.key === '2' || event.key === '3') {
    game.select((Number(event.key) - 1) as 0 | 1 | 2);
  } else if (event.key === 'Enter' || event.key === ' ') {
    if (renderer.watching) renderer.skipWave();
    else game.launch();
  }
});

/**
 * A hidden tab jumps the show to its end. Timers are throttled or stopped in
 * the background, and a wave that crawls on for minutes behind a locked phone
 * helps nobody; the result was settled when Go was pressed.
 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden && renderer.watching) renderer.skipWave();
});

const refit = (): void => {
  if (!currentState) return;
  lastCell = -1;
  renderer.render(currentState);
  const level = currentState.generated;
  if (level && fitBoard(level.width, level.height)) renderer.render(currentState);
};
window.addEventListener('resize', refit);
window.addEventListener('orientationchange', () => window.setTimeout(refit, 220));

/* -------------------------------------------------------------------- boot */

void (async () => {
  await game.start();
  applyTheme(game.settings.theme);
  setSoundEnabled(game.settings.sound);
  if (currentState) refit();

  if (shouldAutoShow(game.currentSave)) howTo.open(true);
})();

registerServiceWorker();
