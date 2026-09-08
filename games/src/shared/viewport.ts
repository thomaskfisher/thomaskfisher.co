/**
 * Pins the app to the height that is actually visible.
 *
 * `100dvh` is supposed to be this, and on iOS it is. On Chrome for Android it
 * is not reliable: with the address bar at the bottom of the screen — the
 * default on a recent Pixel — the dynamic viewport is reported as if that bar
 * were not there, so the last strip of the page sits underneath it. Every one
 * of these games puts its controls in exactly that strip, and `overflow:
 * hidden` on the shell means there is no scrolling down to reach them. Undo,
 * restart and hint were simply gone.
 *
 * `visualViewport.height` is the one measurement that always describes what the
 * player can see: browser chrome, keyboard and all. It is written to
 * `--app-height`, which `shell.css` prefers over `100dvh`.
 */

/** What the window looks like from here. Narrowed so the maths is testable. */
export interface ViewportLike {
  innerHeight: number;
  visualViewport?: { height: number; scale: number } | null;
}

/**
 * The height to hand the stylesheet.
 *
 * Two things it deliberately does not do:
 *
 *  - **It ignores a pinch.** Zooming shrinks the visual viewport without
 *    shrinking the window, and following that would shrink the board under
 *    someone who was only trying to look at it more closely. The viewport meta
 *    sets `maximum-scale=1`, so this is a guard rather than a feature.
 *  - **It never grows past `innerHeight`.** Where the visual viewport is the
 *    larger of the two, `100dvh` was already right and this has nothing to add.
 *
 * Floored, because a fractional height rounded up is the overflow this exists
 * to prevent.
 */
export function visibleHeight(win: ViewportLike): number {
  const viewport = win.visualViewport;
  const height =
    viewport && viewport.scale <= 1.01 ? Math.min(win.innerHeight, viewport.height) : win.innerHeight;
  return Math.floor(height);
}

/** Writes `--app-height` now, and again whenever the visible area moves. */
export function pinViewportHeight(): void {
  const viewport = window.visualViewport;

  const apply = (): void => {
    const height = visibleHeight(window);
    if (height <= 0) return;
    document.documentElement.style.setProperty('--app-height', `${height}px`);
  };

  apply();

  viewport?.addEventListener('resize', apply);
  window.addEventListener('resize', apply);
  // The window is the wrong size for a frame or two after a rotation on both
  // platforms, so the immediate `resize` is measured again once it settles.
  window.addEventListener('orientationchange', () => window.setTimeout(apply, 150));
}
