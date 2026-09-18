/**
 * Artillery entry point. Wires the controller to the renderer and the chrome.
 *
 * What is different here from the single-player games follows from there being
 * two people rather than one:
 *
 *   - There is no Hint. A hint at a two-player board is an engine playing one
 *     side better than the other. What replaces it is that the previous shot
 *     from each side stays on the field — the half of a hint that teaches
 *     somebody to range in, rather than the half that plays for them.
 *   - Settings offers no clock. Nothing here is timed, and a clock between two
 *     people sharing a phone is a different game.
 *   - Settings offers no shape overlay either, which is the first time a game
 *     here has declined it. The overlay exists where colour is the only thing
 *     telling two pieces apart; the seats in this game never swap ends, so
 *     position says everything colour does. Every number, gauge and control
 *     that belongs to a seat is also on that seat's side of the screen.
 *   - Restart is New match rather than Restart. The battlefield is a function of
 *     the match number, so replaying one would deal the same ground and the
 *     same draft the players have just seen.
 */

import '../shared/shell.css';
import './artillery.css';

import { setSoundEnabled, sfx } from '../shared/audio';
import { registerServiceWorker } from '../shared/pwa';
import { pinViewportHeight } from '../shared/viewport';
import { createHowToPlay, shouldAutoShow } from '../shared/how-to-play';
import { openSettings } from '../shared/settings-sheet';
import { applyTheme, el, icons, openSheet, prefersReducedMotion } from '../shared/ui';
import { ArtilleryGame, GAME_ID, NAMES, type GameView } from './game';
import { START_HP, type Seat } from './model';
import { RULES } from './rules';
import { FieldRenderer, describeTally, describeTurn } from './render';
import { PLAIN_SHELL, type Weapon } from './weapons';

const app = document.getElementById('app');
if (!app) throw new Error('#app is missing');

// Before anything measures the board: the shell is sized from the height this
// writes down, not from the browser's idea of the viewport. See viewport.ts.
pinViewportHeight();

/* ------------------------------------------------------------------ chrome */

const matchLabel = el('b', {}, 'Match 1');
const tallyLabel = el('span', {}, '');
const settingsButton = el(
  'button',
  { class: 'icon-button', 'aria-label': 'Settings' },
  icons.settings,
);

const topbar = el('header', { class: 'topbar' });
const matchBlock = el('div', { class: 'topbar-level' });
matchBlock.append(matchLabel, tallyLabel);

const howTo = createHowToPlay({
  rules: RULES,
  onSeen: () => game.markHowToPlaySeen(),
});

const topbarActions = el('div', { class: 'topbar-actions' });
topbarActions.append(howTo.button, settingsButton);
topbar.append(matchBlock, topbarActions);

/* --------------------------------------------------------------- life strip */

interface Gauge {
  root: HTMLDivElement;
  bar: HTMLDivElement;
  hp: HTMLSpanElement;
}

function gaugeFor(seat: Seat): Gauge {
  const root = el('div', {
    class: `ar-gauge ar-gauge--${seat === 0 ? 'left' : 'right'}`,
  });
  const hp = el('span', { class: 'ar-gauge-hp' }, String(START_HP));
  const head = el('div', { class: 'ar-gauge-head' });
  head.append(el('span', {}, NAMES[seat]), hp);
  const bar = el('div', {
    class: 'ar-gauge-bar',
    role: 'progressbar',
    'aria-label': `${NAMES[seat]} life`,
    'aria-valuemin': '0',
    'aria-valuemax': String(START_HP),
  });
  root.append(head, bar);
  return { root, bar, hp };
}

const gauges: [Gauge, Gauge] = [gaugeFor(0), gaugeFor(1)];
const lifeStrip = el('div', { class: 'ar-life' });
lifeStrip.append(gauges[0].root, gauges[1].root);

/* ------------------------------------------------------------------- board */

const boardEl = el('main', { class: 'board' });
const fieldHost = el('div', { class: 'ar-field-host' });
const statusEl = el('p', { class: 'ar-status', role: 'status', 'aria-live': 'polite' }, '');

/* -------------------------------------------------------------- the shop */

const shopTurn = el('p', { class: 'ar-shop-turn' }, '');
const poolList = el('ul', { class: 'ar-pool' });
const shopTally = el('p', { class: 'ar-shop-tally' }, '');
const shop = el('section', { class: 'ar-shop', 'aria-label': 'Weapon shop' });
shop.append(shopTurn, poolList, shopTally);

/* ---------------------------------------------------------------- controls */

const moveLeft = stepButton('◀', 'Move left');
const moveRight = stepButton('▶', 'Move right');
const moveValue = el('div', { class: 'ar-move-value' }, '<b>10</b><span>Move</span>');
const moveGroup = el('div', { class: 'ar-move' });
moveGroup.append(moveLeft, moveValue, moveRight);

const weaponButton = el('button', { class: 'ar-weapon', type: 'button' });
const weaponName = el('div', { class: 'ar-weapon-name' }, '');
const weaponCount = el('span', { class: 'ar-weapon-count' }, '');
weaponButton.append(weaponName, weaponCount);

const rowOne = el('div', { class: 'ar-row' });
rowOne.append(moveGroup, weaponButton);

const angleDial = dial('Angle', 'angle');
const powerDial = dial('Power', 'power');
const rowTwo = el('div', { class: 'ar-row' });
rowTwo.append(angleDial.root, powerDial.root);

const fireButton = el('button', { class: 'ar-fire', type: 'button' }, 'Fire');
const rowThree = el('div', { class: 'ar-row' });
rowThree.append(fireButton);

const undoButton = controlButton('Undo', icons.undo);
const restartButton = controlButton('New match', icons.restart);
const secondary = el('div', { class: 'ar-secondary' });
secondary.append(undoButton, restartButton);

const controls = el('footer', { class: 'controls' });
controls.append(rowOne, rowTwo, rowThree, secondary);

app.append(topbar, lifeStrip, boardEl, statusEl, controls);
boardEl.append(fieldHost, shop);
app.classList.add('app--artillery');

function controlButton(label: string, icon: string): HTMLButtonElement {
  return el('button', { class: 'control', type: 'button' }, `${icon}<span>${label}</span>`);
}

function stepButton(glyph: string, label: string): HTMLButtonElement {
  return el('button', { class: 'ar-step', type: 'button', 'aria-label': label }, glyph);
}

interface Dial {
  root: HTMLDivElement;
  value: HTMLDivElement;
  down: HTMLButtonElement;
  up: HTMLButtonElement;
}

function dial(label: string, key: string): Dial {
  const root = el('div', { class: 'ar-dial' });
  const down = stepButton('−', `${label} down`);
  const up = stepButton('+', `${label} up`);
  const value = el('div', {
    class: 'ar-dial-value',
    role: 'status',
    'aria-label': label,
    id: `ar-${key}`,
  }, '0');
  root.append(el('div', { class: 'ar-dial-label' }, label), down, value, up);
  return { root, value, down, up };
}

/* -------------------------------------------------------------------- game */

const game = new ArtilleryGame();
const reducedMotion = prefersReducedMotion();
const renderer = new FieldRenderer(fieldHost, { reducedMotion });

/**
 * Press and hold to run a dial.
 *
 * Two timers, and both are cancelled by every path out of a press — pointerup,
 * pointercancel, leaving the button, and the button becoming disabled under a
 * thumb that is still down. The last one is the case that matters: firing
 * disables the dials, and a repeat still running against a disabled control
 * would keep nudging the *next* player's aim.
 */
function holdRepeat(button: HTMLButtonElement, act: () => void): void {
  let delay: number | null = null;
  let repeat: number | null = null;
  let held = 0;

  const stop = (): void => {
    if (delay !== null) window.clearTimeout(delay);
    if (repeat !== null) window.clearInterval(repeat);
    delay = null;
    repeat = null;
    held = 0;
  };

  const tick = (): void => {
    if (button.disabled) {
      stop();
      return;
    }
    held++;
    // Accelerates, so a full sweep of the angle is a second and a half rather
    // than a minute, and a single degree is still one tap.
    const size = held > 22 ? 3 : held > 9 ? 2 : 1;
    for (let i = 0; i < size; i++) act();
  };

  button.addEventListener('pointerdown', () => {
    if (button.disabled) return;
    act();
    stop();
    delay = window.setTimeout(() => {
      repeat = window.setInterval(tick, 55);
    }, 300);
  });

  for (const event of ['pointerup', 'pointercancel', 'pointerleave', 'blur']) {
    button.addEventListener(event, stop);
  }
}

holdRepeat(angleDial.up, () => game.nudgeAngle(1));
holdRepeat(angleDial.down, () => game.nudgeAngle(-1));
holdRepeat(powerDial.up, () => game.nudgePower(1));
holdRepeat(powerDial.down, () => game.nudgePower(-1));
holdRepeat(moveLeft, () => game.move(-1));
holdRepeat(moveRight, () => game.move(1));

fireButton.addEventListener('click', () => game.fire());
undoButton.addEventListener('click', () => game.undo());
weaponButton.addEventListener('click', () => {
  if (current) openWeapons(current);
});
restartButton.addEventListener('click', () => {
  if (current) confirmNewMatch(current);
});

/* ------------------------------------------------------- state -> screen */

let current: GameView | null = null;

/**
 * The beat between the last shell landing and the sheet that talks about it.
 *
 * The handle is kept and cancelled on every reset, so starting a new match
 * inside that window cannot pop a result sheet about a match that is no longer
 * on screen — which is the bug shape the house rules are most emphatic about.
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

  matchLabel.textContent = `Match ${view.level}`;
  tallyLabel.textContent = describeTally(view);

  if (view.effect.kind === 'reset') {
    clearPendingSheet();
    renderer.reset();
  }

  const drafting = view.phase === 'draft';
  const loading = view.phase === 'loading';

  shop.hidden = !drafting;
  lifeStrip.hidden = drafting || loading;
  rowOne.hidden = drafting || loading;
  rowTwo.hidden = drafting || loading;
  rowThree.hidden = drafting || loading;
  fieldHost.hidden = drafting;
  // The shop names whose pick it is in its own heading, so the status strip has
  // nothing left to say down there.
  statusEl.hidden = drafting;

  if (drafting) drawShop(view);
  else renderer.render(view);

  drawGauges(view);
  drawControls(view);

  const status = statusFor(view);
  statusEl.textContent = status.text;
  statusEl.classList.toggle('is-alert', status.alert);

  handleEffect(view);
});

function drawGauges(view: GameView): void {
  for (const seat of [0, 1] as Seat[]) {
    const tank = view.match.tanks[seat];
    const gauge = gauges[seat];
    gauge.hp.textContent = String(tank.hp);
    gauge.bar.style.setProperty('--hp', `${(tank.hp / START_HP) * 100}%`);
    gauge.bar.setAttribute('aria-valuenow', String(tank.hp));
    gauge.root.classList.toggle(
      'is-active',
      view.match.turn === seat && (view.phase === 'aiming' || view.phase === 'firing'),
    );
  }
}

function drawControls(view: GameView): void {
  const tank = view.match.tanks[view.match.turn];
  const playable = view.phase === 'aiming';

  angleDial.value.textContent = `${tank.angle}°`;
  powerDial.value.textContent = String(tank.power);
  moveValue.replaceChildren(
    el('b', {}, String(view.match.movesLeft)),
    el('span', {}, 'Move'),
  );

  weaponName.replaceChildren(
    document.createTextNode(view.chosen.name),
    el('small', {}, view.chosen.blurb),
  );
  weaponCount.textContent = view.chosen.id === PLAIN_SHELL.id ? '∞' : '1';

  moveLeft.disabled = !view.canMove.left;
  moveRight.disabled = !view.canMove.right;
  angleDial.up.disabled = !playable;
  angleDial.down.disabled = !playable;
  powerDial.up.disabled = !playable;
  powerDial.down.disabled = !playable;
  weaponButton.disabled = !playable;
  fireButton.disabled = !playable;
  undoButton.disabled = !view.canUndo;
  restartButton.disabled = view.phase === 'loading';

  controls.classList.toggle('is-right', view.match.turn === 1);
}

/**
 * The shop.
 *
 * Both arsenals are visible as they fill, because the only thing to think about
 * here is what the other player is going to take next. A weapon that has gone
 * keeps its name and takes its new owner's colour rather than disappearing —
 * the list is a record of the draft, not just an inventory of what is left.
 */
function drawShop(view: GameView): void {
  const draft = view.draft;
  if (!draft) return;

  shopTurn.replaceChildren(
    document.createTextNode(`${NAMES[draft.picker]} picks`),
    el('span', {}, ` · ${draft.remaining} left`),
  );

  poolList.replaceChildren(
    ...draft.pool.map((weapon, index) => {
      const owner = draft.taken[index];
      const item = el('li', {});
      const button = el('button', { class: 'ar-chip', type: 'button' });
      button.append(el('b', {}, weapon.name), el('span', {}, statOf(weapon)));

      if (owner !== null && owner !== undefined) {
        button.classList.add('is-taken', owner === 0 ? 'is-taken--left' : 'is-taken--right');
        button.disabled = true;
        button.setAttribute('aria-label', `${weapon.name}, taken by ${NAMES[owner]}`);
      } else {
        button.addEventListener('click', () => game.pick(index));
      }

      item.append(button);
      return item;
    }),
  );

  shopTally.replaceChildren(
    el('span', { class: 'ar-shop-left' }, `${NAMES[0]} <b>${draft.arsenals[0].length}</b>`),
    el('span', { class: 'ar-shop-right' }, `<b>${draft.arsenals[1].length}</b> ${NAMES[1]}`),
  );
}

/** The one line under a weapon's name. Its most distinctive number, not all of them. */
function statOf(weapon: Weapon): string {
  if (weapon.kind === 'dirt') return `Adds earth · ${Math.round(weapon.radius)} wide`;
  if (weapon.shots > 1) return `${weapon.shots} shells · ${weapon.damage} each`;
  if (weapon.kind === 'digger') return `${weapon.damage} damage · digs deep`;
  return `${weapon.damage} damage · ${Math.round(weapon.radius)} wide`;
}

function statusFor(view: GameView): { text: string; alert: boolean } {
  if (view.effect.kind === 'reject') return { text: view.effect.note, alert: true };
  if (view.effect.kind === 'landed') return { text: damageLine(view, view.effect.damage), alert: false };
  return { text: describeTurn(view), alert: false };
}

/**
 * What the shot just did.
 *
 * Left on screen until the next thing happens, because this is the shot report
 * and the player reading it has only just picked the phone up. It names whose
 * turn it is now for the same reason.
 */
function damageLine(view: GameView, damage: [number, number]): string {
  const hits = ([0, 1] as Seat[])
    .filter((seat) => (damage[seat] as number) > 0)
    .map((seat) => `${NAMES[seat]} −${damage[seat]}`);
  const report = hits.length > 0 ? hits.join(' · ') : 'No damage';
  return `${report} · ${NAMES[view.match.turn]} to fire`;
}

function handleEffect(view: GameView): void {
  const { effect } = view;

  if (effect.kind === 'fired') {
    sfx.note(170, 0.16);
    renderer.flight(effect.resolution, () => game.shotLanded());
    return;
  }

  if (effect.kind === 'landed') {
    if (effect.damage[0] + effect.damage[1] > 0) sfx.complete();
    else sfx.pour(2);
    return;
  }

  if (effect.kind === 'win') {
    sfx.win();
    clearPendingSheet();
    pendingSheet = window.setTimeout(() => showResult(view), 650);
    return;
  }

  if (effect.kind === 'reject') sfx.reject();
  else if (effect.kind === 'moved' || effect.kind === 'picked' || effect.kind === 'undo') {
    sfx.select();
  }
}

/**
 * A shell in the air when the page is hidden.
 *
 * A backgrounded tab stops delivering frames, so the flight would sit half
 * drawn and the turn would never end — the player comes back to a board that
 * refuses every control. Finishing it immediately resolves the shot against
 * exactly the same outcome, because the outcome was decided before the first
 * frame was drawn.
 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) renderer.finishNow();
});

/* ---------------------------------------------------------------- overlays */

/** Choosing what to fire. One tap picks and closes; there is nothing to confirm. */
function openWeapons(view: GameView): void {
  openSheet((sheet) => {
    sheet.content.append(el('h2', {}, 'Weapon'));

    const list = el('ul', { class: 'ar-list' });
    for (const weapon of view.arsenal) {
      const item = el('li', {});
      const button = el('button', {
        class: 'ar-pick',
        type: 'button',
        'aria-pressed': String(weapon.id === view.chosen.id),
      });
      button.append(
        el('div', {}, `<b>${weapon.name}</b><small>${weapon.blurb}</small>`),
        el('span', { class: 'ar-pick-uses' }, weapon.id === PLAIN_SHELL.id ? '∞' : '1 left'),
      );
      button.addEventListener('click', () => {
        sheet.close();
        game.selectWeapon(weapon.id);
      });
      item.append(button);
      list.append(item);
    }

    sheet.content.append(list);

    const done = el('button', { class: 'button button--ghost button--full' }, 'Close');
    done.addEventListener('click', sheet.close);
    sheet.content.append(done);
  });
}

/**
 * The match is over.
 *
 * Not dismissible: there is nothing left to tap on a decided battlefield, and
 * the result is already banked by the time this appears — closing the app here
 * loses the sheet and nothing else.
 */
function showResult(view: GameView): void {
  const winner = view.winner;
  const title = winner === null ? 'Both tanks out' : `${NAMES[winner]} wins`;
  const line =
    winner === null
      ? `<b>${view.match.volley}</b><span>volleys</span>`
      : `<b>${view.match.tanks[winner].hp}</b><span>life left</span>`;

  openSheet(
    (sheet) => {
      sheet.content.append(el('h2', { class: 'win-title' }, title));
      sheet.content.append(el('div', { class: 'result-line' }, line));

      const next = el('button', { class: 'button button--full' }, 'New match');
      next.addEventListener('click', () => {
        sheet.close();
        game.advance();
      });
      sheet.content.append(next);
    },
    { dismissible: false },
  );
}

/** Starting over. Confirmed, because it throws away a match in progress. */
function confirmNewMatch(view: GameView): void {
  const started = view.phase !== 'draft' && (view.match.volley > 1 || view.canUndo);
  if (!started) {
    game.restart();
    return;
  }

  openSheet((sheet) => {
    sheet.content.append(el('h2', {}, 'Start a new match?'));
    sheet.content.append(
      el(
        'p',
        {},
        `${NAMES[0]} ${view.match.tanks[0].hp}, ${NAMES[1]} ${view.match.tanks[1].hp}. ` +
          'An abandoned match is not counted in the tally.',
      ),
    );

    const confirm = el('button', { class: 'button button--full' }, 'New match');
    confirm.addEventListener('click', () => {
      sheet.close();
      game.restart();
    });

    const keep = el('button', { class: 'button button--ghost button--full' }, 'Keep playing');
    keep.addEventListener('click', sheet.close);

    sheet.content.append(confirm, keep);
  });
}

settingsButton.addEventListener('click', () => {
  const stats = game.currentSave.stats;
  const matches = stats.levelsCleared;
  const tally = stats.seatScores ?? [];

  openSettings({
    gameId: GAME_ID,
    gameName: 'Artillery',
    save: game.currentSave,
    currentLevel: game.currentSave.level,
    levelNoun: 'Match',
    // Nothing here is timed, and colour never carries information on its own.
    // See the file header.
    showTimer: false,
    showShapes: false,
    progressLine:
      matches === 0
        ? 'No matches finished yet'
        : `${matches} match${matches === 1 ? '' : 'es'} · ${NAMES[0]} ${tally[0] ?? 0} · ${NAMES[1]} ${tally[1] ?? 0}`,
    onSettingsChange: (patch) => game.updateSettings(patch),
    onHowToPlay: () => howTo.open(),
    onImport: (save) => game.replaceSave(save),
    onGoToLevel: (target) => game.goToMatch(target),
  });
});

/**
 * The whole game on a keyboard, for a desktop.
 *
 * Arrows drive the tank and the angle, because those are the two things with a
 * direction. Power is on the two keys next to each other that nothing else
 * wants, and the trigger is the space bar.
 */
document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (document.querySelector('.overlay')) return;

  switch (event.key) {
    case 'ArrowLeft':
      game.move(-1);
      break;
    case 'ArrowRight':
      game.move(1);
      break;
    case 'ArrowUp':
      game.nudgeAngle(1);
      break;
    case 'ArrowDown':
      game.nudgeAngle(-1);
      break;
    case '-':
    case '_':
      game.nudgePower(-1);
      break;
    case '=':
    case '+':
      game.nudgePower(1);
      break;
    case ' ':
    case 'Enter':
      game.fire();
      break;
    case 'u':
    case 'z':
      game.undo();
      break;
    case 'w':
      if (current) openWeapons(current);
      break;
    default:
      return;
  }
  event.preventDefault();
});

/* -------------------------------------------------------------------- boot */

void (async () => {
  await game.start();
  applyTheme(game.settings.theme);
  setSoundEnabled(game.settings.sound);

  if (shouldAutoShow(game.currentSave)) howTo.open(true);
})();

registerServiceWorker();
