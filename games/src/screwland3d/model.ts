/**
 * Screw Land 3D rules. Pure — no DOM, no storage, no randomness.
 *
 * Screw Land is 2D on purpose: its README argues the original's 3D is skin over
 * a layering rule. This game keeps that rule and puts the skin back on.
 *
 * The object is made entirely of pieces, and every piece is held on by screws.
 * Some pieces are solid blocks — a house's walls, its roof, a car's wheels —
 * and some are thin plates bolted over them, but the rules treat them the same:
 * a piece falls away when its last screw comes out, and once every screw is out
 * nothing is left at all. There is no static skeleton.
 *
 * The rule is Screw Land's, generalised: a screw can be taken out once no piece
 * still standing sits in front of it, where "in front" means along the screw's
 * own outward normal. A roof covers the screws in the top of the wall it sits
 * on; a plate bolted over the front covers the screws underneath it; a plate on
 * the back never covers the front. Everything downstream — the solver, the box
 * and tray engine, the hint — reads only the derived table of which pieces
 * cover which screw, which has exactly Screw Land's shape. 3D changes how that
 * table is computed and nothing else.
 *
 * What 3D adds is *visibility*: a screw on the underside is free from the start
 * and still invisible until you turn the object over. That lives in the
 * renderer and the difficulty model, never in these rules.
 *
 * Coordinates are grid units, y up. Every piece is an axis-aligned box.
 */

export type Axis = 0 | 1 | 2;
export type Sign = 1 | -1;
export type Vec3 = [number, number, number];

/** Thickness of a plate along its normal. */
export const PLATE_THICKNESS = 0.25;

const EPS = 1e-6;

export interface Box {
  min: Vec3;
  max: Vec3;
}

/**
 * One piece of the object. `kind` is 'plate' for a thin plate, otherwise the
 * template's name for the block ('wall', 'roof', 'wheel') — which only the
 * renderer cares about.
 */
export interface Piece extends Box {
  id: number;
  kind: string;
}

export interface Screw {
  id: number;
  color: number;
  /** The piece this screw fastens; removing every one of them drops it. */
  pieceId: number;
  /** On one face of its piece. */
  point: Vec3;
  /** That face's outward normal. */
  axis: Axis;
  sign: Sign;
}

export interface Structure {
  /** Which template family built it, for the renderer's palette and the probe. */
  template: string;
  /** In assembly order: each piece went on after every piece before it. */
  pieces: Piece[];
  screws: Screw[];
  colors: number;
}

/** Derived lookups — the same shape as Screw Land's, which is the point. */
export interface StructureIndex {
  pieceIndexById: Map<number, number>;
  screwsByPiece: number[][];
  /** screw id -> piece indices sitting in front of it along its normal. */
  coveringPieces: number[][];
}

export interface BoardState {
  removed: boolean[];
  remainingPerPiece: number[];
}

export const isPlate = (piece: Piece): boolean => piece.kind === 'plate';

/* -------------------------------------------------------------- geometry */

/** The two axes that are not `axis`, in a fixed order. */
export function faceAxes(axis: Axis): [Axis, Axis] {
  return axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
}

/** Interiors overlap — touching faces do not count. */
export function boxesOverlap(a: Box, b: Box): boolean {
  for (let k = 0; k < 3; k++) {
    if (a.min[k]! >= b.max[k]! - EPS || b.min[k]! >= a.max[k]! - EPS) return false;
  }
  return true;
}

/**
 * Where two boxes touch face to face with some area, the face of `a` that
 * touches: its axis and outward sign, and the shared rectangle on it. Null
 * when they only meet along an edge or not at all.
 */
export function contactFace(
  a: Box,
  b: Box,
): { axis: Axis; sign: Sign; plane: number; u: [number, number]; v: [number, number] } | null {
  for (const axis of [0, 1, 2] as Axis[]) {
    let sign: Sign | 0 = 0;
    if (Math.abs(a.max[axis] - b.min[axis]) < EPS) sign = 1;
    else if (Math.abs(a.min[axis] - b.max[axis]) < EPS) sign = -1;
    if (sign === 0) continue;
    const [u, v] = faceAxes(axis);
    const u0 = Math.max(a.min[u], b.min[u]);
    const u1 = Math.min(a.max[u], b.max[u]);
    const v0 = Math.max(a.min[v], b.min[v]);
    const v1 = Math.min(a.max[v], b.max[v]);
    if (u1 - u0 > EPS && v1 - v0 > EPS) {
      return { axis, sign, plane: sign > 0 ? a.max[axis] : a.min[axis], u: [u0, u1], v: [v0, v1] };
    }
  }
  return null;
}

/**
 * Does the axis-aligned ray from `point` along (`axis`, `sign`) pass through
 * `box`'s interior? The ray starts *at* the point, so a box the point merely
 * rests on (behind it) never counts.
 */
export function axisRayHits(point: Vec3, axis: Axis, sign: Sign, box: Box): boolean {
  const [u, v] = faceAxes(axis);
  if (point[u] <= box.min[u] + EPS || point[u] >= box.max[u] - EPS) return false;
  if (point[v] <= box.min[v] + EPS || point[v] >= box.max[v] - EPS) return false;
  return sign > 0 ? box.max[axis] > point[axis] + EPS : box.min[axis] < point[axis] - EPS;
}

/**
 * Does a ray from `origin` in direction `dir` (any direction) pass through the
 * box's interior at distance greater than `tMin`? Slab test.
 */
export function rayHitsBox(origin: Vec3, dir: Vec3, box: Box, tMin = 1e-4): boolean {
  let t0 = tMin;
  let t1 = Number.POSITIVE_INFINITY;
  for (let k = 0; k < 3; k++) {
    const o = origin[k]!;
    const d = dir[k]!;
    const lo = box.min[k]!;
    const hi = box.max[k]!;
    if (Math.abs(d) < 1e-12) {
      if (o <= lo + EPS || o >= hi - EPS) return false;
      continue;
    }
    let a = (lo - o) / d;
    let b = (hi - o) / d;
    if (a > b) [a, b] = [b, a];
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 >= t1 - EPS) return false;
  }
  return true;
}

/** Tight bounds of every piece. */
export function structureBounds(structure: Structure): Box {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const box of structure.pieces) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, box.min[k]!);
      max[k] = Math.max(max[k]!, box.max[k]!);
    }
  }
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [1, 1, 1] };
  return { min, max };
}

/* ----------------------------------------------------------------- index */

export function indexStructure(structure: Structure): StructureIndex {
  const pieceIndexById = new Map<number, number>();
  structure.pieces.forEach((piece, index) => pieceIndexById.set(piece.id, index));

  const screwsByPiece: number[][] = structure.pieces.map(() => []);
  for (const screw of structure.screws) {
    const index = pieceIndexById.get(screw.pieceId);
    if (index !== undefined) (screwsByPiece[index] as number[]).push(screw.id);
  }

  const coveringPieces: number[][] = structure.screws.map((screw) => {
    const covering: number[] = [];
    structure.pieces.forEach((piece, index) => {
      if (piece.id === screw.pieceId) return;
      if (axisRayHits(screw.point, screw.axis, screw.sign, piece)) covering.push(index);
    });
    return covering;
  });

  return { pieceIndexById, screwsByPiece, coveringPieces };
}

/* ------------------------------------------------------------ play state */

export function createBoardState(structure: Structure, index: StructureIndex): BoardState {
  return {
    removed: new Array<boolean>(structure.screws.length).fill(false),
    // A piece with no screws could never be unfastened. Infinity says that
    // precisely and keeps `isDisassemblable` able to catch it.
    remainingPerPiece: index.screwsByPiece.map((screws) =>
      screws.length === 0 ? Number.POSITIVE_INFINITY : screws.length,
    ),
  };
}

export function cloneBoardState(state: BoardState): BoardState {
  return {
    removed: state.removed.slice(),
    remainingPerPiece: state.remainingPerPiece.slice(),
  };
}

export function hasFallen(state: BoardState, pieceIndex: number): boolean {
  return state.remainingPerPiece[pieceIndex] === 0;
}

/** Nothing still standing sits in front of it. */
export function isAccessible(index: StructureIndex, state: BoardState, screwId: number): boolean {
  if (state.removed[screwId]) return false;
  const covering = index.coveringPieces[screwId] as number[];
  for (let i = 0; i < covering.length; i++) {
    if (state.remainingPerPiece[covering[i] as number] !== 0) return false;
  }
  return true;
}

export function accessibleScrewIds(
  structure: Structure,
  index: StructureIndex,
  state: BoardState,
): number[] {
  const ids: number[] = [];
  for (let id = 0; id < structure.screws.length; id++) {
    if (isAccessible(index, state, id)) ids.push(id);
  }
  return ids;
}

export function removeScrew(
  structure: Structure,
  index: StructureIndex,
  state: BoardState,
  screwId: number,
): void {
  if (state.removed[screwId]) return;
  state.removed[screwId] = true;
  const screw = structure.screws[screwId] as Screw;
  const pieceIndex = index.pieceIndexById.get(screw.pieceId);
  if (pieceIndex !== undefined) {
    state.remainingPerPiece[pieceIndex] = (state.remainingPerPiece[pieceIndex] as number) - 1;
  }
}

export function restoreScrew(
  structure: Structure,
  index: StructureIndex,
  state: BoardState,
  screwId: number,
): void {
  if (!state.removed[screwId]) return;
  state.removed[screwId] = false;
  const screw = structure.screws[screwId] as Screw;
  const pieceIndex = index.pieceIndexById.get(screw.pieceId);
  if (pieceIndex !== undefined) {
    state.remainingPerPiece[pieceIndex] = (state.remainingPerPiece[pieceIndex] as number) + 1;
  }
}

export function allRemoved(state: BoardState): boolean {
  return state.removed.every(Boolean);
}

export function remainingCount(state: BoardState): number {
  let n = 0;
  for (let i = 0; i < state.removed.length; i++) if (!state.removed[i]) n++;
  return n;
}

export function structureKey(state: BoardState): string {
  let key = '';
  for (let i = 0; i < state.removed.length; i++) key += state.removed[i] ? '1' : '0';
  return key;
}

/* ------------------------------------------------------------ visibility */

/**
 * Could a player looking from direction `toViewer` (unit vector from the object
 * towards the eye, orthographic) see this screw?
 *
 * Two tests. The screw's face must turn towards the viewer by more than a
 * grazing angle, and a ray from the screw towards the viewer must not pass
 * through any piece still standing. The renderer and the trap-rate rollout
 * both use this, so the difficulty model measures what is drawn.
 *
 * This is line of sight only. The renderer also refuses to show a screw that is
 * not free to take, so a covered screw glimpsed past the edge of the plate over
 * it never appears — a visible screw always means a tappable one.
 */
export function isVisibleFrom(
  structure: Structure,
  state: BoardState,
  screwId: number,
  toViewer: Vec3,
  minFacing = 0.2,
): boolean {
  const screw = structure.screws[screwId] as Screw;
  const facing = toViewer[screw.axis]! * screw.sign;
  if (facing <= minFacing) return false;

  // Lift the origin a hair off the face so it does not test against its own piece.
  const origin: Vec3 = [screw.point[0], screw.point[1], screw.point[2]];
  origin[screw.axis] += screw.sign * 1e-3;

  for (let i = 0; i < structure.pieces.length; i++) {
    if (state.remainingPerPiece[i] === 0) continue;
    if (rayHitsBox(origin, toViewer, structure.pieces[i] as Piece)) return false;
  }
  return true;
}

/* -------------------------------------------------------------- validity */

const pointKey = (p: Vec3): string => `${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)}`;

/**
 * Sanity invariants a generated structure must satisfy. A malformed structure
 * fails confusingly and late — as an unsolvable level rather than as an error.
 */
export function isWellFormed(structure: Structure): boolean {
  if (structure.pieces.length === 0 || structure.screws.length === 0) return false;

  const pieceIds = new Set(structure.pieces.map((p) => p.id));
  if (pieceIds.size !== structure.pieces.length) return false;

  const points = new Set<string>();
  for (let i = 0; i < structure.screws.length; i++) {
    const screw = structure.screws[i] as Screw;
    if (screw.id !== i) return false;
    if (screw.color < 0 || screw.color >= structure.colors) return false;

    const piece = structure.pieces.find((p) => p.id === screw.pieceId);
    if (!piece) return false;

    // On one of its piece's faces, strictly inside that face.
    const face = screw.sign > 0 ? piece.max[screw.axis] : piece.min[screw.axis];
    if (Math.abs(screw.point[screw.axis] - face) > EPS) return false;
    const [u, v] = faceAxes(screw.axis);
    if (screw.point[u] <= piece.min[u] || screw.point[u] >= piece.max[u]) return false;
    if (screw.point[v] <= piece.min[v] || screw.point[v] >= piece.max[v]) return false;

    const key = pointKey(screw.point);
    if (points.has(key)) return false;
    points.add(key);
  }

  // Every piece is held by at least one screw, or it could never come off and
  // the level could never end with nothing left.
  for (const piece of structure.pieces) {
    if (!structure.screws.some((screw) => screw.pieceId === piece.id)) return false;
  }
  // Nothing solid passes through anything else.
  for (let i = 0; i < structure.pieces.length; i++) {
    for (let j = i + 1; j < structure.pieces.length; j++) {
      if (boxesOverlap(structure.pieces[i] as Piece, structure.pieces[j] as Piece)) return false;
    }
  }

  return true;
}

/**
 * Every structure must come apart completely when colour is ignored.
 * Generation assembles pieces so this holds by construction; this proves it.
 */
export function isDisassemblable(structure: Structure): boolean {
  const index = indexStructure(structure);
  const state = createBoardState(structure, index);
  let remaining = structure.screws.length;

  while (remaining > 0) {
    const next = accessibleScrewIds(structure, index, state);
    if (next.length === 0) return false;
    for (const id of next) {
      removeScrew(structure, index, state, id);
      remaining--;
    }
  }

  return true;
}

/**
 * Nothing is ever left hanging in mid-air: at every point of any legal
 * disassembly, each piece still standing touches some other piece still
 * standing, or is the one piece holding up the rest.
 *
 * Generation guarantees it by giving every piece a *support* — an earlier piece
 * it touches and covers a screw of, so the support cannot fall first. This
 * checks the guarantee directly: each piece after the first must cover a screw
 * of some piece it touches.
 */
export function isSupported(structure: Structure): boolean {
  for (let i = 1; i < structure.pieces.length; i++) {
    const piece = structure.pieces[i] as Piece;
    let held = false;
    for (let j = 0; j < i && !held; j++) {
      const below = structure.pieces[j] as Piece;
      if (!contactFace(piece, below)) continue;
      held = structure.screws.some(
        (s) => s.pieceId === below.id && axisRayHits(s.point, s.axis, s.sign, piece),
      );
    }
    if (!held) return false;
  }
  return true;
}
