/**
 * Wordle entry point. Wires the controller to the renderer and the chrome.
 */

import '../shared/shell.css';
import './wordle.css';

import { setSoundEnabled, sfx } from '../shared/audio';
import { registerServiceWorker } from '../shared/pwa';
import { pinViewportHeight } from '../shared/viewport';
import { createHowToPlay, shouldAutoShow } from '../shared/how-to-play';
import { openSettings } from '../shared/settings-sheet';
import { createTimedPlay } from '../shared/timed-play';
import { budgetFor } from '../shared/timer';
import { applyTheme, el, icons, openSheet, prefersReducedMotion } from '../shared/ui';
import { GAME_ID, type GameState, WordleGame, wonOnRow } from './game';
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

const boardEl = el('main', { class: 'board', 'aria-label': 'Guesses' });
const padEl = el('div', { class: 'pad' });

const undoButton = controlButton('Undo', icons.undo);
const restartButton = controlButton('Restart', icons.restart);
const hintButton = controlButton('Hint', icons.hint);
const controls = el('footer', { class: 'controls' });
controls.append(undoButton, restartButton, hintButton);

app.append(topbar, boardEl, padEl, controls);
app.classList.add('app--wordle');

function controlButton(label: string, icon: string): HTMLButtonElement {
  return el('button', { class: 'control', type: 'button' }, `${icon}<span>${label}</span>`);
}

/* -------------------------------------------------------------------- game */

const game = new WordleGame();
const reducedMotion = prefersReducedMotion();

const renderer = new BoardRenderer(boardEl, padEl, {
  reducedMotion,
  onKey: (key) => press(key),
});

function press(key: string): void {
  if (key === 'Enter') game.submit();
  else if (key === 'Backspace') game.backspace();
  else game.type(key.toLowerCase());
}

/* ------------------------------------------------------------------- clock */

/**
 * The optional clock.
 *
 * The unit of work is a row, and what pays time back is a *green letter* — not
 * a submitted guess, which would reward burning rows on nothing. Greens only
 * ever accumulate within a level, so the payout cannot be farmed by undoing and
 * re-guessing.
 */
const timed = createTimedPlay<GameState>({
  anchor: settingsButton,
  isTimed: () => game.settings.timed,
  onTimedChange: (value) => game.updateSettings({ timed: value }),
  budget: (state) =>
    state.generated
      ? budgetFor({
          units: state.generated.tries,
          rewards: state.generated.length,
          pressure: state.generated.difficulty,
          generous: 46,
          tight: 26,
          floor: 120,
        })
      : null,
  progress: (state) => state.found,
  isPlaying: (state) => state.phase === 'playing',
  levelKey: (state) => (state.generated ? `${state.level}` : null),
  onExpire: () => game.loseToTime(),
});

/* --------------------------------------------------------------------- fit */

/** Largest a tile may be drawn. Past this a five-letter grid looks like a toy. */
const MAX_CELL = 62;
/** Smallest before the letters stop being legible. */
const MIN_CELL = 28;

/**
 * Sizes the grid so the whole board fits without scrolling.
 *
 * The keyboard below is a fixed height, so the grid gets whatever is left —
 * which is why this measures `.board` rather than the window. `.app` pins its
 * column to `minmax(0, 1fr)`, so that measurement is trustworthy.
 */
function fitBoard(state: GameState): void {
  const generated = state.generated;
  if (!generated) return;

  const style = getComputedStyle(boardEl);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);

  // The 5px gap between every pair of tiles, in both directions.
  const gapsAcross = (generated.length - 1) * 5;
  const gapsDown = (generated.tries - 1) * 5;

  const availableWidth = boardEl.clientWidth - padX - gapsAcross;
  const availableHeight = boardEl.clientHeight - padY - gapsDown;
  if (availableWidth <= 0 || availableHeight <= 0) return;

  const cell = Math.min(
    availableWidth / generated.length,
    availableHeight / generated.tries,
    MAX_CELL,
  );
  renderer.setCell(Math.max(MIN_CELL, Math.floor(cell)));
}

/* ------------------------------------------------------- state -> screen */

let lastPhase: GameState['phase'] = 'loading';
let currentState: GameState | null = null;

/**
 * The one deferred thing in the game: the end-of-level sheet waits for the row
 * to finish turning over. The handle is kept and cancelled on every reset, so
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

/** Long enough for the last tile of a row to have turned over. */
const REVEAL_MS = 1500;

game.subscribe((state) => {
  currentState = state;

  levelLabel.textContent = `Level ${state.level}`;
  subLabel.textContent = describeProgress(state);

  fitBoard(state);
  renderer.render(state);
  timed.sync(state);

  undoButton.disabled = !state.canUndo || state.phase === 'loading';
  restartButton.disabled = state.phase === 'loading' || state.moveCount === 0;
  hintButton.disabled = state.phase !== 'playing';

  if (state.effect.kind === 'reset') clearPendingSheet();
  handleEffect(state);

  if (state.phase === 'won' && lastPhase !== 'won') {
    renderer.celebrate(wonOnRow(state) - 1);
    sfx.win();
    clearPendingSheet();
    pendingSheet = window.setTimeout(() => showWin(state), REVEAL_MS);
  }

  if (state.phase === 'lost' && lastPhase !== 'lost') {
    sfx.reject();
    clearPendingSheet();
    pendingSheet = window.setTimeout(() => showLoss(state), state.outOfTime ? 420 : REVEAL_MS);
  }

  lastPhase = state.phase;
});

function handleEffect(state: GameState): void {
  const { effect } = state;

  if (effect.kind === 'typing') {
    sfx.select();
  } else if (effect.kind === 'submit') {
    // Pitch rises with how much the row gave back, so a good guess sounds
    // different from a wasted one without anything having to say so.
    const greens = effect.marks.filter((mark) => mark === 2).length;
    sfx.pour(Math.min(6, greens * 1.4 + 1));
  } else if (effect.kind === 'reject') {
    sfx.reject();
    say(effect.reason === 'short' ? 'Not enough letters' : 'Not in the word list');
  } else if (effect.kind === 'hint') {
    sfx.complete();
  }
}

/* -------------------------------------------------------------- the toast */

/**
 * The one-line message over the board.
 *
 * There is exactly one of these at a time and the handle is kept, because two
 * overlapping toasts is how "Not in the word list" ends up stuck on screen
 * after the word that caused it has been taken back.
 */
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
  const row = wonOnRow(state);

  openSheet(
    (sheet) => {
      sheet.content.append(el('h2', { class: 'win-title' }, row === 1 ? 'First try' : 'Got it'));
      sheet.content.append(
        el(
          'div',
          { class: 'result-line' },
          `<b>${row}</b><span>${row === 1 ? 'row' : 'rows'}</span>`,
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
 * Out of rows, or out of time.
 *
 * **The word is shown.** Withholding it would be the one genuinely mean thing
 * this collection could do — the player has spent six rows earning it — and it
 * is also what makes the loss worth anything: you find out whether it was
 * gettable. Undo is offered first and costs nothing, as everywhere else here.
 */
function showLoss(state: GameState): void {
  const answer = state.generated?.answer ?? '';
  const left = game.remainingCandidates();

  openSheet(
    (sheet) => {
      sheet.content.append(
        el('h2', { class: 'lose-title' }, state.outOfTime ? 'Out of time' : 'Out of rows'),
      );
      sheet.content.append(el('div', { class: 'wd-answer' }, answer));

      if (!state.outOfTime && left > 1) {
        sheet.content.append(
          el('div', { class: 'result-line' }, `<b>${left}</b><span>words still fitted</span>`),
        );
      }

      const carry = el('button', { class: 'button button--full' }, 'Take a row back');
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
hintButton.addEventListener('click', () => {
  if (game.requestHint() === null) sfx.reject();
});

settingsButton.addEventListener('click', () => {
  timed.pause('settings');
  openSettings({
    gameId: GAME_ID,
    gameName: 'Wordle',
    save: game.currentSave,
    currentLevel: game.currentSave.level,
    /*
     * The one game here where the shape overlay genuinely matters. Green and
     * yellow are the whole feedback channel and they are exactly the pair a
     * red-green colour-blind player cannot separate, so the overlay puts a
     * filled dot on "right place" and a ring on "wrong place".
     */
    shapesLabel: 'Marks on colours',
    shapesDescription: 'A dot for right place, a ring for wrong.',
    onSettingsChange: (patch) => {
      game.updateSettings(patch);
      if (patch.timed !== undefined) timed.chip.setEnabled(patch.timed);
      if (patch.colorBlindShapes !== undefined) applyShapes(patch.colorBlindShapes);
    },
    onHowToPlay: () => howTo.open(),
    onImport: (save) => {
      applyShapes(save.settings.colorBlindShapes);
      return game.replaceSave(save);
    },
    onGoToLevel: (level) => game.goToLevel(level),
    onClose: () => timed.resume('settings'),
  });
});

/**
 * The overlay is a root attribute rather than a class on the board, because the
 * keyboard keys carry the same colours and live in a different subtree.
 */
function applyShapes(on: boolean): void {
  if (on) document.documentElement.setAttribute('data-shapes', 'on');
  else document.documentElement.removeAttribute('data-shapes');
}

/**
 * Typing, and the two things the listener must not do.
 *
 * The listener is on `document` so a letter works wherever the focus happens to
 * be — but that also means it fires while a sheet is open and while a text field
 * has the caret. Settings has a *save code* field, and a save code is base64:
 * typing one would otherwise fill the board with its letters.
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

  if (event.key === 'Enter') press('Enter');
  else if (event.key === 'Backspace') press('Backspace');
  else if (/^[a-zA-Z]$/.test(event.key)) press(event.key.toLowerCase());
  else return;

  event.preventDefault();
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
  applyShapes(game.settings.colorBlindShapes);
  setSoundEnabled(game.settings.sound);
  if (currentState) refit();

  // Offered once, on a save that has never cleared a level. See
  // `shouldAutoShow` for why it is not simply "has not seen it".
  if (shouldAutoShow(game.currentSave)) howTo.open(true);
})();

registerServiceWorker();
