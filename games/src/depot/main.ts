/**
 * Depot entry point. Wires the controller to the renderer and the chrome.
 */

import '../shared/shell.css';
import './depot.css';

import { setSoundEnabled, sfx } from '../shared/audio';
import { registerServiceWorker } from '../shared/pwa';
import { createHowToPlay, shouldAutoShow } from '../shared/how-to-play';
import { openSettings } from '../shared/settings-sheet';
import { createTimedPlay } from '../shared/timed-play';
import { budgetFor } from '../shared/timer';
import { applyTheme, el, icons, openSheet, prefersReducedMotion } from '../shared/ui';
import { DepotGame, GAME_ID, type GameState } from './game';
import { RULES } from './rules';
import { BoardRenderer, describeProgress } from './render';

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

/**
 * The rules sheet. Built before the top bar because the `?` lives in it, and
 * wired to `game` and `timed` through closures that only run on a tap — both
 * are declared further down this file.
 */
const howTo = createHowToPlay({
  rules: RULES,
  onOpen: () => timed.pause('howto'),
  onClose: () => timed.resume('howto'),
  onSeen: () => game.markHowToPlaySeen(),
});

const topbarActions = el('div', { class: 'topbar-actions' });
topbarActions.append(howTo.button, settingsButton);
topbar.append(levelBlock, topbarActions);

const boardEl = el('main', { class: 'board', 'aria-label': 'The depot' });

const undoButton = controlButton('Undo', icons.undo);
const restartButton = controlButton('Restart', icons.restart);
const hintButton = controlButton('Hint', icons.hint);
const controls = el('footer', { class: 'controls' });
controls.append(undoButton, restartButton, hintButton);

app.append(topbar, boardEl, controls);
app.classList.add('app--depot');

function controlButton(label: string, icon: string): HTMLButtonElement {
  return el('button', { class: 'control', type: 'button' }, `${icon}<span>${label}</span>`);
}

/* -------------------------------------------------------------------- game */

const game = new DepotGame();
const reducedMotion = prefersReducedMotion();

const renderer = new BoardRenderer(boardEl, {
  reducedMotion,
  colorBlindShapes: false,
  onTap: (id) => game.tap(id),
});

/* ------------------------------------------------------------------- clock */

/**
 * The optional clock. Off by default, and not a difficulty setting — the board
 * is identical either way.
 *
 * A bus filling up and driving off is what pays time back, rather than any old
 * tap: rewarding the tap would reward pulling buses out at random, which is
 * exactly the play the game is asking you not to make.
 */
const timed = createTimedPlay<GameState>({
  anchor: settingsButton,
  isTimed: () => game.settings.timed,
  onTimedChange: (value) => game.updateSettings({ timed: value }),
  budget: (state) =>
    state.generated
      ? budgetFor({
          units: state.generated.moves,
          rewards: state.generated.board.buses.length,
          pressure: state.generated.difficulty,
          generous: 8,
          tight: 4.5,
          floor: 35,
        })
      : null,
  progress: (state) => state.departed,
  isPlaying: (state) => state.phase === 'playing',
  levelKey: (state) => (state.generated ? `${state.level}` : null),
  onExpire: () => game.loseToTime(),
});

/* --------------------------------------------------------------------- fit */

/** Widest a bay in the lot may be drawn. Past this the lot stops reading as one object. */
const MAX_CELL = 62;
const MIN_CELL = 22;

/**
 * Sizes the lot so the whole screen fits without scrolling.
 *
 * The queue and the kerb are laid out by the browser and vary in height — the
 * queue wraps onto a second row on a narrow phone, and the kerb is two, three
 * or four bays depending on the level — so their heights are *measured* rather
 * than assumed, and the lot gets whatever is left. Hardcoding a copy of a CSS
 * value here is how Gridlock once hung its exit five pixels off the screen.
 *
 * Measured from `.board`, which is only trustworthy because `.app` pins its
 * column to `minmax(0, 1fr)`: a board wider than the phone would otherwise
 * widen its own container and this measurement would chase itself.
 *
 * Returns true when the size changed, so the caller knows to redraw.
 */
function fitBoard(cols: number, rows: number): boolean {
  const style = getComputedStyle(boardEl);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const gap = parseFloat(style.rowGap) || 0;

  const queueEl = boardEl.querySelector('.queue') as HTMLElement | null;
  const kerbEl = boardEl.querySelector('.kerb') as HTMLElement | null;
  const above = (queueEl?.offsetHeight ?? 0) + (kerbEl?.offsetHeight ?? 0) + gap * 2;

  const availableWidth = boardEl.clientWidth - padX;
  const availableHeight = boardEl.clientHeight - padY - above;
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
 * The one deferred thing in the game: a beat between the last tap and the sheet
 * that talks about it. The handle is kept and cancelled on every reset, so an
 * undo or a new level inside that window cannot pop a sheet about a level that
 * is no longer over.
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

  // Drawn first, then measured, then drawn again only if the fit moved. The
  // queue's height is a consequence of how many people are left, so there is
  // nothing to measure until it is on the page.
  renderer.render(state);
  const board = state.generated?.board;
  if (board && fitBoard(board.width, board.height)) renderer.render(state);

  timed.sync(state);

  undoButton.disabled = !state.canUndo || state.phase === 'loading';
  restartButton.disabled = state.phase === 'loading' || state.moveCount === 0;
  hintButton.disabled = state.phase !== 'playing';

  if (state.effect.kind === 'reset') {
    clearPendingSheet();
    renderer.clearGhosts();
  }
  handleEffect(state);

  if (state.phase === 'won' && lastPhase !== 'won') {
    renderer.celebrate();
    sfx.win();
    clearPendingSheet();
    pendingSheet = window.setTimeout(() => showWin(state), 700);
  }

  if (state.phase === 'lost' && lastPhase !== 'lost') {
    sfx.reject();
    clearPendingSheet();
    pendingSheet = window.setTimeout(() => showLoss(state), 460);
  }

  lastPhase = state.phase;
});

function handleEffect(state: GameState): void {
  const board = state.generated?.board;
  const { effect } = state;
  if (!board) return;

  if (effect.kind === 'pull') {
    renderer.showDeparture(board, effect.id);
    // Pitch rises with how many people that bus got moving, so a good pull is
    // audible without anything having to announce it.
    if (effect.boarded > 0) sfx.pour(Math.min(6, effect.boarded * 0.8));
    else sfx.select();
  } else if (effect.kind === 'reject') {
    sfx.reject();
    renderer.showReject(effect.id);
  } else if (effect.kind === 'hint') {
    renderer.showHint(effect.id);
  }
}

/* ---------------------------------------------------------------- overlays */

function showWin(state: GameState): void {
  openSheet(
    (sheet) => {
      sheet.content.append(el('h2', { class: 'win-title' }, 'All aboard'));
      sheet.content.append(
        el(
          'div',
          { class: 'result-line' },
          `<b>${state.moveCount}</b><span>${state.moveCount === 1 ? 'bus' : 'buses'} out of the lot</span>`,
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
 * Two ways to lose, and they want different words.
 *
 * The clock is optional and nothing about the board is lost when it runs out,
 * so carrying on is the first option there. A jammed kerb is a real dead end —
 * every bay is spent on a colour the front of the queue does not want — so the
 * first option is the move that caused it.
 */
function showLoss(state: GameState): void {
  const timedOut = state.outOfTime;

  openSheet(
    (sheet) => {
      sheet.content.append(
        el('h2', { class: 'lose-title' }, timedOut ? 'Out of time' : 'Every bay taken'),
      );
      if (!timedOut) {
        sheet.content.append(
          el(
            'p',
            { class: 'result-note' },
            'Nobody at the front of the queue can board, and there is nowhere to put another bus.',
          ),
        );
      }

      const back = el(
        'button',
        { class: 'button button--full' },
        timedOut ? 'Keep going' : 'Undo that',
      );
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

undoButton.addEventListener('click', () => game.undo());
restartButton.addEventListener('click', () => game.restart());
hintButton.addEventListener('click', () => {
  if (game.requestHint() === null) sfx.reject();
});

settingsButton.addEventListener('click', () => {
  timed.pause('settings');
  openSettings({
    gameId: GAME_ID,
    gameName: 'Depot',
    save: game.currentSave,
    currentLevel: game.currentSave.level,
    showShapes: true,
    onSettingsChange: (patch) => {
      // Renderer options are set *before* the state change that triggers the
      // redraw. `updateSettings` notifies synchronously, so doing this the
      // other way round redraws with the old options and the toggle appears
      // not to work until the next tap.
      if (patch.colorBlindShapes !== undefined) {
        renderer.setOptions({ colorBlindShapes: patch.colorBlindShapes });
      }
      game.updateSettings(patch);
      if (patch.timed !== undefined) timed.chip.setEnabled(patch.timed);
    },
    onHowToPlay: () => howTo.open(),
    onImport: (save) => game.replaceSave(save),
    onGoToLevel: (level) => game.goToLevel(level),
    onClose: () => timed.resume('settings'),
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
  lastCell = -1;
  renderer.render(currentState);
  const board = currentState.generated?.board;
  if (board && fitBoard(board.width, board.height)) renderer.render(currentState);
};
window.addEventListener('resize', refit);
window.addEventListener('orientationchange', () => window.setTimeout(refit, 220));

/* -------------------------------------------------------------------- boot */

void (async () => {
  await game.start();
  applyTheme(game.settings.theme);
  setSoundEnabled(game.settings.sound);
  renderer.setOptions({ colorBlindShapes: game.settings.colorBlindShapes });
  if (currentState) refit();

  // Offered once, on a save that has never cleared a level. See
  // `shouldAutoShow` for why it is not simply "has not seen it".
  if (shouldAutoShow(game.currentSave)) howTo.open(true);
})();

registerServiceWorker();
