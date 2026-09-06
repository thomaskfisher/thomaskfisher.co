/**
 * Backgammon entry point. Wires the controller to the renderer and the chrome.
 *
 * What is different here from the other games follows from there being two
 * people rather than one:
 *
 *   - The controls are Undo and one contextual button — Roll, then Done, then
 *     Pass when there was nothing to play. That button is the hand-over, and it
 *     is deliberately the only way a turn ends.
 *   - There is no Hint. See the header of `game.ts`: a hint here would be an
 *     engine playing one side of a two-player game.
 *   - Settings offers the shape overlay and not the clock. Colour is the only
 *     thing separating the two sides, so the overlay earns its row; nothing
 *     here is timed, and a clock between two people is a different game.
 */

import '../shared/shell.css';
import './backgammon.css';

import { setSoundEnabled, sfx } from '../shared/audio';
import { registerServiceWorker } from '../shared/pwa';
import { createHowToPlay, shouldAutoShow } from '../shared/how-to-play';
import { openSettings } from '../shared/settings-sheet';
import { applyTheme, el, icons, openSheet, prefersReducedMotion } from '../shared/ui';
import { OPPONENT, pipCount } from './board';
import { BackgammonGame, GAME_ID, NAMES, type GameView } from './game';
import { RULES } from './rules';
import { BoardRenderer, describeTally, describeTurn } from './render';

const app = document.getElementById('app');
if (!app) throw new Error('#app is missing');

/* ------------------------------------------------------------------ chrome */

const gameLabel = el('b', {}, 'Game 1');
const tallyLabel = el('span', {}, '');
const newGameButton = el(
  'button',
  { class: 'icon-button', 'aria-label': 'New game' },
  icons.restart,
);
const settingsButton = el(
  'button',
  { class: 'icon-button', 'aria-label': 'Settings' },
  icons.settings,
);

const topbar = el('header', { class: 'topbar' });
const gameBlock = el('div', { class: 'topbar-level' });
gameBlock.append(gameLabel, tallyLabel);

const howTo = createHowToPlay({
  rules: RULES,
  onSeen: () => game.markHowToPlaySeen(),
});

const topbarActions = el('div', { class: 'topbar-actions' });
topbarActions.append(howTo.button, newGameButton, settingsButton);
topbar.append(gameBlock, topbarActions);

const boardEl = el('main', { class: 'board', 'aria-label': 'Backgammon board' });
const statusEl = el('p', { class: 'bg-status', role: 'status', 'aria-live': 'polite' }, '');

/*
 * Two icons of this game's own: the shared set has no die, and nothing that
 * means "your turn is over". The pips need `fill` set on themselves, because
 * `.control svg` in shell.css sets `fill: none` and children inherit it.
 */
const DIE_ICON =
  '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/>' +
  '<circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none"/>' +
  '<circle cx="15.5" cy="8.5" r="1.5" fill="currentColor" stroke="none"/>' +
  '<circle cx="8.5" cy="15.5" r="1.5" fill="currentColor" stroke="none"/>' +
  '<circle cx="15.5" cy="15.5" r="1.5" fill="currentColor" stroke="none"/></svg>';

const HAND_OVER_ICON =
  '<svg viewBox="0 0 24 24"><path d="M4 12h13"/><path d="M12.5 6.5L18 12l-5.5 5.5"/>' +
  '<path d="M20.5 4.5v15"/></svg>';

const undoButton = controlButton('Undo', icons.undo);
const goButton = controlButton('Roll', DIE_ICON);
goButton.classList.add('control--go');

const controls = el('footer', { class: 'controls' });
controls.append(undoButton, goButton);

app.append(topbar, boardEl, statusEl, controls);
app.classList.add('app--backgammon');

function controlButton(label: string, icon: string): HTMLButtonElement {
  return el('button', { class: 'control', type: 'button' }, `${icon}<span>${label}</span>`);
}

/** Repaints the contextual button, and only when it has actually changed. */
function setControl(button: HTMLButtonElement, icon: string, label: string): void {
  if (button.dataset.state === label) return;
  button.dataset.state = label;
  button.innerHTML = `${icon}<span>${label}</span>`;
}

/* -------------------------------------------------------------------- game */

const game = new BackgammonGame();
const reducedMotion = prefersReducedMotion();

const renderer = new BoardRenderer(boardEl, {
  reducedMotion,
  shapes: game.settings.colorBlindShapes,
  onTapPoint: (point) => game.tapPoint(point),
  onTapOff: () => game.tapOff(),
});

/* Proportions of the board, in units of `--u` — the width of one point. */
const COLUMNS = 12;
const BAR_UNITS = 1.15;
const HALF_UNITS = 5.2;
const MID_UNITS = 1.7;
const TRAY_UNITS = 0.8;
const MIN_UNIT = 13;
const MAX_UNIT = 46;

const WIDE = COLUMNS + BAR_UNITS;
const TALL = HALF_UNITS * 2 + MID_UNITS + TRAY_UNITS * 2;

/**
 * Sizes the board so the whole of it fits without scrolling.
 *
 * A backgammon board with five checkers standing on a point is very nearly
 * square — thirteen point-widths across, a shade under fourteen down — which is
 * the only reason it fits a portrait phone at all. On any phone the width is
 * therefore what settles the size of a checker, and a tall screen is left with
 * a few hundred pixels of nothing.
 *
 * So the second half of this hands that slack back: the halves, the middle and
 * the trays each stretch towards a cap, which lengthens the points without
 * touching the checkers. That is worth doing rather than centring the dead
 * space, because a longer point is a bigger tap target on the axis that has
 * room to spare — and because a board floating in the middle of the screen
 * reads as a small board rather than a well-proportioned one.
 */
function fitBoard(): void {
  const width = boardEl.clientWidth - 12;
  const height = boardEl.clientHeight - 4;
  if (width <= 0 || height <= 0) return;

  const unit = clamp(Math.min(width / WIDE, height / TALL), MIN_UNIT, MAX_UNIT);
  const checker = unit * 0.9;

  // Shares add up to one across the five rows: two halves, the middle, two
  // trays. Each stops at its cap, so a very tall screen keeps its margin rather
  // than stretching the board into something that is not a backgammon board.
  const slack = Math.max(0, height - TALL * unit);
  const stretch = (base: number, cap: number, share: number): number =>
    Math.min(cap * unit, base * unit + slack * share);

  const half = stretch(HALF_UNITS, 6.8, 0.36);
  const mid = stretch(MID_UNITS, 3.2, 0.18);
  const tray = stretch(TRAY_UNITS, 1.3, 0.05);

  boardEl.style.setProperty('--u', `${unit.toFixed(2)}px`);
  boardEl.style.setProperty('--bar', `${(unit * BAR_UNITS).toFixed(2)}px`);
  boardEl.style.setProperty('--half', `${half.toFixed(2)}px`);
  boardEl.style.setProperty('--mid', `${mid.toFixed(2)}px`);
  boardEl.style.setProperty('--tray', `${tray.toFixed(2)}px`);
  boardEl.style.setProperty('--checker', `${checker.toFixed(2)}px`);

  renderer.setMetrics({ unit, half, checker });
}

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

/* ------------------------------------------------------- state -> screen */

let current: GameView | null = null;
let lastPhase: GameView['phase'] = 'loading';

/**
 * The one deferred thing in the game: a beat between the last checker coming
 * off and the sheet that talks about it. The handle is kept and cancelled on
 * every reset, so starting a new game inside that window cannot pop a result
 * sheet about a game that is no longer on screen.
 */
let pendingSheet: number | null = null;

function clearPendingSheet(): void {
  if (pendingSheet !== null) {
    window.clearTimeout(pendingSheet);
    pendingSheet = null;
  }
}

game.subscribe((view) => {
  current = view;

  gameLabel.textContent = `Game ${view.level}`;
  tallyLabel.textContent = describeTally(view);

  if (view.effect.kind === 'reset') {
    clearPendingSheet();
    renderer.reset();
  }

  // Sized before the redraw, never after: the checkers are positioned in pixels
  // solved for here, so a render against stale metrics is a stack in the wrong
  // place until something else happens to trigger another one.
  fitBoard();
  renderer.render(view);

  statusEl.textContent = describeTurn(view);
  statusEl.classList.toggle('is-alert', view.effect.kind === 'reject');

  undoButton.disabled = !view.canUndo;
  goButton.disabled = !(view.canRoll || view.canEnd);
  // Pass only when the turn really is over with nothing played — while there
  // are still dice to play the button is a greyed-out Done, and offering to
  // pass a turn the player has not had yet reads as the game giving up on them.
  if (view.canRoll) setControl(goButton, DIE_ICON, 'Roll');
  else setControl(goButton, HAND_OVER_ICON, view.canEnd && view.isPass ? 'Pass' : 'Done');

  handleEffect(view);

  if (view.phase === 'finished' && lastPhase !== 'finished') {
    sfx.win();
    clearPendingSheet();
    pendingSheet = window.setTimeout(() => showResult(view), 620);
  }

  lastPhase = view.phase;
});

function handleEffect(view: GameView): void {
  const { effect } = view;
  if (effect.kind === 'rolled') sfx.pour(view.spent.length);
  else if (effect.kind === 'moved') sfx[effect.hit ? 'complete' : 'select']();
  else if (effect.kind === 'undo') sfx.select();
  else if (effect.kind === 'reject') sfx.reject();
}

/* ---------------------------------------------------------------- overlays */

/**
 * The game is over.
 *
 * Not dismissible: there is nothing left to tap on a finished board, and the
 * result is already banked by the time this appears — closing the app here
 * loses the sheet and nothing else.
 */
function showResult(view: GameView): void {
  const winner = view.winner;
  const position = view.position;
  if (!winner || !position) return;

  const title =
    view.win === 'backgammon'
      ? `${NAMES[winner]} backgammons`
      : view.win === 'gammon'
        ? `${NAMES[winner]} gammons`
        : `${NAMES[winner]} wins`;

  openSheet(
    (sheet) => {
      sheet.content.append(el('h2', { class: 'win-title' }, title));
      sheet.content.append(
        el(
          'div',
          { class: 'result-line' },
          `<b>${pipCount(position.board, OPPONENT[winner])}</b><span>pips</span>`,
        ),
      );

      const next = el('button', { class: 'button button--full' }, 'New game');
      next.addEventListener('click', () => {
        sheet.close();
        game.advance();
      });
      sheet.content.append(next);
    },
    { dismissible: false },
  );
}

/**
 * Starting again. Confirmed, because it throws away a game in progress — and it
 * says whose it was, since the person reaching for the top bar is not always
 * the person who would lose by it.
 */
function confirmNewGame(view: GameView): void {
  if (view.phase !== 'playing' || (view.position?.turn ?? 0) === 0) {
    game.newGame();
    return;
  }

  openSheet((sheet) => {
    sheet.content.append(el('h2', {}, 'Start a new game?'));
    sheet.content.append(
      el(
        'p',
        {},
        `White ${view.pips.white} pips, Red ${view.pips.red}. ` +
          'An abandoned game is not counted in the tally.',
      ),
    );

    const confirm = el('button', { class: 'button button--full' }, 'New game');
    confirm.addEventListener('click', () => {
      sheet.close();
      game.newGame();
    });

    const keep = el('button', { class: 'button button--ghost button--full' }, 'Keep playing');
    keep.addEventListener('click', sheet.close);

    sheet.content.append(confirm, keep);
  });
}

/* ---------------------------------------------------------------- controls */

undoButton.addEventListener('click', () => game.undo());
goButton.addEventListener('click', () => {
  if (!current) return;
  if (current.canRoll) game.roll();
  else game.endTurn();
});

newGameButton.addEventListener('click', () => {
  if (current) confirmNewGame(current);
});

settingsButton.addEventListener('click', () => {
  const stats = game.currentSave.stats;
  const games = stats.levelsCleared;

  openSettings({
    gameId: GAME_ID,
    gameName: 'Backgammon',
    save: game.currentSave,
    currentLevel: game.currentSave.level,
    levelNoun: 'Game',
    // Nothing here is timed; see the file header.
    showTimer: false,
    progressLine:
      games === 0
        ? 'No games finished yet'
        : `${games} game${games === 1 ? '' : 's'} · White ${stats.whiteWins ?? 0} · ` +
          `Red ${stats.redWins ?? 0}`,
    onSettingsChange: (patch) => {
      // Before `updateSettings`, which triggers the redraw that has to use it.
      if (patch.colorBlindShapes !== undefined) {
        renderer.setOptions({ shapes: patch.colorBlindShapes });
      }
      game.updateSettings(patch);
    },
    onHowToPlay: () => howTo.open(),
    onImport: (save) => game.replaceSave(save),
    onGoToLevel: (target) => game.goToGame(target),
  });
});

document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    if (current?.canRoll) game.roll();
    else if (current?.canEnd) game.endTurn();
  } else if (event.key === 'u' || event.key === 'z') game.undo();
});

const refit = (): void => {
  fitBoard();
  if (current) renderer.render(current);
};
window.addEventListener('resize', refit);
window.addEventListener('orientationchange', () => window.setTimeout(refit, 220));

/* -------------------------------------------------------------------- boot */

void (async () => {
  await game.start();
  applyTheme(game.settings.theme);
  setSoundEnabled(game.settings.sound);
  renderer.setOptions({ shapes: game.settings.colorBlindShapes });
  if (current) {
    fitBoard();
    renderer.render(current);
  }

  if (shouldAutoShow(game.currentSave)) howTo.open(true);
})();

registerServiceWorker();
