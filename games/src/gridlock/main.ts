/**
 * Gridlock entry point. Wires the controller to the renderer and the chrome.
 */

import '../shared/shell.css';
import './gridlock.css';

import { setSoundEnabled, sfx } from '../shared/audio';
import { registerServiceWorker } from '../shared/pwa';
import { createHowToPlay, shouldAutoShow } from '../shared/how-to-play';
import { openSettings } from '../shared/settings-sheet';
import { createTimedPlay } from '../shared/timed-play';
import { budgetFor } from '../shared/timer';
import { applyTheme, el, icons, openSheet, prefersReducedMotion } from '../shared/ui';
import { GAME_ID, type GameState, GridlockGame, MAX_ADVANCE } from './game';
import { SIZE, TARGET } from './model';
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

const boardEl = el('main', { class: 'board', 'aria-label': 'The car park' });

const undoButton = controlButton('Undo', icons.undo);
const restartButton = controlButton('Restart', icons.restart);
const hintButton = controlButton('Hint', icons.hint);
const controls = el('footer', { class: 'controls' });
controls.append(undoButton, restartButton, hintButton);

app.append(topbar, boardEl, controls);
app.classList.add('app--gridlock');

function controlButton(label: string, icon: string): HTMLButtonElement {
  return el('button', { class: 'control', type: 'button' }, `${icon}<span>${label}</span>`);
}

/* -------------------------------------------------------------------- game */

const game = new GridlockGame();
const reducedMotion = prefersReducedMotion();

const renderer = new BoardRenderer(boardEl, {
  reducedMotion,
  onSlide: (id, to) => game.slide(id, to),
});

/* ------------------------------------------------------------------- clock */

/**
 * The optional clock.
 *
 * The unit of work here is a slide, and what pays time back is the red car
 * actually getting closer to the exit — not any old move, which would reward
 * shuffling. `reached` is monotonic within a level for exactly that reason: a
 * payout that could be undone and re-earned would let an undo-and-redo cycle
 * mint time out of nothing.
 */
const timed = createTimedPlay<GameState>({
  anchor: settingsButton,
  isTimed: () => game.settings.timed,
  onTimedChange: (value) => game.updateSettings({ timed: value }),
  budget: (state) =>
    state.generated
      ? budgetFor({
          units: state.generated.moves,
          rewards: MAX_ADVANCE,
          pressure: state.generated.difficulty,
          generous: 9,
          tight: 5,
          floor: 30,
        })
      : null,
  progress: (state) => state.reached,
  isPlaying: (state) => state.phase === 'playing',
  levelKey: (state) => (state.generated ? `${state.level}` : null),
  onExpire: () => game.loseToTime(),
});

/* --------------------------------------------------------------------- fit */

/** Widest a bay may be drawn. Past this the park stops reading as one object. */
const MAX_CELL = 74;
/**
 * Room kept to the right of the park for the gap in the wall and its arrow.
 * Matches the `margin-right` on `.park`, which is what makes the park *and* its
 * exit sit centred rather than the park alone.
 */
const EXIT_GUTTER = 30;

/**
 * Sizes the park so the whole thing fits without scrolling.
 *
 * The board is always six by six, so unlike the other games there is no
 * level-to-level variation to solve for — but phones vary by three hundred
 * pixels of height, and a park you have to scroll is one you cannot plan from.
 * So the largest bay that still fits is solved for rather than picked.
 *
 * Measured from `.board`, which is safe because `.app` pins its column to
 * `minmax(0, 1fr)`. Sizing a board from an element the board can itself widen
 * is how Survival once walked off the right edge of the screen.
 */
function fitBoard(): void {
  // Padding is read off the element rather than written here as a number. The
  // first version subtracted a guessed 8px, which left the gap in the wall
  // hanging five pixels off the right of the screen — visible only at a
  // phone-sized viewport, and exactly the drift a hardcoded copy of a CSS value
  // produces.
  const style = getComputedStyle(boardEl);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);

  const availableWidth = boardEl.clientWidth - padX - EXIT_GUTTER;
  const availableHeight = boardEl.clientHeight - padY;
  if (availableWidth <= 0 || availableHeight <= 0) return;

  const cell = Math.max(26, Math.min(availableWidth / SIZE, availableHeight / SIZE, MAX_CELL));
  renderer.setCell(Math.floor(cell));
}

/* ------------------------------------------------------- state -> screen */

let lastPhase: GameState['phase'] = 'loading';
let currentState: GameState | null = null;

/**
 * The one deferred thing in the game: a beat between the last slide and the
 * sheet that talks about it. The handle is kept and cancelled on every reset,
 * so an undo or a new level inside that window cannot pop a sheet about a
 * level that is no longer over.
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

  // Fit before drawing: every car's box is computed from the bay size, so the
  // size has to be settled first. The park is a fixed six by six, so unlike the
  // other games this needs no measure-draw-measure round trip.
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
    pendingSheet = window.setTimeout(() => showWin(state), 700);
  }

  if (state.phase === 'lost' && lastPhase !== 'lost') {
    sfx.reject();
    clearPendingSheet();
    pendingSheet = window.setTimeout(() => showOutOfTime(), 420);
  }

  lastPhase = state.phase;
});

function handleEffect(state: GameState): void {
  const board = state.generated?.board;
  const { effect } = state;
  if (!board) return;

  if (effect.kind === 'slide') {
    // Pitch rises as the red car gets closer to the way out, so progress is
    // audible without anything having to announce it.
    if (effect.id === TARGET) sfx.pour(Math.min(6, effect.to * 1.4));
    else sfx.select();
  } else if (effect.kind === 'reject') {
    sfx.reject();
    renderer.showReject(effect.id);
  } else if (effect.kind === 'hint') {
    renderer.showHint(board, effect.id, effect.to);
  }
}

/* ---------------------------------------------------------------- overlays */

function showWin(state: GameState): void {
  const par = state.generated?.moves ?? 0;
  const perfect = state.moveCount <= par;

  openSheet(
    (sheet) => {
      sheet.content.append(el('h2', { class: 'win-title' }, perfect ? 'Perfect' : 'Out'));
      sheet.content.append(
        el(
          'div',
          { class: 'result-line' },
          `<b>${state.moveCount}</b><span>${
            perfect
              ? 'moves — the shortest there is'
              : `moves · it can be done in ${par}`
          }</span>`,
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
 * The only way this game ends badly, and only when the clock is on.
 *
 * Nothing about the park is lost — the cars are exactly where they were — so
 * the recovery is simply to carry on, and the sheet says so rather than
 * offering a consolation.
 */
function showOutOfTime(): void {
  openSheet(
    (sheet) => {
      sheet.content.append(el('h2', { class: 'lose-title' }, 'Out of time'));
      sheet.content.append(
        el(
          'p',
          {},
          'The clock ran out — the park is untouched and every car is where you left it. ' +
            'Carry on from here, or turn the clock off in the top bar and take it at your ' +
            'own pace.',
        ),
      );

      const carry = el('button', { class: 'button button--full' }, 'Keep going');
      carry.addEventListener('click', () => {
        sheet.close();
        game.undo();
      });

      const restart = el(
        'button',
        { class: 'button button--ghost button--full' },
        'Start this park again',
      );
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
    gameName: 'Gridlock',
    save: game.currentSave,
    currentLevel: game.currentSave.level,
    // Colour carries no rule in this game — a car is told apart by where it is
    // and which way it points — so the shape overlay would be a row that
    // changes nothing, and offering one of those is worse than not offering it.
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

  const target = event.target as HTMLElement | null;
  if (target?.closest('input, textarea') || target?.isContentEditable) return;
  if (document.querySelector('.overlay')) return;

  if (event.key === 'z') game.undo();
  else if (event.key === 'r') game.restart();
  else if (event.key === 'h') game.requestHint();
});

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
