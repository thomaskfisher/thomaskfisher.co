/**
 * Screw Land entry point. Wires the controller to the renderers and the chrome.
 */

import '../shared/shell.css';
import './screwland.css';

import { setSoundEnabled, sfx } from '../shared/audio';
import { paint } from '../shared/palette';
import { registerServiceWorker } from '../shared/pwa';
import { createHowToPlay, shouldAutoShow } from '../shared/how-to-play';
import { openSettings } from '../shared/settings-sheet';
import { createTimedPlay } from '../shared/timed-play';
import { budgetFor } from '../shared/timer';
import { applyTheme, el, icons, openSheet, prefersReducedMotion } from '../shared/ui';
import { GAME_ID, type GameState, ScrewLandGame } from './game';
import { RULES } from './rules';
import { structureBounds } from './model';
import { SinkRenderer, StructureRenderer, describeProgress } from './render';

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
 * The rules sheet.
 *
 * Built before the top bar because the `?` lives in it, and wired to `game` and
 * `timed` through closures that only ever run on a tap — both are declared
 * further down this file.
 */
const howTo = createHowToPlay({
  rules: RULES,
  onOpen: () => timed.pause('howto'),
  onClose: () => timed.resume('howto'),
  onSeen: () => game.markHowToPlaySeen(),
});

// The `?`, the clock and Settings share the right-hand end of the bar. The
// clock inserts itself before `settingsButton` (see shared/timed-play.ts), so
// it lands inside this group rather than beside it.
const topbarActions = el('div', { class: 'topbar-actions' });
topbarActions.append(howTo.button, settingsButton);
topbar.append(levelBlock, topbarActions);

const boxesEl = el('div', { class: 'boxes', 'aria-label': 'Boxes' });
const queueEl = el('div', { class: 'queue', 'aria-label': 'Boxes coming next' });
const trayEl = el('div', { class: 'tray', 'aria-label': 'Tray' });
const sinksEl = el('section', { class: 'sinks' });
sinksEl.append(boxesEl, queueEl, trayEl);

const structureEl = el('div', { class: 'structure' });
const boardEl = el('main', { class: 'board', 'aria-label': 'Puzzle board' });
boardEl.append(structureEl);

const undoButton = controlButton('Undo', icons.undo);
const restartButton = controlButton('Restart', icons.restart);
const hintButton = controlButton('Hint', icons.hint);
const controls = el('footer', { class: 'controls' });
controls.append(undoButton, restartButton, hintButton);

app.append(topbar, sinksEl, boardEl, controls);
app.classList.add('app--screwland');

function controlButton(label: string, icon: string): HTMLButtonElement {
  return el('button', { class: 'control', type: 'button' }, `${icon}<span>${label}</span>`);
}

/* -------------------------------------------------------------------- game */

const game = new ScrewLandGame();
const reducedMotion = prefersReducedMotion();

const structure = new StructureRenderer(structureEl, {
  showGlyphs: false,
  reducedMotion,
  onTapScrew: (id) => game.tapScrew(id),
});

const sinks = new SinkRenderer(boxesEl, queueEl, trayEl, { showGlyphs: false });

/* ------------------------------------------------------------------- clock */

const timed = createTimedPlay<GameState>({
  anchor: settingsButton,
  isTimed: () => game.settings.timed,
  onTimedChange: (value) => game.updateSettings({ timed: value }),
  budget: (state) =>
    state.generated
      ? budgetFor({
          units: state.generated.shape.screwCount,
          rewards: state.generated.shape.screwCount,
          pressure: state.generated.difficulty,
          generous: 3.4,
          tight: 1.9,
          floor: 20,
        })
      : null,
  // Screws boxed, not screws touched. Dropping one in the tray is a decision,
  // not an achievement, so it pays nothing.
  progress: (state) =>
    state.board.removed.filter((gone) => gone).length - state.sinks.buffer.length,
  isPlaying: (state) => state.phase === 'playing',
  levelKey: (state) => (state.generated ? `${state.level}` : null),
  onExpire: () => game.loseToTime(),
});

/**
 * Sizes the board so the whole structure fits without scrolling. Grid extent
 * varies by level, so this has to be measured rather than fixed.
 */
function fitBoard(state: GameState): void {
  const generated = state.generated;
  if (!generated) return;

  const bounds = structureBounds(generated.structure);
  const width = boardEl.clientWidth - 20;
  const height = boardEl.clientHeight - 20;
  if (width <= 0 || height <= 0) return;

  const cell = Math.max(18, Math.min(width / bounds.w, height / bounds.h, 74));
  structureEl.style.setProperty('--cell', `${cell}px`);
  structureEl.style.setProperty('--screw-size', `${Math.round(cell * 0.62)}px`);

  // Boxes scale with the board so the two halves stay visually related.
  const boxSize = Math.max(46, Math.min(cell * 1.9, 72));
  sinksEl.style.setProperty('--box-size', `${Math.round(boxSize)}px`);
  sinksEl.style.setProperty('--tray-slot', `${Math.round(boxSize * 0.36)}px`);
  sinksEl.style.setProperty('--queue-chip', `${Math.round(boxSize * 0.3)}px`);
}

/* ------------------------------------------------------- state -> screen */

let lastPhase: GameState['phase'] = 'loading';
let currentState: GameState | null = null;

game.subscribe((state) => {
  currentState = state;

  levelLabel.textContent = `Level ${state.level}`;
  subLabel.textContent = state.phase === 'loading' ? 'Preparing…' : describeProgress(state);

  structure.render(state);
  sinks.render(state);
  timed.sync(state);
  fitBoard(state);

  undoButton.disabled = !state.canUndo || state.phase === 'loading';
  restartButton.disabled = state.phase === 'loading' || state.moveCount === 0;
  hintButton.disabled = state.phase !== 'playing';

  handleEffect(state);

  if (state.phase === 'won' && lastPhase !== 'won') {
    structure.celebrate();
    sfx.win();
    window.setTimeout(() => showWin(state), 700);
  }

  if (state.phase === 'lost' && lastPhase !== 'lost') {
    sfx.reject();
    window.setTimeout(() => showLost(state.outOfTime), 420);
  }

  lastPhase = state.phase;
});

function handleEffect(state: GameState): void {
  const { effect } = state;

  if (effect.kind === 'take') {
    sfx.pour(2);
    if (!reducedMotion) flyScrew(state, effect);
  } else if (effect.kind === 'reject') {
    sfx.reject();
  } else if (effect.kind === 'overflow') {
    // The loss sheet says what happened; the flash says *which screw* did it.
    trayEl.classList.add('is-overflowed');
    window.setTimeout(() => trayEl.classList.remove('is-overflowed'), 900);
  }
}

/**
 * Animates the screw from the board to the slot it landed in.
 *
 * The screw element itself is already hidden by the time this runs, so a
 * throwaway clone does the travelling — no layout thrash, and nothing to clean
 * up if the board rebuilds mid-flight.
 */
function flyScrew(
  state: GameState,
  effect: Extract<GameState['effect'], { kind: 'take' }>,
): void {
  const from = structure.screwRect(effect.screwId);
  if (!from) return;

  const generated = state.generated;
  if (!generated) return;

  const to =
    effect.to === 'box'
      ? sinks.boxHoleRect(
          effect.boxIndex,
          Math.max(0, (state.sinks.sinks[effect.boxIndex]?.filled ?? 1) - 1),
        )
      : sinks.traySlotRect(effect.traySlot);
  if (!to) return;

  const screw = generated.structure.screws[effect.screwId];
  if (!screw) return;
  const p = paint(screw.color);

  const flier = el('div', { class: 'screw-flight' });
  flier.style.cssText += `left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;--head:${p.hex};--head-edge:${p.shade}`;
  document.body.append(flier);

  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const scale = Math.max(0.4, to.width / Math.max(1, from.width));

  requestAnimationFrame(() => {
    flier.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    flier.style.opacity = '0.85';
  });

  setTimeout(() => flier.remove(), 380);
}

/* ---------------------------------------------------------------- overlays */

function showWin(state: GameState): void {
  openSheet(
    (sheet) => {
      sheet.content.append(el('h2', { class: 'win-title' }, 'Taken apart'));
      sheet.content.append(
        el('div', { class: 'result-line' }, `<b>${state.moveCount}</b><span>screws</span>`),
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
 * The level is over. Not dismissible — an overflowed tray has no legal move
 * left in it, so leaving the board tappable would only invite dead taps.
 */
function showLost(outOfTime: boolean): void {
  openSheet(
    (sheet) => {
      sheet.content.append(
        el('h2', { class: 'lose-title' }, outOfTime ? 'Out of time' : 'Out of room'),
      );

      const restart = el('button', { class: 'button button--full' }, 'Restart');
      restart.addEventListener('click', () => {
        sheet.close();
        game.restart();
      });

      const undo = el('button', { class: 'button button--ghost button--full' }, 'Undo');
      undo.addEventListener('click', () => {
        sheet.close();
        game.undo();
      });

      sheet.content.append(restart, undo);
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
    gameName: 'Screw Land',
    save: game.currentSave,
    currentLevel: game.currentSave.level,
    onSettingsChange: (patch) => {
      // Renderer options first: the redraw that `updateSettings` triggers is
      // the one that has to pick them up.
      if (patch.colorBlindShapes !== undefined) {
        structure.setOptions({ showGlyphs: patch.colorBlindShapes });
        sinks.setOptions({ showGlyphs: patch.colorBlindShapes });
      }
      game.updateSettings(patch);
      if (patch.timed !== undefined) timed.chip.setEnabled(patch.timed);
    },
    onHowToPlay: () => howTo.open(),
    onImport: (save) => game.replaceSave(save),
    onGoToLevel: (level) => game.goToLevel(level),
    onClose: () => timed.resume('settings'),
  });
});

document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === 'z') game.undo();
  else if (event.key === 'r') game.restart();
  else if (event.key === 'h') game.requestHint();
});

const refit = (): void => {
  if (currentState) fitBoard(currentState);
};
window.addEventListener('resize', refit);
window.addEventListener('orientationchange', () => setTimeout(refit, 220));

/* -------------------------------------------------------------------- boot */

void (async () => {
  await game.start();
  applyTheme(game.settings.theme);
  setSoundEnabled(game.settings.sound);
  structure.setOptions({ showGlyphs: game.settings.colorBlindShapes });
  sinks.setOptions({ showGlyphs: game.settings.colorBlindShapes });
  if (currentState) {
    structure.render(currentState);
    sinks.render(currentState);
    fitBoard(currentState);
  }

  // Offered once, on a save that has never cleared a level. See
  // `shouldAutoShow` for why it is not simply "has not seen it".
  if (shouldAutoShow(game.currentSave)) howTo.open(true);
})();

registerServiceWorker();
