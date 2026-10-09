/**
 * Marble Sort entry point. Wires the controller to the renderer and the chrome.
 */

import '../shared/shell.css';
import './marblesort.css';

import { setSoundEnabled, sfx } from '../shared/audio';
import { createHowToPlay, shouldAutoShow } from '../shared/how-to-play';
import { registerServiceWorker } from '../shared/pwa';
import { openSettings } from '../shared/settings-sheet';
import { applyTheme, el, icons, openSheet, prefersReducedMotion } from '../shared/ui';
import { pinViewportHeight } from '../shared/viewport';
import { GAME_ID, type GameState, MarbleSortGame } from './game';
import { marblesLeft } from './model';
import { MarbleRenderer } from './render';
import { RULES } from './rules';

const app = document.getElementById('app');
if (!app) throw new Error('#app is missing');

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
  onOpen: () => game.pause('howto'),
  onClose: () => game.resume('howto'),
  onSeen: () => game.markHowToPlaySeen(),
});

const topbarActions = el('div', { class: 'topbar-actions' });
topbarActions.append(howTo.button, settingsButton);
topbar.append(levelBlock, topbarActions);

const boardEl = el('main', { class: 'board ms-board', 'aria-label': 'Marble machine' });

const undoButton = controlButton('Undo', icons.undo);
const restartButton = controlButton('Restart', icons.restart);
const hintButton = controlButton('Hint', icons.hint);
const controls = el('footer', { class: 'controls' });
controls.append(undoButton, restartButton, hintButton);

app.append(topbar, boardEl, controls);
app.classList.add('app--marblesort');

function controlButton(label: string, icon: string): HTMLButtonElement {
  return el('button', { class: 'control', type: 'button' }, `${icon}<span>${label}</span>`);
}

/* -------------------------------------------------------------------- game */

const game = new MarbleSortGame();

const renderer = new MarbleRenderer(boardEl, {
  showGlyphs: false,
  reducedMotion: prefersReducedMotion(),
  onTapPipe: (color) => game.tapPipe(color),
});

/* ------------------------------------------------------- state -> screen */

let lastPhase: GameState['phase'] = 'loading';
let currentState: GameState | null = null;

game.subscribe((state) => {
  currentState = state;

  levelLabel.textContent = `Level ${state.level}`;
  subLabel.textContent =
    state.phase === 'loading' || !state.sim
      ? 'Preparing…'
      : `${marblesLeft(state.sim)} marbles left`;

  renderer.render(state);

  undoButton.disabled = !state.canUndo || state.phase === 'loading';
  restartButton.disabled = state.phase === 'loading' || state.moveCount === 0;
  hintButton.disabled = state.phase !== 'playing';
  hintButton.classList.toggle('is-waiting', state.hintPending);

  handleEffect(state);

  if (state.phase === 'won' && lastPhase !== 'won') {
    sfx.win();
    window.setTimeout(() => showWin(state), 500);
  }
  if (state.phase === 'lost' && lastPhase !== 'lost') {
    sfx.reject();
    window.setTimeout(showLost, 420);
  }

  lastPhase = state.phase;
});

function handleEffect(state: GameState): void {
  const { effect } = state;
  if (effect.kind === 'drop') sfx.pour(Math.min(6, effect.count / 2));
  else if (effect.kind === 'tick' && effect.events.cleared.length > 0) sfx.complete();
  else if (effect.kind === 'reject') sfx.reject();
}

/* ---------------------------------------------------------------- overlays */

function showWin(state: GameState): void {
  // The phase may have moved on in the half second before this fires — an undo
  // straight after the last marble lands. A sheet for a level no longer won
  // would advance past a board still being played.
  if (currentState?.phase !== 'won') return;
  const total = state.generated
    ? state.generated.board.columns.reduce((n, c) => n + c.length, 0) *
      state.generated.board.blockSize
    : 0;
  openSheet(
    (sheet) => {
      sheet.content.append(el('h2', { class: 'win-title' }, 'All sorted'));
      sheet.content.append(
        el('div', { class: 'result-line' }, `<b>${total}</b><span>marbles</span>`),
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

function showLost(): void {
  if (currentState?.phase !== 'lost') return;
  openSheet(
    (sheet) => {
      sheet.content.append(el('h2', { class: 'lose-title' }, 'Belt is full'));

      const restart = el('button', { class: 'button button--full' }, 'Restart');
      restart.addEventListener('click', () => {
        sheet.close();
        game.restart();
      });

      const undo = el('button', { class: 'button button--ghost button--full' }, 'Undo');
      undo.addEventListener('click', () => {
        sheet.close();
        game.undo();
      });

      sheet.content.append(restart, undo);
    },
    { dismissible: false },
  );
}

/* ---------------------------------------------------------------- controls */

undoButton.addEventListener('click', () => game.undo());
restartButton.addEventListener('click', () => game.restart());
hintButton.addEventListener('click', () => game.requestHint());

settingsButton.addEventListener('click', () => {
  game.pause('settings');
  openSettings({
    gameId: GAME_ID,
    gameName: 'Marble Sort',
    save: game.currentSave,
    currentLevel: game.currentSave.level,
    // Already real time; a countdown on top would be a second clock to fight.
    showTimer: false,
    onSettingsChange: (patch) => {
      // Renderer options first: the redraw `updateSettings` fires must see them.
      if (patch.colorBlindShapes !== undefined) {
        renderer.setOptions({ showGlyphs: patch.colorBlindShapes });
      }
      game.updateSettings(patch);
    },
    onHowToPlay: () => howTo.open(),
    onImport: (save) => game.replaceSave(save),
    onGoToLevel: (level) => game.goToLevel(level),
    onClose: () => game.resume('settings'),
  });
});

document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (document.querySelector('.overlay')) return;
  if (event.key === 'z') game.undo();
  else if (event.key === 'r') game.restart();
  else if (event.key === 'h') game.requestHint();
  else if (/^[1-8]$/.test(event.key)) game.tapPipe(Number(event.key) - 1);
});

/**
 * A hidden tab holds the belt rather than letting it run on throttled timers.
 * `pagehide` covers the phone being locked, which on iOS does not always fire
 * `visibilitychange` first. See Tetris for the longer version of this.
 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    game.pause('hidden');
    game.flush();
  } else {
    game.resume('hidden');
  }
});
window.addEventListener('pagehide', () => {
  game.pause('hidden');
  game.flush();
});
window.addEventListener('pageshow', () => game.resume('hidden'));

const refit = (): void => {
  if (currentState) renderer.fit(currentState);
};
window.addEventListener('resize', refit);
window.addEventListener('orientationchange', () => setTimeout(refit, 220));

/* -------------------------------------------------------------------- boot */

void (async () => {
  await game.start();
  applyTheme(game.settings.theme);
  setSoundEnabled(game.settings.sound);
  renderer.setOptions({ showGlyphs: game.settings.colorBlindShapes });
  if (currentState) renderer.fit(currentState);

  if (shouldAutoShow(game.currentSave)) howTo.open(true);
})();

registerServiceWorker();
