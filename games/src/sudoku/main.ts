/**
 * Sudoku entry point. Wires the controller to the renderer and the chrome.
 */

import '../shared/shell.css';
import './sudoku.css';

import { setSoundEnabled, sfx } from '../shared/audio';
import { registerServiceWorker } from '../shared/pwa';
import { pinViewportHeight } from '../shared/viewport';
import { createHowToPlay, shouldAutoShow } from '../shared/how-to-play';
import { openSettings } from '../shared/settings-sheet';
import { createTimedPlay } from '../shared/timed-play';
import { budgetFor } from '../shared/timer';
import { applyTheme, el, icons, openSheet, prefersReducedMotion } from '../shared/ui';
import { GAME_ID, type GameState, SudokuGame, blanksOf } from './game';
import { SIZE } from './model';
import { RULES } from './rules';
import { BoardRenderer, describeProgress } from './render';

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

const boardEl = el('main', { class: 'board', 'aria-label': 'The grid' });
const padEl = el('div', { class: 'pad' });

const undoButton = controlButton('Undo', icons.undo);
const restartButton = controlButton('Restart', icons.restart);
const hintButton = controlButton('Hint', icons.hint);
const controls = el('footer', { class: 'controls' });
controls.append(undoButton, restartButton, hintButton);

app.append(topbar, boardEl, padEl, controls);
app.classList.add('app--sudoku');

function controlButton(label: string, icon: string): HTMLButtonElement {
  return el('button', { class: 'control', type: 'button' }, `${icon}<span>${label}</span>`);
}

/* -------------------------------------------------------------------- game */

const game = new SudokuGame();
const reducedMotion = prefersReducedMotion();

const renderer = new BoardRenderer(boardEl, padEl, {
  reducedMotion,
  onSelect: (cell) => game.select(cell),
  onDigit: (digit) => game.enter(digit),
  onErase: () => game.erase(),
  onPencil: (on) => game.setPencilMode(on),
});

/* ------------------------------------------------------------------- clock */

/**
 * The optional clock.
 *
 * The unit of work is a blank cell, and what pays time back is a *correct*
 * digit — not any entry, which would let a player mint time by typing anything
 * into an empty cell and taking it out again. `correct` can fall (an undo), and
 * a fall simply pays nothing.
 */
const timed = createTimedPlay<GameState>({
  anchor: settingsButton,
  isTimed: () => game.settings.timed,
  onTimedChange: (value) => game.updateSettings({ timed: value }),
  budget: (state) =>
    state.generated
      ? budgetFor({
          units: blanksOf(state.generated),
          rewards: blanksOf(state.generated),
          pressure: state.generated.difficulty,
          generous: 14,
          tight: 8,
          floor: 90,
        })
      : null,
  progress: (state) => state.correct,
  isPlaying: (state) => state.phase === 'playing',
  levelKey: (state) => (state.generated ? `${state.level}` : null),
  onExpire: () => game.loseToTime(),
});

/* --------------------------------------------------------------------- fit */

/** Largest a cell may be drawn. Past this the grid stops reading as one object. */
const MAX_CELL = 46;
/** Smallest a cell may be before the digits stop being legible. */
const MIN_CELL = 24;

/**
 * Sizes the grid so the whole thing fits without scrolling.
 *
 * Measured from `.board`, which is safe because `.app` pins its column to
 * `minmax(0, 1fr)`. Sizing a board from an element the board can itself widen is
 * how Survival once walked off the right edge of the screen.
 *
 * Padding is read off the element rather than written here as a number: a
 * hardcoded copy of a CSS value is the drift that leaves the last column of the
 * grid hanging off the right of a phone.
 */
function fitBoard(): void {
  const style = getComputedStyle(boardEl);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);

  // The grid's own 3px padding on each side, plus the two heavy box rules that
  // sit inside it. Both come out of the space the cells have.
  const chrome = 6 + 4;

  const availableWidth = boardEl.clientWidth - padX - chrome;
  const availableHeight = boardEl.clientHeight - padY - chrome;
  if (availableWidth <= 0 || availableHeight <= 0) return;

  const cell = Math.min(availableWidth / SIZE, availableHeight / SIZE, MAX_CELL);
  renderer.setCell(Math.max(MIN_CELL, Math.floor(cell)));
}

/* ------------------------------------------------------- state -> screen */

let lastPhase: GameState['phase'] = 'loading';
let currentState: GameState | null = null;

/**
 * The one deferred thing in the game: a beat between the last digit and the
 * sheet that talks about it. The handle is kept and cancelled on every reset,
 * so an undo or a new level inside that window cannot pop a sheet about a level
 * that is no longer over.
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

  // Fit before drawing: every cell's box is computed from the cell size, so the
  // size has to be settled first. The grid is always nine by nine, so unlike
  // the other games this needs no measure-draw-measure round trip.
  fitBoard();
  renderer.render(state);
  timed.sync(state);

  undoButton.disabled = !state.canUndo || state.phase === 'loading';
  restartButton.disabled = state.phase === 'loading' || state.moveCount === 0;
  hintButton.disabled = state.phase !== 'playing';

  if (state.effect.kind === 'reset') clearPendingSheet();
  handleEffect(state);

  if (state.phase === 'won' && lastPhase !== 'won') {
    renderer.celebrate();
    sfx.win();
    clearPendingSheet();
    pendingSheet = window.setTimeout(() => showWin(state), 900);
  }

  if (state.phase === 'lost' && lastPhase !== 'lost') {
    sfx.reject();
    clearPendingSheet();
    pendingSheet = window.setTimeout(() => showOutOfTime(), 420);
  }

  lastPhase = state.phase;
});

function handleEffect(state: GameState): void {
  const { effect } = state;

  if (effect.kind === 'write') {
    // A wrong digit still goes in — the board marks it rather than refusing it —
    // but it does not get the confirming note.
    if (effect.wrong) sfx.reject();
    else sfx.pour(Math.min(6, effect.digit * 0.6));
  } else if (effect.kind === 'erase' || effect.kind === 'note') {
    sfx.select();
  } else if (effect.kind === 'reject' || effect.kind === 'mistake') {
    sfx.reject();
  } else if (effect.kind === 'hint') {
    sfx.complete();
  }
}

/* ---------------------------------------------------------------- overlays */

function showWin(state: GameState): void {
  openSheet(
    (sheet) => {
      sheet.content.append(el('h2', { class: 'win-title' }, 'Solved'));
      sheet.content.append(
        el(
          'div',
          { class: 'result-line' },
          `<b>${state.generated?.clues ?? 0}</b><span>clues</span>`,
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
 * The only way this game ends badly, and only when the clock is on. Nothing
 * about the grid is lost — every digit is exactly where it was — so carrying on
 * is the first option.
 */
function showOutOfTime(): void {
  openSheet(
    (sheet) => {
      sheet.content.append(el('h2', { class: 'lose-title' }, 'Out of time'));

      const carry = el('button', { class: 'button button--full' }, 'Keep going');
      carry.addEventListener('click', () => {
        sheet.close();
        game.undo();
      });

      const restart = el('button', { class: 'button button--ghost button--full' }, 'Restart');
      restart.addEventListener('click', () => {
        sheet.close();
        game.restart();
      });

      sheet.content.append(carry, restart);
    },
    { dismissible: false },
  );
}

/* ---------------------------------------------------------------- controls */

undoButton.addEventListener('click', () => game.undo());
restartButton.addEventListener('click', () => game.restart());
hintButton.addEventListener('click', () => game.requestHint());

settingsButton.addEventListener('click', () => {
  timed.pause('settings');
  openSettings({
    gameId: GAME_ID,
    gameName: 'Sudoku',
    save: game.currentSave,
    currentLevel: game.currentSave.level,
    // Nothing in this game is told apart by colour — a digit is a digit — so the
    // shape overlay would be a row that changes nothing, and offering one of
    // those is worse than not offering it.
    showShapes: false,
    onSettingsChange: (patch) => {
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

  // `event.target` is not always an element — with nothing focused it is the
  // document itself, which has no `closest` and would throw here on every
  // keystroke. Narrowing rather than casting is what makes this safe.
  const target = event.target;
  if (target instanceof Element) {
    if (target.closest('input, textarea')) return;
    if (target instanceof HTMLElement && target.isContentEditable) return;
  }
  if (document.querySelector('.overlay')) return;

  if (event.key >= '1' && event.key <= '9') {
    game.enter(Number(event.key));
  } else if (event.key === 'Backspace' || event.key === 'Delete' || event.key === '0') {
    game.erase();
  } else if (event.key === 'n') {
    game.setPencilMode(!(currentState?.pencilMode ?? false));
  } else if (event.key === 'z') {
    game.undo();
  } else if (event.key === 'r') {
    game.restart();
  } else if (event.key === 'h') {
    game.requestHint();
  } else if (event.key.startsWith('Arrow')) {
    moveCaret(event.key);
    event.preventDefault();
  }
});

/** Arrow keys walk the caret, which is what a keyboard player reaches for first. */
function moveCaret(key: string): void {
  if (!currentState) return;
  const from = currentState.selected ?? 0;
  const row = Math.floor(from / SIZE);
  const col = from % SIZE;

  const delta = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[
    key
  ];
  if (!delta) return;

  const nextRow = Math.min(SIZE - 1, Math.max(0, row + (delta[0] as number)));
  const nextCol = Math.min(SIZE - 1, Math.max(0, col + (delta[1] as number)));
  const target = nextRow * SIZE + nextCol;

  // `select` toggles, so landing on the cell already selected would clear it.
  if (target !== currentState.selected) game.select(target);
}

const refit = (): void => {
  if (!currentState) return;
  fitBoard();
  renderer.render(currentState);
};
window.addEventListener('resize', refit);
window.addEventListener('orientationchange', () => window.setTimeout(refit, 220));

/* -------------------------------------------------------------------- boot */

void (async () => {
  await game.start();
  applyTheme(game.settings.theme);
  setSoundEnabled(game.settings.sound);
  if (currentState) refit();

  // Offered once, on a save that has never cleared a level. See
  // `shouldAutoShow` for why it is not simply "has not seen it".
  if (shouldAutoShow(game.currentSave)) howTo.open(true);
})();

registerServiceWorker();
