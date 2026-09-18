/**
 * The ground, as a heightmap.
 *
 * **One integer height per column, and that decision carries the whole game.**
 * The obvious alternative is a bitmap of solid pixels, which is what the
 * originals use and which buys overhangs and tunnels. It also costs a fast
 * collision test, a compact save, and any simple answer to "where does a tank
 * sit". A heightmap gives all three: collision is one interpolation, the whole
 * battlefield is 96 bytes, and a tank's height *is* the column's height.
 *
 * What it gives up is overhangs, and the one weapon that wants them — a shell
 * that tunnels — gets them approximated instead: a digger lowers the columns it
 * passes through, so the shaft is open to the sky rather than roofed. That
 * reads correctly on screen and plays the same way, because what the shaft is
 * for is dropping the ground out from under somebody.
 *
 * Heights are integers so that a saved match reloads byte for byte. Rounding
 * at the point of change rather than at the point of saving is what makes that
 * true: quantising on the way to disk would shift the ground very slightly
 * every time the app was closed.
 */

/** Columns across the field. 96 at 2 units each. */
export const COLUMNS = 96;
/** World units per column. */
export const COL_W = 2;
/** Field width in world units. */
export const FIELD_W = COLUMNS * COL_W;
/** Field height in world units. Everything fits in a byte, deliberately. */
export const FIELD_H = 128;

/** The ground never digs out completely, and never reaches the sky. */
export const GROUND_MIN = 4;
export const GROUND_MAX = 116;

/**
 * A column's height, in world units, indexed by column.
 *
 * `Uint8Array` rather than `number[]`: it is the save format as well as the
 * working representation, so there is one definition of what the ground is.
 */
export type Terrain = Uint8Array;

export function createTerrain(fill = 40): Terrain {
  return new Uint8Array(COLUMNS).fill(clampHeight(fill));
}

export function cloneTerrain(terrain: Terrain): Terrain {
  return new Uint8Array(terrain);
}

export function clampHeight(value: number): number {
  return Math.max(GROUND_MIN, Math.min(GROUND_MAX, Math.round(value)));
}

/** The world x of a column's centre. Tanks and craters both measure from here. */
export function columnCentre(column: number): number {
  return (column + 0.5) * COL_W;
}

/** The column a world x falls in, clamped to the field. */
export function columnAt(x: number): number {
  return Math.max(0, Math.min(COLUMNS - 1, Math.floor(x / COL_W)));
}

/**
 * Ground height at any world x, interpolated between column centres.
 *
 * Sampling the column outright would give the projectile a staircase to hit,
 * and a shell skimming a slope would stop dead on a step rather than skip
 * along it. The ends extend flat, which is also how the field is drawn.
 */
export function heightAt(terrain: Terrain, x: number): number {
  const u = x / COL_W - 0.5;
  const i = Math.floor(u);
  const frac = u - i;
  const left = terrain[Math.max(0, Math.min(COLUMNS - 1, i))] as number;
  const right = terrain[Math.max(0, Math.min(COLUMNS - 1, i + 1))] as number;
  return left + (right - left) * frac;
}

/**
 * Blows a circular hole, and lets what was above it fall in.
 *
 * For a column at horizontal distance `dx` from the blast, the circle covers a
 * band of ground `2 * sqrt(r^2 - dx^2)` thick. Three cases, and the third is
 * the one that matters:
 *
 *  - the ground is below the band: nothing happens, the blast was in the air;
 *  - the ground top is inside the band: it drops to the bottom of the band;
 *  - the ground top is *above* the band: the band is removed from underneath
 *    it, so the column loses that thickness and everything above it settles.
 *
 * That third case is what a heightmap can say about a blast underground, and it
 * is the right thing to say: no roof is left behind, the surface subsides.
 *
 * `dig` scales how much is actually taken, so a weapon can hit hard and barely
 * scratch the ground (Super Zapper) or hit softly and wreck it (Crater Maker).
 */
export function carve(terrain: Terrain, ex: number, ey: number, radius: number, dig = 1): void {
  if (radius <= 0 || dig <= 0) return;

  const first = columnAt(ex - radius);
  const last = columnAt(ex + radius);

  for (let c = first; c <= last; c++) {
    const dx = columnCentre(c) - ex;
    const inside = radius * radius - dx * dx;
    if (inside <= 0) continue;

    const half = Math.sqrt(inside);
    const bottom = ey - half;
    const top = ey + half;
    const height = terrain[c] as number;

    let removed: number;
    if (height <= bottom) continue;
    else if (height <= top) removed = height - bottom;
    else removed = 2 * half;

    terrain[c] = clampHeight(height - removed * dig);
  }
}

/**
 * Drops a mound of earth.
 *
 * The mirror of `carve`, with one difference that is a rule rather than an
 * implementation detail: dirt is *added to the column*, not drawn as a ball
 * where it landed. A dirt weapon lobbed into a crater fills the crater, and one
 * lobbed against a hillside piles up on the hillside. Nothing floats.
 */
export function heap(terrain: Terrain, ex: number, radius: number, fill: number): void {
  if (radius <= 0 || fill <= 0) return;

  const first = columnAt(ex - radius);
  const last = columnAt(ex + radius);

  for (let c = first; c <= last; c++) {
    const dx = columnCentre(c) - ex;
    const inside = radius * radius - dx * dx;
    if (inside <= 0) continue;
    terrain[c] = clampHeight((terrain[c] as number) + 2 * Math.sqrt(inside) * fill);
  }
}

/**
 * Sinks a shaft straight down from a blast.
 *
 * Narrower than the blast that made it — a drill hole rather than a bowl — and
 * it is the one terrain effect with no circle in it, because the whole point is
 * a wall too steep to climb out of on both sides.
 */
export function shaft(terrain: Terrain, ex: number, radius: number, depth: number): void {
  if (radius <= 0 || depth <= 0) return;

  const first = columnAt(ex - radius);
  const last = columnAt(ex + radius);
  for (let c = first; c <= last; c++) {
    terrain[c] = clampHeight((terrain[c] as number) - depth);
  }
}

/** Levels a short pad, so a tank never starts the match on a cliff edge. */
export function flatten(terrain: Terrain, column: number, halfWidth = 2): void {
  const centre = terrain[Math.max(0, Math.min(COLUMNS - 1, column))] as number;
  for (let c = column - halfWidth; c <= column + halfWidth; c++) {
    if (c < 0 || c >= COLUMNS) continue;
    terrain[c] = centre;
  }
}

/** Base64 for the save. 96 bytes in, 128 characters out. */
export function encodeTerrain(terrain: Terrain): string {
  let binary = '';
  for (const value of terrain) binary += String.fromCharCode(value);
  return btoa(binary);
}

/** Anything the wrong length is rejected rather than padded — see `model.ts`. */
export function decodeTerrain(code: string): Terrain | null {
  try {
    const binary = atob(code);
    if (binary.length !== COLUMNS) return null;
    const terrain = new Uint8Array(COLUMNS);
    for (let i = 0; i < COLUMNS; i++) terrain[i] = binary.charCodeAt(i) & 0xff;
    return terrain;
  } catch {
    return null;
  }
}
