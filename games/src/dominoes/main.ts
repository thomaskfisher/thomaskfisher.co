/**
 * Mexican Train entry point. Wires the controller to the renderer and the
 * chrome.
 *
 * What is different here from the single-player games:
 *
 *   - The tray under the board is the player's hand, and between turns it is a
 *     curtain instead. That is the one piece of chrome this game has that
 *     nothing else in the collection needs.
 *   - The controls are Undo and one contextual button — Draw, then Pass. Draw
 *     is offered only when nothing in the hand fits, and Pass only once the
 *     boneyard has been asked as well, so the button always says the only thing
 *     left to do.
 *   - There is no Hint. See the header of `game.ts`.
 *   - Settings carries how many are playing, which is a setting no other game
 *     here has. Changing it deals a new round, because the deal is a function
 *     of the table size.
 */

import '../shared/shell.css';
import './dominoes.css';

import { setSoundEnabled, sfx } from '../shared/audio';
import { registerServiceWorker } from '../shared/pwa';
import { pinViewportHeight } from '../shared/viewport';
import { createHowToPlay, shouldAutoShow } from '../shared/how-to-play';
import { openSettings } from '../shared/settings-sheet';
import { applyTheme, el, icons, openSheet, prefersReducedMotion, segmentedRow } from '../shared/ui';
import { DominoesGame, GAME_ID, type GameView, seatName } from './game';
import { MAX_PLAYERS, MIN_PLAYERS } from './model';
import { RULES } from './rules';
import { BoardRenderer, describeTotals, describeTurn } from './render';

const app = document.getElementById('app');
if (!app) throw new Error('#app is missing');

// Before anything measures the board: the shell is sized from the height this
// writes down, not from the browser's idea of the viewport. See viewport.ts.
pinViewportHeight();

/* ------------------------------------------------------------------ chrome */

const roundLabel = el('b', {}, 'Round 1');
const totalsLabel = el('span', {}, '');
const newRoundButton = el(
  'button',
  { class: 'icon-button', 'aria-label': 'New round' },
  icons.restart,
);
const settingsButton = el(
  'button',
  { class: 'icon-button', 'aria-label': 'Settings' },
  icons.settings,
);

const topbar = el('header', { class: 'topbar' });
const roundBlock = el('div', { class: 'topbar-level' });
roundBlock.append(roundLabel, totalsLabel);

const howTo = createHowToPlay({
  rules: RULES,
  onSeen: () => game.markHowToPlaySeen(),
});

const topbarActions = el('div', { class: 'topbar-actions' });
topbarActions.append(howTo.button, newRoundButton, settingsButton);
topbar.append(roundBlock, topbarActions);

const boardEl = el('main', { class: 'board', 'aria-label': 'The trains' });
const statusEl = el('p', { class: 'dm-status', role: 'status', 'aria-live': 'polite' }, '');
const trayEl = el('div', { class: 'dm-tray' });

/*
 * Two icons of this game's own: the shared set has no boneyard and nothing that
 * means "I give up on this turn".
 */
const DRAW_ICON =
  '<svg viewBox="0 0 24 24"><rect x="3.5" y="7.5" width="17" height="9" rx="2.5"/>' +
  '<path d="M12 7.5v9"/><circle cx="7.8" cy="12" r="1.1" fill="currentColor" stroke="none"/>' +
  '<circle cx="16.2" cy="10" r="1.1" fill="currentColor" stroke="none"/>' +
  '<circle cx="16.2" cy="14" r="1.1" fill="currentColor" stroke="none"/></svg>';

const PASS_ICON =
  '<svg viewBox="0 0 24 24"><path d="M4 12h13"/><path d="M12.5 6.5L18 12l-5.5 5.5"/>' +
  '<path d="M20.5 4.5v15"/></svg>';

const undoButton = controlButton('Undo', icons.undo);
const goButton = controlButton('Draw', DRAW_ICON);
goButton.classList.add('control--go');

const controls = el('footer', { class: 'controls' });
controls.append(undoButton, goButton);

app.append(topbar, boardEl, statusEl, trayEl, controls);
app.classList.add('app--dominoes');

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

const game = new DominoesGame();
const reducedMotion = prefersReducedMotion();

const renderer = new BoardRenderer(boardEl, trayEl, {
  reducedMotion,
  onTapTile: (tile) => game.tapTile(tile),
  onTapTrain: (train) => game.tapTrain(train),
  onReveal: () => game.reveal(),
});

/* ------------------------------------------------------- state -> screen */

let current: GameView | null = null;
let lastPhase: GameView['phase'] = 'loading';

/**
 * The one deferred thing in the game: a beat between the last tile landing and
 * the sheet that talks about it. The handle is kept and cancelled on every
 * reset, so dealing again inside that window cannot pop a result sheet about a
 * round that is no longer on screen.
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

  roundLabel.textContent = `Round ${view.level}`;
  totalsLabel.textContent = describeTotals(view);

  if (view.effect.kind === 'reset') {
    clearPendingSheet();
    renderer.reset();
  }

  renderer.render(view);

  statusEl.textContent = describeTurn(view);
  statusEl.classList.toggle('is-alert', view.effect.kind === 'reject');

  undoButton.disabled = !view.canUndo;
  goButton.disabled = !(view.canDraw || view.canPass);
  // Pass is only ever offered after the boneyard has been asked, so the two
  // never compete: Draw while there is a tile to take, Pass once there is not.
  if (view.canDraw) setControl(goButton, DRAW_ICON, 'Draw');
  else setControl(goButton, PASS_ICON, 'Pass');

  handleEffect(view);

  if (view.phase === 'finished' && lastPhase !== 'finished') {
    sfx.win();
    clearPendingSheet();
    pendingSheet = window.setTimeout(() => showResult(view), 640);
  }

  lastPhase = view.phase;
});

function handleEffect(view: GameView): void {
  const { effect } = view;
  if (effect.kind === 'played') sfx.select();
  else if (effect.kind === 'drew') sfx.pour(2);
  else if (effect.kind === 'handover') sfx.complete();
  else if (effect.kind === 'undo') sfx.select();
  else if (effect.kind === 'reject') sfx.reject();
}

/* ---------------------------------------------------------------- overlays */

/**
 * The round is over.
 *
 * Not dismissible: there is nothing left to tap on a finished round, and the
 * result is already banked by the time this appears — closing the app here
 * loses the sheet and nothing else.
 *
 * The card shows both numbers per player, because they answer different
 * questions: what this round cost you, and who is winning. The lowest running
 * total is marked rather than the lowest round, since the running total is the
 * one people are actually playing for.
 */
function showResult(view: GameView): void {
  const round = view.roundScores;
  const position = view.position;
  if (!round || !position) return;

  const best = Math.min(...view.totals);

  openSheet(
    (sheet) => {
      sheet.content.append(
        el(
          'h2',
          { class: 'win-title' },
          position.wentOut === null
            ? 'Blocked'
            : `${seatName(position.wentOut)} went out`,
        ),
      );

      if (position.wentOut === null) {
        // "Blocked" on its own is a word, not an explanation. One line, and
        // only in the case that needs it.
        sheet.content.append(
          el('p', {}, 'Nobody could play and the boneyard was empty. Everybody scores what they hold.'),
        );
      }

      const table = el('div', { class: 'dm-scores' });
      table.append(
        el('span', { class: 'dm-scores-head' }, ''),
        el('span', { class: 'dm-scores-head' }, 'Round'),
        el('span', { class: 'dm-scores-head' }, 'Total'),
      );
      for (const [seat, pips] of round.entries()) {
        const total = view.totals[seat] ?? 0;
        const leader = total === best ? ' is-leader' : '';
        table.append(
          el('b', { class: leader.trim() }, seatName(seat)),
          el('span', {}, String(pips)),
          el('span', { class: leader.trim() }, String(total)),
        );
      }
      sheet.content.append(table);

      const next = el('button', { class: 'button button--full' }, 'Next round');
      next.addEventListener('click', () => {
        sheet.close();
        game.advance();
      });
      sheet.content.append(next);
    },
    { dismissible: false },
  );
}

/** Dealing again. Confirmed, because it throws away a round in progress. */
function confirmNewRound(view: GameView): void {
  if (view.phase === 'finished' || (view.position?.boneyard.length ?? 0) === 0) {
    game.newRound();
    return;
  }

  const laid = view.position?.trains.reduce((sum, train) => sum + train.tiles.length, 0) ?? 0;
  if (laid === 0) {
    game.newRound();
    return;
  }

  openSheet((sheet) => {
    sheet.content.append(el('h2', {}, 'Deal a new round?'));
    sheet.content.append(
      el('p', {}, `${laid} tile${laid === 1 ? '' : 's'} laid. An abandoned round is not scored.`),
    );

    const confirm = el('button', { class: 'button button--full' }, 'Deal');
    confirm.addEventListener('click', () => {
      sheet.close();
      game.newRound();
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
  if (current.canDraw) game.draw();
  else game.pass();
});

newRoundButton.addEventListener('click', () => {
  if (current) confirmNewRound(current);
});

settingsButton.addEventListener('click', () => {
  const stats = game.currentSave.stats;
  const rounds = stats.levelsCleared;
  const totals = stats.seatScores ?? [];

  const counts = Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, index) => {
    const value = String(MIN_PLAYERS + index) as '2' | '3' | '4';
    return { value, label: value };
  });

  openSettings({
    gameId: GAME_ID,
    gameName: 'Mexican Train',
    save: game.currentSave,
    currentLevel: game.currentSave.level,
    levelNoun: 'Round',
    // Nothing here is timed, and colour carries no rule — the tiles are pips.
    showTimer: false,
    showShapes: false,
    extraRows: [
      segmentedRow(
        'Players',
        'Changing this deals a new round.',
        counts,
        String(game.players) as '2' | '3' | '4',
        (value) => game.setPlayers(Number(value)),
      ),
    ],
    progressLine:
      rounds === 0
        ? 'No rounds finished yet'
        : `${rounds} round${rounds === 1 ? '' : 's'} · ` +
          totals.map((total, seat) => `P${seat + 1} ${total}`).join(' · '),
    onSettingsChange: (patch) => game.updateSettings(patch),
    onHowToPlay: () => howTo.open(),
    onImport: (save) => game.replaceSave(save),
    onGoToLevel: (target) => game.goToRound(target),
  });
});

document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    if (current?.phase === 'handover') game.reveal();
    else if (current?.canDraw) game.draw();
    else if (current?.canPass) game.pass();
  } else if (event.key === 'u' || event.key === 'z') {
    game.undo();
  }
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
