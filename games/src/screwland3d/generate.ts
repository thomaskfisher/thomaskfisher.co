/**
 * Level generation for Screw Land 3D.
 *
 * A template lists the object's blocks in build order; plates are then bolted
 * over them. Every piece, block or plate, is *assembled* one at a time and
 * accepted only if nothing already in place sits in front of its own screws.
 * Disassembly in the reverse order is then always physically possible, by
 * induction — the 3D version of Screw Land's bottom-up stacking — and when the
 * last screw is out, nothing is left. That leaves colour as the only thing the
 * solver has to verify.
 *
 * Every piece after the first also gets a *support*: an earlier piece it
 * touches and hides a screw of. The support then cannot come off first, so no
 * piece is ever left floating where something used to hold it.
 *
 * Difficulty is Screw Land's trap rate, with one change that matters: the naive
 * player in the rollout can only take screws they can *see*. They look from one
 * direction at a time and sometimes turn the object, and a screw on the
 * underside is not an option until they do. Without that, hidden screws would
 * be cosmetic as far as the curve is concerned — the generator must measure the
 * game actually being played.
 */

import type { SinkConfig } from '../shared/buffer-sink';
import { accept, createSinkState } from '../shared/buffer-sink';
import { type LevelPressure, pressureForLevel } from '../shared/difficulty';
import { MAX_COLORS } from '../shared/palette';
import { type Rng, createRng, hashSeed } from '../shared/rng';
import {
  type Axis,
  type BoardState,
  type Box,
  PLATE_THICKNESS,
  type Piece,
  type Screw,
  type Sign,
  type Structure,
  type Vec3,
  accessibleScrewIds,
  axisRayHits,
  boxesOverlap,
  contactFace,
  createBoardState,
  faceAxes,
  indexStructure,
  isDisassemblable,
  isSupported,
  isVisibleFrom,
  isWellFormed,
  removeScrew,
} from './model';
import { search } from './solve';
import { TEMPLATE_NAMES, type TemplateName, buildTemplate } from './templates';

export const MAX_OPEN_BOXES = 3;

export interface LevelShape {
  template: TemplateName;
  /** 0..1, how large the template is rolled. */
  size: number;
  /** Blocks plus plates the object is built from, as a target. */
  pieceCount: number;
  screwCount: number;
  colors: number;
  openBoxes: number;
  boxCapacity: number;
  trayCapacity: number;
  previewCount: number;
  /** Share of plates placed on faces the opening view cannot see. */
  hiddenShare: number;
}

export interface GeneratedLevel {
  level: number;
  structure: Structure;
  queue: number[];
  config: SinkConfig;
  shape: LevelShape;
  /** 0..1, measured from naive playthroughs. */
  difficulty: number;
  attempts: number;
}

const MAX_ATTEMPTS = 32;
/**
 * See Screw Land's VERIFY_BUDGET: giving up rejects the board, never ships it.
 * Half Screw Land's, because blocks that fall add pieces to every board and a
 * rejected attempt costs the whole budget: at 40k a few deep levels took over a
 * second to build.
 */
const VERIFY_BUDGET = 20_000;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/* ----------------------------------------------------------------- views */

const normalize = (v: Vec3): Vec3 => {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};

/**
 * Direction from the object towards the eye when a level opens: front, a little
 * from the right and above. The renderer starts here too, so "hidden" means the
 * same thing to the generator and to the player.
 */
export const DEFAULT_VIEW: Vec3 = normalize([0.55, 0.5, 1]);

/** Where a player might turn the object to look from. */
export const LOOK_DIRECTIONS: readonly Vec3[] = (() => {
  const views: Vec3[] = [];
  for (const x of [-1, 0, 1]) {
    for (const y of [-1, 0, 1]) {
      for (const z of [-1, 0, 1]) {
        if (x === 0 && y === 0 && z === 0) continue;
        views.push(normalize([x, y, z]));
      }
    }
  }
  return views;
})();

/** Faces whose normal points away from the opening view. */
function isHiddenFace(axis: Axis, sign: Sign): boolean {
  return DEFAULT_VIEW[axis] * sign <= 0;
}

/* ------------------------------------------------------------------ shape */

/** Templates come in seeded blocks holding each family once, so none runs twice in a row. */
export function templateForLevel(profileSeed: string, level: number): TemplateName {
  const n = TEMPLATE_NAMES.length;
  const block = Math.floor((level - 1) / n);
  const order = (b: number): TemplateName[] =>
    createRng(hashSeed(profileSeed, 'screwland3d', 'templates', b)).shuffle(TEMPLATE_NAMES.slice());

  const current = order(block);
  if (block > 0) {
    const previousLast = order(block - 1)[n - 1];
    if (current[0] === previousLast) [current[0], current[1]] = [current[1]!, current[0]!];
  }
  return current[(level - 1) % n]!;
}

export function shapeFor(pressure: LevelPressure, template: TemplateName): LevelShape {
  const p = pressure.pressure;

  // The levers below are Screw Land's, and its comments explain each one. They
  // were calibrated with a probe and are kept unless this game's probe says
  // otherwise.
  const boxCapacity = p < 0.45 ? 3 : p < 0.75 ? 4 : 5;
  const boxes = clamp(Math.round(4 + p * 5), 4, 9);
  const screwCount = boxes * boxCapacity;
  // Pieces, blocks and plates together. Every block now carries screws and
  // falls like a plate, so they share Screw Land's ratio of a little over two
  // screws a piece; the template's blocks come first and plates fill the rest.
  const pieceCount = clamp(Math.round(screwCount / 2.1), 3, 22);
  const openBoxes = p < 0.12 ? 3 : 2;
  const trayCapacity = p < 0.15 ? 5 : 4;
  const colorBudget = openBoxes + trayCapacity + 2 - boxCapacity;
  const colors = Math.max(4, Math.min(4 + Math.round(Math.sqrt(p) * 3), colorBudget, MAX_COLORS));
  const previewCount = p < 0.45 ? 3 : p < 0.75 ? 2 : 1;

  // New here. Faces the opening view cannot see are where screws go to be
  // missed: the underside, the back, the far side. Even the easiest level puts
  // some there, because turning the object is the point of the game.
  const hiddenShare = clamp(0.15 + p * 0.4, 0.15, 0.55);

  return {
    template,
    size: p,
    pieceCount,
    screwCount,
    colors,
    openBoxes,
    boxCapacity,
    trayCapacity,
    previewCount,
    hiddenShare,
  };
}

/* -------------------------------------------------------------- assembly */

/** One face of a box: where screws can go, and what plates can rest on. */
interface Face {
  axis: Axis;
  sign: Sign;
  /** The surface's coordinate along `axis`. */
  plane: number;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

function boxFaces(box: Box): Face[] {
  const faces: Face[] = [];
  for (const axis of [0, 1, 2] as Axis[]) {
    const [u, v] = faceAxes(axis);
    for (const sign of [1, -1] as Sign[]) {
      faces.push({
        axis,
        sign,
        plane: sign > 0 ? box.max[axis] : box.min[axis],
        u0: box.min[u],
        u1: box.max[u],
        v0: box.min[v],
        v1: box.max[v],
      });
    }
  }
  return faces;
}

interface Builder {
  /** In assembly order. */
  pieces: Piece[];
  /** For a plate, the block face it ultimately rests on; null for a block. */
  roots: (Face | null)[];
  screws: Omit<Screw, 'color'>[];
  points: Set<string>;
}

interface Spot {
  point: Vec3;
  axis: Axis;
  sign: Sign;
}

const pointKey = (p: Vec3): string => `${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)}`;

/** A piece placed before `limit` sits in front of this point. */
function blockedBy(point: Vec3, axis: Axis, sign: Sign, b: Builder, limit: number): boolean {
  for (let i = 0; i < limit; i++) {
    if (axisRayHits(point, axis, sign, b.pieces[i] as Piece)) return true;
  }
  return false;
}

/** Cell centres on a face, restricted to [u0,u1) x [v0,v1). */
function cellSpots(face: Face, u0 = face.u0, u1 = face.u1, v0 = face.v0, v1 = face.v1): Spot[] {
  const [u, v] = faceAxes(face.axis);
  const spots: Spot[] = [];
  for (let cu = Math.floor(u0); cu < u1; cu++) {
    if (cu + 0.5 <= u0 || cu + 0.5 >= u1) continue;
    for (let cv = Math.floor(v0); cv < v1; cv++) {
      if (cv + 0.5 <= v0 || cv + 0.5 >= v1) continue;
      const point: Vec3 = [0, 0, 0];
      point[face.axis] = face.plane;
      point[u] = cu + 0.5;
      point[v] = cv + 0.5;
      spots.push({ point, axis: face.axis, sign: face.sign });
    }
  }
  return spots;
}

/**
 * Where a new screw could go on a piece: any face of a block, or the outer
 * face of a plate. Only pieces placed *earlier* may not cover it — later ones
 * come off first, so a screw under them is simply hidden until then.
 */
function freeSpots(b: Builder, index: number): Spot[] {
  const piece = b.pieces[index] as Piece;
  const root = b.roots[index];
  const faces = root ? boxFaces(piece).filter((f) => f.axis === root.axis && f.sign === root.sign) : boxFaces(piece);
  const out: Spot[] = [];
  for (const face of faces) {
    for (const spot of cellSpots(face)) {
      if (b.points.has(pointKey(spot.point))) continue;
      if (blockedBy(spot.point, spot.axis, spot.sign, b, index)) continue;
      out.push(spot);
    }
  }
  return out;
}

function addScrew(b: Builder, index: number, spot: Spot): void {
  const piece = b.pieces[index] as Piece;
  b.points.add(pointKey(spot.point));
  b.screws.push({ id: b.screws.length, pieceId: piece.id, point: spot.point, axis: spot.axis, sign: spot.sign });
}

/**
 * Gives the newest piece a support: an earlier piece it touches and covers a
 * screw of. The support then cannot fall while this piece stands, so nothing is
 * ever left floating. If no touching piece has a screw under this one yet, one
 * is added — the hidden screw a roof sits on, the one under a wheel.
 *
 * Returns false when the piece touches nothing earlier, or nowhere it touches
 * can take a screw.
 */
function giveSupport(b: Builder, index: number, rng: Rng): boolean {
  const piece = b.pieces[index] as Piece;
  const touching: number[] = [];
  for (let j = 0; j < index; j++) {
    if (contactFace(b.pieces[j] as Piece, piece)) touching.push(j);
  }
  if (touching.length === 0) return false;

  for (const j of touching) {
    const below = b.pieces[j] as Piece;
    const covered = b.screws.some(
      (s) => s.pieceId === below.id && axisRayHits(s.point, s.axis, s.sign, piece),
    );
    if (covered) return true;
  }

  for (const j of rng.shuffle(touching.slice())) {
    const below = b.pieces[j] as Piece;
    const contact = contactFace(below, piece);
    if (!contact) continue;
    const face: Face = {
      axis: contact.axis,
      sign: contact.sign,
      plane: contact.plane,
      u0: contact.u[0],
      u1: contact.u[1],
      v0: contact.v[0],
      v1: contact.v[1],
    };
    const spots = cellSpots(face).filter(
      (spot) =>
        !b.points.has(pointKey(spot.point)) &&
        !blockedBy(spot.point, spot.axis, spot.sign, b, j) &&
        axisRayHits(spot.point, spot.axis, spot.sign, piece),
    );
    if (spots.length > 0) {
      addScrew(b, j, rng.pick(spots));
      return true;
    }
  }
  return false;
}

/**
 * Proposes one plate: a footprint on a face of a block, or overlapping an
 * existing plate so it stacks — stacking is what makes plates cover screws, and
 * covering is the puzzle.
 *
 * A stacked plate stays inside the block face its anchor ultimately rests on.
 * It may sit offset from the anchor, covering some of what is under it and not
 * all, but it never reaches out past the block into the air: on a one-cell
 * mast, allowing that grew stacks into wide signboards hanging off nothing.
 */
function proposePlate(b: Builder, blockFaces: Face[], wantHidden: boolean, rng: Rng): { plate: Piece; root: Face } | null {
  let root: Face;
  let anchor: Piece | null = null;

  const stackable: number[] = [];
  b.roots.forEach((r, i) => {
    if (r && isHiddenFace(r.axis, r.sign) === wantHidden) stackable.push(i);
  });
  if (stackable.length > 0 && rng.chance(0.55)) {
    const i = rng.pick(stackable);
    anchor = b.pieces[i] as Piece;
    root = b.roots[i] as Face;
  } else {
    const pool = blockFaces.filter((f) => isHiddenFace(f.axis, f.sign) === wantHidden);
    if (pool.length === 0) return null;
    // Weight by area so the big faces get most of the plates.
    let total = 0;
    for (const f of pool) total += (f.u1 - f.u0) * (f.v1 - f.v0);
    let roll = rng.next() * total;
    root = pool[pool.length - 1] as Face;
    for (const f of pool) {
      roll -= (f.u1 - f.u0) * (f.v1 - f.v0);
      if (roll <= 0) {
        root = f;
        break;
      }
    }
  }

  const face = root;
  const [u, v] = faceAxes(face.axis);
  const uw = Math.min(rng.range(1, 3), face.u1 - face.u0);
  const vh = Math.min(rng.range(1, 3), face.v1 - face.v0);

  let cu0: number;
  let cv0: number;
  if (anchor) {
    // Any start that keeps the plate on the face and overlapping its anchor.
    const uLo = Math.max(face.u0, anchor.min[u] - uw + 1);
    const uHi = Math.min(face.u1 - uw, anchor.max[u] - 1);
    const vLo = Math.max(face.v0, anchor.min[v] - vh + 1);
    const vHi = Math.min(face.v1 - vh, anchor.max[v] - 1);
    if (uHi < uLo || vHi < vLo) return null;
    cu0 = rng.range(uLo, uHi);
    cv0 = rng.range(vLo, vHi);
  } else {
    cu0 = face.u0 + rng.int(face.u1 - face.u0 - uw + 1);
    cv0 = face.v0 + rng.int(face.v1 - face.v0 - vh + 1);
  }

  const min: Vec3 = [0, 0, 0];
  const max: Vec3 = [0, 0, 0];
  min[u] = cu0;
  max[u] = cu0 + uw;
  min[v] = cv0;
  max[v] = cv0 + vh;

  // Rest on whatever plate is already highest under the footprint on this face.
  let base = face.plane;
  b.pieces.forEach((p, i) => {
    const r = b.roots[i];
    if (!r || r.axis !== face.axis || r.sign !== face.sign) return;
    if (p.max[u] <= min[u] || p.min[u] >= max[u] || p.max[v] <= min[v] || p.min[v] >= max[v]) return;
    const outer = face.sign > 0 ? p.max[face.axis] : p.min[face.axis];
    const inner = face.sign > 0 ? p.min[face.axis] : p.max[face.axis];
    const inFront = face.sign > 0 ? inner >= face.plane - 1e-6 : inner <= face.plane + 1e-6;
    if (!inFront) return;
    base = face.sign > 0 ? Math.max(base, outer) : Math.min(base, outer);
  });

  if (face.sign > 0) {
    min[face.axis] = base;
    max[face.axis] = base + PLATE_THICKNESS;
  } else {
    min[face.axis] = base - PLATE_THICKNESS;
    max[face.axis] = base;
  }

  return { plate: { id: b.pieces.length, kind: 'plate', min, max }, root };
}

/**
 * Adds a piece, gives it a support and its first screw, or leaves the builder
 * exactly as it was and returns false.
 */
function tryPlace(b: Builder, piece: Piece, root: Face | null, rng: Rng): boolean {
  for (const other of b.pieces) if (boxesOverlap(piece, other)) return false;
  const screwsBefore = b.screws.length;
  const pointsBefore = new Set(b.points);
  b.pieces.push(piece);
  b.roots.push(root);
  const index = b.pieces.length - 1;

  const supported = index === 0 || giveSupport(b, index, rng);
  const spots = supported ? freeSpots(b, index) : [];
  if (spots.length === 0) {
    b.pieces.pop();
    b.roots.pop();
    b.screws.length = screwsBefore;
    b.points = pointsBefore;
    return false;
  }
  addScrew(b, index, rng.pick(spots));
  return true;
}

function buildStructureGeometry(
  shape: LevelShape,
  rng: Rng,
): { pieces: Piece[]; screws: Omit<Screw, 'color'>[] } | null {
  const blocks = buildTemplate(shape.template, rng, shape.size);
  const b: Builder = { pieces: [], roots: [], screws: [], points: new Set() };

  // The object itself, in the template's build order. Every block after the
  // first must touch an earlier one, or the template is wrong.
  for (const block of blocks) {
    const piece: Piece = { id: b.pieces.length, kind: block.kind, min: block.min, max: block.max };
    if (!tryPlace(b, piece, null, rng)) return null;
  }

  // A busy object — a train has eight blocks, each screwed to the one before
  // — can need more screws to hold together than an early level budgets for.
  // Rather than fail every attempt, the level grows by whole boxes until the
  // object fits with room for a couple of plates.
  const capacity = shape.boxCapacity;
  const needed = b.screws.length + 4;
  const screwTarget =
    needed > shape.screwCount ? Math.ceil(needed / capacity) * capacity : shape.screwCount;

  // Plates over it. Each costs up to two screws — its own, and the one hidden
  // under it that holds whatever it rests on — so stop while there is room.
  const blockFaces = b.pieces.flatMap((piece) => boxFaces(piece));
  const plateTarget = Math.max(1, shape.pieceCount - blocks.length);
  let plates = 0;
  let guard = 0;
  while (plates < plateTarget && b.screws.length + 2 <= screwTarget) {
    if (guard++ > plateTarget * 60) break;
    const proposal = proposePlate(b, blockFaces, rng.chance(shape.hiddenShare), rng);
    if (!proposal) continue;
    if (tryPlace(b, proposal.plate, proposal.root, rng)) plates++;
  }
  if (plates === 0) return null;

  // The rest of the screws, spread at random over every piece with room.
  guard = 0;
  while (b.screws.length < screwTarget) {
    if (guard++ > screwTarget * 40) return null;
    const index = rng.int(b.pieces.length);
    const spots = freeSpots(b, index);
    if (spots.length === 0) continue;
    addScrew(b, index, rng.pick(spots));
  }

  return { pieces: b.pieces, screws: b.screws };
}

function assignColors(
  screws: Omit<Screw, 'color'>[],
  shape: LevelShape,
  rng: Rng,
): { screws: Screw[]; queue: number[] } {
  const boxes = screws.length / shape.boxCapacity;
  const boxColors: number[] = [];
  for (let c = 0; c < shape.colors && boxColors.length < boxes; c++) boxColors.push(c);
  while (boxColors.length < boxes) boxColors.push(rng.int(shape.colors));

  const pool: number[] = [];
  for (const color of boxColors) {
    for (let i = 0; i < shape.boxCapacity; i++) pool.push(color);
  }
  rng.shuffle(pool);

  return {
    screws: screws.map((screw, i) => ({ ...screw, color: pool[i] as number })),
    queue: rng.shuffle(boxColors.slice()),
  };
}

/* ------------------------------------------------------------- difficulty */

/**
 * One naive playthrough. Returns true if it overflowed the tray.
 *
 * The player looks from one direction. They take a screw a box wants if they
 * can see one; failing that they usually turn the object to look for one, and
 * sometimes just take whatever is in front of them — which is how the tray
 * fills. Exported so the probe measures exactly what the scorer does.
 */
export function naiveRollout(
  structure: Structure,
  queue: number[],
  config: SinkConfig,
  rng: Rng,
): boolean {
  const index = indexStructure(structure);
  const state: BoardState = createBoardState(structure, index);
  let sinks = createSinkState(config, queue);
  let view: Vec3 = DEFAULT_VIEW;

  for (let step = 0; step < structure.screws.length; step++) {
    const reachable = accessibleScrewIds(structure, index, state);
    if (reachable.length === 0) return false;

    let choice: number | null = null;
    for (let look = 0; look < 4 && choice === null; look++) {
      const seen = reachable.filter((id) => isVisibleFrom(structure, state, id, view));
      const wanted = seen.filter((id) => {
        const color = (structure.screws[id] as Screw).color;
        return sinks.sinks.some((s) => s && s.color === color && s.filled < config.sinkCapacity);
      });
      if (wanted.length > 0 && rng.chance(0.75)) choice = rng.pick(wanted);
      else if (seen.length > 0 && rng.chance(0.4)) choice = rng.pick(seen);
      else view = rng.pick(LOOK_DIRECTIONS);
    }
    if (choice === null) {
      const seen = reachable.filter((id) => isVisibleFrom(structure, state, id, view));
      choice = rng.pick(seen.length > 0 ? seen : reachable);
    }

    const result = accept(sinks, config, (structure.screws[choice] as Screw).color);
    if (result.placed === 'lost') return true;
    sinks = result.state;
    removeScrew(structure, index, state, choice);
  }
  return false;
}

function trapRate(
  structure: Structure,
  queue: number[],
  config: SinkConfig,
  rng: Rng,
  rollouts = 16,
): number {
  let lost = 0;
  for (let r = 0; r < rollouts; r++) if (naiveRollout(structure, queue, config, rng)) lost++;
  return lost / rollouts;
}

/** Share of screws not visible from the opening view. */
export function hiddenScrewShare(structure: Structure): number {
  const index = indexStructure(structure);
  const state = createBoardState(structure, index);
  let hidden = 0;
  for (let id = 0; id < structure.screws.length; id++) {
    if (!isVisibleFrom(structure, state, id, DEFAULT_VIEW)) hidden++;
  }
  return hidden / structure.screws.length;
}

const norm = (value: number, lo: number, hi: number): number =>
  clamp((value - lo) / (hi - lo), 0, 1);

export function scoreDifficulty(shape: LevelShape, trap: number): number {
  const trapScore = clamp(trap / 0.8, 0, 1);
  const structural = clamp(
    norm(shape.colors, 4, 6) * 0.22 +
      norm(shape.boxCapacity, 3, 5) * 0.22 +
      norm(5 - shape.trayCapacity, 0, 1) * 0.22 +
      norm(MAX_OPEN_BOXES - shape.openBoxes, 0, 1) * 0.14 +
      norm(shape.screwCount, 12, 45) * 0.12 +
      norm(3 - shape.previewCount, 0, 2) * 0.08,
    0,
    1,
  );
  return clamp(0.7 * trapScore + 0.3 * structural, 0, 1);
}

/** One assembly attempt, or null when it is unusable. Exported for the probe. */
export function buildCandidate(
  shape: LevelShape,
  rng: Rng,
  rollRng: Rng,
): Omit<GeneratedLevel, 'level' | 'attempts'> | null {
  const geometry = buildStructureGeometry(shape, rng);
  if (!geometry) return null;

  const coloured = assignColors(geometry.screws, shape, rng);
  const structure: Structure = {
    template: shape.template,
    pieces: geometry.pieces,
    screws: coloured.screws,
    colors: shape.colors,
  };

  if (!isWellFormed(structure) || !isDisassemblable(structure) || !isSupported(structure)) {
    return null;
  }

  const config: SinkConfig = {
    openSinks: shape.openBoxes,
    sinkCapacity: shape.boxCapacity,
    bufferCapacity: shape.trayCapacity,
  };

  const spec = { structure, queue: coloured.queue, config };
  if (search(spec, { nodeBudget: VERIFY_BUDGET }).status !== 'solved') return null;

  const difficulty = scoreDifficulty(shape, trapRate(structure, coloured.queue, config, rollRng));
  return { structure, queue: coloured.queue, config, shape, difficulty };
}

/** Deterministic for a given (profileSeed, level). */
export function generateLevel(profileSeed: string, level: number): GeneratedLevel {
  const pressureRng = createRng(hashSeed(profileSeed, 'screwland3d', 'pressure', level));
  const pressure = pressureForLevel(level, pressureRng);
  const shape = shapeFor(pressure, templateForLevel(profileSeed, level));

  let closest: GeneratedLevel | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rng = createRng(hashSeed(profileSeed, 'screwland3d', level, attempt));
    const rollRng = createRng(hashSeed(profileSeed, 'screwland3d', 'rollout', level, attempt));

    const built = buildCandidate(shape, rng, rollRng);
    if (!built) continue;

    const candidate: GeneratedLevel = { ...built, level, attempts: attempt + 1 };
    const [lo, hi] = pressure.band;
    if (candidate.difficulty >= lo && candidate.difficulty <= hi) return candidate;

    const distance =
      candidate.difficulty < lo ? lo - candidate.difficulty : candidate.difficulty - hi;
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = candidate;
    }
  }

  if (closest) return closest;
  throw new Error(`Unable to generate a solvable Screw Land 3D level ${level}`);
}
