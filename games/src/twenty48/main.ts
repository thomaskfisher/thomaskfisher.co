/**
 * 2048 entry point. Wires the controller to the renderer and the chrome.
 */

import '../shared/shell.css';
import './twenty48.css';

import { setSoundEnabled, sfx } from '../shared/audio';
import { registerServiceWorker } from '../shared/pwa';
import { pinViewportHeight } from '../shared/viewport';
import { createHowToPlay, shouldAutoShow } from '../shared/how-to-play';
import { openSettings } from '../shared/settings-sheet';
import { createTimedPlay } from '../shared/timed-play';
import { budgetFor } from '../shared/timer';
import { applyTheme, el, icons, openSheet, prefersReducedMotion } from '../shared/ui';
import { GAME_ID, type GameState, Twenty48Game } from './game';
import { Dir, faceOf } from './model';
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

/** The preview. See the note in twenty48.css for why it is worth the row. */
const nextRow = el('div', { class: 'tf-next' });
const nextLabel = el('span', {}, 'Next');
const nextTile = el('span', { class: 'tf-next-tile tf-tile--1' }, '2');
nextRow.append(nextLabel, nextTile);

const boardEl = el('main', { class: 'board', 'aria-label': 'The board' });

const undoButton = controlButton('Undo', icons.undo);
const restartButton = controlButton('Restart', icons.restart);
const hintButton = controlButton('Hint', icons.hint);
const controls = el('footer', { class: 'controls' });
controls.append(undoButton, restartButton, hintButton);

app.append(topbar, nextRow, boardEl, controls);
app.classList.add('app--twenty48');

function controlButton(label: string, icon: string): HTMLButtonElement {
  return el('button', { class: 'control', type: 'button' }, `${icon}<span>${label}</span>`);
}

/* -------------------------------------------------------------------- game */

const game = new Twenty48Game();
const reducedMotion = prefersReducedMotion();

const renderer = new BoardRenderer(boardEl, {
  reducedMotion,
  onSwipe: (direction) => game.move(direction),
});

/* ------------------------------------------------------------------- clock */

/**
 * The optional clock.
 *
 * The unit of work is a move and what pays time back is the *best tile getting
 * bigger* — not a merge, which would pay out for shuffling twos around forever.
 * The metric climbs at most ten times a level, so the bonus per step is large;
 * that is the right shape here, because the long middle of a 512 is exactly
 * where a per-merge payout would let somebody stall indefinitely.
 */
const timed = createTimedPlay<GameState>({
  anchor: settingsButton,
  isTimed: () => game.settings.timed,
  onTimedChange: (value) => game.updateSettings({ timed: value }),
  budget: (state) =>
    state.generated
      ? budgetFor({
          units: state.generated.par,
          rewards: state.generated.target,
          pressure: state.generated.difficulty,
          generous: 2.2,
          tight: 1.3,
          floor: 120,
        })
      : null,
  progress: (state) => state.best,
  isPlaying: (state) => state.phase === 'playing',
  levelKey: (state) => (state.generated ? `${state.level}` : null),
  onExpire: () => game.loseToTime(),
});

/* --------------------------------------------------------------------- fit */

/** Largest a tile may be drawn. Past this a four-by-four stops reading as one. */
const MAX_CELL = 82;
const MIN_CELL = 40;

/**
 * Sizes the board so the whole thing fits without scrolling.
 *
 * Measured from `.board`, which is safe because `.app` pins its column to
 * `minmax(0, 1fr)`. The gaps are part of the board's own box, so they come out
 * of the space before the cells are divided up.
 */
function fitBoard(state: GameState): void {
  const size = state.generated?.size;
  if (!size) return;

  const style = getComputedStyle(boardEl);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);

  // Kept in step with `--gap` in the stylesheet: one gap between each pair of
  // cells, plus one at each edge.
  const gaps = (size + 1) * 8;

  const availableWidth = boardEl.clientWidth - padX - gaps;
  const availableHeight = boardEl.clientHeight - padY - gaps;
  if (availableWidth <= 0 || availableHeight <= 0) return;

  const cell = Math.min(availableWidth / size, availableHeight / size, MAX_CELL);
  renderer.setCell(Math.max(MIN_CELL, Math.floor(cell)));
}

/* ------------------------------------------------------- state -> screen */

let lastPhase: GameState['phase'] = 'loading';
let currentState: GameState | null = null;

/**
 * The one deferred thing in the game: a beat between the last move and the
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

  fitBoard(state);
  renderer.render(state);
  timed.sync(state);

  if (state.nextSpawn) {
    nextTile.textContent = String(faceOf(state.nextSpawn.exponent));
    nextTile.className = `tf-next-tile tf-tile--${state.nextSpawn.exponent}`;
  }
  nextRow.hidden = state.phase === 'loading';

  undoButton.disabled = !state.canUndo || state.phase === 'loading';
  restartButton.disabled = state.phase === 'loading' || state.moveCount === 0;
  hintButton.disabled = state.phase !== 'playing';

  if (state.effect.kind === 'reset') clearPendingSheet();
  handleEffect(state);

  if (state.phase === 'won' && lastPhase !== 'won') {
    renderer.celebrate();
    sfx.win();
    clearPendingSheet();
    pendingSheet = window.setTimeout(() => showWin(state), 650);
  }

  if (state.phase === 'lost' && lastPhase !== 'lost') {
    sfx.reject();
    clearPendingSheet();
    pendingSheet = window.setTimeout(() => showLoss(state), 500);
  }

  lastPhase = state.phase;
});

function handleEffect(state: GameState): void {
  const { effect } = state;

  if (effect.kind === 'move') {
    // Pitch rises with the size of the biggest thing that just merged, so a
    // good move sounds different from a shuffle.
    if (effect.merged.length) sfx.pour(Math.min(6, Math.max(...effect.merged) * 0.7));
    else sfx.select();
  } else if (effect.kind === 'reject') {
    sfx.reject();
    renderer.showReject(effect.direction);
  } else if (effect.kind === 'hint') {
    renderer.showHint(effect.direction);
    sfx.complete();
  }
}

/* ---------------------------------------------------------------- overlays */

function showWin(state: GameState): void {
  const target = faceOf(state.generated?.target ?? 0);

  openSheet(
    (sheet) => {
      sheet.content.append(el('h2', { class: 'win-title' }, 'Built it'));
      sheet.content.append(
        el('div', { class: 'result-line' }, `<b>${target}</b><span>in ${state.moveCount} moves</span>`),
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
 * The two ways a level ends badly: a jammed board, or the clock.
 *
 * Undo is offered first in both cases and costs nothing, which is the whole
 * house position on losing — a dead end is a reason to try another line, not a
 * punishment, and there is nothing here to buy your way out of.
 */
function showLoss(state: GameState): void {
  openSheet(
    (sheet) => {
      sheet.content.append(
        el('h2', { class: 'lose-title' }, state.outOfTime ? 'Out of time' : 'Board jammed'),
      );

      const carry = el('button', { class: 'button button--full' }, 'Take it back');
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
    gameName: '2048',
    save: game.currentSave,
    currentLevel: game.currentSave.level,
    // Every tile carries its own number, so colour is a convenience here rather
    // than information — a symbol overlay would add noise and no meaning.
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

  const arrows: Record<string, Dir> = {
    ArrowUp: Dir.Up,
    ArrowRight: Dir.Right,
    ArrowDown: Dir.Down,
    ArrowLeft: Dir.Left,
  };

  const direction = arrows[event.key];
  if (direction !== undefined) {
    game.move(direction);
    event.preventDefault();
  } else if (event.key === 'z') game.undo();
  else if (event.key === 'r') game.restart();
  else if (event.key === 'h') game.requestHint();
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
