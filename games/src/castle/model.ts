/**
 * Castle — the rules, and nothing else. No DOM, no randomness, no timers.
 *
 * A road winds from the top of the map to the castle gate at the bottom. Beside
 * it are a few stone plots, and the player is handed a fixed set of towers to
 * put on them. Then they press Go, and a wave walks the road. If any enemy
 * reaches the gate the wave is lost.
 *
 * **Plan, then watch.** Kingdom Rush builds during the wave, which makes it a
 * game of thumbs and timing. Here every decision is made before the first enemy
 * moves, and the wave that follows is a pure function of where the towers are.
 * That is what lets the collection's promise survive the genre: a level is a
 * placement puzzle with a finite number of answers, so a solver can check that
 * one of them wins before the level is ever shown.
 *
 * ## Everything is integers
 *
 * Positions along the road are counted in `SUB`ths of a cell, speeds in `SUB`ths
 * per tick, ranges as squared distances in the same units. Nothing here touches
 * a float, so a layout wins or loses identically on every engine forever — the
 * save is a move list, and a move list is only worth storing if replaying it
 * cannot drift. Artillery could not promise that and stores a snapshot instead.
 *
 * ## One tick
 *
 *  1. Enemies due this tick appear at the start of the road.
 *  2. Towers fire, in plot order. Each shoots the enemy furthest along the road
 *     within its range; a cannon's shell also hits everyone near its target.
 *  3. The dead are removed.
 *  4. The living walk. An enemy inside any frost tower's range walks at half
 *     speed. One that reaches the gate ends the wave.
 *
 * Firing before walking is what lets a tower at the very start of the road
 * shoot something on the tick it arrives.
 */

/** Sub-cell resolution of the road. Twelve, so halves, thirds and quarters are exact. */
export const SUB = 12;

export const ARROW = 0;
export const CANNON = 1;
export const FROST = 2;
export const TOWER_KINDS = 3;

export const GRUNT = 0;
export const RUNNER = 1;
export const KNIGHT = 2;
export const FOE_KINDS = 3;

export type TowerKind = 0 | 1 | 2;
export type FoeKind = 0 | 1 | 2;

export interface TowerSpec {
  readonly name: string;
  /** Squared reach from the plot's centre, in SUB units. */
  readonly rangeSq: number;
  /** Ticks between shots. Zero for a tower that does not shoot. */
  readonly reload: number;
  /** Damage per shot against each foe kind. */
  readonly damage: readonly number[];
  /** Squared blast radius around the target. Zero hits the target alone. */
  readonly splashSq: number;
}

/**
 * The three towers, each with one job.
 *
 * Arrows are quick and hit one enemy; armour turns them into a tickle. The
 * cannon is slow and hits a crowd, and does not care about armour. Frost does
 * no damage at all — it buys the other two time, and is worth most where the
 * road passes it twice.
 */
export const TOWERS: readonly TowerSpec[] = [
  { name: 'Arrow', rangeSq: 24 * 24, reload: 3, damage: [2, 2, 1], splashSq: 0 },
  { name: 'Cannon', rangeSq: 21 * 21, reload: 8, damage: [4, 4, 4], splashSq: 13 * 13 },
  { name: 'Frost', rangeSq: 18 * 18, reload: 0, damage: [0, 0, 0], splashSq: 0 },
];

export interface FoeSpec {
  readonly name: string;
  /** SUB units per tick. Halved (rounding down, never below one) in frost. */
  readonly speed: number;
  /** Hit points before the generator scales the wave. */
  readonly hp: number;
}

/**
 * The three enemies, each the answer to a tower.
 *
 * A runner crosses a cannon's reach between two of its shots. A knight shrugs
 * off arrows. A pack of grunts overwhelms a single arrow tower that would have
 * picked them off one at a time.
 */
export const FOES: readonly FoeSpec[] = [
  { name: 'Grunt', speed: 3, hp: 8 },
  { name: 'Runner', speed: 6, hp: 4 },
  { name: 'Knight', speed: 2, hp: 18 },
];

export interface Foe {
  readonly kind: FoeKind;
  readonly hp: number;
  /** The tick it steps onto the road. */
  readonly spawn: number;
}

export interface Level {
  readonly width: number;
  readonly height: number;
  /** Cell indices from the entrance to the gate. Consecutive cells touch. */
  readonly path: readonly number[];
  /** Cell indices where a tower may stand. The order is the firing order. */
  readonly plots: readonly number[];
  /** How many of each tower kind the player is given. */
  readonly towers: readonly number[];
  /** Sorted by spawn tick. */
  readonly wave: readonly Foe[];
}

/** One entry per plot: the tower kind on it, or `EMPTY`. */
export type Layout = number[];
export const EMPTY = -1;

/* ---------------------------------------------------------------- geometry */

export interface Geometry {
  /** The road position at which an enemy has reached the gate. */
  readonly end: number;
  /** A point on the road for each position 0..end, in SUB units. */
  readonly x: Int16Array;
  readonly y: Int16Array;
  /**
   * `cover[plot * TOWER_KINDS + kind][pos]` is 1 when a tower of that kind on
   * that plot reaches that point of the road.
   *
   * Precomputed because the solver runs thousands of waves per level and every
   * one of them asks this question for every tower, every enemy, every tick.
   */
  readonly cover: Uint8Array[];
  /** Road cells each plot reaches, per kind. What a player reads off the map. */
  readonly reach: number[];
}

const geometryCache = new WeakMap<Level, Geometry>();

const centre = (cell: number, width: number): [number, number] => [
  (cell % width) * SUB + SUB / 2,
  Math.floor(cell / width) * SUB + SUB / 2,
];

export function geometry(level: Level): Geometry {
  const cached = geometryCache.get(level);
  if (cached) return cached;

  const { width, path, plots } = level;
  const end = (path.length - 1) * SUB;
  const x = new Int16Array(end + 1);
  const y = new Int16Array(end + 1);

  for (let pos = 0; pos <= end; pos++) {
    const index = Math.floor(pos / SUB);
    const step = pos % SUB;
    const [ax, ay] = centre(path[index] as number, width);
    if (step === 0) {
      x[pos] = ax;
      y[pos] = ay;
      continue;
    }
    // Neighbouring centres differ by exactly SUB along one axis, so the
    // interpolation is a whole number and no rounding is ever involved.
    const [bx, by] = centre(path[index + 1] as number, width);
    x[pos] = ax + Math.sign(bx - ax) * step;
    y[pos] = ay + Math.sign(by - ay) * step;
  }

  const cover: Uint8Array[] = [];
  const reach: number[] = [];
  for (const plot of plots) {
    const [px, py] = centre(plot, width);
    for (let kind = 0; kind < TOWER_KINDS; kind++) {
      const rangeSq = (TOWERS[kind] as TowerSpec).rangeSq;
      const inRange = new Uint8Array(end + 1);
      for (let pos = 0; pos <= end; pos++) {
        const dx = (x[pos] as number) - px;
        const dy = (y[pos] as number) - py;
        if (dx * dx + dy * dy <= rangeSq) inRange[pos] = 1;
      }
      cover.push(inRange);

      let cells = 0;
      for (const cell of path) {
        const [cx, cy] = centre(cell, width);
        if ((cx - px) ** 2 + (cy - py) ** 2 <= rangeSq) cells++;
      }
      reach.push(cells);
    }
  }

  const built: Geometry = { end, x, y, cover, reach };
  geometryCache.set(level, built);
  return built;
}

/** Road cells a tower of this kind would reach from this plot. */
export const reachOf = (level: Level, plot: number, kind: number): number =>
  geometry(level).reach[plot * TOWER_KINDS + kind] as number;

/* -------------------------------------------------------------- simulation */

export interface Shot {
  /** Plot index of the tower that fired. */
  readonly plot: number;
  readonly kind: TowerKind;
  /** Wave index of the target. */
  readonly foe: number;
  /** Where the target stood when hit — so the renderer need not look it up. */
  readonly pos: number;
}

export interface FoeFrame {
  readonly id: number;
  readonly pos: number;
  /** Zero on the tick it dies, then it is gone from the next frame. */
  readonly hp: number;
  readonly slowed: boolean;
}

/** What the board looks like at the end of one tick. Only built when asked. */
export interface Frame {
  readonly foes: readonly FoeFrame[];
  readonly shots: readonly Shot[];
}

export interface Outcome {
  readonly won: boolean;
  readonly ticks: number;
  readonly killed: number;
  /** Wave index of the enemy that reached the gate, or -1. */
  readonly leaked: number;
  /** Furthest any enemy got. How close a winning layout came to losing. */
  readonly closest: number;
  readonly frames?: readonly Frame[];
}

/**
 * Plays the wave against a layout.
 *
 * The hot loop of the whole game: the solver and the difficulty rollouts call
 * this thousands of times per level, so it works on typed arrays and bails on
 * the first leak. Asking for `frames` costs allocation per tick and is only
 * done for the one wave the player actually watches.
 */
export function simulate(level: Level, layout: readonly number[], trace = false): Outcome {
  const geo = geometry(level);
  const { end, cover } = geo;
  const wave = level.wave;
  const count = wave.length;

  const towerPlot: number[] = [];
  const towerKind: number[] = [];
  const cooldown: number[] = [];
  const slow = new Uint8Array(end + 1);
  for (let plot = 0; plot < layout.length; plot++) {
    const kind = layout[plot] as number;
    if (kind === EMPTY) continue;
    if (kind === FROST) {
      const inRange = cover[plot * TOWER_KINDS + FROST] as Uint8Array;
      for (let pos = 0; pos <= end; pos++) if (inRange[pos]) slow[pos] = 1;
      continue;
    }
    towerPlot.push(plot);
    towerKind.push(kind);
    cooldown.push(0);
  }

  const pos = new Int32Array(count);
  const hp = new Int32Array(count);
  let alive: number[] = [];
  let next = 0;
  let killed = 0;
  let closest = 0;
  const frames: Frame[] | undefined = trace ? [] : undefined;

  // Longer than any wave can take: the last enemy spawns, then walks the whole
  // road at the slowest speed there is. A guard, not a rule.
  const lastSpawn = count > 0 ? (wave[count - 1] as Foe).spawn : 0;
  const limit = lastSpawn + end + 8;

  for (let tick = 0; tick <= limit; tick++) {
    while (next < count && (wave[next] as Foe).spawn <= tick) {
      pos[next] = 0;
      hp[next] = (wave[next] as Foe).hp;
      alive.push(next);
      next++;
    }

    const shots: Shot[] | undefined = trace ? [] : undefined;

    for (let t = 0; t < towerPlot.length; t++) {
      if ((cooldown[t] as number) > 0) cooldown[t] = (cooldown[t] as number) - 1;
      if ((cooldown[t] as number) > 0) continue;

      const plot = towerPlot[t] as number;
      const kind = towerKind[t] as number;
      const inRange = cover[plot * TOWER_KINDS + kind] as Uint8Array;

      // Furthest along the road; ties to the earlier spawn, which is the one
      // that has been on the road longer.
      let target = -1;
      let best = -1;
      for (let i = 0; i < alive.length; i++) {
        const id = alive[i] as number;
        if ((hp[id] as number) <= 0) continue;
        const at = pos[id] as number;
        if (inRange[at] && at > best) {
          best = at;
          target = id;
        }
      }
      if (target === -1) continue;

      const spec = TOWERS[kind] as TowerSpec;
      if (spec.splashSq > 0) {
        const tx = geo.x[best] as number;
        const ty = geo.y[best] as number;
        for (let i = 0; i < alive.length; i++) {
          const id = alive[i] as number;
          if ((hp[id] as number) <= 0) continue;
          const at = pos[id] as number;
          const dx = (geo.x[at] as number) - tx;
          const dy = (geo.y[at] as number) - ty;
          if (dx * dx + dy * dy <= spec.splashSq) {
            hp[id] = (hp[id] as number) - (spec.damage[(wave[id] as Foe).kind] as number);
          }
        }
      } else {
        hp[target] = (hp[target] as number) - (spec.damage[(wave[target] as Foe).kind] as number);
      }
      cooldown[t] = spec.reload;
      shots?.push({ plot, kind: kind as TowerKind, foe: target, pos: best });
    }

    // Walk the living. The dead are dropped here, after every tower has had
    // its turn, so two towers can both fire at an enemy that dies this tick —
    // overkill is part of the game, and a cannon is not psychic.
    const walking: number[] = [];
    const foeFrames: FoeFrame[] | undefined = trace ? [] : undefined;
    let leaked = -1;

    for (let i = 0; i < alive.length; i++) {
      const id = alive[i] as number;
      if ((hp[id] as number) <= 0) {
        killed++;
        foeFrames?.push({ id, pos: pos[id] as number, hp: 0, slowed: false });
        continue;
      }
      const at = pos[id] as number;
      const speed = (FOES[(wave[id] as Foe).kind] as FoeSpec).speed;
      const slowed = slow[at] === 1;
      const step = slowed ? Math.max(1, speed >> 1) : speed;
      const to = Math.min(end, at + step);
      pos[id] = to;
      if (to > closest) closest = to;
      foeFrames?.push({ id, pos: to, hp: hp[id] as number, slowed });
      if (to >= end && leaked === -1) leaked = id;
      walking.push(id);
    }
    alive = walking;

    if (frames && foeFrames && shots) frames.push({ foes: foeFrames, shots });

    if (leaked !== -1) {
      return { won: false, ticks: tick + 1, killed, leaked, closest, frames };
    }
    if (next >= count && alive.length === 0) {
      return { won: true, ticks: tick + 1, killed, leaked: -1, closest, frames };
    }
  }

  // Unreachable for a well-formed level: every enemy either dies or walks to
  // the gate within `limit`. Treated as a loss rather than a win, so a bug here
  // can only ever cost a level its solvability, never pass off a broken one.
  return { won: false, ticks: limit, killed, leaked: -1, closest, frames };
}

/* ------------------------------------------------------------------ state */

export interface GameStateCore {
  layout: Layout;
  /** Go has been pressed. The layout is locked and the wave has an outcome. */
  launched: boolean;
}

export const createState = (level: Level): GameStateCore => ({
  layout: level.plots.map(() => EMPTY),
  launched: false,
});

export const cloneState = (state: GameStateCore): GameStateCore => ({
  layout: state.layout.slice(),
  launched: state.launched,
});

/** Towers of each kind not yet on the map. */
export function remaining(level: Level, layout: readonly number[]): number[] {
  const left = level.towers.slice();
  for (const kind of layout) if (kind !== EMPTY) left[kind] = (left[kind] as number) - 1;
  return left;
}

export type Move =
  | { kind: 'place'; plot: number; tower: TowerKind }
  | { kind: 'remove'; plot: number }
  | { kind: 'go' };

export type MoveResult = 'ok' | 'occupied' | 'empty' | 'none-left' | 'launched' | 'bad-plot';

/**
 * Applies a move. Mutates `state`, and only when the answer is 'ok' — a refused
 * tap must leave the position exactly as it found it.
 */
export function applyMove(level: Level, state: GameStateCore, move: Move): MoveResult {
  if (state.launched) return 'launched';
  if (move.kind === 'go') {
    state.launched = true;
    return 'ok';
  }

  if (move.plot < 0 || move.plot >= level.plots.length) return 'bad-plot';
  const current = state.layout[move.plot] as number;

  if (move.kind === 'remove') {
    if (current === EMPTY) return 'empty';
    state.layout[move.plot] = EMPTY;
    return 'ok';
  }

  if (current !== EMPTY) return 'occupied';
  if ((remaining(level, state.layout)[move.tower] as number) <= 0) return 'none-left';
  state.layout[move.plot] = move.tower;
  return 'ok';
}

/* ------------------------------------------------------------ well-formed */

const touches = (a: number, b: number, width: number): boolean => {
  const dx = Math.abs((a % width) - (b % width));
  const dy = Math.abs(Math.floor(a / width) - Math.floor(b / width));
  return dx + dy === 1;
};

/**
 * Structural sanity for a whole level.
 *
 * The road must be a single connected walk from the top row to the bottom row
 * that never brushes against itself — a road that touches itself sideways reads
 * on screen as a junction, and there are no junctions. Plots sit off the road,
 * there are at least as many as towers, and the wave is sorted and alive.
 */
export function isWellFormed(level: Level): boolean {
  const { width, height, path, plots, towers, wave } = level;
  const cells = width * height;
  if (width < 3 || height < 3 || path.length < 4) return false;

  const onPath = new Set<number>();
  for (let i = 0; i < path.length; i++) {
    const cell = path[i] as number;
    if (cell < 0 || cell >= cells || onPath.has(cell)) return false;
    if (i > 0 && !touches(path[i - 1] as number, cell, width)) return false;
    onPath.add(cell);
  }
  if (Math.floor((path[0] as number) / width) !== 0) return false;
  if (Math.floor((path[path.length - 1] as number) / width) !== height - 1) return false;

  // No shortcuts: two road cells side by side must be consecutive on the road.
  for (let i = 0; i < path.length; i++) {
    for (let j = i + 2; j < path.length; j++) {
      if (touches(path[i] as number, path[j] as number, width)) return false;
    }
  }

  const plotSet = new Set<number>();
  for (const plot of plots) {
    if (plot < 0 || plot >= cells || onPath.has(plot) || plotSet.has(plot)) return false;
    plotSet.add(plot);
  }

  if (towers.length !== TOWER_KINDS || towers.some((n) => n < 0 || !Number.isInteger(n))) {
    return false;
  }
  const total = towers.reduce((a, b) => a + b, 0);
  if (total < 1 || total > plots.length) return false;

  if (wave.length === 0) return false;
  for (let i = 0; i < wave.length; i++) {
    const foe = wave[i] as Foe;
    if (foe.hp < 1 || foe.kind < 0 || foe.kind >= FOE_KINDS) return false;
    if (i > 0 && foe.spawn < (wave[i - 1] as Foe).spawn) return false;
  }
  return true;
}

/* -------------------------------------------------------------- save file */

/**
 * Moves pack to one integer: a placement is `plot * 4 + kind`, a removal is
 * `plot * 4 + 3`, and Go is -1. The whole of a level in progress is a handful
 * of small numbers, and the map replays from (profileSeed, level).
 */
export function packMove(move: Move): number {
  if (move.kind === 'go') return -1;
  if (move.kind === 'remove') return move.plot * 4 + 3;
  return move.plot * 4 + move.tower;
}

export function unpackMove(packed: number): Move | null {
  if (packed === -1) return { kind: 'go' };
  if (!Number.isInteger(packed) || packed < 0) return null;
  const plot = Math.floor(packed / 4);
  const low = packed % 4;
  if (low === 3) return { kind: 'remove', plot };
  return { kind: 'place', plot, tower: low as TowerKind };
}
