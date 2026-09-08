import { describe, expect, it } from 'vitest';

import shellCss from './shell.css?raw';
import { visibleHeight } from './viewport';

/**
 * The bug this is here for: on a Pixel with Chrome's address bar at the bottom
 * of the screen, `100dvh` overshoots the visible area by the height of that
 * bar, and the shell's `overflow: hidden` means the controls under it cannot be
 * scrolled to. Undo, restart and hint were unreachable, in every game at once.
 *
 * Checked in two halves, so the fix cannot half-rot: the stylesheet has to
 * prefer `--app-height`, and every game has to be the thing that sets it.
 */

const mains = import.meta.glob('../*/main.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** shell.css with its comments taken out — they talk about `100dvh` too. */
const css = shellCss.replace(/\/\*[\s\S]*?\*\//g, '');

describe('the app is sized from the visible viewport', () => {
  it('found every game to check', () => {
    expect(Object.keys(mains).length).toBeGreaterThanOrEqual(10);
  });

  for (const [path, source] of Object.entries(mains)) {
    it(`${path} pins the viewport height`, () => {
      expect(source).toContain("from '../shared/viewport'");
      expect(source).toContain('pinViewportHeight()');
    });
  }

  it('leaves no full-height rule without the --app-height fallback', () => {
    // A bare `height: 100dvh` in the shell is this bug coming back.
    const bare = css.match(/(?<!var\(--app-height, )100dvh/g) ?? [];
    expect(bare, `unguarded dvh in shell.css: ${bare.join(', ')}`).toHaveLength(0);
    expect(css).toContain('var(--app-height, 100dvh)');
  });
});

describe('visibleHeight', () => {
  it('prefers the visual viewport to the window', () => {
    // A Pixel with the address bar at the bottom: the window claims the strip
    // under the bar, the visual viewport knows better.
    expect(visibleHeight({ innerHeight: 900, visualViewport: { height: 844.6, scale: 1 } })).toBe(
      844,
    );
  });

  it('ignores a pinched viewport', () => {
    expect(visibleHeight({ innerHeight: 900, visualViewport: { height: 400, scale: 2.5 } })).toBe(
      900,
    );
  });

  it('never grows past the window', () => {
    expect(visibleHeight({ innerHeight: 700, visualViewport: { height: 780, scale: 1 } })).toBe(700);
  });

  it('falls back to the window with no visual viewport', () => {
    expect(visibleHeight({ innerHeight: 700 })).toBe(700);
    expect(visibleHeight({ innerHeight: 700, visualViewport: null })).toBe(700);
  });
});
