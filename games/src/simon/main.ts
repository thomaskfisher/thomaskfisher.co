/**
 * Simon entry point. Wires the controller to the renderer and the chrome.
 *
 * What differs from the other games follows from this being a memory game:
 *
 *   - There is no Undo and no Hint. See the header of `game.ts`.
 *   - The pads are the controls. The footer has one button, New game, and the
 *     hub in the middle of the board is Start.
 *   - Any sheet opening over the board pauses the round back to its start. A
 *     sequence played behind a menu was not shown to anybody.
 *   - Settings offers no clock: the original's time limit on each tap is the
 *     one piece of it left out, because it is pressure rather than play.
 */

import '../shared/shell.css';
import './simon.css';

import { setSoundEnabled } from '../shared/audio';
import { registerServiceWorker } from '../shared/pwa';
import { pinViewportHeight } from '../shared/viewport';
import { createHowToPlay, shouldAutoShow } from '../shared/how-to-play';
import { openSettings } from '../shared/settings-sheet';
import { applyTheme, el, icons, openSheet } from '../shared/ui';
import { GAME_ID, SimonGame, type GameView } from './game';
import { RULES } from './rules';
import { BoardRenderer, describeRecord, describeStatus } from './render';

const app = document.getElementById('app');
if (!app) throw new Error('#app is missing');

// Before anything measures the board: the shell is sized from the height this
// writes down, not from the browser's idea of the viewport. See viewport.ts.
pinViewportHeight();

/* ------------------------------------------------------------------ chrome */

const gameLabel = el('b', {}, 'Game 1');
const recordLabel = el('span', {}, '');
const settingsButton = el(
  'button',
  { class: 'icon-button', 'aria-label': 'Settings' },
  icons.settings,
);

const topbar = el('header', { class: 'topbar' });
const gameBlock = el('div', { class: 'topbar-level' });
gameBlock.append(gameLabel, recordLabel);

const howTo = createHowToPlay({
  rules: RULES,
  onSeen: () => game.markHowToPlaySeen(),
  onOpen: () => game.pause(),
});

const topbarActions = el('div', { class: 'topbar-actions' });
topbarActions.append(howTo.button, settingsButton);
topbar.append(gameBlock, topbarActions);

const boardEl = el('main', { class: 'board', 'aria-label': 'Simon board' });
const statusEl = el('p', { class: 'sm-status', role: 'status', 'aria-live': 'polite' }, '');

const newGameButton = el(
  'button',
  { class: 'control', type: 'button' },
  `${icons.restart}<span>New game</span>`,
);
const controls = el('footer', { class: 'controls' });
controls.append(newGameButton);

app.append(topbar, boardEl, statusEl, controls);
app.classList.add('app--simon');

/* -------------------------------------------------------------------- game */

const game = new SimonGame();

const renderer = new BoardRenderer(boardEl, {
  onTapPad: (pad) => game.tapPad(pad),
  onTapHub: () => {
    if (current?.phase === 'over') game.advance();
    else game.begin();
  },
  onShown: (showId) => game.shown(showId),
});

/* ------------------------------------------------------- state -> screen */

let current: GameView | null = null;

/**
 * The beat between the right pad flashing and the result sheet. Kept and
 * cancelled on every reset, so a new game inside that window cannot pop a
 * sheet about a game that is no longer on screen. The flashing itself is the
 * renderer's, and so are its handles.
 */
let pendingSheet = false;

game.subscribe((view) => {
  current = view;

  gameLabel.textContent = `Game ${view.level}`;
  recordLabel.textContent = describeRecord(view);

  const { effect } = view;
  if (effect.kind === 'reset') {
    pendingSheet = false;
    renderer.cancel();
  }

  // Settings first, then the draw that uses them.
  renderer.setShapes(game.settings.colorBlindShapes);
  renderer.render(view);

  statusEl.textContent = describeStatus(view);
  newGameButton.disabled = view.phase === 'loading';

  if (effect.kind === 'show') renderer.play(view, effect.lead);
  else if (effect.kind === 'pressed') renderer.tapped(effect.pad);
  else if (effect.kind === 'lost') {
    pendingSheet = true;
    const level = view.level;
    renderer.lost(effect.pad, effect.expected, () => {
      if (pendingSheet && current?.phase === 'over' && current.level === level) {
        pendingSheet = false;
        showResult(view);
      }
    });
  } else if (view.phase === 'ready') {
    // A pause: whatever was mid-flash stops, and its report back is stale.
    renderer.cancel();
  }
});

/* ---------------------------------------------------------------- overlays */

/**
 * The game is over.
 *
 * Not dismissible, and no explanation: the board behind it has just flashed
 * the pad that was wanted. The game is banked by now, so closing the app here
 * loses the sheet and nothing else.
 */
function showResult(view: GameView): void {
  openSheet(
    (sheet) => {
      sheet.content.append(
        el('h2', { class: view.isBest ? 'win-title' : 'lose-title' }, view.isBest ? 'New best' : 'Wrong colour'),
      );
      sheet.content.append(
        el(
          'div',
          { class: 'result-line' },
          `<b>${view.score}</b><span>${view.score === 1 ? 'round' : 'rounds'}</span>`,
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

/** Confirmed once a round has been finished, because it ends a run. */
function confirmNewGame(view: GameView): void {
  if (view.phase === 'over' || view.score === 0) {
    game.newGame();
    return;
  }

  game.pause();
  openSheet((sheet) => {
    sheet.content.append(el('h2', {}, 'End this game?'));
    sheet.content.append(
      el('div', { class: 'result-line' }, `<b>${view.score}</b><span>${view.score === 1 ? 'round' : 'rounds'}</span>`),
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
    gameName: 'Simon',
    save: game.currentSave,
    currentLevel: game.currentSave.level,
    levelNoun: 'Game',
    showTimer: false,
    progressLine:
      games === 0
        ? 'No games finished yet'
        : `${games} game${games === 1 ? '' : 's'} · best ${stats.bestScore ?? 0}`,
    onSettingsChange: (patch) => game.updateSettings(patch),
    onHowToPlay: () => howTo.open(),
    onImport: (save) => game.replaceSave(save),
    onGoToLevel: (target) => game.goToGame(target),
  });
});

/**
 * On a keyboard: 1-4 are the pads clockwise from the top left, and Space or
 * Enter is the hub.
 */
document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
  if (document.querySelector('.overlay')) return;

  if (event.key >= '1' && event.key <= '4') {
    if (current?.phase === 'input') {
      game.tapPad(Number(event.key) - 1);
    }
  } else if (event.key === ' ' || event.key === 'Enter') {
    if (current?.phase === 'ready') {
      event.preventDefault();
      game.begin();
    }
  }
});

/*
 * Backgrounding the app mid-round pauses it. Timers keep running in a hidden
 * tab on some browsers and are throttled on others, so a sequence shown to a
 * phone in a pocket is at best unseen and at worst shown at the wrong speed.
 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.pause();
});

/* -------------------------------------------------------------------- boot */

void (async () => {
  await game.start();
  applyTheme(game.settings.theme);
  setSoundEnabled(game.settings.sound);
  if (current) renderer.render(current);

  if (shouldAutoShow(game.currentSave)) howTo.open(true);
})();

registerServiceWorker();
