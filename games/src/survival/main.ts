/**
 * Survival entry point. Wires the controller to the renderer and the chrome.
 */

import '../shared/shell.css';
import './survival.css';

import { setSoundEnabled, sfx } from '../shared/audio';
import { registerServiceWorker } from '../shared/pwa';
import { openSettings } from '../shared/settings-sheet';
import { createTimedPlay } from '../shared/timed-play';
import { budgetFor } from '../shared/timer';
import { applyTheme, el, icons, openSheet, prefersReducedMotion } from '../shared/ui';
import { GAME_ID, type GameState, SurvivalGame } from './game';
import { BoardRenderer, describeProgress, formatCount } from './render';

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

const boardEl = el('main', { class: 'board', 'aria-label': 'The lane' });

const undoButton = controlButton('Undo', icons.undo);
const restartButton = controlButton('Restart', icons.restart);
const hintButton = controlButton('Hint', icons.hint);
const controls = el('footer', { class: 'controls' });
controls.append(undoButton, restartButton, hintButton);

app.append(topbar, boardEl, controls);
app.classList.add('app--survival');

function controlButton(label: string, icon: string): HTMLButtonElement {
  return el('button', { class: 'control', type: 'button' }, `${icon}<span>${label}</span>`);
}

/* -------------------------------------------------------------------- game */

const game = new SurvivalGame();
const reducedMotion = prefersReducedMotion();

const renderer = new BoardRenderer(boardEl, {
  showGlyphs: false,
  reducedMotion,
  onTapCell: (row, lane) => game.tapCell(row, lane),
});

/* ------------------------------------------------------------------- clock */

/**
 * Survival is the game the clock was really asked for.
 *
 * Reading the whole board and planning a route to the top is a two-minute job
 * if you let it be, and doing that turns a lane you commit to into a lane you
 * solve on paper first. Seconds per *row* is the unit that stops it: enough to
 * read the row in front of you and one or two above it, not enough to trace
 * every route to the horde. Surviving a row buys the next one.
 */
const timed = createTimedPlay<GameState>({
  anchor: settingsButton,
  isTimed: () => game.settings.timed,
  onTimedChange: (value) => game.updateSettings({ timed: value }),
  budget: (state) =>
    state.generated
      ? budgetFor({
          units: state.generated.board.rows,
          rewards: state.generated.board.rows,
          pressure: state.generated.difficulty,
          generous: 8,
          tight: 4.5,
          floor: 18,
        })
      : null,
  progress: (state) => state.route.length,
  isPlaying: (state) => state.phase === 'playing',
  levelKey: (state) => (state.generated ? `${state.level}` : null),
  onExpire: () => game.loseToTime(),
});

/* Proportions of the lane, all in px or as multiples of the cell. */
const GAP = 6;
const FIELD_GAP = 8;
const START_RATIO = 0.62;
const MAX_CELL_W = 132;
const MAX_CELL_H = 96;

/**
 * Sizes the lane so the whole board fits without scrolling.
 *
 * Both dimensions vary by level — three to five lanes, five to nine rows — and
 * the entire board has to stay on screen at once, because looking further up it
 * is the game. So this solves for the largest cell that still fits rather than
 * picking a size and hoping.
 *
 * Fitted to the grid's real content: the rows, the gaps between them, and the
 * start line the squad waits on. Sizing against the nominal board area instead
 * leaves dead margin at the bottom and shrinks every cell for nothing.
 */
function fitBoard(state: GameState): void {
  const board = state.generated?.board;
  if (!board) return;

  const hordeHeight = boardEl.querySelector<HTMLElement>('.horde')?.offsetHeight ?? 44;
  const availableWidth = boardEl.clientWidth - 12;
  const availableHeight = boardEl.clientHeight - hordeHeight - FIELD_GAP - 8;
  if (availableWidth <= 0 || availableHeight <= 0) return;

  const cellWidth = Math.max(
    30,
    Math.min((availableWidth - (board.lanes - 1) * GAP) / board.lanes, MAX_CELL_W),
  );

  // rows * h + START_RATIO * h + rows * gap <= available
  const cellHeight = Math.max(
    24,
    Math.min(
      (availableHeight - board.rows * GAP) / (board.rows + START_RATIO),
      cellWidth * 0.8,
      MAX_CELL_H,
    ),
  );

  const grid = boardEl.querySelector<HTMLElement>('.grid');
  if (!grid) return;
  grid.style.setProperty('--cell-w', `${cellWidth}px`);
  grid.style.setProperty('--cell-h', `${cellHeight}px`);
  grid.style.setProperty('--start-h', `${cellHeight * START_RATIO}px`);
  grid.style.setProperty('--gap', `${GAP}px`);
}

/* ------------------------------------------------------- state -> screen */

let lastPhase: GameState['phase'] = 'loading';
let currentState: GameState | null = null;

/**
 * The one deferred thing in the game: a beat between the last step and the
 * sheet that talks about it. The handle is kept and cancelled on every reset,
 * so an undo or a new level inside that window cannot pop a sheet about a run
 * that no longer exists.
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

  // Three steps, in this order, because each depends on the last: the cells
  // have to exist before they can be measured, the measurement decides the cell
  // size, and the squad is positioned from the cells' own boxes — so it has to
  // be placed again once they have their final size. Cheap: these boards are at
  // most forty-five elements, and this runs on state change, not on a frame loop.
  renderer.render(state);
  timed.sync(state);
  fitBoard(state);
  renderer.render(state);

  undoButton.disabled = !state.canUndo || state.phase === 'loading';
  restartButton.disabled = state.phase === 'loading' || state.moveCount === 0;
  hintButton.disabled = state.phase !== 'playing';

  if (state.effect.kind === 'reset') clearPendingSheet();
  handleEffect(state);

  if (state.phase === 'won' && lastPhase !== 'won') {
    renderer.celebrate();
    sfx.win();
    clearPendingSheet();
    pendingSheet = window.setTimeout(() => showWin(state), 640);
  }

  if (state.phase === 'lost' && lastPhase !== 'lost') {
    sfx.reject();
    clearPendingSheet();
    pendingSheet = window.setTimeout(() => showLost(state), 460);
  }

  lastPhase = state.phase;
});

function handleEffect(state: GameState): void {
  const board = state.generated?.board;
  const { effect } = state;
  if (!board) return;

  if (effect.kind === 'advance') {
    // Pitch tracks how much the squad grew, so a good gate sounds like one.
    const growth = effect.before > 0 ? effect.after / effect.before : 0;
    if (effect.after <= 0) sfx.reject();
    else sfx.pour(Math.max(0, Math.min(6, (growth - 1) * 3)));
    renderer.showAdvance(board, effect.row, effect.toLane);
  } else if (effect.kind === 'reject') {
    sfx.reject();
    renderer.showReject(board, effect.row, effect.lane);
  } else if (effect.kind === 'hint') {
    renderer.showHint(board, effect.row, effect.lane);
  }
}

/* ---------------------------------------------------------------- overlays */

function showWin(state: GameState): void {
  const horde = state.generated?.board.horde ?? 0;
  openSheet(
    (sheet) => {
      sheet.content.append(el('h2', { class: 'win-title' }, 'Broke through'));
      sheet.content.append(
        el(
          'div',
          { class: 'result-line' },
          `<b>${formatCount(state.count)}</b><span>against ${formatCount(horde)}</span>`,
        ),
      );

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

/**
 * The run is over. Not dismissible — the squad is gone or the horde is through,
 * and leaving the board tappable would only invite dead taps.
 *
 * There are no lives and no ad break here, so the recovery is generous: start
 * the lane again, or step back to just before the wrong turn. Every level has a
 * way through, and saying so is what keeps a loss a puzzle rather than a tax.
 */
function showLost(state: GameState): void {
  const horde = state.generated?.board.horde ?? 0;

  const headline = state.outOfTime
    ? 'Out of time'
    : state.lossCause === 'overrun'
      ? 'Not enough of you'
      : state.lossCause === 'blocked'
        ? 'Stopped at the barrier'
        : 'Squad wiped out';

  const explanation = state.outOfTime
    ? 'The clock ran out — the squad was fine. Step back and keep going, or turn the clock ' +
      'off in the top bar and take the lane at your own pace.'
    : state.lossCause === 'overrun'
      ? `You reached the front with ${formatCount(state.count)} against ${formatCount(horde)}. ` +
        'A different route through the same gates gets there with more — every level here has one.'
      : state.lossCause === 'blocked'
        ? 'The barrier needed more soldiers than the squad had left. Growing earlier, or ' +
          'arriving in a different lane, gets through it.'
        : 'That gate took the last of them. Every level here can be cleared — the route is ' +
          'what has to change, not the board.';

  openSheet(
    (sheet) => {
      sheet.content.append(el('h2', { class: 'lose-title' }, headline));
      sheet.content.append(el('p', {}, explanation));

      const undo = el('button', { class: 'button button--full' }, 'Step back');
      undo.addEventListener('click', () => {
        sheet.close();
        game.undo();
      });

      const restart = el('button', { class: 'button button--ghost button--full' }, 'Start the lane again');
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
  timed.pause('settings');
  openSettings({
    gameId: GAME_ID,
    gameName: 'Survival',
    save: game.currentSave,
    currentLevel: game.currentSave.level,
    onSettingsChange: (patch) => {
      // Renderer options first: the redraw that `updateSettings` triggers is
      // the one that has to pick them up.
      if (patch.colorBlindShapes !== undefined) {
        renderer.setOptions({ showGlyphs: patch.colorBlindShapes });
      }
      game.updateSettings(patch);
      if (patch.timed !== undefined) timed.chip.setEnabled(patch.timed);
    },
    onImport: (save) => game.replaceSave(save),
    onGoToLevel: (level) => game.goToLevel(level),
    onClose: () => timed.resume('settings'),
  });
});

document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.key === 'z') game.undo();
  else if (event.key === 'r') game.restart();
  else if (event.key === 'h') game.requestHint();
  else if (/^[1-9]$/.test(event.key)) {
    // Lane by number, which is also how the browser harness plays a level.
    const state = currentState;
    if (state && state.phase === 'playing') {
      game.tapCell(state.route.length, Number(event.key) - 1);
    }
  }
});

const refit = (): void => {
  if (currentState) {
    fitBoard(currentState);
    renderer.render(currentState);
  }
};
window.addEventListener('resize', refit);
window.addEventListener('orientationchange', () => window.setTimeout(refit, 220));

/* -------------------------------------------------------------------- boot */

void (async () => {
  await game.start();
  applyTheme(game.settings.theme);
  setSoundEnabled(game.settings.sound);
  renderer.setOptions({ showGlyphs: game.settings.colorBlindShapes });
  if (currentState) {
    renderer.render(currentState);
    fitBoard(currentState);
    renderer.render(currentState);
  }
})();

registerServiceWorker();
