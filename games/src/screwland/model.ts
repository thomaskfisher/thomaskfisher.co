/**
 * Screw Land rules. Pure — no DOM, no storage, no randomness.
 *
 * The original is a 3D object you rotate. The 3D is skin: the actual puzzle is
 * that plates overlap, and a screw under another plate cannot be reached until
 * the plate above loses all of *its* screws and falls away. That is fully
 * expressible with layered rectangles, which has the large advantage of being
 * procedurally generatable — a library of hand-modelled 3D objects would cap
 * "infinite levels" at however many objects someone modelled.
 *
 * Coordinates are grid units. A plate covers the half-open rect
 * [x, x+w) x [y, y+h); a screw sits at a lattice point inside its plate.
 */

export interface Plate {
  id: number;
  /** Higher is nearer the viewer. */
  layer: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Screw {
  id: number;
  color: number;
  /** The plate this screw fastens; removing every one of them drops the plate. */
  plateId: number;
  x: number;
  y: number;
}

export interface Structure {
  plates: Plate[];
  screws: Screw[];
  gridWidth: number;
  gridHeight: number;
  colors: number;
}

/**
 * Derived lookup tables.
 *
 * Checking "is this screw reachable" from the raw structure costs
 * O(screws x plates) per screw, which the solver would pay millions of times.
 * Precomputing which plates can ever block each screw turns it into a walk over
 * a handful of counters.
 */
export interface StructureIndex {
  /** plate array index, by plate id. */
  plateIndexById: Map<number, number>;
  /** plate index -> ids of the screws fastening it. */
  screwsByPlate: number[][];
  /** screw id -> plate indices that sit above it and cover its point. */
  coveringPlates: number[][];
}

/** Mutable play state. `remainingPerPlate` is what makes accessibility cheap. */
export interface BoardState {
  removed: boolean[];
  remainingPerPlate: number[];
}

function contains(plate: Plate, x: number, y: number): boolean {
  return x >= plate.x && x < plate.x + plate.w && y >= plate.y && y < plate.y + plate.h;
}

/**
 * Tight bounding box of the plates, in grid units.
 *
 * Plates rarely reach the edges of the nominal grid, so sizing the board to
 * `gridWidth x gridHeight` leaves dead margins and shrinks the object for no
 * reason. Both the renderer and the fitter work from these bounds instead.
 */
export function structureBounds(structure: Structure): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const plate of structure.plates) {
    minX = Math.min(minX, plate.x);
    minY = Math.min(minY, plate.y);
    maxX = Math.max(maxX, plate.x + plate.w);
    maxY = Math.max(maxY, plate.y + plate.h);
  }

  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, w: structure.gridWidth, h: structure.gridHeight };
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function platesOverlap(a: Plate, b: Plate): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function indexStructure(structure: Structure): StructureIndex {
  const plateIndexById = new Map<number, number>();
  structure.plates.forEach((plate, index) => plateIndexById.set(plate.id, index));

  const screwsByPlate: number[][] = structure.plates.map(() => []);
  for (const screw of structure.screws) {
    const index = plateIndexById.get(screw.plateId);
    if (index !== undefined) (screwsByPlate[index] as number[]).push(screw.id);
  }

  const coveringPlates: number[][] = structure.screws.map((screw) => {
    const ownIndex = plateIndexById.get(screw.plateId);
    const own = ownIndex === undefined ? undefined : structure.plates[ownIndex];
    if (!own) return [];

    const covering: number[] = [];
    structure.plates.forEach((plate, index) => {
      if (plate.id === screw.plateId) return;
      if (plate.layer <= own.layer) return;
      if (contains(plate, screw.x, screw.y)) covering.push(index);
    });
    return covering;
  });

  return { plateIndexById, screwsByPlate, coveringPlates };
}

export function createBoardState(structure: Structure, index: StructureIndex): BoardState {
  return {
    removed: new Array<boolean>(structure.screws.length).fill(false),
    // A plate with no screws can never be unfastened, so it must never reach
    // zero and read as fallen. Infinity says "permanently stuck" precisely, and
    // keeps `isDisassemblable` able to catch it — such a plate would block
    // everything beneath it forever.
    remainingPerPlate: index.screwsByPlate.map((screws) =>
      screws.length === 0 ? Number.POSITIVE_INFINITY : screws.length,
    ),
  };
}

export function cloneBoardState(state: BoardState): BoardState {
  return {
    removed: state.removed.slice(),
    remainingPerPlate: state.remainingPerPlate.slice(),
  };
}

/** A plate is gone once every screw fastening it has been removed. */
export function hasFallen(state: BoardState, plateIndex: number): boolean {
  return state.remainingPerPlate[plateIndex] === 0;
}

/**
 * A screw can be tapped when no surviving plate above it covers the point.
 * This single rule is the whole puzzle: it forces you to clear the top layer
 * before the layer beneath becomes reachable.
 */
export function isAccessible(index: StructureIndex, state: BoardState, screwId: number): boolean {
  if (state.removed[screwId]) return false;
  const covering = index.coveringPlates[screwId] as number[];
  for (let i = 0; i < covering.length; i++) {
    if (state.remainingPerPlate[covering[i] as number] !== 0) return false;
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
  const plateIndex = index.plateIndexById.get(screw.plateId);
  if (plateIndex !== undefined) {
    state.remainingPerPlate[plateIndex] = (state.remainingPerPlate[plateIndex] as number) - 1;
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
  const plateIndex = index.plateIndexById.get(screw.plateId);
  if (plateIndex !== undefined) {
    state.remainingPerPlate[plateIndex] = (state.remainingPerPlate[plateIndex] as number) + 1;
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

/** Identity for memoising search: which screws are gone determines the rest. */
export function structureKey(state: BoardState): string {
  let key = '';
  for (let i = 0; i < state.removed.length; i++) key += state.removed[i] ? '1' : '0';
  return key;
}

/**
 * Sanity invariants a generated structure must satisfy. A malformed structure
 * fails confusingly and late — as an unsolvable level rather than as an error.
 */
export function isWellFormed(structure: Structure): boolean {
  if (structure.plates.length === 0 || structure.screws.length === 0) return false;

  const plateIds = new Set(structure.plates.map((p) => p.id));
  if (plateIds.size !== structure.plates.length) return false;

  for (let i = 0; i < structure.screws.length; i++) {
    const screw = structure.screws[i] as Screw;
    if (screw.id !== i) return false; // ids must index the array
    const plate = structure.plates.find((p) => p.id === screw.plateId);
    if (!plate || !contains(plate, screw.x, screw.y)) return false;
    if (screw.color < 0 || screw.color >= structure.colors) return false;
  }

  // Every plate needs at least one screw, or it could never have stood.
  for (const plate of structure.plates) {
    if (!structure.screws.some((screw) => screw.plateId === plate.id)) return false;
  }

  // Two screws sharing a point would leave one permanently unclickable.
  const points = new Set<string>();
  for (const screw of structure.screws) {
    const key = `${screw.x},${screw.y}`;
    if (points.has(key)) return false;
    points.add(key);
  }

  return true;
}

/**
 * Every structure must come apart when colour is ignored: repeatedly taking all
 * reachable screws must clear the board. Generation builds structures bottom-up
 * so this holds by construction; this proves it.
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
