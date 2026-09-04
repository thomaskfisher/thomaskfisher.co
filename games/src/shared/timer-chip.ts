/**
 * The clock in the top bar, and the one-tap toggle that is the whole point.
 *
 * The brief was "sometimes I want to race, sometimes I want to sit and think",
 * and a setting buried two taps deep in a sheet does not serve that — by the
 * time you have gone looking for it the mood has passed. So the clock is also
 * its own switch: tapping it turns timed play off, and tapping the outline it
 * leaves behind turns it back on.
 *
 * Switching mid-level takes effect immediately, on the level in front of you.
 * There is an argument for deferring it to the next level so it cannot be used
 * to escape a clock about to expire — but this collection already ships
 * unlimited undo and a free hint, so pretending the timer is inescapable would
 * be the only bit of theatre in it. If she wants the clock off, it goes off.
 */

import { formatClock } from './timer';
import { el } from './ui';

/** Below this many seconds the chip goes urgent. */
const URGENT_AT = 10;

export interface TimerChip {
  root: HTMLButtonElement;
  /** Redraws the clock face. Pass null when the clock is not running. */
  set: (remaining: number | null, fraction: number) => void;
  /** Reflects the on/off setting without firing the change callback. */
  setEnabled: (enabled: boolean) => void;
}

export function createTimerChip(onToggle: (enabled: boolean) => void): TimerChip {
  let enabled = false;

  const face = el('span', { class: 'timer-face' }, '—');
  const bar = el('span', { class: 'timer-bar' });
  const root = el('button', {
    class: 'timer-chip',
    type: 'button',
    'aria-label': 'Timed play',
  }) as HTMLButtonElement;
  root.append(face, bar);

  root.addEventListener('click', () => {
    enabled = !enabled;
    apply();
    onToggle(enabled);
  });

  function apply(): void {
    root.classList.toggle('is-off', !enabled);
    root.setAttribute('aria-pressed', String(enabled));
    root.title = enabled ? 'Timed play — tap to turn off' : 'Timed play off — tap to turn on';
    if (!enabled) {
      face.textContent = '∞';
      bar.style.setProperty('--fill', '1');
      root.classList.remove('is-urgent');
    }
  }

  apply();

  return {
    root,
    set(remaining, fraction) {
      if (!enabled || remaining === null) return;
      face.textContent = formatClock(remaining);
      bar.style.setProperty('--fill', String(Math.max(0, Math.min(1, fraction))));
      root.classList.toggle('is-urgent', remaining <= URGENT_AT);
    },
    setEnabled(next) {
      enabled = next;
      apply();
    },
  };
}
