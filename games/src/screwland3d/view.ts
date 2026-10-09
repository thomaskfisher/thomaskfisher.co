/**
 * Camera maths for Screw Land 3D. Pure, so it can be tested without a GPU.
 *
 * The view is a single rotation matrix `R`, row-major, taking object
 * coordinates to view coordinates: x right, y up, z towards the eye. Projection
 * is orthographic, which is a deliberate choice rather than a shortcut: it is
 * what makes "visible" mean exactly the same thing to the renderer as to
 * `isVisibleFrom` in the model, and therefore to the difficulty model. A screw
 * the rules let you take is always visible when you look straight down its
 * normal, with no perspective sliver to argue about.
 */

import { DEFAULT_VIEW } from './generate';
import {
  type Axis,
  type BoardState,
  type Screw,
  type Structure,
  type Vec3,
  faceAxes,
  isVisibleFrom,
} from './model';

export type Mat3 = [number, number, number, number, number, number, number, number, number];
export type Quat = [number, number, number, number];

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const n = len(a) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

export function row(m: Mat3, i: 0 | 1 | 2): Vec3 {
  return [m[i * 3]!, m[i * 3 + 1]!, m[i * 3 + 2]!];
}

const fromRows = (x: Vec3, y: Vec3, z: Vec3): Mat3 => [...x, ...y, ...z] as Mat3;

/** Rotation that puts the eye along `toViewer`, keeping `up` as upright as it can. */
export function lookFrom(toViewer: Vec3, up: Vec3 = [0, 1, 0]): Mat3 {
  const z = normalize(toViewer);
  let x = cross(up, z);
  if (len(x) < 1e-4) x = cross([0, 0, 1], z);
  if (len(x) < 1e-4) x = cross([1, 0, 0], z);
  x = normalize(x);
  const y = cross(z, x);
  return fromRows(x, y, z);
}

export const defaultRotation = (): Mat3 => lookFrom(DEFAULT_VIEW);

/** The direction from the object towards the eye, in object coordinates. */
export const viewerDirection = (r: Mat3): Vec3 => row(r, 2);

export function multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9) as Mat3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i * 3 + j] =
        a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!;
    }
  }
  return out;
}

/** Gram-Schmidt, so a long drag never accumulates into a shear. */
export function orthonormalize(m: Mat3): Mat3 {
  const x = normalize(row(m, 0));
  let y = row(m, 1);
  const d = dot(x, y);
  y = normalize([y[0] - x[0] * d, y[1] - x[1] * d, y[2] - x[2] * d]);
  return fromRows(x, y, cross(x, y));
}

/**
 * Turns the object as if the finger were on its surface: dragging right spins
 * it about the screen's vertical axis, dragging down tips it towards you.
 */
export function dragRotate(r: Mat3, dxPx: number, dyPx: number, radiansPerPx: number): Mat3 {
  const a = dxPx * radiansPerPx;
  const b = dyPx * radiansPerPx;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  const ry: Mat3 = [ca, 0, sa, 0, 1, 0, -sa, 0, ca];
  const rx: Mat3 = [1, 0, 0, 0, cb, -sb, 0, sb, cb];
  return orthonormalize(multiply(multiply(rx, ry), r));
}

/* ----------------------------------------------------------- quaternions */

export function toQuat(m: Mat3): Quat {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const trace = m00 + m11 + m22;
  let q: Quat;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  const n = Math.hypot(...q) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

export function fromQuat([x, y, z, w]: Quat): Mat3 {
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - z * w),
    2 * (x * z + y * w),
    2 * (x * y + z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z - x * w),
    2 * (x * z - y * w),
    2 * (y * z + x * w),
    1 - 2 * (x * x + y * y),
  ];
}

export function slerp(a: Quat, b: Quat, t: number): Quat {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) {
    d = -d;
    bb = [-b[0], -b[1], -b[2], -b[3]];
  }
  if (d > 0.9995) {
    const q: Quat = [
      a[0] + (bb[0] - a[0]) * t,
      a[1] + (bb[1] - a[1]) * t,
      a[2] + (bb[2] - a[2]) * t,
      a[3] + (bb[3] - a[3]) * t,
    ];
    const n = Math.hypot(...q) || 1;
    return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
  }
  const theta = Math.acos(d);
  const s = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / s;
  const wb = Math.sin(t * theta) / s;
  return [
    a[0] * wa + bb[0] * wb,
    a[1] * wa + bb[1] * wb,
    a[2] * wa + bb[2] * wb,
    a[3] * wa + bb[3] * wb,
  ];
}

/* ------------------------------------------------------------ projection */

/** Object point to view space, relative to `center`. */
export function toView(r: Mat3, p: Vec3, center: Vec3): Vec3 {
  const d: Vec3 = [p[0] - center[0], p[1] - center[1], p[2] - center[2]];
  return [dot(row(r, 0), d), dot(row(r, 1), d), dot(row(r, 2), d)];
}

/**
 * A CSS `matrix()` that lays a circle onto a face lying across `axis`: the two
 * in-face unit vectors as they appear on screen. Applied to a round screw head
 * it draws the ellipse that head actually makes from this angle.
 */
export function discMatrix(r: Mat3, axis: Axis): [number, number, number, number] {
  const [u, v] = faceAxes(axis);
  const eu: Vec3 = [0, 0, 0];
  const ev: Vec3 = [0, 0, 0];
  eu[u] = 1;
  ev[v] = 1;
  // Screen y runs down; view y runs up.
  return [dot(row(r, 0), eu), -dot(row(r, 1), eu), dot(row(r, 0), ev), -dot(row(r, 1), ev)];
}

/** How squarely a face turns towards the eye, 0 edge-on to 1 face-on. */
export function facing(r: Mat3, screw: Screw): number {
  return viewerDirection(r)[screw.axis] * screw.sign;
}

/**
 * Where to turn the object so a hinted screw is in plain view, or null when it
 * already is.
 *
 * Straight down the screw's normal always works — the rules guarantee nothing
 * stands in front of a reachable screw — but it is a flat, disorienting view.
 * So it first tries leaning back towards wherever the player is already
 * looking, and settles for the head-on view only if every lean is blocked.
 */
export function hintRotation(
  structure: Structure,
  state: BoardState,
  screwId: number,
  current: Mat3,
): Mat3 | null {
  const screw = structure.screws[screwId] as Screw;
  const eye = viewerDirection(current);
  if (facing(current, screw) > 0.4 && isVisibleFrom(structure, state, screwId, eye)) return null;

  const n: Vec3 = [0, 0, 0];
  n[screw.axis] = screw.sign;

  const candidates: Vec3[] = [];
  for (const t of [0.45, 0.3, 0.15]) {
    candidates.push(normalize([n[0] + eye[0] * t, n[1] + eye[1] * t, n[2] + eye[2] * t]));
  }
  // An upright-ish lean as a second family, for when the current eye is behind.
  for (const t of [0.4, 0.2]) {
    candidates.push(normalize([n[0] + DEFAULT_VIEW[0] * t, n[1] + DEFAULT_VIEW[1] * t, n[2] + DEFAULT_VIEW[2] * t]));
  }
  candidates.push(n);

  const up = row(current, 1);
  for (const dir of candidates) {
    if (len(dir) < 1e-3) continue;
    if (dir[screw.axis] * screw.sign <= 0.45) continue;
    if (isVisibleFrom(structure, state, screwId, dir)) return lookFrom(dir, up);
  }
  return lookFrom(n, up);
}
