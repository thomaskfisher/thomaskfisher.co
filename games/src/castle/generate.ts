/**
 * Level generation for Castle.
 *
 * A level is built in three parts and then *tuned*, rather than dealt and
 * hoped over.
 *
 *  1. **The road.** A self-avoiding walk from the top row to the bottom row that
 *     never brushes against itself, so it reads as one road with no junctions.
 *  2. **The plots.** Cells beside the road, chosen with a bias towards the ones
 *     that see a lot of it — the inside of a hairpin sees both legs — but never
 *     only those, because a map where every plot is good has no decision in it.
 *  3. **The wave.** Groups of one kind of enemy each, so the preview reads as
 *     "four grunts, then two knights" rather than as a soup.
 *
 * Then the wave's strength is climbed. Every layout of the towers is played at
 * a gentle strength, the winners are kept, and hit points go up a step at a
 * time: the winners are re-checked, and a fixed sample of naive layouts is
 * re-played to measure how many of *them* now lose. The first strength whose
 * difficulty lands in the curve's band ships, provided a winner survives it.
 *
 * That makes the solver's guarantee structural rather than lucky: a strength is
 * never accepted without a layout that has been played and seen to win at it.
 * The solver is then run once more on the finished level anyway, because that
 * is the promise the collection is built on and it costs almost nothing to
 * keep.
 */

import { type LevelPressure, pressureForLevel } from '../shared/difficulty';
import { type Rng, createRng, hashSeed } from '../shared/rng';
import {
  type Foe,
  type FoeKind,
  type Layout,
  type Level,
  EMPTY,
  type FoeSpec,
  FOES,
  GRUNT,
  KNIGHT,
  RUNNER,
  isWellFormed,
  reachOf,
  simulate,
} from './model';
import { forEachCompletion, search } from './solve';

export interface LevelShape {
  width: number;
  height: number;
  minPath: number;
  maxPath: number;
  /** Towers handed over, per kind: arrow, cannon, frost. */
  towers: [number, number, number];
  /** Plots beyond one per tower. The sharpest lever: every spare is a wrong answer. */
  spare: number;
  foes: number;
  /** Relative weights of grunt, runner, knight. */
  mix: [number, number, number];
  /** Largest group of one kind. Bigger groups are what cannons are for. */
  groupMax: number;
}

export interface GeneratedLevel extends Level {
  level: number;
  shape: LevelShape;
  /** 0..1, measured from naive layouts. */
  difficulty: number;
  /** Share of naive layouts that lose. */
  trap: number;
  /** Hit points as a percentage of the enemies' base. */
  strength: number;
  attempts: number;
}

const MAX_ATTEMPTS = 14;
/** Past this many layouts a board is too slow to enumerate on a phone. */
const MAX_LAYOUTS = 9_000;
const ROLLOUTS = 40;
/** Winners kept through the climb, best margin first. */
const KEEP_WINNERS = 120;
const START_STRENGTH = 55;
const STRENGTH_STEP = 1.08;
const MAX_STRENGTH = 900;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/* ------------------------------------------------------------------ shape */

/**
 * The levers, staggered along the curve.
 *
 * Kinds arrive one at a time and each one is introduced before it is combined
 * with the next: arrows and cannons against grunts first, then runners, then
 * frost, then knights. A level that shows the player three new things at once
 * teaches none of them.
 */
export function shapeFor(pressure: LevelPressure, rng: Rng): LevelShape {
  const p = pressure.pressure;

  const towers: [number, number, number] =
    p < 0.36
      ? [2, 1, 0]
      : p < 0.62
        ? [2, 1, 1]
        : p < 0.82
          ? rng.chance(0.5)
            ? [1, 2, 1]
            : [2, 1, 1]
          : [2, 2, 1];

  const spare = clamp(2 + Math.round((p - 0.2) * 3.6), 2, 5);

  const mix: [number, number, number] = [
    1,
    p < 0.3 ? 0 : 0.45 + p * 0.2,
    p < 0.44 ? 0 : 0.3 + p * 0.3,
  ];

  return {
    width: 7,
    height: 9,
    minPath: 19,
    maxPath: 27,
    towers,
    spare,
    foes: 8 + Math.round(p * 8),
    mix,
    groupMax: p < 0.5 ? 3 : 5,
  };
}

/* ------------------------------------------------------------------- road */

/**
 * A winding road from a random column of the top row to the bottom row.
 *
 * Depth-first with backtracking, and two rules that make it a road rather than
 * a scribble: it never runs beside itself (a cell may touch no road cell but
 * the one it came from), and the top and bottom rows hold only its two ends, so
 * where the enemies come in and where the castle is are never in doubt.
 */
function makePath(shape: LevelShape, rng: Rng): number[] | null {
  const { width: w, height: h, minPath, maxPath } = shape;
  const on = new Uint8Array(w * h);
  const start = rng.range(1, w - 2);
  const path = [start];
  on[start] = 1;
  let nodes = 0;

  const neighbours = (cell: number): number[] => {
    const x = cell % w;
    const y = Math.floor(cell / w);
    const out: number[] = [];
    if (y > 0) out.push(cell - w);
    if (y < h - 1) out.push(cell + w);
    if (x > 0) out.push(cell - 1);
    if (x < w - 1) out.push(cell + 1);
    return out;
  };

  const open = (cell: number, head: number): boolean => {
    if (on[cell]) return false;
    const y = Math.floor(cell / w);
    if (y === 0) return false;
    for (const n of neighbours(cell)) if (on[n] && n !== head) return false;
    return true;
  };

  const walk = (): boolean => {
    if (++nodes > 6_000) return false;
    const head = path[path.length - 1] as number;
    const row = Math.floor(head / w);
    if (row === h - 1) return path.length >= minPath;
    if (path.length + (h - 1 - row) > maxPath) return false;

    const options = rng.shuffle(neighbours(head));
    for (const cell of options) {
      if (!open(cell, head)) continue;
      // The bottom row is the gate. Arriving early is a short road.
      if (Math.floor(cell / w) === h - 1 && path.length + 1 < minPath) continue;
      path.push(cell);
      on[cell] = 1;
      if (walk()) return true;
      path.pop();
      on[cell] = 0;
    }
    return false;
  };

  return walk() ? path : null;
}

/* ------------------------------------------------------------------ plots */

/**
 * Where towers may stand.
 *
 * Every candidate sees some road. The pick is weighted towards the plots that
 * see the most of it, but only weighted — the level wants a couple of plots
 * that look tempting and are not, and a couple that look modest and are the
 * answer. No two plots share an edge, so every plot is its own tap target.
 */
function pickPlots(shape: LevelShape, path: readonly number[], count: number, rng: Rng): number[] | null {
  const { width: w, height: h } = shape;
  const onPath = new Set(path);

  const candidates: { cell: number; score: number }[] = [];
  for (let cell = 0; cell < w * h; cell++) {
    if (onPath.has(cell)) continue;
    const x = cell % w;
    const y = Math.floor(cell / w);
    let near = 0;
    let far = 0;
    for (const road of path) {
      const dx = (road % w) - x;
      const dy = Math.floor(road / w) - y;
      const d = dx * dx + dy * dy;
      if (d <= 2) near++;
      if (d <= 4) far++;
    }
    if (near === 0) continue;
    candidates.push({ cell, score: near * 2 + far });
  }

  const chosen: number[] = [];
  const taken = new Set<number>();
  while (chosen.length < count) {
    const open = candidates.filter(({ cell }) => {
      if (taken.has(cell)) return false;
      for (const other of chosen) {
        const dx = Math.abs((other % w) - (cell % w));
        const dy = Math.abs(Math.floor(other / w) - Math.floor(cell / w));
        if (dx + dy === 1) return false;
      }
      return true;
    });
    if (open.length === 0) return null;

    const weights = open.map(({ score }) => score ** 1.4);
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = rng.next() * total;
    let pick = open[open.length - 1] as { cell: number };
    for (let i = 0; i < open.length; i++) {
      roll -= weights[i] as number;
      if (roll <= 0) {
        pick = open[i] as { cell: number };
        break;
      }
    }
    chosen.push(pick.cell);
    taken.add(pick.cell);
  }

  // Firing order is plot order, and reading order is the natural one for it.
  return chosen.sort((a, b) => a - b);
}

/* ------------------------------------------------------------------- wave */

/** Ticks between two enemies of a group. Tight enough to read as a pack. */
const GROUP_GAP: readonly number[] = [3, 2, 5];

interface WavePlan {
  kinds: FoeKind[];
  spawns: number[];
}

/**
 * The order enemies come in, and when.
 *
 * In groups of one kind. A mixed trickle is harder to read and no harder to
 * play, and the preview across the top of the screen is only a decision aid if
 * it can say "three knights" rather than listing twelve icons.
 */
function planWave(shape: LevelShape, rng: Rng): WavePlan {
  const kinds: FoeKind[] = [];
  const spawns: number[] = [];
  const total = shape.mix.reduce((a, b) => a + b, 0);
  const seen = new Set<number>();

  let tick = 0;
  let last = -1;
  while (kinds.length < shape.foes) {
    let kind: FoeKind = GRUNT;
    // Every kind in the mix appears at least once: an enemy on the preview
    // that never shows up is a lesson the level forgot to teach.
    const missing = [GRUNT, RUNNER, KNIGHT].filter((k) => (shape.mix[k] as number) > 0 && !seen.has(k));
    const room = shape.foes - kinds.length;
    if (missing.length > 0 && room <= missing.length * 2) {
      kind = missing[0] as FoeKind;
    } else {
      let roll = rng.next() * total;
      for (const k of [GRUNT, RUNNER, KNIGHT] as FoeKind[]) {
        roll -= shape.mix[k] as number;
        if (roll <= 0) {
          kind = k;
          break;
        }
      }
      if (kind === last && rng.chance(0.6)) continue;
    }
    seen.add(kind);

    const size = Math.min(room, kind === KNIGHT ? rng.range(1, 3) : rng.range(2, shape.groupMax));
    if (last !== -1) tick += rng.range(9, 16);
    for (let i = 0; i < size; i++) {
      kinds.push(kind);
      spawns.push(tick);
      tick += GROUP_GAP[kind] as number;
    }
    last = kind;
  }

  return { kinds, spawns };
}

function buildWave(plan: WavePlan, strength: number): Foe[] {
  return plan.kinds.map((kind, i) => ({
    kind,
    hp: Math.max(1, Math.round(((FOES[kind] as FoeSpec).hp * strength) / 100)),
    spawn: plan.spawns[i] as number,
  }));
}

/* ------------------------------------------------------------- difficulty */

/**
 * One naive layout: towers dropped on the plots that look best for them.
 *
 * Models someone on the couch who knows what towers are for — each goes where
 * its own kind sees the most road, weighted rather than argmaxed — and who does
 * not simulate the wave in their head. Now and then a tower goes somewhere
 * arbitrary, because people do that too.
 */
function naiveLayout(level: Level, rng: Rng): Layout {
  const layout: Layout = level.plots.map(() => EMPTY);
  const bag: number[] = [];
  level.towers.forEach((count, kind) => {
    for (let i = 0; i < count; i++) bag.push(kind);
  });
  rng.shuffle(bag);

  for (const kind of bag) {
    const free = layout.map((k, plot) => (k === EMPTY ? plot : -1)).filter((plot) => plot !== -1);
    if (rng.chance(0.2)) {
      layout[rng.pick(free)] = kind;
      continue;
    }
    const weights = free.map((plot) => reachOf(level, plot, kind) ** 2 + 0.25);
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = rng.next() * total;
    let pick = free[free.length - 1] as number;
    for (let i = 0; i < free.length; i++) {
      roll -= weights[i] as number;
      if (roll <= 0) {
        pick = free[i] as number;
        break;
      }
    }
    layout[pick] = kind;
  }
  return layout;
}

const norm = (value: number, lo: number, hi: number): number =>
  clamp((value - lo) / (hi - lo), 0, 1);

/**
 * Blends the measured trap rate with what the level is made of.
 *
 * Trap rate carries most of it, because it measures the player being built for.
 * The structural half is there so two levels with the same trap rate still rank
 * the one with more to think about — more spare plots, more tower kinds, more
 * kinds of enemy — as the harder one.
 */
function scoreDifficulty(shape: LevelShape, trap: number): number {
  const trapScore = clamp(trap / 0.9, 0, 1);
  const kinds = shape.towers.filter((n) => n > 0).length;
  const foeKinds = shape.mix.filter((n) => n > 0).length;
  const structural =
    norm(shape.spare, 2, 5) * 0.45 + norm(kinds, 2, 3) * 0.25 + norm(foeKinds, 1, 3) * 0.3;
  return clamp(0.78 * trapScore + 0.22 * structural, 0, 1);
}

/* --------------------------------------------------------------- tuning */

interface Candidate {
  wave: Foe[];
  strength: number;
  trap: number;
  difficulty: number;
}

interface Built {
  base: Omit<Level, 'wave'>;
  plan: WavePlan;
}

function build(shape: LevelShape, rng: Rng): Built | null {
  const path = makePath(shape, rng);
  if (!path) return null;
  const total = shape.towers.reduce((a, b) => a + b, 0);
  const plots = pickPlots(shape, path, total + shape.spare, rng);
  if (!plots) return null;
  return {
    base: { width: shape.width, height: shape.height, path, plots, towers: shape.towers },
    plan: planWave(shape, rng),
  };
}

/**
 * Climbs the wave's strength until the level is as hard as it was asked to be.
 *
 * Returns every step of the climb that still had a proven winner, so the caller
 * can pick; `onStep` may stop the climb early by returning true.
 */
function climb(
  built: Built,
  shape: LevelShape,
  rollRng: Rng,
  onStep: (candidate: Candidate) => boolean,
): Candidate[] {
  const steps: Candidate[] = [];
  let strength = START_STRENGTH;

  // Every layout, once, at the opening strength. This is the only full
  // enumeration: from here on only the survivors are re-checked.
  let level: Level = { ...built.base, wave: buildWave(built.plan, strength) };
  let winners: { layout: Layout; closest: number }[] = [];
  let layouts = 0;
  forEachCompletion(level, level.plots.map(() => EMPTY), (layout) => {
    layouts++;
    if (layouts > MAX_LAYOUTS) return true;
    const outcome = simulate(level, layout);
    if (outcome.won) winners.push({ layout: layout.slice(), closest: outcome.closest });
    return false;
  });
  if (layouts > MAX_LAYOUTS || winners.length === 0) return steps;

  winners.sort((a, b) => a.closest - b.closest);
  winners = winners.slice(0, KEEP_WINNERS);

  // The same naive layouts all the way up, so the trap rate climbs smoothly
  // with the strength rather than jittering with a fresh sample each step.
  const naive = Array.from({ length: ROLLOUTS }, () => naiveLayout(level, rollRng));

  while (strength <= MAX_STRENGTH) {
    const lost = naive.filter((layout) => !simulate(level, layout).won).length;
    const trap = lost / ROLLOUTS;
    const candidate: Candidate = {
      wave: level.wave as Foe[],
      strength,
      trap,
      difficulty: scoreDifficulty(shape, trap),
    };
    steps.push(candidate);
    if (onStep(candidate)) break;

    strength = Math.round(strength * STRENGTH_STEP);
    level = { ...built.base, wave: buildWave(built.plan, strength) };
    const current = level;
    winners = winners.filter(({ layout }) => simulate(current, layout).won);
    if (winners.length === 0) break;
  }

  return steps;
}

/* -------------------------------------------------------------- assembly */

/**
 * Deterministic for a given (profileSeed, level), so a save stores the moves
 * rather than the map, a level is shareable by number, and a reported bug
 * reproduces exactly.
 */
export function generateLevel(profileSeed: string, level: number): GeneratedLevel {
  const pressureRng = createRng(hashSeed(profileSeed, 'castle', 'pressure', level));
  const pressure = pressureForLevel(level, pressureRng);
  const [lo, hi] = pressure.band;

  let closest: GeneratedLevel | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rng = createRng(hashSeed(profileSeed, 'castle', level, attempt));
    const shape = shapeFor(pressure, rng);
    const built = build(shape, rng);
    if (!built) continue;

    const rollRng = createRng(hashSeed(profileSeed, 'castle', 'rollout', level, attempt));
    // Aimed a little inside the band rather than at its floor: the climb moves
    // in steps of eight per cent, and stopping at the first step past `lo`
    // put every level at the easiest end of what it was asked for.
    const aim = Math.min(hi, lo + 0.05);
    const steps = climb(built, shape, rollRng, (step) => step.difficulty >= aim);
    if (steps.length === 0) continue;

    // The first step at or above the floor of the band, or the hardest step
    // the climb reached when no winner survived that far.
    const pick = steps[steps.length - 1] as Candidate;
    const candidate: Level = { ...built.base, wave: pick.wave };
    if (!isWellFormed(candidate)) continue;
    if (search(candidate).status !== 'solved') continue;

    const generated: GeneratedLevel = {
      ...candidate,
      level,
      shape,
      difficulty: pick.difficulty,
      trap: pick.trap,
      strength: pick.strength,
      attempts: attempt + 1,
    };

    if (pick.difficulty >= lo && pick.difficulty <= hi) return generated;

    const distance = pick.difficulty < lo ? lo - pick.difficulty : pick.difficulty - hi;
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = generated;
    }
  }

  if (closest) return closest;
  throw new Error(`Unable to generate a winnable Castle level ${level}`);
}

/* ---------------------------------------------------------------- probing */

/**
 * The raw signal at fixed settings, for `tools/castle.ts`.
 *
 * Nothing in the game calls this. It answers "what range can the trap rate
 * reach, and at what strength" before any band is trusted — the mistake that
 * flattened the curve in two earlier games was calibrating first.
 */
export function probeShape(
  overrides: Partial<LevelShape>,
  samples = 12,
): { built: number; ceiling: number; trapAtCeiling: number; strengthAtCeiling: number; layouts: number; steps: string } {
  const base: LevelShape = {
    width: 7,
    height: 9,
    minPath: 19,
    maxPath: 27,
    towers: [2, 1, 1],
    spare: 3,
    foes: 12,
    mix: [1, 0.5, 0.4],
    groupMax: 4,
    ...overrides,
  };

  let built = 0;
  let ceiling = 0;
  let trapAtCeiling = 0;
  let strengthAtCeiling = 0;
  let layouts = 0;
  const curve = new Map<number, number[]>();

  for (let sample = 0; sample < samples; sample++) {
    const rng = createRng(hashSeed('probe-castle', sample, JSON.stringify(overrides)));
    const b = build(base, rng);
    if (!b) continue;
    const steps = climb(b, base, createRng(hashSeed('probe-roll', sample)), () => false);
    if (steps.length === 0) continue;
    built++;
    const last = steps[steps.length - 1] as Candidate;
    ceiling += last.difficulty;
    trapAtCeiling += last.trap;
    strengthAtCeiling += last.strength;
    let count = 0;
    forEachCompletion({ ...b.base, wave: last.wave }, b.base.plots.map(() => EMPTY), () => {
      count++;
      return false;
    });
    layouts += count;
    // Trap rate at a few fixed fractions of the way up this board's climb.
    steps.forEach((step, i) => {
      const bucket = Math.round((i / Math.max(1, steps.length - 1)) * 4);
      const list = curve.get(bucket) ?? [];
      list.push(step.trap);
      curve.set(bucket, list);
    });
  }

  const n = Math.max(1, built);
  const steps = [0, 1, 2, 3, 4]
    .map((b) => {
      const list = curve.get(b) ?? [];
      const mean = list.length ? list.reduce((a, c) => a + c, 0) / list.length : 0;
      return mean.toFixed(2);
    })
    .join(' ');
  return {
    built,
    ceiling: ceiling / n,
    trapAtCeiling: trapAtCeiling / n,
    strengthAtCeiling: strengthAtCeiling / n,
    layouts: layouts / n,
    steps,
  };
}

