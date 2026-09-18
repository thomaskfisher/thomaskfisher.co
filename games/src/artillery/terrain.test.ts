import { describe, expect, it } from 'vitest';

import {
  COLUMNS,
  COL_W,
  GROUND_MAX,
  GROUND_MIN,
  carve,
  columnAt,
  columnCentre,
  createTerrain,
  decodeTerrain,
  encodeTerrain,
  flatten,
  heap,
  heightAt,
  shaft,
} from './terrain';

describe('sampling the ground', () => {
  it('reads a column centre as that column exactly', () => {
    const terrain = createTerrain(40);
    terrain[10] = 70;
    expect(heightAt(terrain, columnCentre(10))).toBe(70);
  });

  it('interpolates between centres, so a slope has no steps in it', () => {
    const terrain = createTerrain(40);
    terrain[10] = 40;
    terrain[11] = 60;
    const midpoint = (columnCentre(10) + columnCentre(11)) / 2;
    expect(heightAt(terrain, midpoint)).toBeCloseTo(50, 6);
  });

  it('extends the end columns flat rather than falling off the field', () => {
    const terrain = createTerrain(40);
    terrain[0] = 55;
    terrain[COLUMNS - 1] = 33;
    expect(heightAt(terrain, 0)).toBe(55);
    expect(heightAt(terrain, COLUMNS * COL_W)).toBe(33);
  });

  it('maps x back to the column it came from', () => {
    for (const column of [0, 1, 47, COLUMNS - 1]) {
      expect(columnAt(columnCentre(column))).toBe(column);
    }
  });
});

describe('carving a crater', () => {
  it('leaves ground below the blast alone', () => {
    const terrain = createTerrain(20);
    carve(terrain, columnCentre(48), 80, 12);
    expect([...terrain]).toEqual(new Array(COLUMNS).fill(20));
  });

  it('cuts deepest at the centre and tapers to the rim', () => {
    const terrain = createTerrain(60);
    const centre = columnCentre(48);
    carve(terrain, centre, 60, 20);

    const depthAt = (column: number) => 60 - (terrain[column] as number);
    expect(depthAt(48)).toBeGreaterThan(depthAt(52));
    expect(depthAt(52)).toBeGreaterThan(depthAt(56));
    // Outside the radius nothing moved at all.
    expect(terrain[37]).toBe(60);
  });

  it('subsides the column when the blast goes off underground', () => {
    // A blast centred 20 units below a 60-unit surface, radius 10: the band it
    // removes is 20 thick at the centre, and everything above settles into it.
    const terrain = createTerrain(60);
    carve(terrain, columnCentre(48), 40, 10);
    expect(terrain[48]).toBe(40);
  });

  it('never digs below the floor of the field', () => {
    const terrain = createTerrain(GROUND_MIN + 2);
    carve(terrain, columnCentre(48), GROUND_MIN, 40, 3);
    for (const height of terrain) expect(height).toBeGreaterThanOrEqual(GROUND_MIN);
  });

  it('scales with dig, so damage and digging are separate dials', () => {
    const soft = createTerrain(60);
    const hard = createTerrain(60);
    carve(soft, columnCentre(48), 60, 16, 0.25);
    carve(hard, columnCentre(48), 60, 16, 1);
    expect(60 - (soft[48] as number)).toBeLessThan(60 - (hard[48] as number));
  });
});

describe('heaping dirt', () => {
  it('piles onto whatever is already there rather than floating', () => {
    const terrain = createTerrain(30);
    terrain[48] = 10;
    heap(terrain, columnCentre(48), 12, 1);
    // The low column gained the same thickness as its neighbours, so the pile
    // followed the ground down into the hole.
    expect(terrain[48]).toBe(34);
    expect(terrain[47]).toBeGreaterThan(30);
  });

  it('never piles above the ceiling', () => {
    const terrain = createTerrain(GROUND_MAX - 4);
    heap(terrain, columnCentre(48), 20, 4);
    for (const height of terrain) expect(height).toBeLessThanOrEqual(GROUND_MAX);
  });
});

describe('sinking a shaft', () => {
  it('drops a narrow band by a fixed depth, with nothing either side', () => {
    const terrain = createTerrain(80);
    shaft(terrain, columnCentre(48), 4, 30);
    expect(terrain[48]).toBe(50);
    expect(terrain[40]).toBe(80);
  });
});

describe('flattening a pad', () => {
  it('levels the columns either side to the middle one', () => {
    const terrain = createTerrain(40);
    terrain[20] = 50;
    terrain[21] = 12;
    flatten(terrain, 20, 2);
    for (let c = 18; c <= 22; c++) expect(terrain[c]).toBe(50);
  });
});

describe('the save encoding', () => {
  it('round-trips byte for byte', () => {
    const terrain = createTerrain(40);
    for (let c = 0; c < COLUMNS; c++) terrain[c] = (c * 7 + 5) % 110 + GROUND_MIN;
    const restored = decodeTerrain(encodeTerrain(terrain));
    expect(restored).not.toBeNull();
    expect([...(restored as Uint8Array)]).toEqual([...terrain]);
  });

  it('refuses a code of the wrong length instead of padding it', () => {
    expect(decodeTerrain(btoa('short'))).toBeNull();
    expect(decodeTerrain('not base64 at all !!')).toBeNull();
  });
});
