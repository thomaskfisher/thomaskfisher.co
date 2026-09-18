/**
 * Draws the battlefield, and flies the shells.
 *
 * SVG rather than canvas, for the reason the rest of the collection is SVG or
 * DOM: the ground, the tanks and the arcs are all a handful of paths, they want
 * to change colour with the theme, and a stylesheet does that for nothing where
 * a canvas needs a palette passed in and a full repaint.
 *
 * **The only frame loop in the collection lives in this file, and it is a
 * camera.** Every other game here renders on state change and nothing else. An
 * artillery game cannot: the arc is the feedback, and a shot that teleports to
 * its crater teaches nobody how to correct the next one. So `flight()` walks a
 * path the model has *already* computed, in real time, and reports back when it
 * is done. It decides nothing, it can be cancelled, and while it runs the
 * controller is in its `firing` phase and refuses input. Drop every frame and
 * the outcome is identical.
 *
 * Which is also the whole of the animation budget. The one deferred thing —
 * this loop — keeps its handle and is cancelled on reset, because the house
 * rule about deferred DOM mutation is what cost Screw Land a week: a timer that
 * fires against a state that has since been undone is a permanent bug, and
 * "New match while a shell is in the air" is exactly that shape.
 *
 * Trails are why a shot is worth remembering. The player aims by reading the
 * last arc and correcting, so the previous shot from each side stays on the
 * field, faintly — and it rides in the save, so closing the app between turns
 * does not throw away the range somebody just found.
 */

import { COLUMNS, FIELD_H, FIELD_W, columnCentre, type Terrain } from './terrain';
import { BARREL_LEN, TURRET_Y } from './physics';
import type { Burst, MatchState, Resolution, Seat } from './model';
import { NAMES, type GameView } from './game';

const SVG = 'http://www.w3.org/2000/svg';

/** How long a burst takes to bloom and fade, in seconds. */
const BURST_TIME = 0.45;
/** Held on screen after the last burst, so the crater is seen before the turn moves. */
const SETTLE_TIME = 0.35;
/** With reduced motion: the whole arc appears at once and is held this long. */
const STILL_TIME = 0.6;

function node<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
}

/** World y (up from the ground) to SVG y (down from the top). */
const sy = (y: number): number => FIELD_H - y;

export interface RendererOptions {
  reducedMotion: boolean;
}

export class FieldRenderer {
  private svg: SVGSVGElement;
  private ground = node('path', { class: 'ar-ground' });
  private surface = node('path', { class: 'ar-surface' });
  private trails: [SVGPathElement, SVGPathElement] = [
    node('path', { class: 'ar-trail ar-trail--left' }),
    node('path', { class: 'ar-trail ar-trail--right' }),
  ];
  private tanks: [TankArt, TankArt];
  /** Shells and bursts, cleared whenever the loop stops. */
  private transient = node('g', { class: 'ar-transient' });

  private frame: number | null = null;
  private options: RendererOptions;

  constructor(host: HTMLElement, options: RendererOptions) {
    this.options = options;

    this.svg = node('svg', {
      class: 'ar-field',
      viewBox: `0 0 ${FIELD_W} ${FIELD_H}`,
      // Bottom-anchored, not centred. The board row is taller than the field's
      // 3:2, and the spare height is worth more as sky than as a letterbox
      // margin: a high lob leaves the top of the world and stays visible in it.
      preserveAspectRatio: 'xMidYMax meet',
      'aria-hidden': 'true',
      focusable: 'false',
    });

    this.tanks = [tankArt(0), tankArt(1)];

    this.svg.append(
      this.ground,
      this.surface,
      this.trails[0],
      this.trails[1],
      this.tanks[0].group,
      this.tanks[1].group,
      this.transient,
    );
    host.append(this.svg);
  }

  updateOptions(options: Partial<RendererOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Stops any flight and clears everything transient.
   *
   * `finishNow` goes back to a no-op with it. Left pointing at the finished
   * flight's closure it would still be callable — harmlessly today, because
   * the controller refuses a report from a turn it is no longer on, but that
   * is one guard away from being the stale-timer bug this file's header is
   * about. Nothing deferred outlives the state it was created for.
   */
  reset(): void {
    this.cancel();
    this.transient.replaceChildren();
    this.finishNow = () => undefined;
  }

  private cancel(): void {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
  }

  /* ----------------------------------------------------------- drawing */

  render(view: GameView): void {
    const { match } = view;

    this.ground.setAttribute('d', groundPath(match.terrain));
    this.surface.setAttribute('d', surfacePath(match.terrain));

    for (const seat of [0, 1] as Seat[]) {
      const trail = match.trail[seat];
      const path = trail && trail.length >= 4 ? trailPath(trail) : '';
      this.trails[seat].setAttribute('d', path);
      this.trails[seat].classList.toggle('is-empty', path === '');
    }

    for (const seat of [0, 1] as Seat[]) {
      drawTank(this.tanks[seat], match, seat, view);
    }
  }

  /**
   * Flies a resolved shot, then hands back.
   *
   * `onDone` is called exactly once, and the caller may also call
   * `finishNow()` to bring it forward — the page does that when it is hidden
   * mid-flight, because a backgrounded tab stops delivering frames and the
   * turn would otherwise never end.
   */
  flight(resolution: Resolution, onDone: () => void): void {
    this.cancel();
    this.transient.replaceChildren();

    const flights = resolution.flights;
    if (flights.length === 0) {
      onDone();
      return;
    }

    const shells = flights.map(() => {
      const shell = node('circle', { class: 'ar-shell', r: shellRadius(resolution), cx: -10, cy: -10 });
      this.transient.append(shell);
      return shell;
    });

    const still = this.options.reducedMotion;
    const lastLanding = Math.max(...flights.map((flight) => flight.duration));
    const total = still ? STILL_TIME + BURST_TIME : lastLanding + BURST_TIME + SETTLE_TIME;

    // Drawn arcs, one per shell, so a cluster shows its whole fan rather than
    // one line. These are the live shot; `render` draws the remembered one.
    const arcs = flights.map((flight) => {
      const arc = node('path', { class: 'ar-arc', d: trailPath(flight.path) });
      this.transient.insertBefore(arc, this.transient.firstChild);
      if (!still) arc.setAttribute('d', '');
      return arc;
    });

    const burstsShown = new Set<number>();
    const start = performance.now();
    let finished = false;

    const finish = (): void => {
      if (finished) return;
      finished = true;
      this.cancel();
      this.transient.replaceChildren();
      onDone();
    };

    this.finishNow = finish;

    const step = (now: number): void => {
      const elapsed = (now - start) / 1000;

      flights.forEach((flight, index) => {
        const shell = shells[index];
        if (!shell) return;
        const landedAt = still ? STILL_TIME : flight.duration;

        if (elapsed < landedAt) {
          const point = pointAt(flight.path, still ? 1 : elapsed / flight.duration);
          shell.setAttribute('cx', String(point.x));
          shell.setAttribute('cy', String(sy(point.y)));
          if (!still) arcs[index]?.setAttribute('d', trailPath(flight.path, elapsed / flight.duration));
          return;
        }

        shell.setAttribute('cx', '-10');
        arcs[index]?.setAttribute('d', trailPath(flight.path));

        if (!burstsShown.has(index)) {
          burstsShown.add(index);
          const burst = resolution.bursts[index];
          if (burst) this.transient.append(burstArt(burst, resolution));
        }
      });

      if (elapsed >= total) {
        finish();
        return;
      }
      this.frame = requestAnimationFrame(step);
    };

    this.frame = requestAnimationFrame(step);
  }

  /** Replaced for the duration of each flight. See `flight`. */
  finishNow: () => void = () => undefined;
}

/* ------------------------------------------------------------------ */
/* Paths                                                              */
/* ------------------------------------------------------------------ */

/**
 * The filled ground.
 *
 * Column centres, with the two ends carried flat out to the edge of the field —
 * which is what `heightAt` does for collision, so the shape a shell hits is the
 * shape on screen. Getting those two to disagree is how a shell ends up
 * bursting against thin air near the edge.
 */
function groundPath(terrain: Terrain): string {
  const parts: string[] = [`M 0 ${sy(terrain[0] as number).toFixed(2)}`];
  for (let c = 0; c < COLUMNS; c++) {
    parts.push(`L ${columnCentre(c).toFixed(2)} ${sy(terrain[c] as number).toFixed(2)}`);
  }
  parts.push(
    `L ${FIELD_W} ${sy(terrain[COLUMNS - 1] as number).toFixed(2)}`,
    `L ${FIELD_W} ${FIELD_H}`,
    `L 0 ${FIELD_H}`,
    'Z',
  );
  return parts.join(' ');
}

/** Just the surface line, so the ground can carry a lit edge. */
function surfacePath(terrain: Terrain): string {
  const parts: string[] = [`M 0 ${sy(terrain[0] as number).toFixed(2)}`];
  for (let c = 0; c < COLUMNS; c++) {
    parts.push(`L ${columnCentre(c).toFixed(2)} ${sy(terrain[c] as number).toFixed(2)}`);
  }
  parts.push(`L ${FIELD_W} ${sy(terrain[COLUMNS - 1] as number).toFixed(2)}`);
  return parts.join(' ');
}

/** A flight path as a polyline, optionally cut short at a fraction of its length. */
function trailPath(path: readonly number[], fraction = 1): string {
  const points = path.length / 2;
  if (points < 2) return '';
  const upto = Math.max(2, Math.min(points, Math.ceil(points * fraction)));

  const parts: string[] = [];
  for (let i = 0; i < upto; i++) {
    const x = path[i * 2] as number;
    const y = sy(path[i * 2 + 1] as number);
    parts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return parts.join(' ');
}

/** Where along a path a shell is, at a fraction of its flight. */
function pointAt(path: readonly number[], fraction: number): { x: number; y: number } {
  const points = path.length / 2;
  const at = Math.max(0, Math.min(points - 1, fraction * (points - 1)));
  const index = Math.floor(at);
  const frac = at - index;
  const next = Math.min(points - 1, index + 1);

  const x0 = path[index * 2] as number;
  const y0 = path[index * 2 + 1] as number;
  const x1 = path[next * 2] as number;
  const y1 = path[next * 2 + 1] as number;

  return { x: x0 + (x1 - x0) * frac, y: y0 + (y1 - y0) * frac };
}

/* ------------------------------------------------------------------ */
/* Tanks                                                               */
/* ------------------------------------------------------------------ */

interface TankArt {
  group: SVGGElement;
  hull: SVGPathElement;
  barrel: SVGLineElement;
  turret: SVGCircleElement;
  marker: SVGPathElement;
}

const HULL_W = 9;
const HULL_H = 3;

function tankArt(seat: Seat): TankArt {
  const group = node('g', { class: `ar-tank ar-tank--${seat === 0 ? 'left' : 'right'}` });
  const hull = node('path', { class: 'ar-hull' });
  const barrel = node('line', { class: 'ar-barrel' });
  const turret = node('circle', { class: 'ar-turret', r: 2 });
  // The "you're up" marker. A CSS animation rather than a timer, so there is
  // nothing to cancel and nothing to leak.
  const marker = node('path', { class: 'ar-marker' });
  group.append(hull, barrel, turret, marker);
  return { group, hull, barrel, turret, marker };
}

function drawTank(art: TankArt, match: MatchState, seat: Seat, view: GameView): void {
  const tank = match.tanks[seat];
  const ground = match.terrain[tank.col] as number;
  const x = columnCentre(tank.col);
  // The ground line, which is the *bottom* of the hull. Drawing down from here
  // instead put every tank underneath the ground it was standing on.
  const base = sy(ground);
  const roof = base - HULL_H;

  art.hull.setAttribute(
    'd',
    `M ${(x - HULL_W / 2).toFixed(2)} ${base.toFixed(2)} ` +
      `L ${(x - HULL_W / 2 + 1.4).toFixed(2)} ${roof.toFixed(2)} ` +
      `L ${(x + HULL_W / 2 - 1.4).toFixed(2)} ${roof.toFixed(2)} ` +
      `L ${(x + HULL_W / 2).toFixed(2)} ${base.toFixed(2)} Z`,
  );

  const pivotY = sy(ground + TURRET_Y);
  art.turret.setAttribute('cx', x.toFixed(2));
  art.turret.setAttribute('cy', pivotY.toFixed(2));

  const radians = (tank.angle * Math.PI) / 180;
  art.barrel.setAttribute('x1', x.toFixed(2));
  art.barrel.setAttribute('y1', pivotY.toFixed(2));
  art.barrel.setAttribute('x2', (x + Math.cos(radians) * BARREL_LEN).toFixed(2));
  art.barrel.setAttribute('y2', (pivotY - Math.sin(radians) * BARREL_LEN).toFixed(2));

  const onTheMove =
    match.turn === seat && (view.phase === 'aiming' || view.phase === 'firing') && tank.hp > 0;
  const markerY = sy(ground + TURRET_Y + BARREL_LEN + 4);
  art.marker.setAttribute(
    'd',
    `M ${(x - 2.6).toFixed(2)} ${markerY.toFixed(2)} L ${x.toFixed(2)} ${(markerY + 3.4).toFixed(2)} ` +
      `L ${(x + 2.6).toFixed(2)} ${markerY.toFixed(2)} Z`,
  );

  art.group.classList.toggle('is-active', onTheMove);
  art.group.classList.toggle('is-out', tank.hp <= 0);
}

/* ------------------------------------------------------------------ */
/* Bursts                                                              */
/* ------------------------------------------------------------------ */

function burstArt(burst: Burst, resolution: Resolution): SVGCircleElement {
  const circle = node('circle', {
    class: `ar-burst ar-burst--${burst.kind}`,
    cx: burst.x.toFixed(2),
    cy: sy(burst.y).toFixed(2),
    r: burst.radius.toFixed(2),
  });
  // The blast's own radius drives the bloom, so a Crater Maker reads as the
  // wrecking ball it is and a Hail Storm shell reads as a pop.
  circle.style.setProperty('--burst-r', `${burst.radius.toFixed(2)}`);
  circle.style.setProperty('--burst-ms', `${Math.round(BURST_TIME * 1000)}ms`);
  if (resolution.weapon.kind === 'dirt') circle.classList.add('ar-burst--fill');
  return circle;
}

/** A single shell is drawn bigger than one of twelve. */
function shellRadius(resolution: Resolution): number {
  return resolution.flights.length > 4 ? 1.1 : 1.6;
}

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

export function describeTurn(view: GameView): string {
  if (view.phase === 'loading') return '';
  if (view.phase === 'finished') {
    return view.winner === null ? 'Both tanks out' : `${NAMES[view.winner]} wins`;
  }
  if (view.phase === 'firing') return 'Incoming';

  const moves = view.match.movesLeft;
  return `${NAMES[view.match.turn]} to fire — ${moves} move${moves === 1 ? '' : 's'} left`;
}

export function describeTally(view: GameView): string {
  const { matches, left, right } = view.record;
  if (matches === 0) return 'First match';
  return `${NAMES[0]} ${left} · ${NAMES[1]} ${right}`;
}
