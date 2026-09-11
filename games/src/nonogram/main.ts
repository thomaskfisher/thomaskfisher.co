/**
 * Nonogram entry point. Wires the controller to the renderer and the chrome.
 */

import '../shared/shell.css';
import './nonogram.css';

import { setSoundEnabled, sfx } from '../shared/audio';
import { registerServiceWorker } from '../shared/pwa';
import { pinViewportHeight } from '../shared/viewport';
import { createHowToPlay, shouldAutoShow } from '../shared/how-to-play';
import { openSettings } from '../shared/settings-sheet';
import { createTimedPlay } from '../shared/timed-play';
import { budgetFor } from '../shared/timer';
import { applyTheme, el, icons, openSheet, prefersReducedMotion } from '../shared/ui';
import { GAME_ID, type GameState, NonogramGame } from './game';
import { Mark } from './model';
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

const boardEl = el('main', { class: 'board', 'aria-label': 'The picture' });

const brushes = el('div', { class: 'brushes' });
const fillBrush = brushButton('fill', 'Paint');
const crossBrush = brushButton('cross', 'Cross');
brushes.append(fillBrush, crossBrush);

const undoButton = controlButton('Undo', icons.undo);
const restartButton = controlButton('Restart', icons.restart);
const hintButton = controlButton('Hint', icons.hint);
const controls = el('footer', { class: 'controls' });
controls.append(undoButton, restartButton, hintButton);

app.append(topbar, boardEl, brushes, controls);
app.classList.add('app--nonogram');

function controlButton(label: string, icon: string): HTMLButtonElement {
  return el('button', { class: 'control', type: 'button' }, `${icon}<span>${label}</span>`);
}

function brushButton(kind: 'fill' | 'cross', label: string): HTMLButtonElement {
  return el(
    'button',
    { class: `brush brush--${kind}`, type: 'button', 'aria-pressed': 'false' },
    `<span class="brush-swatch"></span><span>${label}</span>`,
  ) as HTMLButtonElement;
}

/* -------------------------------------------------------------------- game */

const game = new NonogramGame();
const reducedMotion = prefersReducedMotion();

const renderer = new BoardRenderer(boardEl, {
  reducedMotion,
  onPaint: (cells, mark) => game.paint(cells, mark),
  markFor: (cell) => game.markFor(cell),
});

/* ------------------------------------------------------------------- clock */

/**
 * The optional clock.
 *
 * The unit of work is a painted cell, and what pays time back is a *correct*
 * one — not any mark, which would let a player mint time by painting a cell and
 * scrubbing it out again. `correct` can fall (an undo), and a fall pays nothing.
 */
const timed = createTimedPlay<GameState>({
  anchor: settingsButton,
  isTimed: () => game.settings.timed,
  onTimedChange: (value) => game.updateSettings({ timed: value }),
  budget: (state) =>
    state.generated
      ? budgetFor({
          units: state.generated.painted,
          rewards: state.generated.painted,
          pressure: state.generated.difficulty,
          generous: 7,
          tight: 4,
          floor: 75,
        })
      : null,
  progress: (state) => state.correct,
  isPlaying: (state) => state.phase === 'playing',
  levelKey: (state) => (state.generated ? `${state.level}` : null),
  onExpire: () => game.loseToTime(),
});

/* --------------------------------------------------------------------- fit */

/** Largest a cell may be drawn. Past this a 5x5 looks like a toy. */
const MAX_CELL = 34;
/** Smallest before the clue numbers stop being legible. */
const MIN_CELL = 14;

/**
 * Sizes the board so the grid *and its clue gutters* fit without scrolling.
 *
 * The gutters are the part that makes this non-obvious: they are measured in
 * cells too, so a 15x15 whose longest row clue has four numbers is really
 * 15 + 2.5 cells across. Solving for the grid alone and hoping is how the left
 * column of clues ends up off the side of a phone.
 *
 * Measured from `.board`, which is safe because `.app` pins its column to
 * `minmax(0, 1fr)`.
 */
function fitBoard(state: GameState): void {
  const generated = state.generated;
  if (!generated) return;

  const style = getComputedStyle(boardEl);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);

  const { puzzle } = generated;
  const widestRow = Math.max(1, ...puzzle.rowClues.map((clues) => clues.length));
  const tallestCol = Math.max(1, ...puzzle.colClues.map((clues) => clues.length));

  // The multipliers match the `--row-clues` / `--col-clues` terms in the
  // stylesheet. Kept in step deliberately: a copy that drifts puts the gutter
  // off the screen at exactly one grid size and nowhere else.
  const across = puzzle.width + widestRow * 0.62;
  const down = puzzle.height + tallestCol * 0.72;

  // The frame's own 6px padding on each side.
  const chrome = 12;
  const availableWidth = boardEl.clientWidth - padX - chrome;
  const availableHeight = boardEl.clientHeight - padY - chrome;
  if (availableWidth <= 0 || availableHeight <= 0) return;

  const cell = Math.min(availableWidth / across, availableHeight / down, MAX_CELL);
  renderer.setCell(Math.max(MIN_CELL, Math.floor(cell)));
}

/* ------------------------------------------------------- state -> screen */

let lastPhase: GameState['phase'] = 'loading';
let currentState: GameState | null = null;

/**
 * The one deferred thing in the game: a beat between the last cell and the
 * sheet that talks about it. The handle is kept and cancelled on every reset, so
 * an undo or a new level inside that window cannot pop a sheet about a level
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

  // Fit before drawing: every cell's box comes from the cell size, so the size
  // has to be settled first.
  fitBoard(state);
  renderer.render(state);
  timed.sync(state);

  fillBrush.classList.toggle('is-on', state.brush === Mark.Filled);
  fillBrush.setAttribute('aria-pressed', String(state.brush === Mark.Filled));
  crossBrush.classList.toggle('is-on', state.brush === Mark.Cross);
  crossBrush.setAttribute('aria-pressed', String(state.brush === Mark.Cross));

  const playable = state.phase === 'playing';
  fillBrush.disabled = !playable;
  crossBrush.disabled = !playable;
  undoButton.disabled = !state.canUndo || state.phase === 'loading';
  restartButton.disabled = state.phase === 'loading' || state.moveCount === 0;
  hintButton.disabled = !playable;

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

  if (effect.kind === 'paint') {
    if (effect.wrong) sfx.reject();
    else if (effect.mark === Mark.Filled) sfx.pour(2);
    else sfx.select();
  } else if (effect.kind === 'mistake') {
    sfx.reject();
  } else if (effect.kind === 'hint') {
    sfx.complete();
  }
}

/* ---------------------------------------------------------------- overlays */

function showWin(state: GameState): void {
  const size = state.generated?.puzzle.width ?? 0;

  openSheet(
    (sheet) => {
      sheet.content.append(el('h2', { class: 'win-title' }, 'Picture done'));
      sheet.content.append(
        el('div', { class: 'result-line' }, `<b>${size}×${size}</b><span>squares</span>`),
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
 * about the grid is lost, so carrying on is the first option.
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

fillBrush.addEventListener('click', () => game.setBrush(Mark.Filled));
crossBrush.addEventListener('click', () => game.setBrush(Mark.Cross));
undoButton.addEventListener('click', () => game.undo());
restartButton.addEventListener('click', () => game.restart());
hintButton.addEventListener('click', () => game.requestHint());

settingsButton.addEventListener('click', () => {
  timed.pause('settings');
  openSettings({
    gameId: GAME_ID,
    gameName: 'Nonogram',
    save: game.currentSave,
    currentLevel: game.currentSave.level,
    // A cell is painted or it is not; no colour here carries a rule, so the
    // shape overlay would be a row that changes nothing.
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
 * restart or hint the level sitting behind the sheet.
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

  if (event.key === 'z') game.undo();
  else if (event.key === 'r') game.restart();
  else if (event.key === 'h') game.requestHint();
  else if (event.key === 'x') {
    game.setBrush(currentState?.brush === Mark.Cross ? Mark.Filled : Mark.Cross);
  }
});

const refit = (): void => {
  if (!currentState) return;
  fitBoard(currentState);
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
