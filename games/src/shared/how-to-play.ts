/**
 * How to play.
 *
 * Every one of these games opens straight onto a board with no explanation, and
 * three of the four have a rule you cannot infer by tapping: Screw Land loses
 * the level when the tray overflows, Bus Jam only lets you tap someone with a
 * clear walk to the top edge, and Survival's reach limit is invisible until you
 * try to cross the board in one step and are refused. A new player finds those
 * out by losing, which reads as the game being unfair rather than as a rule.
 *
 * So each game carries a short illustrated rules sheet, shown once on a fresh
 * save and available forever after from the `?` in the top bar. Diagrams rather
 * than prose: the rules are all spatial, and "a plate falls when its last screw
 * comes out" is one picture and four lines of text.
 *
 * The closing promises are written here rather than per game because they are
 * the same promise in all four — they are the house rules, and a player who has
 * read them once in Color Sort should read the same words in Bus Jam.
 */

import { el, openSheet } from './ui';

export interface RuleStep {
  /** Short and imperative. This is the line someone skims. */
  title: string;
  /** A sentence or two under the title. Plain text — no markup. */
  text: string;
  /** Inline SVG drawn in a `0 0 92 64` viewBox. See the `art*` helpers below. */
  art: string;
}

export interface GameRules {
  /** As it appears in the sheet's heading. */
  gameName: string;
  /** One sentence: what finishing a level actually means. */
  goal: string;
  steps: RuleStep[];
}

/**
 * True the first time a profile opens the game.
 *
 * Deliberately not just `!seenHowToPlay`: adding the flag to the save format
 * means every existing player reads as never having seen it, and interrupting
 * someone on level 60 to explain the tap target is worse than not explaining
 * it. A save that has cleared nothing is the one that belongs to a new player.
 */
export function shouldAutoShow(save: {
  seenHowToPlay: boolean;
  stats: { levelsCleared: number };
}): boolean {
  return !save.seenHowToPlay && save.stats.levelsCleared === 0;
}

const HOUSE_PROMISES = [
  'Every level is solved by a computer before you ever see it. You can lose one, but you can never be handed a board that cannot be finished.',
  'Undo goes back as far as you like, and Hint always points at a move that still wins. Both are free, unlimited, and cost you nothing to use.',
  'Nothing is locked and nothing is timed unless you ask for it. Settings will jump you to any level you like.',
];

export interface HowToPlayOptions {
  rules: GameRules;
  /** Fired when the sheet opens — the games hold the clock with it. */
  onOpen?: () => void;
  onClose?: () => void;
  /** Fired once, the first time the sheet is actually shown. */
  onSeen?: () => void;
}

export interface HowToPlay {
  /** The `?` for the top bar. Insert it yourself; placement varies by game. */
  button: HTMLButtonElement;
  /** `firstRun` changes only the closing button's wording. */
  open: (firstRun?: boolean) => void;
}

export function createHowToPlay(options: HowToPlayOptions): HowToPlay {
  const button = el(
    'button',
    { class: 'icon-button', type: 'button', 'aria-label': 'How to play', title: 'How to play' },
    icon,
  ) as HTMLButtonElement;

  let seen = false;

  const open = (firstRun = false): void => {
    if (!seen) {
      seen = true;
      options.onSeen?.();
    }
    options.onOpen?.();
    openSheet((sheet) => build(sheet.content, options.rules, firstRun, sheet.close), {
      onClose: options.onClose,
    });
  };

  button.addEventListener('click', () => open());

  return { button, open };
}

function build(
  content: HTMLElement,
  rules: GameRules,
  firstRun: boolean,
  close: () => void,
): void {
  content.append(el('h2', {}, `How to play ${rules.gameName}`));
  content.append(el('p', { class: 'howto-goal' }, rules.goal));

  const list = el('ol', { class: 'howto-steps' });
  for (const step of rules.steps) {
    const item = el('li', { class: 'howto-step' });
    item.append(el('div', { class: 'howto-art' }, artSvg(step.art)));
    item.append(
      el('div', { class: 'howto-step-text' }, `<b>${step.title}</b><span>${step.text}</span>`),
    );
    list.append(item);
  }
  content.append(list);

  const promises = el('ul', { class: 'howto-promises' });
  for (const line of HOUSE_PROMISES) promises.append(el('li', {}, line));
  content.append(promises);

  const done = el(
    'button',
    { class: 'button button--full' },
    firstRun ? 'Start playing' : 'Got it',
  );
  done.addEventListener('click', close);
  content.append(done);
}

function artSvg(body: string): string {
  return `<svg viewBox="0 0 92 64" aria-hidden="true" focusable="false">${body}</svg>`;
}

/* ------------------------------------------------------------------ */
/* Drawing helpers                                                     */
/* ------------------------------------------------------------------ */

/*
 * Colours come from CSS classes rather than `fill="var(--accent)"`, because a
 * presentation attribute is not a CSS declaration and `var()` inside one is
 * simply ignored. See the `.howto-art` block in shell.css for the classes.
 */

const icon =
  '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/>' +
  '<path d="M9.4 9.2a2.7 2.7 0 1 1 3.4 2.9c-.6.2-.9.7-.9 1.3v.5"/>' +
  '<path d="M12 17.4h.01"/></svg>';

/** "Tap here": a filled dot inside two accent rings. */
export function artTap(cx: number, cy: number, r = 11): string {
  return (
    `<circle class="ha-accent" cx="${cx}" cy="${cy}" r="${r}" stroke-width="1.7"/>` +
    `<circle class="ha-accent ha-faint" cx="${cx}" cy="${cy}" r="${r + 4.5}" stroke-width="1.4"/>`
  );
}

/** A dashed accent arc from one point to another, with an arrowhead at the end. */
export function artArrow(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bend = 14,
): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 - bend;
  const angle = Math.atan2(y2 - my, x2 - mx);
  const head = (spread: number): string =>
    `${(x2 - 6 * Math.cos(angle - spread)).toFixed(1)} ${(y2 - 6 * Math.sin(angle - spread)).toFixed(1)}`;

  return (
    `<path class="ha-accent" d="M${x1} ${y1} Q${mx.toFixed(1)} ${my.toFixed(1)} ${x2} ${y2}" ` +
    `stroke-width="1.7" stroke-dasharray="3.5 3" stroke-linecap="round"/>` +
    `<path class="ha-accent" d="M${head(0.5)} L${x2} ${y2} L${head(-0.5)}" ` +
    `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

/** A tick in a filled accent disc. Used for "this is what winning looks like". */
export function artTick(cx: number, cy: number, r = 8): string {
  return (
    `<circle class="ha-accent-fill" cx="${cx}" cy="${cy}" r="${r}"/>` +
    `<path class="ha-on-accent" d="M${cx - r * 0.45} ${cy} l${r * 0.32} ${r * 0.36} l${r * 0.62} -${r * 0.72}" ` +
    `stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

/** A cross in a filled danger disc. Used for "this is how a level ends". */
export function artCross(cx: number, cy: number, r = 8): string {
  return (
    `<circle class="ha-danger-fill" cx="${cx}" cy="${cy}" r="${r}"/>` +
    `<path class="ha-on-accent" d="M${cx - r * 0.4} ${cy - r * 0.4} l${r * 0.8} ${r * 0.8} ` +
    `M${cx + r * 0.4} ${cy - r * 0.4} l-${r * 0.8} ${r * 0.8}" stroke-width="1.9" stroke-linecap="round"/>`
  );
}
