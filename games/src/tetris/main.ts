/**
 * Tetris entry point. Wires the controller to the renderer and the chrome.
 *
 * What differs from the other games follows from this being real-time:
 *
 *   - **No Undo and no Hint.** See the header of `game.ts`. There is no footer
 *     at all — the well takes gestures (see `render.ts`), so it gets the
 *     height — and New game moves up to the top bar beside the other two icons.
 *   - **Any sheet opening over the board stops the clock**, and so does the tab
 *     being hidden or the page going away. Play resumes on a tap on the well,
 *     never on its own: a piece that started falling behind a menu is a piece
 *     nobody was watching.
 *   - **Settings offers no shape overlay.** The overlay exists where colour is
 *     the only thing telling two pieces apart, and here it never is — a falling
 *     piece is identified by its shape, which is the entire subject of the
 *     game, and a locked cell is just a filled cell whose colour the rules do
 *     not consult. Artillery declined it first, for the same kind of reason.
 *   - **Settings offers no clock.** There is already one, and it is the game.
 */

import '../shared/shell.css';
import './tetris.css';

import { setSoundEnabled } from '../shared/audio';
import { registerServiceWorker } from '../shared/pwa';
import { pinViewportHeight } from '../shared/viewport';
import { createHowToPlay, shouldAutoShow } from '../shared/how-to-play';
import { openSettings } from '../shared/settings-sheet';
import { applyTheme, el, icons, openSheet } from '../shared/ui';
import { GAME_ID, TetrisGame, type GameView } from './game';
import { RULES } from './rules';
import { BoardRenderer, pieceColourVars } from './render';

const app = document.getElementById('app');
if (!app) throw new Error('#app is missing');

// Before anything measures the board: the shell is sized from the height this
// writes down, not from the browser's idea of the viewport. See viewport.ts.
pinViewportHeight();

// The seven piece colours, taken from the shared palette so there is one place
// they are defined, and handed to the stylesheet as custom properties.
app.setAttribute('style', pieceColourVars());

/* ------------------------------------------------------------------ chrome */

const scoreLabel = el('b', {}, '0');
const detailLabel = el('span', {}, '');

const newGameButton = el(
  'button',
  { class: 'icon-button', type: 'button', 'aria-label': 'New game', title: 'New game' },
  icons.restart,
);
const settingsButton = el(
  'button',
  { class: 'icon-button', 'aria-label': 'Settings' },
  icons.settings,
);

const topbar = el('header', { class: 'topbar' });
const scoreBlock = el('div', { class: 'topbar-level' });
scoreBlock.append(scoreLabel, detailLabel);

const howTo = createHowToPlay({
  rules: RULES,
  onSeen: () => game.markHowToPlaySeen(),
  onOpen: () => game.pause(),
});

const topbarActions = el('div', { class: 'topbar-actions' });
topbarActions.append(newGameButton, howTo.button, settingsButton);
topbar.append(scoreBlock, topbarActions);

const trayEl = el('div', { class: 'tt-tray' });
const boardEl = el('main', { class: 'tt-board', 'aria-label': 'Tetris well' });

app.append(topbar, trayEl, boardEl);
app.classList.add('app--tetris');

/* -------------------------------------------------------------------- game */

const game = new TetrisGame();

const renderer = new BoardRenderer(boardEl, trayEl, {
  onPress: (action) => game.press(action),
  onResume: () => game.begin(),
});

/* ------------------------------------------------------- state -> screen */

let current: GameView | null = null;

/**
 * The beat between the last piece landing and the result sheet, so the board
 * that ended the game is actually seen. Kept and cancelled on every reset, so a
 * new game inside that window cannot pop a sheet about a game that is no longer
 * on screen.
 */
let pendingSheet = false;

const formatNumber = (value: number): string => value.toLocaleString('en-GB');

game.subscribe((view) => {
  current = view;

  scoreLabel.textContent = formatNumber(view.score);
  detailLabel.textContent =
    `Level ${view.runLevel} · ${view.lines} line${view.lines === 1 ? '' : 's'}` +
    (view.best > 0 ? ` · best ${formatNumber(view.best)}` : '');

  const { effect } = view;
  if (effect.kind === 'reset') {
    pendingSheet = false;
    renderer.cancel();
  }

  renderer.render(view);

  if (effect.kind !== 'none' && effect.kind !== 'reset') renderer.play(effect);

  if (effect.kind === 'over') {
    pendingSheet = true;
    const game_ = view.level;
    window.setTimeout(() => {
      if (pendingSheet && current?.phase === 'over' && current.level === game_) {
        pendingSheet = false;
        showResult(view);
      }
    }, 700);
  }
});

/* ---------------------------------------------------------------- overlays */

/**
 * The game is over.
 *
 * Not dismissible, and no explanation: the well behind it is stacked to the
 * lip, which says it better. The game is banked by now, so closing the app here
 * loses the sheet and nothing else.
 */
function showResult(view: GameView): void {
  openSheet(
    (sheet) => {
      sheet.content.append(
        el(
          'h2',
          { class: view.isBest ? 'win-title' : 'lose-title' },
          view.isBest ? 'New best' : 'Stacked out',
        ),
      );
      sheet.content.append(
        el(
          'div',
          { class: 'result-line' },
          `<b>${formatNumber(view.score)}</b><span>${view.score === 1 ? 'point' : 'points'}</span>`,
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

/** Confirmed once there is a score on the board, because it ends a run. */
function confirmNewGame(view: GameView): void {
  if (view.phase === 'over' || view.score === 0) {
    game.newGame();
    return;
  }

  game.pause();
  openSheet((sheet) => {
    sheet.content.append(el('h2', {}, 'End this game?'));
    sheet.content.append(
      el(
        'div',
        { class: 'result-line' },
        `<b>${formatNumber(view.score)}</b><span>${view.score === 1 ? 'point' : 'points'}</span>`,
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

newGameButton.addEventListener('click', () => {
  if (current) confirmNewGame(current);
});

settingsButton.addEventListener('click', () => {
  game.pause();
  const stats = game.currentSave.stats;
  const games = stats.levelsCleared;

  openSettings({
    gameId: GAME_ID,
    gameName: 'Tetris',
    save: game.currentSave,
    currentLevel: game.currentSave.level,
    levelNoun: 'Game',
    showTimer: false,
    // See the header: colour never carries information here.
    showShapes: false,
    progressLine:
      games === 0
        ? 'No games finished yet'
        : `${games} game${games === 1 ? '' : 's'} · best ${formatNumber(stats.bestScore ?? 0)}`,
    onSettingsChange: (patch) => game.updateSettings(patch),
    onHowToPlay: () => howTo.open(),
    onImport: (save) => game.replaceSave(save),
    onGoToLevel: (target) => game.goToGame(target),
  });
});

/**
 * On a keyboard: the arrows move and soft drop, Z and X turn, Space drops,
 * Shift or C holds, and Escape stops the clock.
 *
 * `repeat` is let through for the two that should walk when held, and blocked
 * for everything else — a held rotate key firing thirty times a second would
 * spin the piece and, worse, spend the lock-delay resets that let it be placed.
 */
document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (document.querySelector('.overlay')) return;

  const key = event.key;
  const walks = key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowDown';
  if (event.repeat && !walks) return;

  switch (key) {
    case 'ArrowLeft':
      game.press('left');
      break;
    case 'ArrowRight':
      game.press('right');
      break;
    case 'ArrowDown':
      game.setSoftDrop(true);
      game.press('soft');
      break;
    case 'ArrowUp':
    case 'x':
    case 'X':
      game.press('cw');
      break;
    case 'z':
    case 'Z':
      game.press('ccw');
      break;
    case 'Shift':
    case 'c':
    case 'C':
      game.press('hold');
      break;
    case ' ':
      event.preventDefault();
      if (current?.phase === 'ready') game.begin();
      else game.press('hard');
      break;
    case 'Enter':
      if (current?.phase === 'ready') {
        event.preventDefault();
        game.begin();
      }
      break;
    case 'Escape':
      game.pause();
      break;
    default:
      return;
  }

  if (walks) event.preventDefault();
});

document.addEventListener('keyup', (event) => {
  if (event.key === 'ArrowDown') game.setSoftDrop(false);
});

/*
 * Backgrounding the app stops the clock. Timers in a hidden tab are throttled
 * on some browsers and stopped on others, so a piece would either crawl or
 * arrive all at once — and either way it fell in a game nobody was watching.
 * `pagehide` covers the phone being locked and the tab being closed, which on
 * iOS does not always fire `visibilitychange` first.
 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.pause();
});
window.addEventListener('pagehide', () => game.pause());

/* -------------------------------------------------------------------- boot */

void (async () => {
  await game.start();
  applyTheme(game.settings.theme);
  setSoundEnabled(game.settings.sound);
  if (current) renderer.render(current);

  if (shouldAutoShow(game.currentSave)) howTo.open(true);
})();

registerServiceWorker();
