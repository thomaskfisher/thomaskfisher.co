/**
 * Spider entry point. Wires the controller to the renderer and the chrome.
 */

import '../shared/shell.css';
import './spider.css';

import { setSoundEnabled, sfx } from '../shared/audio';
import { registerServiceWorker } from '../shared/pwa';
import { createHowToPlay, shouldAutoShow } from '../shared/how-to-play';
import { openSettings } from '../shared/settings-sheet';
import { applyTheme, el, icons, openSheet, prefersReducedMotion } from '../shared/ui';
import { GAME_ID, type GameState, SpiderGame } from './game';
import { RULES } from './rules';
import { TableRenderer, describeProgress } from './render';

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

const howTo = createHowToPlay({
  rules: RULES,
  onSeen: () => game.markHowToPlaySeen(),
});

const topbarActions = el('div', { class: 'topbar-actions' });
topbarActions.append(howTo.button, settingsButton);
topbar.append(levelBlock, topbarActions);

const boardEl = el('main', { class: 'board' });
const tableEl = el('div', { class: 'table', 'aria-label': 'The table' });
boardEl.append(tableEl);

const undoButton = controlButton('Undo', icons.undo);
const restartButton = controlButton('Restart', icons.restart);
const hintButton = controlButton('Hint', icons.hint);
const controls = el('footer', { class: 'controls' });
controls.append(undoButton, restartButton, hintButton);

app.append(topbar, boardEl, controls);
app.classList.add('app--spider');

function controlButton(label: string, icon: string): HTMLButtonElement {
  return el('button', { class: 'control', type: 'button' }, `${icon}<span>${label}</span>`);
}

/* -------------------------------------------------------------------- game */

const game = new SpiderGame();
const reducedMotion = prefersReducedMotion();

const renderer = new TableRenderer(tableEl, {
  reducedMotion,
  fourColor: false,
  onTap: (target) => game.tap(target),
});

/* --------------------------------------------------------------------- fit */

/**
 * Ten columns across the screen is the whole scale of this game.
 *
 * The card width falls out of the width available, the height out of the width,
 * and the tableau gets whatever is left under the stock row. Both that row's
 * height and the gaps are *measured* rather than assumed, because a copy of a
 * CSS value kept in JS is how Gridlock once hung its exit five pixels off the
 * screen.
 *
 * Measuring `.board` is only trustworthy because `.app` pins its column to
 * `minmax(0, 1fr)`: a table wider than the phone would otherwise widen its own
 * container and this measurement would chase itself.
 */
const COLUMNS = 10;
const MAX_CARD_WIDTH = 70;
const MIN_CARD_WIDTH = 20;
/** Playing cards are close to 1:1.4. Anything squarer stops reading as a card. */
const CARD_ASPECT = 1.42;

function fitBoard(): boolean {
  const style = getComputedStyle(boardEl);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const rowGap = parseFloat(style.rowGap) || 0;

  const tableau = boardEl.querySelector('.tableau');
  const columnGap = tableau ? parseFloat(getComputedStyle(tableau).columnGap) || 0 : 0;

  const availableWidth = boardEl.clientWidth - padX;
  const availableHeight = boardEl.clientHeight - padY;
  if (availableWidth <= 0 || availableHeight <= 0) return false;

  const width = Math.floor(
    Math.max(
      MIN_CARD_WIDTH,
      Math.min((availableWidth - columnGap * (COLUMNS - 1)) / COLUMNS, MAX_CARD_WIDTH),
    ),
  );
  const height = Math.round(width * CARD_ASPECT);
  const reserve = boardEl.querySelector('.reserve') as HTMLElement | null;
  const reserveHeight = reserve?.offsetHeight ?? 0;
  const tableauHeight = Math.max(height, availableHeight - reserveHeight - rowGap);

  const signature = `${width}:${height}:${tableauHeight}`;
  if (signature === lastFit) return false;
  lastFit = signature;
  renderer.setMetrics(width, height, tableauHeight);
  return true;
}

let lastFit = '';

/* --------------------------------------------------------- state -> screen */

let lastPhase: GameState['phase'] = 'loading';
let currentState: GameState | null = null;

/**
 * The one deferred thing in the game: a beat between the last card going home
 * and the sheet that talks about it. The handle is kept and cancelled on every
 * reset, so an undo or a new level inside that window cannot pop a sheet about
 * a level that is no longer over.
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

  // Drawn, then measured, then drawn again only if the fit moved. The tableau's
  // gap is a consequence of the stylesheet, so there is nothing to measure
  // until it is on the page.
  renderer.render(state);
  if (fitBoard()) renderer.render(state);

  undoButton.disabled = !state.canUndo || state.phase === 'loading';
  restartButton.disabled = state.phase === 'loading' || state.moveCount === 0;
  hintButton.disabled = state.phase !== 'playing';

  if (state.effect.kind === 'reset') clearPendingSheet();
  handleEffect(state);

  if (state.phase === 'won' && lastPhase !== 'won') {
    renderer.celebrate();
    sfx.win();
    clearPendingSheet();
    pendingSheet = window.setTimeout(() => showWin(state), 620);
  }

  if (state.phase === 'lost' && lastPhase !== 'lost') {
    sfx.reject();
    clearPendingSheet();
    pendingSheet = window.setTimeout(() => showLoss(), 380);
  }

  lastPhase = state.phase;
});

function handleEffect(state: GameState): void {
  const { effect } = state;
  if (effect.kind === 'select') sfx.select();
  else if (effect.kind === 'deal') sfx.pour(3);
  else if (effect.kind === 'reject') sfx.reject();
  else if (effect.kind === 'play') {
    // A set coming off the board is the only thing in Spider worth a noise of
    // its own, and it is the thing a player is listening for.
    if (effect.lifted > 0) sfx.complete();
    else sfx.select();
  }
}

/* ------------------------------------------------------------------ sheets */

function showWin(state: GameState): void {
  openSheet(
    (sheet) => {
      sheet.content.append(el('h2', { class: 'win-title' }, 'Board clear'));
      sheet.content.append(
        el('div', { class: 'result-line' }, `<b>${state.moveCount}</b><span>moves</span>`),
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
 * No explanation under the title. The table behind the sheet is already showing
 * why, and a paragraph restating it is read once and skipped forever after.
 */
function showLoss(): void {
  openSheet(
    (sheet) => {
      sheet.content.append(el('h2', { class: 'lose-title' }, 'Nothing left'));

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
  // Spider's search is a player rather than a proof, so a null here means "I
  // did not find a line", never "there is not one". Nothing honest to show for
  // that, so it buzzes. See the header of `solve.ts`.
  if (game.requestHint() === null) sfx.reject();
});

settingsButton.addEventListener('click', () => {
  openSettings({
    gameId: GAME_ID,
    gameName: 'Spider',
    save: game.currentSave,
    currentLevel: game.currentSave.level,
    showTimer: false,
    shapesLabel: 'Four-colour deck',
    shapesDescription: 'Each suit its own colour.',
    onSettingsChange: (patch) => {
      // Renderer options are set *before* the state change that triggers the
      // redraw. `updateSettings` notifies synchronously, so doing this the
      // other way round redraws with the old options and the toggle appears
      // not to work until the next tap.
      if (patch.colorBlindShapes !== undefined) {
        renderer.setOptions({ fourColor: patch.colorBlindShapes });
      }
      game.updateSettings(patch);
    },
    onHowToPlay: () => howTo.open(),
    onImport: (save) => game.replaceSave(save),
    onGoToLevel: (level) => game.goToLevel(level),
  });
});

/**
 * Keyboard shortcuts, and two things they must not do.
 *
 * The listener is on `document` so a shortcut works wherever the focus happens
 * to be — but that also means it fires while a sheet is open and while a text
 * field has the caret. Settings has a *save code* field, and a save code is
 * base64: typing one containing a `z`, an `r` or an `h` would otherwise undo,
 * restart or hint the level sitting behind the sheet, with nothing on screen to
 * show it had happened.
 */
document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  const target = event.target as HTMLElement | null;
  if (target?.closest('input, textarea') || target?.isContentEditable) return;
  if (document.querySelector('.overlay')) return;

  if (event.key === 'z') game.undo();
  else if (event.key === 'r') game.restart();
  else if (event.key === 'h') game.requestHint();
});

const refit = (): void => {
  if (!currentState) return;
  lastFit = '';
  renderer.render(currentState);
  if (fitBoard()) renderer.render(currentState);
};
window.addEventListener('resize', refit);
window.addEventListener('orientationchange', () => window.setTimeout(refit, 220));

/* -------------------------------------------------------------------- boot */

void (async () => {
  await game.start();
  applyTheme(game.settings.theme);
  setSoundEnabled(game.settings.sound);
  renderer.setOptions({ fourColor: game.settings.colorBlindShapes });
  if (currentState) refit();

  // Offered once, on a save that has never cleared a level. See
  // `shouldAutoShow` for why it is not simply "has not seen it".
  if (shouldAutoShow(game.currentSave)) howTo.open(true);
})();

registerServiceWorker();
