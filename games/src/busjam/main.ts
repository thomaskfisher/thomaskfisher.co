/**
 * Bus Jam entry point. Wires the controller to the renderers and the chrome.
 */

import '../shared/shell.css';
import './busjam.css';

import { setSoundEnabled, sfx } from '../shared/audio';
import { paint } from '../shared/palette';
import { registerServiceWorker } from '../shared/pwa';
import { openSettings } from '../shared/settings-sheet';
import { applyTheme, el, icons, openSheet, prefersReducedMotion } from '../shared/ui';
import { BusJamGame, GAME_ID, type GameState } from './game';
import { CrowdRenderer, StopRenderer, describeProgress } from './render';

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
topbar.append(levelBlock, settingsButton);

const busesEl = el('div', { class: 'buses', 'aria-label': 'Buses at the stop' });
const queueEl = el('div', { class: 'queue', 'aria-label': 'Buses coming next' });
const benchEl = el('div', { class: 'bench', 'aria-label': 'Bench' });

// The buses waiting their turn sit in the same lane as the ones at the stop,
// trailing them, because that is what they are — a queue of buses. Floating the
// preview on its own row read as a stray chip belonging to nothing.
const laneEl = el('div', { class: 'lane' });
laneEl.append(busesEl, queueEl);

const stopEl = el('section', { class: 'stop' });
stopEl.append(laneEl, benchEl);

const gridEl = el('div', { class: 'grid' });
const boardEl = el('main', { class: 'board', 'aria-label': 'Crowd' });
boardEl.append(gridEl);

const undoButton = controlButton('Undo', icons.undo);
const restartButton = controlButton('Restart', icons.restart);
const hintButton = controlButton('Hint', icons.hint);
const controls = el('footer', { class: 'controls' });
controls.append(undoButton, restartButton, hintButton);

app.append(topbar, stopEl, boardEl, controls);
app.classList.add('app--busjam');

function controlButton(label: string, icon: string): HTMLButtonElement {
  return el('button', { class: 'control', type: 'button' }, `${icon}<span>${label}</span>`);
}

/* -------------------------------------------------------------------- game */

const game = new BusJamGame();
const reducedMotion = prefersReducedMotion();

const crowd = new CrowdRenderer(gridEl, {
  showGlyphs: false,
  reducedMotion,
  onTapPassenger: (id) => game.tapPassenger(id),
});

const stop = new StopRenderer(busesEl, queueEl, benchEl, { showGlyphs: false });

/**
 * Sizes the board so the whole grid fits without scrolling. Grid extent varies
 * by level, so this has to be measured rather than fixed.
 */
function fitBoard(state: GameState): void {
  const board = state.generated?.board;
  if (!board) return;

  const width = boardEl.clientWidth - 20;
  const height = boardEl.clientHeight - 20;
  if (width <= 0 || height <= 0) return;

  const cell = Math.max(20, Math.min(width / board.width, height / board.height, 86));
  gridEl.style.setProperty('--cell', `${cell}px`);
  fitLane(cell);
}

/* Proportions of the lane, all expressed in multiples of the bus height. */
const BUS_ASPECT = 1.9;
const QUEUE_SCALE = 0.5;
const BENCH_SCALE = 0.44;
const BUS_GAP = 10;
const QUEUE_GAP = 5;
const LANE_GAP = 8;

/**
 * Sizes the bus lane to whatever is actually in it.
 *
 * The lane holds a variable number of things — one or two buses at the stop,
 * then up to six chips for the ones still coming — so a fixed bus width is
 * either too small on the sparse levels or runs off the edge of the phone on
 * the busy ones. Solving for the width that exactly fills the row keeps the
 * buses as large as they can be without ever clipping.
 *
 * Must run after the stop has rendered, since it counts the rendered children.
 */
function fitLane(cell: number): void {
  const buses = busesEl.childElementCount;
  const chips = queueEl.hidden ? 0 : queueEl.childElementCount;
  if (buses === 0) return;

  const available = stopEl.clientWidth - 28; // the stop's own side padding
  const gaps =
    (buses - 1) * BUS_GAP + (chips > 0 ? LANE_GAP + (chips - 1) * QUEUE_GAP : 0);
  const perUnit = buses * BUS_ASPECT + chips * QUEUE_SCALE;

  // The board sets the ideal size; the lane only ever shrinks it to fit.
  const ideal = Math.min(cell * 1.6, 84);
  const busSize = Math.max(34, Math.min(ideal, (available - gaps) / perUnit));

  stopEl.style.setProperty('--bus-width', `${Math.round(busSize * BUS_ASPECT)}px`);
  stopEl.style.setProperty('--bus-height', `${Math.round(busSize)}px`);
  stopEl.style.setProperty('--bench-slot', `${Math.round(busSize * BENCH_SCALE)}px`);
  stopEl.style.setProperty('--queue-bus', `${Math.round(busSize * QUEUE_SCALE)}px`);
}

/* ------------------------------------------------------- state -> screen */

let lastPhase: GameState['phase'] = 'loading';
let currentState: GameState | null = null;

game.subscribe((state) => {
  currentState = state;

  levelLabel.textContent = `Level ${state.level}`;
  subLabel.textContent = state.phase === 'loading' ? 'Preparing…' : describeProgress(state);

  crowd.render(state);
  stop.render(state);
  fitBoard(state);

  undoButton.disabled = !state.canUndo || state.phase === 'loading';
  restartButton.disabled = state.phase === 'loading' || state.moveCount === 0;
  hintButton.disabled = state.phase !== 'playing';

  handleEffect(state);

  if (state.phase === 'won' && lastPhase !== 'won') {
    crowd.celebrate();
    sfx.win();
    window.setTimeout(() => showWin(state), 700);
  }

  if (state.phase === 'lost' && lastPhase !== 'lost') {
    sfx.reject();
    window.setTimeout(() => showLost(state.lossReason ?? 'noMoves'), 420);
  }

  lastPhase = state.phase;
});

function handleEffect(state: GameState): void {
  const { effect } = state;

  if (effect.kind === 'walk') {
    sfx.pour(2);
    if (!reducedMotion) walkPassenger(state, effect);
  } else if (effect.kind === 'reject') {
    sfx.reject();
    // Saying "no" is not enough — the answer to *why* is the people penning
    // them in, so those are what flash.
    crowd.showBlockers(effect.passengerId, state);
  } else if (effect.kind === 'overflow') {
    // The loss sheet says what happened; the flash says *which tap* did it.
    benchEl.classList.add('is-overflowed');
    window.setTimeout(() => benchEl.classList.remove('is-overflowed'), 900);
  }
}

/** Roughly how long one grid step of the walk takes. */
const STEP_MS = 78;
/** The hop from the exit row up to the bench or a seat. */
const BOARD_MS = 260;

/**
 * Walks the passenger along the route they actually took, then up to their
 * seat.
 *
 * A straight-line flight would be cheaper, but the route *is* the puzzle here:
 * seeing someone thread between two others is what teaches why the person one
 * cell over could not have gone. The element itself is already hidden by the
 * time this runs, so a throwaway clone does the travelling — no layout thrash,
 * and nothing to clean up if the board rebuilds mid-walk.
 */
function walkPassenger(
  state: GameState,
  effect: Extract<GameState['effect'], { kind: 'walk' }>,
): void {
  const from = crowd.personRect(effect.passengerId);
  const board = state.generated?.board;
  if (!from || !board) return;

  const destination =
    effect.to === 'bus'
      ? stop.busSeatRect(
          effect.busIndex,
          Math.max(0, (state.sinks.sinks[effect.busIndex]?.filled ?? 1) - 1),
        )
      : stop.benchSlotRect(effect.benchSlot);
  if (!destination) return;

  const passenger = board.passengers[effect.passengerId];
  if (!passenger) return;
  const p = paint(passenger.color);

  const walker = el('div', { class: 'person-walk' });
  walker.style.cssText += `left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px`;
  walker.innerHTML =
    `<span class="person-art" style="--skin:${p.hex};--skin-edge:${p.shade}">` +
    '<span class="person-head"></span><span class="person-torso"></span></span>';
  document.body.append(walker);

  const originX = from.left + from.width / 2;
  const originY = from.top + from.height / 2;

  // One keyframe per cell walked, then one for the seat. Offsets are weighted
  // so each grid step takes the same time regardless of how long the route is.
  const steps = effect.path
    .map((cell) => crowd.cellCenter(cell, state))
    .filter((point): point is { x: number; y: number } => point !== null);

  const targets = [
    ...steps.map((point) => ({ x: point.x - originX, y: point.y - originY, scale: 1 })),
    {
      x: destination.left + destination.width / 2 - originX,
      y: destination.top + destination.height / 2 - originY,
      scale: Math.max(0.4, destination.width / Math.max(1, from.width)),
    },
  ];

  const walkMs = Math.max(0, steps.length - 1) * STEP_MS;
  const total = walkMs + BOARD_MS;
  const keyframes = targets.map((target, i) => ({
    transform: `translate(${target.x}px, ${target.y}px) scale(${target.scale})`,
    offset: i < targets.length - 1 ? (i * STEP_MS) / total : 1,
    easing: 'linear',
  }));

  const animation = walker.animate(keyframes, { duration: total, fill: 'forwards' });
  animation.finished.catch(() => undefined).finally(() => walker.remove());
}

/* ---------------------------------------------------------------- overlays */

function showWin(state: GameState): void {
  openSheet(
    (sheet) => {
      sheet.content.append(el('h2', { class: 'win-title' }, 'All aboard'));
      sheet.content.append(
        el(
          'p',
          { style: 'text-align:center' },
          `${state.moveCount} passengers, no ads, no timer.`,
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
 * The level is over. Not dismissible — a full bench has no legal move left in
 * it, so leaving the board tappable would only invite dead taps.
 *
 * There are no lives and no ad break here, so the recovery is generous: start
 * over, or step back to just before the mistake. Every level is solvable, and
 * saying so is what keeps a loss feeling like a puzzle rather than a tax.
 */
function showLost(reason: NonNullable<GameState['lossReason']>): void {
  openSheet(
    (sheet) => {
      sheet.content.append(el('h2', { class: 'lose-title' }, 'Bench is full'));
      sheet.content.append(
        el(
          'p',
          {},
          reason === 'benchFull'
            ? 'No bus at the stop wanted that colour and the bench was full, so the ' +
                'level is over. Every level here is solvable — a different order clears it.'
            : 'Nobody you can still reach fits a bus at the stop, and the bench is ' +
                'full, so the level is over. Every level here is solvable — a ' +
                'different order clears it.',
        ),
      );

      const restart = el('button', { class: 'button button--full' }, 'Try again');
      restart.addEventListener('click', () => {
        sheet.close();
        game.restart();
      });

      const undo = el('button', { class: 'button button--ghost button--full' }, 'Undo last move');
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
  openSettings({
    gameId: GAME_ID,
    gameName: 'Bus Jam',
    save: game.currentSave,
    currentLevel: game.currentSave.level,
    onSettingsChange: (patch) => {
      // Renderer options first: the redraw that `updateSettings` triggers is
      // the one that has to pick them up.
      if (patch.colorBlindShapes !== undefined) {
        crowd.setOptions({ showGlyphs: patch.colorBlindShapes });
        stop.setOptions({ showGlyphs: patch.colorBlindShapes });
      }
      game.updateSettings(patch);
    },
    onImport: (save) => game.replaceSave(save),
    onGoToLevel: (level) => game.goToLevel(level),
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
  crowd.setOptions({ showGlyphs: game.settings.colorBlindShapes });
  stop.setOptions({ showGlyphs: game.settings.colorBlindShapes });
  if (currentState) {
    crowd.render(currentState);
    stop.render(currentState);
    fitBoard(currentState);
  }
})();

registerServiceWorker();
