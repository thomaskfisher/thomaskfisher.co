/**
 * Yahtzee renderer.
 *
 * The scorecard and the tray are both fixed in size — thirteen boxes and five
 * dice, forever — so the DOM is built once and updated in place. That keeps every
 * element's identity stable across a render, which is what lets a CSS animation
 * on a die survive the state change that triggered it, and it means no listener
 * ever has to be rebound.
 *
 * The pips are drawn by CSS from a `data-face` attribute rather than toggled from
 * here. Nine spans per die, and each face's rule turns on the ones it needs — so
 * there is no per-pip visibility state to get out of step, and nothing that has
 * to be cleaned up when the dice change.
 */

import { CATEGORIES, UPPER_TARGET, upperFace } from './model';
import type { GameState } from './game';

export interface RendererOptions {
  reducedMotion: boolean;
  onTapBox: (category: number) => void;
  onTapDie: (slot: number) => void;
}

const DIE_PIPS = 9;

export class BoardRenderer {
  private options: RendererOptions;
  private readonly card: HTMLElement;
  private readonly boxes: HTMLButtonElement[] = [];
  private readonly bonus: HTMLElement;
  private readonly status: HTMLElement;
  private readonly grand: HTMLElement;
  private readonly tray: HTMLElement;
  private readonly dice: HTMLButtonElement[] = [];

  constructor(private readonly root: HTMLElement, options: RendererOptions) {
    this.options = options;

    this.card = element('div', 'fd-card');
    const upper = element('div', 'fd-col');
    const lower = element('div', 'fd-col');

    for (const [index, category] of CATEGORIES.entries()) {
      const box = document.createElement('button');
      box.type = 'button';
      box.className = 'fd-box';
      box.dataset.box = String(index);
      box.innerHTML =
        `<span class="fd-box-name">${category.name}</span>` +
        `<span class="fd-box-note">${category.note}</span>` +
        '<span class="fd-box-value"></span>';
      box.addEventListener('click', () => this.options.onTapBox(index));
      this.boxes.push(box);
      (category.section === 'upper' ? upper : lower).append(box);
    }

    // The seventh row of the upper column, so the two columns come out level and
    // the bonus sits with the boxes that feed it rather than in a footnote.
    this.bonus = element('div', 'fd-bonus');
    upper.append(this.bonus);
    this.card.append(upper, lower);

    this.status = element('div', 'fd-status');
    this.grand = element('div', 'fd-grand');

    this.tray = element('div', 'fd-tray');
    for (let slot = 0; slot < 5; slot++) {
      const die = document.createElement('button');
      die.type = 'button';
      die.className = 'fd-die';
      die.dataset.slot = String(slot);
      die.innerHTML = '<span class="fd-pip"></span>'.repeat(DIE_PIPS);
      die.addEventListener('click', () => this.options.onTapDie(slot));
      this.dice.push(die);
      this.tray.append(die);
    }

    const foot = element('div', 'fd-foot');
    foot.append(this.status, this.grand);

    // Its own stacking context, so nothing here can ever paint over a sheet.
    this.root.style.isolation = 'isolate';
    this.root.append(this.card, foot, this.tray);
  }

  setOptions(patch: Partial<RendererOptions>): void {
    this.options = { ...this.options, ...patch };
  }

  render(state: GameState): void {
    const round = state.round;
    this.root.classList.toggle('is-loading', state.phase === 'loading');

    for (const [index, box] of this.boxes.entries()) {
      const written = round?.scores[index] ?? null;
      const preview = state.previews[index];
      const value = box.querySelector('.fd-box-value') as HTMLElement;

      box.classList.toggle('is-filled', written !== null);
      box.classList.toggle('is-selected', state.selected === index);
      box.classList.toggle('is-zero', written === 0);
      box.disabled = written !== null || state.phase !== 'playing';

      if (written !== null) {
        value.textContent = String(written);
      } else if (preview !== null && preview !== undefined) {
        value.textContent = String(preview);
        box.classList.toggle('is-blank', preview === 0);
      } else {
        value.textContent = '';
      }
      if (written !== null) box.classList.remove('is-blank');

      const label = CATEGORIES[index]?.name ?? '';
      box.setAttribute(
        'aria-label',
        written !== null
          ? `${label}, scored ${written}`
          : `${label}, would score ${preview ?? 0}`,
      );
    }

    const { upper, bonus } = state.totals;
    const done = bonus > 0;
    this.bonus.classList.toggle('is-earned', done);
    this.bonus.innerHTML =
      `<span class="fd-box-name">Bonus</span>` +
      `<span class="fd-box-note">${done ? 'Earned' : `${UPPER_TARGET} in the top six`}</span>` +
      `<span class="fd-box-value">${done ? '+35' : `${upper}/${UPPER_TARGET}`}</span>`;

    for (const [slot, die] of this.dice.entries()) {
      const face = round?.dice[slot];
      die.dataset.face = face === undefined ? '' : String(face);
      die.classList.toggle('is-held', state.held[slot] === true);
      die.disabled = state.phase !== 'playing' || state.throwsLeft <= 0;
      die.setAttribute(
        'aria-label',
        `Die ${slot + 1}, showing ${face ?? 0}${state.held[slot] ? ', held' : ''}`,
      );
    }

    this.status.textContent = describeThrows(state);
    this.grand.innerHTML = `Total <b>${state.totals.grand}</b>`;
  }

  /** Tumbles the dice that just changed. */
  showThrow(slots: readonly number[]): void {
    if (this.options.reducedMotion) return;
    for (const slot of slots) {
      const die = this.dice[slot];
      if (!die) continue;
      // Restarting the animation needs the class gone for a layout tick; reading
      // offsetWidth is what forces it, and it is cheaper than a timer that could
      // fire after the round has moved on.
      die.classList.remove('is-thrown');
      void die.offsetWidth;
      die.classList.add('is-thrown');
    }
  }

  /**
   * Marks what the hint is pointing at.
   *
   * Every highlight is cleared first. A lingering `is-hinted` on two boxes at
   * once makes the suggestion ambiguous, and it also quietly breaks the browser
   * harness, which plays a round by clicking whatever is highlighted.
   */
  showHint(state: GameState): void {
    this.clearHints();
    if (state.selected !== null) this.boxes[state.selected]?.classList.add('is-hinted');
    this.root.classList.add('is-hinting');
  }

  clearHints(): void {
    for (const box of this.boxes) box.classList.remove('is-hinted');
    this.root.classList.remove('is-hinting');
  }

  /** Wipes the transient classes. Called whenever the board is rebuilt. */
  reset(): void {
    this.clearHints();
    for (const die of this.dice) die.classList.remove('is-thrown');
  }

  celebrate(): void {
    if (this.options.reducedMotion) return;
    this.card.classList.remove('is-complete');
    void this.card.offsetWidth;
    this.card.classList.add('is-complete');
  }
}

function element(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/** The line above the tray. The throw count is the one thing a player must not miss. */
export function describeThrows(state: GameState): string {
  if (state.phase === 'loading') return 'Shaking the cup…';
  if (state.phase === 'finished') return 'Card full';
  if (state.throwsLeft === 0) return 'Last hand — pick a box for it';
  if (state.held.every((hold) => hold)) return 'All five held — pick a box, or let one go';
  return state.throwsLeft === 1 ? 'One throw left' : `${state.throwsLeft} throws left`;
}

/** The top bar's second line: the record, which is all this game keeps. */
export function describeRecord(state: GameState): string {
  const { rounds, best, average } = state.record;
  if (rounds === 0) return 'First card';
  return `Best ${best} · avg ${Math.round(average)}`;
}

/** Which upper box a face belongs to, for the rules sheet and for tests. */
export const faceOf = upperFace;
