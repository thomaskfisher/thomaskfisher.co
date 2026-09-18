import { describe, expect, it } from 'vitest';

import { COL_W, FIELD_W, columnCentre, createTerrain } from './terrain';
import {
  BARREL_LEN,
  GRAVITY,
  MUZZLE_SPEED,
  TANK_HIT_R,
  TURRET_Y,
  blastDamage,
  fly,
  muzzleOf,
} from './physics';
import { PLAIN_SHELL, weaponById } from './weapons';

const GROUND = 30;

/** A shot from the left of a flat field. */
function shoot(angle: number, power: number, targets: Parameters<typeof fly>[4] = []) {
  const terrain = createTerrain(GROUND);
  const muzzle = muzzleOf(columnCentre(8), GROUND, angle);
  return { terrain, muzzle, flight: fly(terrain, muzzle, angle, power, targets) };
}

describe('the muzzle', () => {
  it('sits a barrel length out from the turret in the aim direction', () => {
    const level = muzzleOf(40, 30, 0);
    expect(level.x).toBeCloseTo(40 + BARREL_LEN, 6);
    expect(level.y).toBeCloseTo(30 + TURRET_Y, 6);

    const up = muzzleOf(40, 30, 90);
    expect(up.x).toBeCloseTo(40, 6);
    expect(up.y).toBeCloseTo(30 + TURRET_Y + BARREL_LEN, 6);
  });

  it('clears the firing tank\'s own hit circle at every angle', () => {
    // Otherwise every shot would burst on the tank that fired it.
    for (let angle = 0; angle <= 180; angle += 5) {
      const muzzle = muzzleOf(40, 30, angle);
      const distance = Math.hypot(muzzle.x - 40, muzzle.y - (30 + TURRET_Y));
      expect(distance).toBeGreaterThan(TANK_HIT_R);
    }
  });
});

describe('a shell in flight', () => {
  it('lands where the range equation says it should', () => {
    const angle = 45;
    const power = 60;
    const { muzzle, flight } = shoot(angle, power);
    expect(flight.impact).not.toBeNull();

    const speed = power * MUZZLE_SPEED;
    const radians = (angle * Math.PI) / 180;
    const vy = Math.sin(radians) * speed;
    const vx = Math.cos(radians) * speed;
    const drop = muzzle.y - GROUND;
    // Time to fall back to ground level, from the muzzle height.
    const time = (vy + Math.sqrt(vy * vy + 2 * GRAVITY * drop)) / GRAVITY;
    const expected = muzzle.x + vx * time;

    // Within a column: the integration is fine but not analytic, and the burst
    // point is bisected against interpolated ground.
    expect((flight.impact as { x: number }).x).toBeCloseTo(expected, -Math.log10(COL_W));
  });

  it('throws further at forty-five degrees than either side of it', () => {
    const flat = shoot(20, 70).flight.impact?.x ?? 0;
    const best = shoot(45, 70).flight.impact?.x ?? 0;
    const steep = shoot(70, 70).flight.impact?.x ?? 0;
    expect(best).toBeGreaterThan(flat);
    expect(best).toBeGreaterThan(steep);
  });

  it('throws further with more power, until it leaves the field', () => {
    let previous = 0;
    for (const power of [20, 35, 50, 65]) {
      const landed = shoot(45, power).flight.impact?.x ?? 0;
      expect(landed).toBeGreaterThan(previous);
      previous = landed;
    }
    // Past about seventy, forty-five degrees clears the far edge entirely.
    // That is the headroom `MUZZLE_SPEED` was retuned to buy, not a bug.
    expect(shoot(45, 100).flight.impact).toBeNull();
  });

  it('comes back down on its own head when fired straight up', () => {
    const { muzzle, flight } = shoot(90, 80);
    expect(flight.impact).not.toBeNull();
    expect((flight.impact as { x: number }).x).toBeCloseTo(muzzle.x, 1);
  });

  it('is a dud when it leaves the side of the field', () => {
    const terrain = createTerrain(GROUND);
    const muzzle = muzzleOf(columnCentre(90), GROUND, 20);
    const flight = fly(terrain, muzzle, 20, 100, []);
    expect(flight.impact).toBeNull();
    expect(flight.hit).toBeNull();
  });

  it('keeps flying above the top of the field and comes back', () => {
    // A high lob spends most of its flight off screen. Nothing up there may
    // stop it, or a full-power shot would silently vanish.
    const { flight } = shoot(80, 100);
    const highest = Math.max(...flight.path.filter((_, index) => index % 2 === 1));
    expect(highest).toBeGreaterThan(128);
    expect(flight.impact).not.toBeNull();
  });

  it('bursts on a tank it passes through', () => {
    const target = { x: columnCentre(60), y: GROUND + TURRET_Y, alive: true };
    const terrain = createTerrain(GROUND);
    // Ranged in by search, so the test is about the hit and not about my aim.
    let hit: number | null = null;
    for (let power = 30; power <= 100 && hit === null; power += 1) {
      const muzzle = muzzleOf(columnCentre(8), GROUND, 45);
      const flight = fly(terrain, muzzle, 45, power, [target]);
      if (flight.hit === 0) hit = power;
    }
    expect(hit).not.toBeNull();
  });

  it('ignores a tank that is already out', () => {
    const target = { x: columnCentre(60), y: GROUND + TURRET_Y, alive: false };
    const terrain = createTerrain(GROUND);
    for (let power = 30; power <= 100; power += 1) {
      const muzzle = muzzleOf(columnCentre(8), GROUND, 45);
      expect(fly(terrain, muzzle, 45, power, [target]).hit).toBeNull();
    }
  });

  it('bursts at the muzzle when the barrel is buried in a hillside', () => {
    const terrain = createTerrain(GROUND);
    for (let c = 9; c < 20; c++) terrain[c] = 90;
    const muzzle = muzzleOf(columnCentre(8), GROUND, 10);
    // Pointed into the wall at a height the wall occupies.
    terrain[8] = GROUND;
    terrain[9] = 90;
    const flight = fly(terrain, muzzle, 10, 100, []);
    expect(flight.impact).not.toBeNull();
    expect((flight.impact as { x: number }).x).toBeLessThan(columnCentre(12));
  });

  it('samples a path dense enough to draw and bounded enough to save', () => {
    const { flight } = shoot(45, 70);
    expect(flight.path.length % 2).toBe(0);
    expect(flight.path.length / 2).toBeGreaterThan(20);
    expect(flight.path.length / 2).toBeLessThan(800);
    expect(flight.duration).toBeGreaterThan(0.5);
  });

  it('stays inside the field for the whole of a path that ends in a burst', () => {
    const { flight } = shoot(45, 70);
    for (let i = 0; i < flight.path.length; i += 2) {
      expect(flight.path[i]).toBeGreaterThanOrEqual(0);
      expect(flight.path[i]).toBeLessThanOrEqual(FIELD_W);
    }
  });
});

describe('blast damage', () => {
  it('is full across the core and nothing at the rim', () => {
    const weapon = PLAIN_SHELL;
    expect(blastDamage(0, weapon)).toBe(weapon.damage);
    expect(blastDamage(weapon.radius * 0.3, weapon)).toBe(weapon.damage);
    expect(blastDamage(weapon.radius, weapon)).toBe(0);
    expect(blastDamage(weapon.radius + 1, weapon)).toBe(0);
  });

  it('falls away with distance in between', () => {
    const weapon = weaponById('bertha');
    let previous = weapon.damage + 1;
    for (let distance = weapon.radius * 0.3; distance <= weapon.radius; distance += 1) {
      const dealt = blastDamage(distance, weapon);
      expect(dealt).toBeLessThanOrEqual(previous);
      previous = dealt;
    }
  });

  it('is nothing at all for a weapon that only moves dirt', () => {
    const weapon = weaponById('dirtball');
    expect(blastDamage(0, weapon)).toBe(0);
  });
});
