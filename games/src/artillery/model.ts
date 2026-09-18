/**
 * Match rules. Pure — no DOM, no randomness, no time.
 *
 * **The third two-player game here, and the first one with a position too
 * expensive to replay.** Backgammon and Mancala store a match as the list of
 * moves that made it, and rebuild the board by playing them again. That works
 * because their rules are integer arithmetic: the same moves give the same
 * board on every device, forever.
 *
 * This one is floating-point ballistics. Replaying it would mean trusting that
 * `Math.sin` returns the same double it returned last week, which no engine
 * promises, and the failure would be silent and bizarre — a saved match
 * reopening with the craters in slightly the wrong places. So **a match in
 * progress is saved as its position rather than as its history**, which the
 * heightmap makes cheap: the whole battlefield is 96 bytes, and a complete
 * snapshot fits in about three hundred characters of save code. See `encode`.
 *
 * What that costs is a move list to rewind through, and it costs nothing,
 * because **undo here stops at the trigger** for the reason Backgammon's stops
 * at the handover. Where a shell lands is the unknown in this game; an undo
 * that crossed a shot would let a player fire, read the arc off the screen,
 * take it back and fire again knowing the answer. That is not a kindness, it is
 * free ranging. Moving and aiming are yours to take back for as long as the
 * turn is.
 */

import {
  COLUMNS,
  type Terrain,
  carve,
  cloneTerrain,
  columnCentre,
  decodeTerrain,
  encodeTerrain,
  FIELD_H,
  FIELD_W,
  heap,
  shaft,
} from './terrain';
import { type Flight, type Target, blastDamage, fly, muzzleOf, TURRET_Y } from './physics';
import {
  ARSENAL_SIZE,
  PLAIN_SHELL,
  POOL,
  type Weapon,
  type WeaponKind,
  barrelAngles,
  isWeaponId,
  weaponById,
} from './weapons';

export type Seat = 0 | 1;

export const OTHER: readonly [Seat, Seat] = [1, 0];

export const START_HP = 100;
/** Column steps a tank may take in one turn. About a tenth of the field. */
export const MOVE_BUDGET = 10;
/**
 * The steepest step a tank will take, in height units per column.
 *
 * This is the number that makes a crater matter. Without a climb limit a tank
 * blown into a hole simply drives out of it next turn, and "knock the ground
 * out from under them" stops being a tactic. At 4 units over a 2-unit column a
 * tank manages a rough hillside and refuses a blast wall, which is the line the
 * game is about.
 */
export const MAX_CLIMB = 4;

/** See `openingState`. Tied to `MUZZLE_SPEED`; move it if the ballistics move. */
export const OPENING_POWER = 55;

export const ANGLE_MIN = 0;
export const ANGLE_MAX = 180;
export const POWER_MIN = 10;
export const POWER_MAX = 100;

export interface Tank {
  /** Which column it stands in. Its height is the column's height. */
  col: number;
  hp: number;
  /** Absolute degrees: 0 due right, 90 up, 180 due left. Persists between turns. */
  angle: number;
  power: number;
}

/** A shot's flight path, kept so the next shot can be corrected against it. */
export type Trail = readonly number[];

export interface MatchState {
  terrain: Terrain;
  tanks: [Tank, Tank];
  /** Drafted weapons not yet fired, in draft order. */
  arsenal: [string[], string[]];
  /** The weapon each seat has selected. Always a weapon that seat still holds. */
  chosen: [string, string];
  turn: Seat;
  /**
   * The seat that opened the match. The volley counter advances when the turn
   * comes back round to it, and it is not always seat 0 — see `openingState`.
   */
  first: Seat;
  movesLeft: number;
  /** Both sides having fired once. Shown in the top bar; counts from 1. */
  volley: number;
  /** The last shot each side fired. See the header of `render.ts`. */
  trail: [Trail | null, Trail | null];
}

/* ------------------------------------------------------------------ */
/* Reading a position                                                  */
/* ------------------------------------------------------------------ */

export function groundUnder(terrain: Terrain, col: number): number {
  return terrain[Math.max(0, Math.min(COLUMNS - 1, col))] as number;
}

/** A tank's turret pivot, which is the point shells are measured against. */
export function pivotOf(terrain: Terrain, tank: Tank): { x: number; y: number } {
  return { x: columnCentre(tank.col), y: groundUnder(terrain, tank.col) + TURRET_Y };
}

/** Can the tank on the move take one step this way? */
export function canStep(state: MatchState, dir: -1 | 1): boolean {
  if (state.movesLeft <= 0) return false;
  const tank = state.tanks[state.turn] as Tank;
  const next = tank.col + dir;
  if (next < 0 || next >= COLUMNS) return false;
  if (next === (state.tanks[OTHER[state.turn]] as Tank).col) return false;
  const rise = groundUnder(state.terrain, next) - groundUnder(state.terrain, tank.col);
  return Math.abs(rise) <= MAX_CLIMB;
}

/** Why a refused step was refused. One short line, shown in the status strip. */
export function refusalFor(state: MatchState, dir: -1 | 1): string {
  const tank = state.tanks[state.turn] as Tank;
  const next = tank.col + dir;
  if (state.movesLeft <= 0) return 'Out of moves this turn';
  if (next < 0 || next >= COLUMNS) return 'End of the field';
  if (next === (state.tanks[OTHER[state.turn]] as Tank).col) return 'The other tank is there';
  return 'Too steep to climb';
}

export function winnerOf(state: MatchState): Seat | null {
  const [left, right] = state.tanks;
  if (left.hp > 0 && right.hp <= 0) return 0;
  if (right.hp > 0 && left.hp <= 0) return 1;
  return null;
}

export function isOver(state: MatchState): boolean {
  return state.tanks.some((tank) => tank.hp <= 0);
}

/* ------------------------------------------------------------------ */
/* Changing a position                                                 */
/* ------------------------------------------------------------------ */

function withTank(state: MatchState, seat: Seat, patch: Partial<Tank>): MatchState {
  const tanks = [...state.tanks] as [Tank, Tank];
  tanks[seat] = { ...(tanks[seat] as Tank), ...patch };
  return { ...state, tanks };
}

export function stepTank(state: MatchState, dir: -1 | 1): MatchState | null {
  if (!canStep(state, dir)) return null;
  const tank = state.tanks[state.turn] as Tank;
  return {
    ...withTank(state, state.turn, { col: tank.col + dir }),
    movesLeft: state.movesLeft - 1,
  };
}

/**
 * The same tank, parked somewhere else, with a stated move budget.
 *
 * Only used to rebuild the turn's undo history from a save — see `Restored`.
 * Unchecked on purpose: these are positions the tank has already stood in, so
 * re-asking `canStep` about them would be asking whether the past was legal.
 */
export function atColumn(state: MatchState, seat: Seat, col: number, movesLeft: number): MatchState {
  return { ...withTank(state, seat, { col }), movesLeft };
}

export function setAngle(state: MatchState, angle: number): MatchState {
  const clamped = Math.max(ANGLE_MIN, Math.min(ANGLE_MAX, Math.round(angle)));
  return withTank(state, state.turn, { angle: clamped });
}

export function setPower(state: MatchState, power: number): MatchState {
  const clamped = Math.max(POWER_MIN, Math.min(POWER_MAX, Math.round(power)));
  return withTank(state, state.turn, { power: clamped });
}

/** Selects a weapon the seat on the move actually holds. Anything else is ignored. */
export function chooseWeapon(state: MatchState, id: string): MatchState {
  if (!available(state, state.turn).some((weapon) => weapon.id === id)) return state;
  const chosen = [...state.chosen] as [string, string];
  chosen[state.turn] = id;
  return { ...state, chosen };
}

/** What a seat can fire right now: the plain shell, then its unspent draft. */
export function available(state: MatchState, seat: Seat): Weapon[] {
  return [PLAIN_SHELL, ...(state.arsenal[seat] as string[]).map(weaponById)];
}

/* ------------------------------------------------------------------ */
/* Firing                                                             */
/* ------------------------------------------------------------------ */

/** One blast, in the order it went off. The renderer draws these. */
export interface Burst {
  x: number;
  y: number;
  radius: number;
  kind: WeaponKind;
}

export interface Resolution {
  weapon: Weapon;
  /** One per shell. A cluster is several. */
  flights: Flight[];
  /**
   * One per shell, parallel to `flights`, and null where a shell was a dud.
   *
   * Parallel rather than compacted so the renderer can pair a burst with the
   * arc that caused it. A compacted list read by a running index puts the
   * wrong burst on the wrong shell the first time a cluster loses one shell
   * off the side of the field — which is most Flea Circus shots near an edge.
   */
  bursts: (Burst | null)[];
  /** Life taken from each seat, including from the player who fired. */
  damage: [number, number];
  /** The position once every shell has landed. */
  next: MatchState;
}

/**
 * Fires the selected weapon and resolves every shell of it.
 *
 * Two things here are rules rather than bookkeeping.
 *
 * **Shells of a cluster land one at a time, in order, against the ground the
 * previous one left.** The first shell of a Five Shot can drop a tank two units
 * and the second then passes over its head. That is the behaviour the original
 * has and it is worth keeping, because it is the reason a fan is worth firing
 * into a crater.
 *
 * **A shell that strikes a tank does full damage to it.** Otherwise a direct
 * hit is priced by how far the burst centre ended up from the turret pivot,
 * which for a small-blast weapon like Super Zapper is most of its damage lost
 * to a couple of units nobody can aim away. Everything else in the blast,
 * including the tank that fired it, is priced by distance as usual.
 */
export function resolveShot(state: MatchState): Resolution {
  const seat = state.turn;
  const shooter = state.tanks[seat] as Tank;
  const weapon = weaponById(state.chosen[seat] as string);

  const terrain = cloneTerrain(state.terrain);
  const hp: [number, number] = [state.tanks[0].hp, state.tanks[1].hp];
  const damage: [number, number] = [0, 0];

  const working: MatchState = { ...state, terrain };
  const muzzle = muzzleOf(columnCentre(shooter.col), groundUnder(terrain, shooter.col), shooter.angle);

  const flights: Flight[] = [];
  const bursts: (Burst | null)[] = [];

  for (const angle of barrelAngles(weapon, shooter.angle)) {
    // Recomputed per shell: the tanks move down as the ground under them goes.
    const targets = state.tanks.map((tank, index) => {
      const pivot = pivotOf(terrain, tank);
      return { x: pivot.x, y: pivot.y, alive: (hp[index] as number) > 0 };
    });

    const flight = fly(terrain, muzzle, angle, shooter.power, targets);
    flights.push(flight);
    if (!flight.impact) {
      bursts.push(null);
      continue;
    }

    bursts.push({
      x: flight.impact.x,
      y: flight.impact.y,
      radius: weapon.radius,
      kind: weapon.kind,
    });

    for (let index = 0; index < 2; index++) {
      if ((hp[index] as number) <= 0) continue;
      const target = targets[index] as Target;
      const dealt =
        flight.hit === index
          ? weapon.damage
          : blastDamage(Math.hypot(flight.impact.x - target.x, flight.impact.y - target.y), weapon);
      if (dealt <= 0) continue;
      const taken = Math.min(dealt, hp[index] as number);
      hp[index] = (hp[index] as number) - taken;
      damage[index] = (damage[index] as number) + taken;
    }

    if (weapon.kind === 'dirt') {
      heap(terrain, flight.impact.x, weapon.radius, weapon.fill);
    } else {
      carve(terrain, flight.impact.x, flight.impact.y, weapon.radius, weapon.dig);
      if (weapon.shaft > 0) shaft(terrain, flight.impact.x, weapon.radius * 0.5, weapon.shaft);
    }
  }

  const arsenal = [[...state.arsenal[0]], [...state.arsenal[1]]] as [string[], string[]];
  if (weapon.id !== PLAIN_SHELL.id) {
    arsenal[seat] = (arsenal[seat] as string[]).filter((id) => id !== weapon.id);
  }

  const trail = [...state.trail] as [Trail | null, Trail | null];
  trail[seat] = flights[0]?.path ?? null;

  const tanks = [
    { ...(state.tanks[0] as Tank), hp: hp[0] as number },
    { ...(state.tanks[1] as Tank), hp: hp[1] as number },
  ] as [Tank, Tank];

  const opponent = OTHER[seat];
  const stillHolding = (arsenal[seat] as string[]).includes(state.chosen[seat] as string);
  const chosen = [...state.chosen] as [string, string];
  if (!stillHolding) chosen[seat] = PLAIN_SHELL.id;

  const next: MatchState = {
    ...working,
    terrain,
    tanks,
    arsenal,
    chosen,
    turn: opponent,
    movesLeft: MOVE_BUDGET,
    volley: state.volley + (opponent === state.first ? 1 : 0),
    trail,
  };

  return { weapon, flights, bursts, damage, next };
}

/* ------------------------------------------------------------------ */
/* The draft                                                           */
/* ------------------------------------------------------------------ */

export interface DraftState {
  /** The pool in shop order. Seeded, so both players read the same list. */
  pool: string[];
  /** Who took each weapon, parallel to `pool`. */
  taken: (Seat | null)[];
  /** Whose pick it is. */
  picker: Seat;
  /** The seat that picks first. The other one fires first. */
  first: Seat;
}

/**
 * Whose pick the nth one is, snaking.
 *
 * Strict alternation hands the first picker every better half of the pool, and
 * with one plainly best weapon in it — Big Bertha — that is a coin flip
 * decided before anybody has aimed. Snaking pairs the picks up, so the player
 * who did not open gets two in a row, and the first picker's advantage is one
 * weapon rather than eight. The seat that picks second fires first, which pays
 * the rest of it back.
 */
export function pickerFor(index: number, first: Seat): Seat {
  const pair = (index + 1) >> 1;
  return pair % 2 === 0 ? first : OTHER[first];
}

/**
 * Who picks first, given who fires first — and it is the other one.
 *
 * The two are one decision, so they are one number. Storing both would let a
 * restored save disagree with itself about whose pick it is, which is exactly
 * what the first draft of `decode` did: it rebuilt the draft's turn order from
 * the match's opening seat and handed the pick to the wrong player.
 */
export function firstPickerFor(firstFirer: Seat): Seat {
  return OTHER[firstFirer];
}

export function openingDraft(pool: string[], first: Seat): DraftState {
  return { pool, taken: pool.map(() => null), picker: pickerFor(0, first), first };
}

export function draftPicksMade(draft: DraftState): number {
  return draft.taken.filter((seat) => seat !== null).length;
}

export function draftComplete(draft: DraftState): boolean {
  return draftPicksMade(draft) === draft.pool.length;
}

/** Takes a weapon. Returns null if that one is gone or the index is nonsense. */
export function draftPick(draft: DraftState, index: number): DraftState | null {
  if (index < 0 || index >= draft.pool.length) return null;
  if (draft.taken[index] !== null) return null;

  const taken = [...draft.taken];
  taken[index] = draft.picker;
  const made = draftPicksMade({ ...draft, taken });

  return { ...draft, taken, picker: pickerFor(made, draft.first) };
}

export function arsenalsFrom(draft: DraftState): [string[], string[]] {
  const arsenals: [string[], string[]] = [[], []];
  draft.pool.forEach((id, index) => {
    const seat = draft.taken[index];
    if (seat === null || seat === undefined) return;
    (arsenals[seat] as string[]).push(id);
  });
  return arsenals;
}

/* ------------------------------------------------------------------ */
/* Starting a match                                                    */
/* ------------------------------------------------------------------ */

export interface Opening {
  terrain: Terrain;
  columns: [number, number];
  pool: string[];
}

/**
 * The position both tanks start from.
 *
 * Opening aim is 45 and 135 — straight at each other, at the angle that carries
 * furthest — and 55 power, which is comfortably short of the crossing.
 *
 * **That number is tied to `MUZZLE_SPEED` and was wrong once already.** It was
 * 70, chosen when a crossing shot needed 86; after the muzzle speed was
 * retuned a crossing sits around 67 and 70 sailed clean off the far edge of the
 * field. A first shot that lands visibly short is a much better teacher than
 * one that vanishes, because the correction it asks for can be read off the
 * screen. If the ballistics move again, move this with them.
 */
export function openingState(opening: Opening, arsenals: [string[], string[]], first: Seat): MatchState {
  return {
    terrain: cloneTerrain(opening.terrain),
    tanks: [
      { col: opening.columns[0], hp: START_HP, angle: 45, power: OPENING_POWER },
      { col: opening.columns[1], hp: START_HP, angle: 135, power: OPENING_POWER },
    ],
    arsenal: [[...arsenals[0]], [...arsenals[1]]],
    chosen: [PLAIN_SHELL.id, PLAIN_SHELL.id],
    turn: first,
    first,
    movesLeft: MOVE_BUDGET,
    volley: 1,
    trail: [null, null],
  };
}

/* ------------------------------------------------------------------ */
/* The save                                                            */
/* ------------------------------------------------------------------ */

/**
 * A match on disk.
 *
 * Short keys because this is what the paste-a-code backup in Settings carries,
 * and a base64 of JSON pays for every character twice. The whole thing is about
 * three hundred characters with both trails in it.
 */
export interface Snapshot {
  /** Terrain, base64. */
  t: string;
  /** Per seat: column, life, angle, power. */
  k: [number[], number[]];
  /** Unspent weapons per seat, comma-joined. */
  a: [string, string];
  /** Selected weapon per seat. */
  c: [string, string];
  /** Seat to play. */
  s: Seat;
  /** Seat that opened the match. */
  f: Seat;
  v: number;
  m: number;
  /** Last shot per seat, base64. Null once one has never been fired. */
  r: [string | null, string | null];
  /** Draft in progress: one character per pool entry — '0', '1' or '.'. */
  d?: string;
  /**
   * Columns the tank on the move has already stood in this turn, oldest first,
   * base64 — the undo history.
   *
   * Only the column is stored because it is the only thing a step changes: the
   * move budget at step *i* is always `MOVE_BUDGET - i`. Ten bytes at the very
   * most, and it is what makes a turn atomic across closing the app. Without
   * it, moving, putting the phone down and picking it up again left a player
   * looking at a move they could no longer take back.
   */
  p?: string;
}

/** Path points kept in the save. Enough to read the arc, not enough to notice. */
const TRAIL_POINTS = 20;

function encodeTrail(trail: Trail | null): string | null {
  if (!trail || trail.length < 4) return null;
  const points = trail.length / 2;
  const stride = Math.max(1, Math.floor(points / TRAIL_POINTS));
  let binary = '';
  for (let i = 0; i < points; i += stride) {
    const x = trail[i * 2] as number;
    const y = trail[i * 2 + 1] as number;
    // y is scaled against twice the field height, because a high lob spends
    // most of its flight above the visible field and the arc is the point.
    binary += String.fromCharCode(
      Math.max(0, Math.min(255, Math.round((x / FIELD_W) * 255))),
      Math.max(0, Math.min(255, Math.round((y / (FIELD_H * 2)) * 255))),
    );
  }
  return btoa(binary);
}

function decodeTrail(code: string | null): Trail | null {
  if (!code) return null;
  try {
    const binary = atob(code);
    const out: number[] = [];
    for (let i = 0; i + 1 < binary.length; i += 2) {
      out.push((binary.charCodeAt(i) / 255) * FIELD_W, (binary.charCodeAt(i + 1) / 255) * FIELD_H * 2);
    }
    return out.length >= 4 ? out : null;
  } catch {
    return null;
  }
}

function encodeColumns(columns: readonly number[]): string {
  let binary = '';
  for (const column of columns) binary += String.fromCharCode(Math.max(0, Math.min(255, column)));
  return btoa(binary);
}

export function encode(
  state: MatchState,
  draft: DraftState | null,
  history: readonly number[] = [],
): Snapshot {
  const snapshot: Snapshot = {
    t: encodeTerrain(state.terrain),
    k: state.tanks.map((tank) => [tank.col, tank.hp, tank.angle, tank.power]) as [number[], number[]],
    a: [state.arsenal[0].join(','), state.arsenal[1].join(',')],
    c: [state.chosen[0] as string, state.chosen[1] as string],
    s: state.turn,
    f: state.first,
    v: state.volley,
    m: state.movesLeft,
    r: [encodeTrail(state.trail[0]), encodeTrail(state.trail[1])],
  };
  if (draft && !draftComplete(draft)) {
    snapshot.d = draft.taken.map((seat) => (seat === null ? '.' : String(seat))).join('');
  }
  if (history.length > 0) snapshot.p = encodeColumns(history);
  return snapshot;
}

export interface Restored {
  state: MatchState;
  draft: DraftState | null;
  /** Columns the tank on the move has stood in this turn, oldest first. */
  history: number[];
}

/**
 * Rebuilds a match from disk against the battlefield the seed generates.
 *
 * `opening` is regenerated rather than stored, so anything the snapshot
 * disagrees with — a terrain of the wrong length, a weapon this build dropped,
 * a column off the field — makes the whole snapshot unusable rather than
 * half-applied. A match that cannot be restored is a match that starts again;
 * a match restored wrong is a bug report nobody can read.
 */
export function decode(snapshot: unknown, opening: Opening, matchFirst: Seat): Restored | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const raw = snapshot as Partial<Snapshot>;

  const terrain = typeof raw.t === 'string' ? decodeTerrain(raw.t) : null;
  if (!terrain) return null;
  if (!Array.isArray(raw.k) || raw.k.length !== 2) return null;

  const seats: Seat[] = [0, 1];
  const tanks = seats.map((seat) => {
    const values = raw.k?.[seat];
    if (!Array.isArray(values) || values.length !== 4) return null;
    const [col, hp, angle, power] = values.map(Number);
    if (![col, hp, angle, power].every(Number.isFinite)) return null;
    if ((col as number) < 0 || (col as number) >= COLUMNS) return null;
    return {
      col: Math.floor(col as number),
      hp: Math.max(0, Math.min(START_HP, Math.floor(hp as number))),
      angle: Math.max(ANGLE_MIN, Math.min(ANGLE_MAX, Math.round(angle as number))),
      power: Math.max(POWER_MIN, Math.min(POWER_MAX, Math.round(power as number))),
    } satisfies Tank;
  });
  if (tanks.some((tank) => tank === null)) return null;

  const poolIds = new Set(opening.pool);
  const arsenal = seats.map((seat) => {
    const list = raw.a?.[seat];
    if (typeof list !== 'string') return null;
    const ids = list ? list.split(',') : [];
    return ids.every((id) => poolIds.has(id)) ? ids : null;
  });
  if (arsenal.some((list) => list === null)) return null;

  const chosen = seats.map((seat) => {
    const id = raw.c?.[seat];
    return typeof id === 'string' && isWeaponId(id) ? id : PLAIN_SHELL.id;
  }) as [string, string];

  const turn: Seat = raw.s === 1 ? 1 : 0;
  const first: Seat = raw.f === 1 ? 1 : raw.f === 0 ? 0 : matchFirst;

  const state: MatchState = {
    terrain,
    tanks: tanks as [Tank, Tank],
    arsenal: arsenal as [string[], string[]],
    chosen,
    turn,
    first,
    movesLeft: Number.isFinite(Number(raw.m))
      ? Math.max(0, Math.min(MOVE_BUDGET, Math.floor(Number(raw.m))))
      : MOVE_BUDGET,
    volley: Number.isFinite(Number(raw.v)) ? Math.max(1, Math.floor(Number(raw.v))) : 1,
    trail: [decodeTrail(raw.r?.[0] ?? null), decodeTrail(raw.r?.[1] ?? null)],
  };

  // Anything the player cannot fire is corrected rather than rejected: a
  // selected weapon is a preference, not a position.
  for (const seat of seats) {
    if (!available(state, seat).some((weapon) => weapon.id === state.chosen[seat])) {
      state.chosen[seat] = PLAIN_SHELL.id;
    }
  }

  let draft: DraftState | null = null;
  if (typeof raw.d === 'string' && raw.d.length === opening.pool.length) {
    const taken = [...raw.d].map((mark) => (mark === '0' ? 0 : mark === '1' ? 1 : null)) as (Seat | null)[];
    const made = taken.filter((seat) => seat !== null).length;
    const picker = firstPickerFor(first);
    draft = { pool: opening.pool, taken, picker: pickerFor(made, picker), first: picker };
  }

  const history: number[] = [];
  if (typeof raw.p === 'string' && raw.p) {
    try {
      const binary = atob(raw.p);
      for (let i = 0; i < binary.length && i < MOVE_BUDGET; i++) {
        const column = binary.charCodeAt(i);
        if (column >= 0 && column < COLUMNS) history.push(column);
      }
    } catch {
      // A history that will not decode is dropped rather than refused: it costs
      // an undo, where refusing the snapshot would cost the whole match.
    }
  }

  return { state, draft, history };
}

/** Every weapon id the pool can contain, for the tests and the shop. */
export const POOL_IDS: readonly string[] = POOL.map((weapon) => weapon.id);

export { ARSENAL_SIZE };
