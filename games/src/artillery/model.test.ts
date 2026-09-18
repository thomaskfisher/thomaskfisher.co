import { describe, expect, it } from 'vitest';

import {
  COLUMNS,
  type Terrain,
  columnCentre,
  createTerrain,
  encodeTerrain,
} from './terrain';
import { TURRET_Y } from './physics';
import { ARSENAL_SIZE, PLAIN_SHELL, POOL, weaponById } from './weapons';
import {
  MAX_CLIMB,
  MOVE_BUDGET,
  type MatchState,
  type Opening,
  type Restored,
  type Seat,
  POOL_IDS,
  START_HP,
  arsenalsFrom,
  atColumn,
  available,
  canStep,
  chooseWeapon,
  decode,
  draftComplete,
  draftPick,
  encode,
  isOver,
  openingDraft,
  openingState,
  pickerFor,
  refusalFor,
  resolveShot,
  setAngle,
  setPower,
  stepTank,
  winnerOf,
} from './model';

const GROUND = 40;

function openingOn(terrain: Terrain, columns: [number, number]): Opening {
  return { terrain, columns, pool: [...POOL_IDS] };
}

function match(
  options: {
    terrain?: Terrain;
    columns?: [number, number];
    arsenals?: [string[], string[]];
    first?: Seat;
  } = {},
): MatchState {
  const terrain = options.terrain ?? createTerrain(GROUND);
  const columns = options.columns ?? [8, 88];
  const arsenals = options.arsenals ?? [[], []];
  return openingState(openingOn(terrain, columns), arsenals, options.first ?? 0);
}

/** Finds a power that puts the seat's shot on the other tank. */
function rangeIn(state: MatchState, angle = 45): number {
  for (let power = 20; power <= 100; power++) {
    const aimed = setPower(setAngle(state, angle), power);
    if (resolveShot(aimed).flights[0]?.hit === 1) return power;
  }
  throw new Error('no power connected');
}

/* ------------------------------------------------------------------ */

describe('moving a tank', () => {
  it('spends one move per column and stops when the budget is gone', () => {
    let state = match();
    expect(state.movesLeft).toBe(MOVE_BUDGET);

    for (let i = 0; i < MOVE_BUDGET; i++) {
      const next = stepTank(state, 1);
      expect(next).not.toBeNull();
      state = next as MatchState;
    }

    expect(state.tanks[0].col).toBe(8 + MOVE_BUDGET);
    expect(state.movesLeft).toBe(0);
    expect(stepTank(state, 1)).toBeNull();
    expect(refusalFor(state, 1)).toBe('Out of moves this turn');
  });

  it('refuses a step too steep to climb', () => {
    const terrain = createTerrain(GROUND);
    terrain[9] = GROUND + MAX_CLIMB + 1;
    const state = match({ terrain });
    expect(canStep(state, 1)).toBe(false);
    expect(refusalFor(state, 1)).toBe('Too steep to climb');
    // The same drop the other way is refused too: a tank does not jump off a
    // cliff any more than it climbs one.
    terrain[9] = GROUND;
    terrain[7] = GROUND - MAX_CLIMB - 1;
    expect(canStep(match({ terrain }), -1)).toBe(false);
  });

  it('allows a step exactly at the climb limit', () => {
    const terrain = createTerrain(GROUND);
    terrain[9] = GROUND + MAX_CLIMB;
    expect(canStep(match({ terrain }), 1)).toBe(true);
  });

  it('stops at the edge of the field and at the other tank', () => {
    expect(canStep(match({ columns: [0, 88] }), -1)).toBe(false);
    expect(refusalFor(match({ columns: [0, 88] }), -1)).toBe('End of the field');

    const adjacent = match({ columns: [40, 41] });
    expect(canStep(adjacent, 1)).toBe(false);
    expect(refusalFor(adjacent, 1)).toBe('The other tank is there');
  });

  it('is the tank on the move that moves, not seat zero', () => {
    const state = { ...match(), turn: 1 as Seat };
    const next = stepTank(state, -1) as MatchState;
    expect(next.tanks[1].col).toBe(87);
    expect(next.tanks[0].col).toBe(8);
  });
});

describe('aiming', () => {
  it('clamps to the dial the controls can express', () => {
    const state = match();
    expect(setAngle(state, -30).tanks[0].angle).toBe(0);
    expect(setAngle(state, 900).tanks[0].angle).toBe(180);
    expect(setPower(state, 0).tanks[0].power).toBe(10);
    expect(setPower(state, 400).tanks[0].power).toBe(100);
  });

  it('is remembered per seat between turns', () => {
    const state = setAngle(setPower(match(), 55), 62);
    expect(state.tanks[0].angle).toBe(62);
    // The other seat's dial is untouched.
    expect(state.tanks[1].angle).toBe(135);
  });
});

describe('the arsenal', () => {
  it('always offers the plain shell, then what is left of the draft', () => {
    const state = match({ arsenals: [['bertha', 'digger'], []] });
    expect(available(state, 0).map((weapon) => weapon.id)).toEqual([
      PLAIN_SHELL.id,
      'bertha',
      'digger',
    ]);
    expect(available(state, 1).map((weapon) => weapon.id)).toEqual([PLAIN_SHELL.id]);
  });

  it('ignores a selection the seat does not hold', () => {
    const state = match({ arsenals: [['bertha'], []] });
    expect(chooseWeapon(state, 'bertha').chosen[0]).toBe('bertha');
    expect(chooseWeapon(state, 'zapper').chosen[0]).toBe(PLAIN_SHELL.id);
  });
});

describe('firing', () => {
  it('leaves the position it was given alone', () => {
    const state = match({ arsenals: [['crater'], []] });
    const before = encodeTerrain(state.terrain);
    const aimed = setPower(setAngle(chooseWeapon(state, 'crater'), 45), 70);
    resolveShot(aimed);
    expect(encodeTerrain(state.terrain)).toBe(before);
    expect(state.tanks[0].hp).toBe(START_HP);
  });

  it('spends a drafted weapon and falls back to the plain shell', () => {
    const state = chooseWeapon(match({ arsenals: [['bertha'], []] }), 'bertha');
    const { next } = resolveShot(setPower(state, 70));
    expect(next.arsenal[0]).toEqual([]);
    expect(next.chosen[0]).toBe(PLAIN_SHELL.id);
  });

  it('never spends the plain shell', () => {
    const state = match({ arsenals: [['bertha'], []] });
    const { next } = resolveShot(state);
    expect(next.arsenal[0]).toEqual(['bertha']);
    expect(next.chosen[0]).toBe(PLAIN_SHELL.id);
  });

  it('hands the turn over with a full move budget', () => {
    const moved = stepTank(match(), 1) as MatchState;
    const { next } = resolveShot(moved);
    expect(next.turn).toBe(1);
    expect(next.movesLeft).toBe(MOVE_BUDGET);
    expect(moved.movesLeft).toBe(MOVE_BUDGET - 1);
  });

  it('counts a volley when the turn comes back round to whoever opened', () => {
    const first: Seat = 1;
    let state = match({ first });
    expect(state.volley).toBe(1);

    state = resolveShot(state).next;
    expect(state.volley).toBe(1);
    expect(state.turn).toBe(0);

    state = resolveShot(state).next;
    expect(state.volley).toBe(2);
    expect(state.turn).toBe(1);
  });

  it('does full damage on a direct strike, whatever the falloff would say', () => {
    // Super Zapper's blast is six units across, so a strike anywhere on the
    // four-unit hit circle would otherwise be priced at about half.
    const base = chooseWeapon(match({ arsenals: [['zapper'], []] }), 'zapper');
    const power = rangeIn(base);
    const resolution = resolveShot(setPower(setAngle(base, 45), power));
    expect(resolution.flights[0]?.hit).toBe(1);
    expect(resolution.damage[1]).toBe(weaponById('zapper').damage);
    expect(resolution.next.tanks[1].hp).toBe(START_HP - weaponById('zapper').damage);
  });

  it('fires one shell per barrel of a cluster', () => {
    const state = chooseWeapon(match({ arsenals: [['hailstorm'], []] }), 'hailstorm');
    const resolution = resolveShot(setPower(state, 70));
    expect(resolution.flights).toHaveLength(weaponById('hailstorm').shots);
  });

  it('moves dirt and does no damage with a dirt weapon', () => {
    const base = chooseWeapon(match({ arsenals: [['dirtball'], []] }), 'dirtball');
    const power = rangeIn(base);
    const resolution = resolveShot(setPower(setAngle(base, 45), power));
    expect(resolution.damage).toEqual([0, 0]);
    // The ground where it landed is higher than it was.
    const landed = resolution.bursts[0];
    expect(landed).toBeDefined();
    const column = Math.floor((landed as { x: number }).x / 2);
    expect(resolution.next.terrain[column]).toBeGreaterThan(GROUND);
  });

  it('sinks a shaft with a digger, deeper than its blast alone', () => {
    const plain = resolveShot(setPower(setAngle(match(), 45), 70));
    const digger = chooseWeapon(match({ arsenals: [['digger'], []] }), 'digger');
    const dug = resolveShot(setPower(setAngle(digger, 45), 70));

    const lowest = (shot: { next: MatchState }) => Math.min(...shot.next.terrain);
    expect(lowest(dug)).toBeLessThan(lowest(plain));
  });

  it('hurts the tank that fired when the shell comes back down on it', () => {
    const state = setPower(setAngle(match(), 90), 20);
    const resolution = resolveShot(state);
    expect(resolution.damage[0]).toBeGreaterThan(0);
    expect(resolution.next.tanks[0].hp).toBeLessThan(START_HP);
  });

  it('is a dud off the side of the field: no burst, no damage, no digging', () => {
    const state = setPower(setAngle(match({ columns: [88, 8] }), 20), 100);
    const flat = { ...state, turn: 0 as Seat };
    const resolution = resolveShot(flat);
    expect(resolution.flights[0]?.impact).toBeNull();
    expect(resolution.bursts).toEqual([null]);
    expect(resolution.damage).toEqual([0, 0]);
    expect(encodeTerrain(resolution.next.terrain)).toBe(encodeTerrain(state.terrain));
  });

  it('takes life to zero and no further', () => {
    const base = chooseWeapon(match({ arsenals: [['zapper'], []] }), 'zapper');
    const power = rangeIn(base);
    let state = setPower(setAngle(base, 45), power);
    state = { ...state, tanks: [state.tanks[0], { ...state.tanks[1], hp: 10 }] };

    const resolution = resolveShot(state);
    expect(resolution.damage[1]).toBe(10);
    expect(resolution.next.tanks[1].hp).toBe(0);
    expect(isOver(resolution.next)).toBe(true);
    expect(winnerOf(resolution.next)).toBe(0);
  });

  it('is a draw when one shot finishes both tanks', () => {
    const state = match();
    const both: MatchState = {
      ...state,
      tanks: [
        { ...state.tanks[0], hp: 0 },
        { ...state.tanks[1], hp: 0 },
      ],
    };
    expect(isOver(both)).toBe(true);
    expect(winnerOf(both)).toBeNull();
  });

  it('records the shot it just fired as the trail for that seat', () => {
    const state = match();
    const { next } = resolveShot(setPower(setAngle(state, 45), 70));
    expect(next.trail[0]?.length ?? 0).toBeGreaterThan(8);
    expect(next.trail[1]).toBeNull();
  });
});

describe('the draft', () => {
  it('snakes, so the player who did not open picks twice in a row', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((index) => pickerFor(index, 0))).toEqual([
      0, 1, 1, 0, 0, 1, 1, 0,
    ]);
    expect([0, 1, 2, 3].map((index) => pickerFor(index, 1))).toEqual([1, 0, 0, 1]);
  });

  it('hands each side half the pool', () => {
    let draft = openingDraft([...POOL_IDS], 0);
    while (!draftComplete(draft)) {
      const index = draft.taken.findIndex((seat) => seat === null);
      draft = draftPick(draft, index) as typeof draft;
    }

    const arsenals = arsenalsFrom(draft);
    expect(arsenals[0]).toHaveLength(ARSENAL_SIZE);
    expect(arsenals[1]).toHaveLength(ARSENAL_SIZE);
    expect([...arsenals[0], ...arsenals[1]].sort()).toEqual([...POOL_IDS].sort());
  });

  it('refuses a weapon already taken, and an index off the list', () => {
    const draft = draftPick(openingDraft([...POOL_IDS], 0), 3) as ReturnType<typeof openingDraft>;
    expect(draftPick(draft, 3)).toBeNull();
    expect(draftPick(draft, -1)).toBeNull();
    expect(draftPick(draft, POOL.length)).toBeNull();
  });
});

describe('the save', () => {
  it('round-trips a match in progress exactly', () => {
    const opening = openingOn(createTerrain(GROUND), [8, 88]);
    let state = openingState(opening, [['bertha', 'digger'], ['zapper']], 0);
    state = setPower(setAngle(chooseWeapon(state, 'bertha'), 61), 44);
    state = stepTank(state, 1) as MatchState;
    state = resolveShot(state).next;

    const restored = decode(encode(state, null), opening, 0);
    expect(restored).not.toBeNull();
    const after = (restored as { state: MatchState }).state;

    expect(encodeTerrain(after.terrain)).toBe(encodeTerrain(state.terrain));
    expect(after.tanks).toEqual(state.tanks);
    expect(after.arsenal).toEqual(state.arsenal);
    expect(after.chosen).toEqual(state.chosen);
    expect(after.turn).toBe(state.turn);
    expect(after.first).toBe(state.first);
    expect(after.volley).toBe(state.volley);
    expect(after.movesLeft).toBe(state.movesLeft);
    // The trail is lossy on purpose — it is only ever drawn — but it survives.
    expect(after.trail[0]?.length ?? 0).toBeGreaterThan(8);
  });

  it("carries the turn's undo history, so a reload does not spend it", () => {
    const opening = openingOn(createTerrain(GROUND), [8, 88]);
    const start = openingState(opening, [[], []], 0);
    // Right two, then back one: a net move of one over three steps, which is
    // the case a monotonic reconstruction would get wrong.
    let state = stepTank(start, 1) as MatchState;
    state = stepTank(state, 1) as MatchState;
    state = stepTank(state, -1) as MatchState;

    const history = [8, 9, 10];
    const restored = decode(encode(state, null, history), opening, 0);
    expect(restored).not.toBeNull();
    expect((restored as Restored).history).toEqual(history);

    // Rebuilt, the stack unwinds to exactly the positions that were visited.
    const rebuilt = history.map((col, index) =>
      atColumn((restored as Restored).state, 0, col, MOVE_BUDGET - index),
    );
    expect(rebuilt.map((entry) => [entry.tanks[0].col, entry.movesLeft])).toEqual([
      [8, 10],
      [9, 9],
      [10, 8],
    ]);
    expect(state.tanks[0].col).toBe(9);
    expect(state.movesLeft).toBe(MOVE_BUDGET - 3);
  });

  it('drops a history it cannot read rather than refusing the match', () => {
    const opening = openingOn(createTerrain(GROUND), [8, 88]);
    const good = encode(openingState(opening, [[], []], 0), null, [8]);
    const restored = decode({ ...good, p: 'not base64 !!' }, opening, 0);
    expect(restored).not.toBeNull();
    expect((restored as Restored).history).toEqual([]);
  });

  it('round-trips a draft in progress', () => {
    const opening = openingOn(createTerrain(GROUND), [8, 88]);
    let draft = openingDraft(opening.pool, 1);
    draft = draftPick(draft, 0) as typeof draft;
    draft = draftPick(draft, 5) as typeof draft;

    const state = openingState(opening, arsenalsFrom(draft), 0);
    const restored = decode(encode(state, draft), opening, 1);
    expect(restored).not.toBeNull();
    const after = (restored as { draft: typeof draft }).draft;
    expect(after.taken).toEqual(draft.taken);
    expect(after.picker).toBe(draft.picker);
  });

  it('leaves the draft out once it is finished', () => {
    const opening = openingOn(createTerrain(GROUND), [8, 88]);
    let draft = openingDraft(opening.pool, 0);
    while (!draftComplete(draft)) {
      draft = draftPick(draft, draft.taken.findIndex((seat) => seat === null)) as typeof draft;
    }
    const state = openingState(opening, arsenalsFrom(draft), 0);
    expect(encode(state, draft).d).toBeUndefined();
  });

  it('fits in a save code worth pasting', () => {
    const opening = openingOn(createTerrain(GROUND), [8, 88]);
    let state = openingState(opening, [[...POOL_IDS.slice(0, 8)], [...POOL_IDS.slice(8)]], 0);
    state = resolveShot(state).next;
    state = resolveShot(state).next;
    expect(JSON.stringify(encode(state, null)).length).toBeLessThan(900);
  });

  it('refuses a snapshot it cannot trust rather than half-applying it', () => {
    const opening = openingOn(createTerrain(GROUND), [8, 88]);
    const good = encode(openingState(opening, [[], []], 0), null);

    expect(decode(null, opening, 0)).toBeNull();
    expect(decode({ ...good, t: 'nonsense' }, opening, 0)).toBeNull();
    expect(decode({ ...good, k: [[1, 2, 3, 4]] }, opening, 0)).toBeNull();
    expect(decode({ ...good, k: [[COLUMNS + 5, 50, 45, 70], [88, 50, 135, 70]] }, opening, 0)).toBeNull();
    // A weapon this build no longer has is a save from another version.
    expect(decode({ ...good, a: ['flamethrower', ''] }, opening, 0)).toBeNull();
  });

  it('corrects a selected weapon it cannot honour instead of refusing the match', () => {
    const opening = openingOn(createTerrain(GROUND), [8, 88]);
    const good = encode(openingState(opening, [['bertha'], []], 0), null);
    const restored = decode({ ...good, c: ['digger', 'plain'] }, opening, 0);
    expect(restored).not.toBeNull();
    expect((restored as { state: MatchState }).state.chosen[0]).toBe(PLAIN_SHELL.id);
  });
});

describe('the opening position', () => {
  it('starts both tanks on full life, pointed at each other', () => {
    const state = match();
    expect(state.tanks.map((tank) => tank.hp)).toEqual([START_HP, START_HP]);
    expect(state.tanks[0].angle).toBe(45);
    expect(state.tanks[1].angle).toBe(135);
    expect(isOver(state)).toBe(false);
  });

  /**
   * The opening shot has to land on the field, not off the end of it. This is
   * the assertion that would have caught `OPENING_POWER` being left at 70 when
   * the muzzle speed changed under it.
   */
  it('opens with a shot that falls short rather than one that leaves the field', () => {
    for (let column = 4; column <= 14; column++) {
      const state = match({ columns: [column, 88] });
      const resolution = resolveShot(state);
      const impact = resolution.flights[0]?.impact;
      expect(impact, `from column ${column}`).not.toBeNull();
      // Short of the other tank, so the correction asked for is "more power".
      expect((impact as { x: number }).x).toBeLessThan(columnCentre(88));
    }
  });

  it('puts each tank on the ground of its own column', () => {
    const terrain = createTerrain(GROUND);
    terrain[88] = 70;
    const state = match({ terrain });
    expect(state.terrain[state.tanks[1].col]).toBe(70);
    expect(columnCentre(state.tanks[1].col) + TURRET_Y).toBeGreaterThan(0);
  });
});
