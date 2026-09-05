/**
 * Five Dice entry point. Wires the controller to the renderer and the chrome.
 *
 * Three things here differ from the other games' entry points, all of them
 * following from this being a game of chance rather than a puzzle:
 *
 *   - The controls are Throw, Score and Hint. There is no Undo and no Restart —
 *     see the header of `game.ts` for why either one would be an exploit.
 *   - Abandoning a card lives in the top bar behind a confirmation, not in the
 *     controls. It is rare, it is mildly destructive, and it should not sit under
 *     the thumb that is pressing Throw twenty times a round.
 *   - The clock and the colour-shape overlay are switched off in Settings rather
 *     than offered and ignored. Nothing here is timed and no colour carries
 *     information, so both rows would be controls that do nothing.
 */

import '../shared/shell.css';
import './fivedice.css';

import { setSoundEnabled, sfx } from '../shared/audio';
import { registerServiceWorker } from '../shared/pwa';
import { createHowToPlay, shouldAutoShow } from '../shared/how-to-play';
import { openSettings } from '../shared/settings-sheet';
import { applyTheme, el, icons, openSheet, prefersReducedMotion } from '../shared/ui';
import { CATEGORIES } from './model';
import { FiveDiceGame, GAME_ID, type GameState } from './game';
import { RULES } from './rules';
import { BoardRenderer, describeRecord } from './render';

const app = document.getElementById('app');
if (!app) throw new Error('#app is missing');

/* ------------------------------------------------------------------ chrome */

const roundLabel = el('b', {}, 'Round 1');
const recordLabel = el('span', {}, '');
const newRoundButton = el(
  'button',
  { class: 'icon-button', 'aria-label': 'New card' },
  icons.restart,
);
const settingsButton = el(
  'button',
  { class: 'icon-button', 'aria-label': 'Settings' },
  icons.settings,
);

const topbar = el('header', { class: 'topbar' });
const roundBlock = el('div', { class: 'topbar-level' });
roundBlock.append(roundLabel, recordLabel);

const howTo = createHowToPlay({
  rules: RULES,
  onSeen: () => game.markHowToPlaySeen(),
});

const topbarActions = el('div', { class: 'topbar-actions' });
topbarActions.append(howTo.button, newRoundButton, settingsButton);
topbar.append(roundBlock, topbarActions);

const boardEl = el('main', { class: 'board', 'aria-label': 'Scorecard and dice' });

/*
 * Two icons of this game's own. The shared set has no die and nothing that means
 * "write this down", and the pips need `fill` set on themselves: `.control svg`
 * in shell.css sets `fill: none` on the element, which children inherit unless
 * they say otherwise.
 */
const DIE_ICON =
  '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/>' +
  '<circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none"/>' +
  '<circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>' +
  '<circle cx="15.5" cy="15.5" r="1.5" fill="currentColor" stroke="none"/></svg>';

const WRITE_ICON =
  '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/>' +
  '<path d="M8 12.2l3 3 5.2-6"/></svg>';

const throwButton = controlButton('Throw', DIE_ICON);
const scoreButton = controlButton('Score', WRITE_ICON);
const hintButton = controlButton('Hint', icons.hint);
const controls = el('footer', { class: 'controls' });
controls.append(throwButton, scoreButton, hintButton);

app.append(topbar, boardEl, controls);
app.classList.add('app--fivedice');

function controlButton(label: string, icon: string): HTMLButtonElement {
  return el('button', { class: 'control', type: 'button' }, `${icon}<span>${label}</span>`);
}

/* -------------------------------------------------------------------- game */

const game = new FiveDiceGame();
const reducedMotion = prefersReducedMotion();

const renderer = new BoardRenderer(boardEl, {
  reducedMotion,
  onTapBox: (category) => game.tapBox(category),
  onTapDie: (slot) => game.toggleHold(slot),
});

/* Proportions of the board, in px. */
const MIN_ROW = 26;
/*
 * Generous, because the card is the board and there is nothing else to give the
 * space to. Seven rows at fifty left two hundred dead pixels between the card
 * and the dice on a 390x844 phone, and the rows expand into that instead. What
 * the cap still leaves over collects immediately above the dice — see the
 * `margin-top: auto` in the stylesheet — where forty-odd pixels reads as the
 * gap between the card and the tray rather than as a gap in the layout.
 */
const MAX_ROW = 72;
const MIN_DIE = 32;
const MAX_DIE = 60;
const FOOT_HEIGHT = 34;
const ROWS = 7;

/**
 * Sizes the card and the dice so the whole board fits without scrolling.
 *
 * The card is always seven rows by two columns and the tray is always five dice,
 * so unlike the other games there is no level-to-level variation here — but the
 * phones vary by three hundred pixels of height, and a scorecard that needs
 * scrolling is a scorecard you cannot plan from. So the row height is solved for
 * rather than picked.
 */
function fitBoard(): void {
  const width = boardEl.clientWidth;
  const height = boardEl.clientHeight;
  if (width <= 0 || height <= 0) return;

  const die = clamp((width - 12 - 4 * 8) / 5, MIN_DIE, MAX_DIE);
  const forCard = height - die - FOOT_HEIGHT - 26;
  const row = clamp((forCard - (ROWS - 1) * 5) / ROWS, MIN_ROW, MAX_ROW);

  boardEl.style.setProperty('--fd-row', `${row.toFixed(1)}px`);
  boardEl.style.setProperty('--fd-die', `${die.toFixed(1)}px`);
}

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

/* ------------------------------------------------------- state -> screen */

let currentState: GameState | null = null;
let lastPhase: GameState['phase'] = 'loading';

/**
 * The one deferred thing in the game: a beat between the last box being written
 * and the sheet that talks about the card. The handle is kept and cancelled on
 * every reset, so dealing a new round inside that window cannot pop a result
 * sheet about a card that is no longer on screen.
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

  roundLabel.textContent = `Round ${state.level}`;
  recordLabel.textContent = describeRecord(state);

  if (state.effect.kind === 'reset') {
    clearPendingSheet();
    renderer.reset();
  }

  renderer.render(state);
  fitBoard();

  throwButton.disabled = !state.canThrow;
  scoreButton.disabled = !state.canWrite;
  hintButton.disabled = state.phase !== 'playing';

  const selected = state.selected;
  scoreButton.querySelector('span')!.textContent =
    selected === null ? 'Score' : `Write ${state.previews[selected] ?? 0}`;
  throwButton.querySelector('span')!.textContent =
    state.throwsLeft > 0 ? `Throw · ${state.throwsLeft}` : 'Throw';

  handleEffect(state);

  if (state.phase === 'finished' && lastPhase !== 'finished') {
    renderer.celebrate();
    sfx.win();
    clearPendingSheet();
    pendingSheet = window.setTimeout(() => showResult(state), 620);
  }

  lastPhase = state.phase;
});

function handleEffect(state: GameState): void {
  const { effect } = state;

  // Cleared before anything new is applied: a stale highlight on two controls at
  // once makes the hint ambiguous, and breaks any automated playthrough.
  if (effect.kind !== 'hint') clearControlHints();

  if (effect.kind === 'threw') {
    sfx.pour(effect.slots.length);
    renderer.showThrow(effect.slots);
  } else if (effect.kind === 'wrote') {
    if (effect.points === 0) sfx.reject();
    else sfx.complete();
    renderer.clearHints();
  } else if (effect.kind === 'reject') {
    sfx.reject();
  } else if (effect.kind === 'hint') {
    clearControlHints();
    renderer.showHint(state);
    (effect.advice.kind === 'roll' ? throwButton : scoreButton).classList.add('is-hinted');
  }
}

function clearControlHints(): void {
  throwButton.classList.remove('is-hinted');
  scoreButton.classList.remove('is-hinted');
}

/* ---------------------------------------------------------------- overlays */

/**
 * The card is full.
 *
 * Not dismissible: there is nothing left to tap on a finished card, and the
 * score is already banked by the time this appears — closing the app here loses
 * the sheet and nothing else.
 */
function showResult(state: GameState): void {
  const { grand } = state.totals;
  const { best, rounds } = state.record;
  const isBest = grand >= best && rounds > 0;

  openSheet(
    (sheet) => {
      sheet.content.append(el('h2', { class: 'win-title' }, isBest ? 'Best card yet' : 'Card full'));
      sheet.content.append(
        el('div', { class: 'result-line' }, `<b>${grand}</b><span>points</span>`),
      );

      const next = el('button', { class: 'button button--full' }, 'New card');
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
 * Abandoning a card. Confirmed, because it throws away a card in progress —
 * and it shows the score so far, since a player halfway through a good one
 * deserves to see the number before they lose it.
 */
function confirmNewRound(state: GameState): void {
  const written = CATEGORIES.length - state.openBoxes.length;
  if (state.phase !== 'playing' || written === 0) {
    game.newRound();
    return;
  }

  openSheet((sheet) => {
    sheet.content.append(el('h2', {}, 'Abandon this card?'));
    sheet.content.append(
      el(
        'p',
        {},
        `${written} of ${CATEGORIES.length} boxes filled, for ${state.totals.grand}. ` +
          'An abandoned card is not counted in your record.',
      ),
    );

    const confirm = el('button', { class: 'button button--full' }, 'New card');
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

throwButton.addEventListener('click', () => game.throwDice());
scoreButton.addEventListener('click', () => game.commit());
hintButton.addEventListener('click', () => {
  if (game.requestHint() === null) sfx.reject();
});

newRoundButton.addEventListener('click', () => {
  if (currentState) confirmNewRound(currentState);
});

settingsButton.addEventListener('click', () => {
  const record = game.currentSave.stats;
  const rounds = record.levelsCleared;

  openSettings({
    gameId: GAME_ID,
    gameName: 'Five Dice',
    save: game.currentSave,
    currentLevel: game.currentSave.level,
    levelNoun: 'Round',
    // No clock, and no colour that carries information. See the file header.
    showTimer: false,
    showShapes: false,
    progressLine:
      rounds === 0
        ? 'No cards finished yet'
        : `${rounds} card${rounds === 1 ? '' : 's'} · best ${record.bestScore ?? 0} · ` +
          `average ${Math.round((record.scoreTotal ?? 0) / rounds)} · ${record.totalHints} hints`,
    onSettingsChange: (patch) => game.updateSettings(patch),
    onHowToPlay: () => howTo.open(),
    onImport: (save) => game.replaceSave(save),
    onGoToLevel: (round) => game.goToRound(round),
  });
});

document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.key === 'r' || event.key === ' ') {
    event.preventDefault();
    game.throwDice();
  } else if (event.key === 'h') game.requestHint();
  else if (event.key === 'Enter') game.commit();
  else if (/^[1-5]$/.test(event.key)) game.toggleHold(Number(event.key) - 1);
});

const refit = (): void => {
  fitBoard();
  if (currentState) renderer.render(currentState);
};
window.addEventListener('resize', refit);
window.addEventListener('orientationchange', () => window.setTimeout(refit, 220));

/* -------------------------------------------------------------------- boot */

void (async () => {
  await game.start();
  applyTheme(game.settings.theme);
  setSoundEnabled(game.settings.sound);
  if (currentState) {
    renderer.render(currentState);
    fitBoard();
  }

  if (shouldAutoShow(game.currentSave)) howTo.open(true);
})();

registerServiceWorker();
