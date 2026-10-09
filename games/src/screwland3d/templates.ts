/**
 * The objects Screw Land 3D's plates are screwed onto.
 *
 * Each family is a small function that builds a recognisable silhouette — a
 * house, a car, a burger — out of axis-aligned boxes, with its proportions and
 * optional pieces rolled from the level's seed. That is what keeps "infinite
 * levels" honest: there are ten families, but the shapes inside each, and
 * every plate and screw laid onto them, are generated fresh.
 *
 * Rules every template keeps, because generation relies on them:
 *  - integer coordinates, so plate footprints tile the faces exactly;
 *  - the object stands on y = 0 and has real area underneath and round the
 *    back, which is where the hidden screws go;
 *  - nothing much past 8 units on a side, so a phone shows it at a size whose
 *    screws can be tapped.
 */

import type { Rng } from '../shared/rng';
import type { Vec3 } from './model';

/** One solid block of an object, before it is given an id and screws. */
export interface Block {
  kind: string;
  min: Vec3;
  max: Vec3;
}

export type TemplateName =
  | 'house'
  | 'car'
  | 'tree'
  | 'boat'
  | 'rocket'
  | 'robot'
  | 'table'
  | 'train'
  | 'burger'
  | 'tower';

export const TEMPLATE_NAMES: readonly TemplateName[] = [
  'house',
  'car',
  'tree',
  'boat',
  'rocket',
  'robot',
  'table',
  'train',
  'burger',
  'tower',
];

/** `size` is 0..1: bigger objects carry more plates without crowding. */
type Builder = (rng: Rng, size: number) => Block[];

const box = (kind: string, min: Vec3, max: Vec3): Block => ({ kind, min, max });

const house: Builder = (rng, size) => {
  const w = 4 + Math.round(size * 2) + rng.int(2); // 4..7
  const d = 3 + Math.round(size) + rng.int(2); // 3..5
  const h = 3 + rng.int(2);
  const parts = [box('wall', [0, 0, 0], [w, h, d]), box('roof', [0, h, 0], [w, h + 1, d])];
  const stepped = w >= 5;
  if (stepped) parts.push(box('roof', [1, h + 1, 0], [w - 1, h + 2, d]));
  if (rng.chance(0.7)) {
    // On the roof's exposed shoulder, clear of the upper step.
    parts.push(box('chimney', [w - 1, h + 1, 1], [w, h + (stepped ? 3 : 2), 2]));
  }
  if (rng.chance(0.5)) parts.push(box('porch', [1, 0, d], [3, 1, d + 1]));
  return parts;
};

const car: Builder = (rng, size) => {
  const l = 5 + Math.round(size * 2) + rng.int(2); // 5..8
  const w = 3 + rng.int(2);
  const parts = [
    box('body', [0, 1, 0], [l, 3, w]),
    box('cabin', [1, 3, 0], [l - 2, 4 + rng.int(2), w]),
  ];
  // Wheels hang off the sides, so the whole underside stays open.
  for (const x of [1, l - 2]) {
    parts.push(box('wheel', [x, 0, -1], [x + 1, 2, 0]));
    parts.push(box('wheel', [x, 0, w], [x + 1, 2, w + 1]));
  }
  if (rng.chance(0.5)) parts.push(box('spoiler', [l - 1, 3, 0], [l, 4, w]));
  return parts;
};

const tree: Builder = (rng, size) => {
  const trunk = 1 + rng.int(2); // 1..2
  const spread = size > 0.5 || rng.chance(0.4) ? 4 : 2; // canopy minus trunk, even
  const c = trunk + spread;
  const t0 = (c - trunk) / 2;
  const trunkTop = 3 + rng.int(2);
  const parts = [
    box('trunk', [t0, 0, t0], [t0 + trunk, trunkTop, t0 + trunk]),
    box('leaves', [0, trunkTop, 0], [c, trunkTop + 2, c]),
    box('leaves', [1, trunkTop + 2, 1], [c - 1, trunkTop + 4, c - 1]),
  ];
  if (c - 4 >= 1) parts.push(box('leaves', [2, trunkTop + 4, 2], [c - 2, trunkTop + 5, c - 2]));
  return parts;
};

const boat: Builder = (rng, size) => {
  const l = 6 + Math.round(size) + rng.int(2); // 6..8
  const w = 3 + rng.int(2);
  const parts = [
    box('hull', [1, 0, 0], [l - 1, 1, w]),
    box('hull', [0, 1, 0], [l, 2, w]),
    box('cabin', [1, 2, 0], [3, 4, w]),
  ];
  const mz = Math.floor(w / 2);
  parts.push(box('mast', [l - 3, 2, mz], [l - 2, 5 + rng.int(2), mz + 1]));
  return parts;
};

const rocket: Builder = (rng, size) => {
  const r = size > 0.5 || rng.chance(0.3) ? 3 : 2; // body cross-section
  const h = 5 + rng.int(2) + Math.round(size);
  const o = 1; // body starts one in, leaving room for fins
  const parts = [
    box('body', [o, 1, o], [o + r, 1 + h, o + r]),
    box('nose', [o + (r === 3 ? 1 : 0), 1 + h, o + (r === 3 ? 1 : 0)], [
      o + (r === 3 ? 2 : r),
      3 + h,
      o + (r === 3 ? 2 : r),
    ]),
  ];
  const mid = o + Math.floor(r / 2);
  parts.push(box('fin', [0, 0, mid], [o, 3, mid + 1]));
  parts.push(box('fin', [o + r, 0, mid], [o + r + 1, 3, mid + 1]));
  if (rng.chance(0.6)) {
    parts.push(box('fin', [mid, 0, 0], [mid + 1, 3, o]));
    parts.push(box('fin', [mid, 0, o + r], [mid + 1, 3, o + r + 1]));
  }
  return parts;
};

const robot: Builder = (rng, size) => {
  const tw = 4 + Math.round(size) + rng.int(2); // 4..6 torso width
  const legH = 2 + rng.int(2);
  const torsoH = 3;
  // Torso first: every later block is screwed to something already built, and
  // the two legs do not touch each other.
  const parts = [
    box('torso', [0, legH, 0], [tw, legH + torsoH, 3]),
    box('leg', [1, 0, 1], [2, legH, 2]),
    box('leg', [tw - 2, 0, 1], [tw - 1, legH, 2]),
    box('head', [1, legH + torsoH, 0], [tw - 1, legH + torsoH + 2, 3]),
    box('arm', [-1, legH, 1], [0, legH + torsoH, 2]),
    box('arm', [tw, legH, 1], [tw + 1, legH + torsoH, 2]),
  ];
  if (rng.chance(0.5)) {
    const ax = Math.floor(tw / 2);
    parts.push(box('antenna', [ax, legH + torsoH + 2, 1], [ax + 1, legH + torsoH + 3, 2]));
  }
  return parts;
};

const table: Builder = (rng, size) => {
  const l = 5 + Math.round(size * 2) + rng.int(2); // 5..8
  const w = 3 + Math.round(size) + rng.int(2); // 3..5
  const h = 3 + rng.int(2);
  const parts = [box('top', [0, h, 0], [l, h + 1, w])];
  for (const [x, z] of [
    [0, 0],
    [l - 1, 0],
    [0, w - 1],
    [l - 1, w - 1],
  ] as const) {
    parts.push(box('leg', [x, 0, z], [x + 1, h, z + 1]));
  }
  // Spans between the legs and touches them, so it has something to be
  // screwed to rather than hanging in the air.
  if (rng.chance(0.4)) parts.push(box('shelf', [1, 1, 0], [l - 1, 2, w]));
  return parts;
};

const train: Builder = (rng, size) => {
  const l = 6 + Math.round(size) + rng.int(2); // 6..8
  const parts = [
    box('base', [0, 1, 0], [l, 2, 3]),
    box('boiler', [0, 2, 0], [l - 3, 4, 3]),
    box('cab', [l - 3, 2, 0], [l, 5, 3]),
    box('funnel', [1, 4, 1], [2, 5 + rng.int(2), 2]),
  ];
  for (const x of [1, l - 2]) {
    parts.push(box('wheel', [x, 0, -1], [x + 1, 2, 0]));
    parts.push(box('wheel', [x, 0, 3], [x + 1, 2, 4]));
  }
  return parts;
};

/**
 * Bun, fillings, bun, dome. Every layer is its own part so each can be its own
 * colour; the fillings are rolled, so no two burgers stack the same.
 */
const burger: Builder = (rng, size) => {
  const w = 4 + (size > 0.5 || rng.chance(0.4) ? 1 : 0);
  const fillings = ['patty', 'cheese', 'lettuce', 'tomato', 'patty'];
  rng.shuffle(fillings);
  const count = 3 + rng.int(2) + (size > 0.6 ? 1 : 0);
  const layers = ['patty', ...fillings.slice(0, count - 1)];
  const parts = [box('bun', [0, 0, 0], [w, 1, w])];
  let y = 1;
  for (const kind of layers) {
    parts.push(box(kind, [0, y, 0], [w, y + 1, w]));
    y++;
  }
  parts.push(box('bun', [0, y, 0], [w, y + 1, w]));
  parts.push(box('dome', [1, y + 1, 1], [w - 1, y + 2, w - 1]));
  return parts;
};

/**
 * A tower of bars stacked crosswise, two to a layer, in alternating tones —
 * a toy Jenga — under a cap.
 *
 * Bars rather than the four cubes a layer used to have: every block now needs
 * screws of its own and one hidden under it, and four cubes a layer cost more
 * screws than an early level has.
 */
const tower: Builder = (rng, size) => {
  // At least three layers, or it is a cube rather than a tower.
  const layers = 3 + rng.int(2) + (size > 0.6 ? 1 : 0);
  const parts: Block[] = [];
  for (let layer = 0; layer < layers; layer++) {
    const y = layer * 2;
    for (const k of [0, 1]) {
      const tone = (layer + k) % 2 === 0 ? 'light' : 'dark';
      parts.push(
        layer % 2 === 0
          ? box(tone, [0, y, k * 2], [4, y + 2, k * 2 + 2])
          : box(tone, [k * 2, y, 0], [k * 2 + 2, y + 2, 4]),
      );
    }
  }
  parts.push(box('cap', [1, layers * 2, 1], [3, layers * 2 + 1, 3]));
  return parts;
};

const BUILDERS: Record<TemplateName, Builder> = {
  house,
  car,
  tree,
  boat,
  rocket,
  robot,
  table,
  train,
  burger,
  tower,
};

export function buildTemplate(name: TemplateName, rng: Rng, size: number): Block[] {
  return BUILDERS[name](rng, Math.min(1, Math.max(0, size)));
}
