/**
 * Color Sort entry point. Wires the controller to the renderer and the chrome.
 */

import '../shared/shell.css';
import './colorsort.css';

import { setSoundEnabled, sfx } from '../shared/audio';
import { openSettings } from '../shared/settings-sheet';
import { applyTheme, el, icons, openSheet, prefersReducedMotion } from '../shared/ui';
import { ColorSortGame, GAME_ID, type GameState } from './game';
import { applyLayout, chooseLayout } from './layout';
import { isComplete } from './model';
import { BoardRenderer } from './render';
import { registerServiceWorker } from '../shared/pwa';

const app = document.getElementById('app');
if (!app) throw new Error('#app is missing');

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
topbar.append(levelBlock, settingsButton);

const board = el('main', { class: 'board', 'aria-label': 'Puzzle board' });

const undoButton = controlButton('Undo', icons.undo);
const restartButton = controlButton('Restart', icons.restart);
const hintButton = controlButton('Hint', icons.hint);

const controls = el('footer', { class: 'controls' });
controls.append(undoButton, restartButton, hintButton);

app.append(topbar, board, controls);

function controlButton(label: string, icon: string): HTMLButtonElement {
  const button = el('button', { class: 'control', type: 'button' }, `${icon}<span>${label}</span>`);
  return button as HTMLButtonElement;
}

/* -------------------------------------------------------------------- game */

const game = new ColorSortGame();

const renderer = new BoardRenderer(board, {
  showGlyphs: false,
  reducedMotion: prefersReducedMotion(),
  onTapTube: (index) => {
    game.tapTube(index);
  },
});

/** Sizes and arranges the tubes so the whole board fits the viewport. */
function fitBoard(state: GameState): void {
  const count = state.board.tubes.length;
  if (count === 0) return;

  // Width comes from the app shell, not the board: the board's own width is
  // set by this function, so measuring it would feed back on itself.
  const shell = getComputedStyle(app as HTMLElement);
  const width =
    (app as HTMLElement).clientWidth -
    parseFloat(shell.paddingLeft || '0') -
    parseFloat(shell.paddingRight || '0') -
    24;
  const height = board.clientHeight - 16;
  if (width <= 0 || height <= 0) return;

  applyLayout(board, chooseLayout(count, state.board.height, width, height));
}

/* ------------------------------------------------------- state -> screen */

let lastCompleteCount = 0;
let lastPhase: GameState['phase'] = 'loading';
let lastLevel = 0;
let currentState: GameState | null = null;

game.subscribe((state) => {
  currentState = state;
  levelLabel.textContent = `Level ${state.level}`;
  subLabel.textContent =
    state.phase === 'loading'
      ? 'Preparing…'
      : `${state.moveCount} move${state.moveCount === 1 ? '' : 's'}`;

  renderer.render(state);
  fitBoard(state);

  undoButton.disabled = !state.canUndo || state.phase === 'loading';
  restartButton.disabled = state.phase === 'loading' || state.moveCount === 0;
  hintButton.disabled = state.phase !== 'playing';

  playSounds(state);

  if (state.phase === 'won' && lastPhase !== 'won') {
    renderer.celebrate();
    sfx.win();
    window.setTimeout(() => showWin(state), 620);
  }

  if (state.phase === 'stuck' && lastPhase !== 'stuck') {
    window.setTimeout(() => showStuck(), 260);
  }

  lastPhase = state.phase;
  lastLevel = state.level;
});

function playSounds(state: GameState): void {
  // A new level (or an undo/restart) resets the baseline without making noise.
  if (state.effect.kind === 'reset' || state.level !== lastLevel) {
    lastCompleteCount = countComplete(state);
    return;
  }

  if (state.effect.kind === 'pour') {
    sfx.pour(state.effect.amount);
    const complete = countComplete(state);
    // A tube finishing deserves its own note, layered over the pour.
    if (complete > lastCompleteCount) window.setTimeout(() => sfx.complete(), 130);
    lastCompleteCount = complete;
  } else if (state.effect.kind === 'reject') {
    sfx.reject();
  }
}

function countComplete(state: GameState): number {
  return state.board.tubes.filter((tube) => isComplete(tube, state.board.height)).length;
}

/* ---------------------------------------------------------------- overlays */

function showWin(state: GameState): void {
  const par = game.parMoves;
  openSheet(
    (sheet) => {
      sheet.content.append(el('h2', { class: 'win-title' }, 'Level complete'));

      const stats = el('div', { class: 'win-stats' });
      stats.append(
        el('div', { class: 'win-stat' }, `<b>${state.moveCount}</b><span>Your moves</span>`),
        el('div', { class: 'win-stat' }, `<b>${par}</b><span>Solver's moves</span>`),
      );
      sheet.content.append(stats);

      const next = el('button', { class: 'button button--full' }, `Play level ${state.level + 1}`);
      next.addEventListener('click', () => {
        sheet.close();
        void game.advance();
      });
      sheet.content.append(next);
    },
    { dismissible: false },
  );
}

function showStuck(): void {
  openSheet((sheet) => {
    sheet.content.append(el('h2', {}, 'No moves left'));
    sheet.content.append(
      el(
        'p',
        {},
        'This board is out of legal pours. Undo as far back as you like — there is no penalty, ' +
          'and every level here is solvable.',
      ),
    );

    const undo = el('button', { class: 'button button--full' }, 'Undo last move');
    undo.addEventListener('click', () => {
      sheet.close();
      game.undo();
    });

    const restart = el('button', { class: 'button button--ghost button--full' }, 'Start level over');
    restart.addEventListener('click', () => {
      sheet.close();
      game.restart();
    });

    sheet.content.append(undo, restart);
  });
}

/* ---------------------------------------------------------------- controls */

undoButton.addEventListener('click', () => game.undo());
restartButton.addEventListener('click', () => game.restart());
hintButton.addEventListener('click', () => {
  if (!game.requestHint()) sfx.reject();
});

settingsButton.addEventListener('click', () => {
  openSettings({
    gameId: GAME_ID,
    gameName: 'Color Sort',
    save: game.currentSave,
    currentLevel: game.currentSave.level,
    onSettingsChange: (patch) => {
      // Set renderer options first: `updateSettings` notifies, and the redraw it
      // triggers is the one that has to pick the new options up.
      if (patch.colorBlindShapes !== undefined) {
        renderer.setOptions({ showGlyphs: patch.colorBlindShapes });
      }
      game.updateSettings(patch);
    },
    onImport: (save) => game.replaceSave(save),
    onGoToLevel: (level) => game.goToLevel(level),
  });
});

/* Keyboard support falls out of using real buttons; these are the extras. */
document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === 'z') game.undo();
  else if (event.key === 'r') game.restart();
  else if (event.key === 'h') game.requestHint();
});

/* Re-fit on rotation, and on the iOS URL bar collapsing mid-scroll. */
const refit = (): void => {
  if (currentState) fitBoard(currentState);
};

window.addEventListener('resize', refit);
window.addEventListener('orientationchange', () => setTimeout(refit, 220));

/* -------------------------------------------------------------------- boot */

void (async () => {
  await game.start();
  applyTheme(game.settings.theme);
  setSoundEnabled(game.settings.sound);
  renderer.setOptions({ showGlyphs: game.settings.colorBlindShapes });
  if (currentState) {
    renderer.render(currentState);
    fitBoard(currentState);
  }
})();

registerServiceWorker();
