/**
 * Ballistics.
 *
 * A shell is a point under constant gravity, integrated at a fixed step. No
 * drag, no wind, no spin: the only two numbers between the player and a hit are
 * the two the player sets, so a shot that missed by a little missed by a little
 * for a reason that can be worked out and corrected. That is the entire skill
 * of the game, and anything else in here would be noise laid over it.
 *
 * **A whole flight is computed before anything is drawn.** The model returns
 * the path, the impact point and what was struck, all at once, and the renderer
 * then walks that path in real time. Two things fall out of that, and both
 * matter more than they look:
 *
 *  - the game state changes exactly once per shot, so there is no frame loop
 *    deciding anything and nothing to resynchronise if a frame is dropped;
 *  - the physics is testable without a DOM, which is how the reachability check
 *    in `generate.ts` can afford to fire a few hundred trial shots at a
 *    candidate battlefield before anyone sees it.
 *
 * The step is 1/240s — four times finer than the frame rate it is drawn at —
 * because collision here is "did the shell pass below the ground", and a coarse
 * step lets a fast shell skip straight through a thin ridge.
 */

import { FIELD_H, FIELD_W, heightAt, type Terrain } from './terrain';
import type { Weapon } from './weapons';

/** World units per second squared. Sets the whole feel of the arcs. */
export const GRAVITY = 120;

/**
 * Muzzle speed per point of power.
 *
 * **Measured, and the first guess was wrong in a way that wasted most of the
 * dial.** It started at 1.55, which put full power at forty-five degrees a
 * shade past the width of the field — which sounds right and is not. The tanks
 * start about 150 units apart, so a crossing shot needed most of the field's
 * worth of range, and `tools/artillery.ts` measured the lowest power that
 * connects at a mean of 86 with a tenth percentile of 79. Ninety-one positions
 * on the power dial and about twenty of them did anything: every shot was
 * nearly full power, and the interesting half of the trade — less power at a
 * flatter angle against more power at a steeper one — could not be expressed.
 *
 * At 2.0 a crossing shot sits around 65, full power reaches a little under
 * twice the width of the field, and the whole dial is in play. Full power going
 * off the far edge is correct rather than a bug; it is the cost of having
 * somewhere to go above the shot you need.
 */
export const MUZZLE_SPEED = 2.0;

const DT = 1 / 240;
/** Path points kept per second. 40 is smooth at any frame rate worth drawing. */
const SAMPLE_EVERY = 6;
/** A shell still in the air after this has gone somewhere absurd. */
const MAX_FLIGHT = 16;
/** How near the centre of a tank a shell has to pass to strike it outright. */
export const TANK_HIT_R = 4;
/** Where the shell leaves the barrel, measured from the turret pivot. */
export const BARREL_LEN = 5;
/** The turret pivot's height above the ground the tank stands on. */
export const TURRET_Y = 2.5;

export interface Target {
  /** Turret pivot, which is what a shell is measured against. */
  x: number;
  y: number;
  alive: boolean;
}

export interface Flight {
  /** Sampled path as a flat list of world coordinates: x0, y0, x1, y1, ... */
  path: number[];
  /** Where the shell burst, or null if it left the field without bursting. */
  impact: { x: number; y: number } | null;
  /** Index into `targets` of the tank it struck, if it struck one. */
  hit: number | null;
  /** Seconds in the air. The renderer animates at this speed. */
  duration: number;
}

export interface Muzzle {
  x: number;
  y: number;
}

/** Where a shell leaves a tank aiming at `angle`. */
export function muzzleOf(tankX: number, groundY: number, angle: number): Muzzle {
  const radians = (angle * Math.PI) / 180;
  return {
    x: tankX + Math.cos(radians) * BARREL_LEN,
    y: groundY + TURRET_Y + Math.sin(radians) * BARREL_LEN,
  };
}

/**
 * Flies one shell.
 *
 * `angle` is absolute: 0 is due right, 90 straight up, 180 due left. Both
 * players read the same scale, so the left tank lives around 45 and the right
 * tank around 135, and neither has to think about which way its own numbers
 * run. Pocket Tanks' 0-90-per-side scale hides that behind a mirror, and the
 * mirror is exactly the thing two people sharing one phone get wrong.
 */
export function fly(
  terrain: Terrain,
  from: Muzzle,
  angle: number,
  power: number,
  targets: readonly Target[],
): Flight {
  const radians = (angle * Math.PI) / 180;
  const speed = power * MUZZLE_SPEED;

  let x = from.x;
  let y = from.y;
  let vx = Math.cos(radians) * speed;
  let vy = Math.sin(radians) * speed;

  const path: number[] = [x, y];
  let steps = 0;
  const maxSteps = Math.ceil(MAX_FLIGHT / DT);

  // Fired into a hillside from inside it: the muzzle is already underground, so
  // the shell bursts where it sits. Harsh, correct, and legible — the blast is
  // drawn on the tank's own position.
  if (y <= heightAt(terrain, x) && x >= 0 && x <= FIELD_W) {
    return { path, impact: { x, y }, hit: null, duration: 0 };
  }

  while (steps < maxSteps) {
    const px = x;
    const py = y;

    vy -= GRAVITY * DT;
    x += vx * DT;
    y += vy * DT;
    steps++;

    if (steps % SAMPLE_EVERY === 0) path.push(x, y);

    // Off the side of the field. A dud: it neither digs nor damages.
    if (x < 0 || x > FIELD_W) {
      path.push(x, y);
      return { path, impact: null, hit: null, duration: steps * DT };
    }

    // Above the field is legal and normal — a high lob leaves the screen and
    // comes back — so nothing is tested up there but the clock.
    if (y > FIELD_H) continue;

    const struck = strike(x, y, targets);
    if (struck !== null) {
      path.push(x, y);
      return { path, impact: { x, y }, hit: struck, duration: steps * DT };
    }

    if (y <= heightAt(terrain, x)) {
      const point = crossing(terrain, px, py, x, y);
      path.push(point.x, point.y);
      return { path, impact: point, hit: null, duration: steps * DT };
    }
  }

  path.push(x, y);
  return { path, impact: null, hit: null, duration: steps * DT };
}

function strike(x: number, y: number, targets: readonly Target[]): number | null {
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i] as Target;
    if (!target.alive) continue;
    const dx = x - target.x;
    const dy = y - target.y;
    if (dx * dx + dy * dy <= TANK_HIT_R * TANK_HIT_R) return i;
  }
  return null;
}

/**
 * Where between two samples the shell crossed the ground.
 *
 * Bisected rather than solved: the ground between two columns is a straight
 * line but the shell's path is not, and four halvings put the burst inside a
 * sixteenth of a step — far below anything the crater maths can notice.
 */
function crossing(
  terrain: Terrain,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { x: number; y: number } {
  let lowT = 0;
  let highT = 1;
  for (let i = 0; i < 4; i++) {
    const mid = (lowT + highT) / 2;
    const mx = ax + (bx - ax) * mid;
    const my = ay + (by - ay) * mid;
    if (my <= heightAt(terrain, mx)) highT = mid;
    else lowT = mid;
  }
  const t = highT;
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t };
}

/**
 * Life taken by a blast, by distance from its centre.
 *
 * Flat across the inner third and falling to nothing at the rim. The flat core
 * is what makes a near miss and a direct hit worth the same: without it, the
 * difference between 58 damage and 31 is a unit and a half of aim, which is
 * below what the controls can express and reads as the game being arbitrary.
 */
export function blastDamage(distance: number, weapon: Weapon): number {
  if (weapon.damage <= 0 || distance >= weapon.radius) return 0;
  const core = weapon.radius * 0.3;
  if (distance <= core) return weapon.damage;
  const falloff = 1 - (distance - core) / (weapon.radius - core);
  return Math.round(weapon.damage * falloff);
}
