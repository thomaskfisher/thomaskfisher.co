/**
 * Mancala entry point. Wires the controller to the renderer and the chrome.
 *
 * What is different here from the single-player games follows from there being
 * two people rather than one:
 *
 *   - There is no Hint. See the header of `game.ts`: a hint at a two-player
 *     board is an engine playing one side better than the other. What replaces
 *     it is that every legal pit is marked, which is the half of a hint that
 *     helps somebody learn the game rather than the half that plays it.
 *   - Settings offers no clock. Nothing here is timed, and a clock between two
 *     people sharing a phone is a different game.
 *   - Restart is confirmed once a game is under way, and says the score, since
 *     the person reaching for it is not always the person who would lose by it.
 */

import '../shared/shell.css';
import './mancala.css';

import { setSoundEnabled, sfx } from '../shared/audio';
import { registerServiceWorker } from '../shared/pwa';
import { pinViewportHeight } from '../shared/viewport';
import { createHowToPlay, shouldAutoShow } from '../shared/how-to-play';
import { openSettings } from '../shared/settings-sheet';
import { applyTheme, el, icons, openSheet, prefersReducedMotion } from '../shared/ui';
import { GAME_ID, MancalaGame, NAMES, type GameView } from './game';
import { pitsOf } from './model';
import { RULES } from './rules';
import { BoardRenderer, describeTally, describeTurn } from './render';

const app = document.getElementById('app');
if (!app) throw new Error('#app is missing');

// Before anything measures the board: the shell is sized from the height this
// writes down, not from the browser's idea of the viewport. See viewport.ts.
pinViewportHeight();

/* ------------------------------------------------------------------ chrome */

const gameLabel = el('b', {}, 'Game 1');
const tallyLabel = el('span', {}, '');
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
topbarActions.append(howTo.button, settingsButton);
topbar.append(gameBlock, topbarActions);

const boardEl = el('main', { class: 'board', 'aria-label': 'Mancala board' });
const statusEl = el('p', { class: 'mc-status', role: 'status', 'aria-live': 'polite' }, '');

const undoButton = controlButton('Undo', icons.undo);
const restartButton = controlButton('Restart', icons.restart);

const controls = el('footer', { class: 'controls' });
controls.append(undoButton, restartButton);

app.append(topbar, boardEl, statusEl, controls);
app.classList.add('app--mancala');

function controlButton(label: string, icon: string): HTMLButtonElement {
  return el('button', { class: 'control', type: 'button' }, `${icon}<span>${label}</span>`);
}

/* -------------------------------------------------------------------- game */

const game = new MancalaGame();
const reducedMotion = prefersReducedMotion();

const renderer = new BoardRenderer(boardEl, {
  reducedMotion,
  onTapPit: (pit) => game.tapPit(pit),
});

/* ------------------------------------------------------------------- sizing */

const MIN_SEED = 6;
const MAX_SEED = 14;
/** Rows of seeds in a pit. Must match `PIT_GRID` in render.ts. */
const SEED_ROWS = 3;

/**
 * The one number CSS cannot solve for.
 *
 * Everything else scales — the rows are `1fr` and the seeds are placed in
 * percentages — but a seed has to be a *fixed* size across the whole board, or
 * a pit holding twenty would draw them twenty times smaller than a pit holding
 * one and the board would stop being countable at a glance.
 *
 * So it is solved for once per layout, from the height of one cell of the grid
 * the seeds are laid out on. Just over half a cell leaves room for the jitter
 * that stops the grid looking like a grid without letting a seed reach the
 * edge of its bowl.
 */
function fitSeeds(): void {
  const height = boardEl.clientHeight;
  if (height <= 0) return;
  // Six pit rows share what the two stores and the gaps leave behind.
  const cell = (height * 0.7) / 6 / SEED_ROWS;
  const seed = Math.max(MIN_SEED, Math.min(MAX_SEED, cell * 0.55));
  boardEl.style.setProperty('--seed', `${seed.toFixed(1)}px`);
}

/* ------------------------------------------------------- state -> screen */

let current: GameView | null = null;
let lastPhase: GameView['phase'] = 'loading';

/**
 * The one deferred thing in the game: a beat between the last seed landing and
 * the sheet that talks about it. The handle is kept and cancelled on every
 * reset, so restarting inside that window cannot pop a result sheet about a
 * game that is no longer on screen.
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

  fitSeeds();
  renderer.render(view);

  statusEl.textContent = describeTurn(view);
  statusEl.classList.toggle('is-alert', view.effect.kind === 'reject');

  undoButton.disabled = !view.canUndo;
  restartButton.disabled = view.phase === 'loading';

  handleEffect(view);

  if (view.phase === 'finished' && lastPhase !== 'finished') {
    sfx.win();
    clearPendingSheet();
    pendingSheet = window.setTimeout(() => showResult(view), 700);
  }

  lastPhase = view.phase;
});

function handleEffect(view: GameView): void {
  const { effect } = view;
  if (effect.kind === 'sown') {
    if (effect.result.capture) sfx.complete();
    else sfx.pour(Math.min(effect.result.path.length, 6));
  } else if (effect.kind === 'undo') sfx.select();
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
  const { south, north } = view.scores;
  const title = view.winner ? `${NAMES[view.winner]} wins` : 'A draw';
  // Winner's number first, so the line reads the way the title does. Fixed in
  // seat order it says "North wins 23-25", which is a sentence that argues
  // with itself.
  const line = view.winner
    ? `${Math.max(south, north)}&ndash;${Math.min(south, north)}`
    : `${south}&ndash;${north}`;

  openSheet(
    (sheet) => {
      sheet.content.append(el('h2', { class: 'win-title' }, title));
      sheet.content.append(
        el('div', { class: 'result-line' }, `<b>${line}</b><span>seeds</span>`),
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

/** Starting over. Confirmed, because it throws away a game in progress. */
function confirmRestart(view: GameView): void {
  if (view.phase !== 'playing' || !view.canUndo) {
    game.restart();
    return;
  }

  openSheet((sheet) => {
    sheet.content.append(el('h2', {}, 'Tip the seeds back in?'));
    sheet.content.append(
      el(
        'p',
        {},
        `South ${view.scores.south}, North ${view.scores.north}. ` +
          'An abandoned game is not counted in the tally.',
      ),
    );

    const confirm = el('button', { class: 'button button--full' }, 'Restart');
    confirm.addEventListener('click', () => {
      sheet.close();
      game.restart();
    });

    const keep = el('button', { class: 'button button--ghost button--full' }, 'Keep playing');
    keep.addEventListener('click', sheet.close);

    sheet.content.append(confirm, keep);
  });
}

/* ---------------------------------------------------------------- controls */

undoButton.addEventListener('click', () => game.undo());
restartButton.addEventListener('click', () => {
  if (current) confirmRestart(current);
});

settingsButton.addEventListener('click', () => {
  const stats = game.currentSave.stats;
  const games = stats.levelsCleared;
  const tally = stats.seatScores ?? [];

  openSettings({
    gameId: GAME_ID,
    gameName: 'Mancala',
    save: game.currentSave,
    currentLevel: game.currentSave.level,
    levelNoun: 'Game',
    // Nothing here is timed; see the file header.
    showTimer: false,
    progressLine:
      games === 0
        ? 'No games finished yet'
        : `${games} game${games === 1 ? '' : 's'} · South ${tally[0] ?? 0} · North ${tally[1] ?? 0}`,
    onSettingsChange: (patch) => game.updateSettings(patch),
    onHowToPlay: () => howTo.open(),
    onImport: (save) => game.replaceSave(save),
    onGoToLevel: (target) => game.goToGame(target),
  });
});

/**
 * Keys 1-6 play the pits of whoever is on the move, counting towards their
 * store — which is what the pits are labelled in the board's aria text, so the
 * two agree. On a desktop that is the whole game on the number row.
 */
document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.key >= '1' && event.key <= '6') {
    if (!current) return;
    const pit = pitsOf(current.turn)[Number(event.key) - 1];
    if (pit !== undefined) game.tapPit(pit);
  } else if (event.key === 'u' || event.key === 'z') {
    game.undo();
  }
});

const refit = (): void => {
  fitSeeds();
  if (current) renderer.render(current);
};
window.addEventListener('resize', refit);
window.addEventListener('orientationchange', () => window.setTimeout(refit, 220));

/* -------------------------------------------------------------------- boot */

void (async () => {
  await game.start();
  applyTheme(game.settings.theme);
  setSoundEnabled(game.settings.sound);
  if (current) {
    fitSeeds();
    renderer.render(current);
  }

  if (shouldAutoShow(game.currentSave)) howTo.open(true);
})();

registerServiceWorker();
