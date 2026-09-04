/**
 * Generates the PWA icons.
 *
 * Icons are drawn in code rather than kept as binary assets, so there is no
 * design-tool round trip when a color changes, and nothing to lose track of.
 * Run with `npm run icons`; the output is committed.
 *
 * Rendering uses a bare PNG encoder (zlib stored blocks + CRC) so the project
 * needs no image dependency at all.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

/* ------------------------------------------------------------- PNG output */

function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** RGBA pixel buffer -> PNG. */
function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolor + alpha
  // 10..12 default to 0: deflate, adaptive filtering, no interlace.

  // One filter byte (0 = none) per scanline.
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------ drawing kit */

function createCanvas(size) {
  const data = Buffer.alloc(size * size * 4);
  return {
    size,
    data,
    set(x, y, [r, g, b], alpha = 1) {
      if (x < 0 || y < 0 || x >= size || y >= size || alpha <= 0) return;
      const i = (y * size + x) * 4;
      const existing = data[i + 3] / 255;
      const out = alpha + existing * (1 - alpha);
      // Standard source-over compositing.
      data[i] = (r * alpha + data[i] * existing * (1 - alpha)) / out;
      data[i + 1] = (g * alpha + data[i + 1] * existing * (1 - alpha)) / out;
      data[i + 2] = (b * alpha + data[i + 2] * existing * (1 - alpha)) / out;
      data[i + 3] = out * 255;
    },
  };
}

/** Coverage of a pixel by a rounded rectangle, sampled 3x3 for antialiasing. */
function roundedRectCoverage(px, py, x, y, w, h, radius) {
  let hits = 0;
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const cx = px + (sx + 0.5) / 3;
      const cy = py + (sy + 0.5) / 3;
      if (cx < x || cy < y || cx > x + w || cy > y + h) continue;

      const dx = Math.max(x + radius - cx, cx - (x + w - radius), 0);
      const dy = Math.max(y + radius - cy, cy - (y + h - radius), 0);
      if (dx * dx + dy * dy <= radius * radius) hits++;
    }
  }
  return hits / 9;
}

function fillRoundedRect(canvas, x, y, w, h, radius, color, alpha = 1) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(canvas.size, Math.ceil(x + w));
  const y1 = Math.min(canvas.size, Math.ceil(y + h));

  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const coverage = roundedRectCoverage(px, py, x, y, w, h, radius);
      if (coverage > 0) canvas.set(px, py, color, coverage * alpha);
    }
  }
}

const hex = (value) => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
];

/* ------------------------------------------------------------- icon design */

const BACKGROUND = hex('#101a2e');
const TUBE_GLASS = hex('#8fa6c9');

/**
 * Three tubes: one sorted, two mid-sort. Reads at 48px as "sorting puzzle"
 * rather than as an abstract mark.
 */
function drawColorSort(size, { maskable }) {
  const canvas = createCanvas(size);

  // Maskable icons must keep their content inside the safe zone, because the
  // platform is free to crop the outer ~10% to any shape it likes.
  const inset = maskable ? size * 0.18 : size * 0.1;
  const radius = maskable ? 0 : size * 0.22;

  fillRoundedRect(canvas, 0, 0, size, size, radius, BACKGROUND);

  const columns = [
    ['#e6394a', '#e6394a', '#e6394a'],
    ['#f5c518', '#2b7fe8', '#f5c518'],
    ['#2b7fe8', '#f5c518', '#2b7fe8'],
  ];

  const area = size - inset * 2;
  const tubeWidth = area * 0.22;
  const gap = (area - tubeWidth * 3) / 2;
  const tubeHeight = area * 0.86;
  const top = inset + (area - tubeHeight) / 2;
  const bandHeight = tubeHeight / 3.4;

  columns.forEach((bands, column) => {
    const x = inset + column * (tubeWidth + gap);

    fillRoundedRect(canvas, x, top, tubeWidth, tubeHeight, tubeWidth * 0.42, TUBE_GLASS, 0.2);

    bands.forEach((color, row) => {
      const bandY = top + tubeHeight - (row + 1) * bandHeight - tubeWidth * 0.08;
      const isBottom = row === 0;
      fillRoundedRect(
        canvas,
        x + tubeWidth * 0.13,
        bandY,
        tubeWidth * 0.74,
        bandHeight * 0.94,
        isBottom ? tubeWidth * 0.3 : tubeWidth * 0.06,
        hex(color),
      );
    });
  });

  return encodePng(size, size, canvas.data);
}

/**
 * A plate corner with three coloured screw heads. Reads at 48px as "unscrew
 * this", which is the whole game.
 */
function drawScrewLand(size, { maskable }) {
  const canvas = createCanvas(size);

  const inset = maskable ? size * 0.19 : size * 0.11;
  const radius = maskable ? 0 : size * 0.22;

  fillRoundedRect(canvas, 0, 0, size, size, radius, BACKGROUND);

  const area = size - inset * 2;

  // Two overlapping plates, so the layering the game is built on is visible.
  fillRoundedRect(
    canvas,
    inset,
    inset + area * 0.16,
    area * 0.66,
    area * 0.84,
    area * 0.09,
    hex('#4f5d76'),
  );
  fillRoundedRect(
    canvas,
    inset + area * 0.3,
    inset,
    area * 0.7,
    area * 0.62,
    area * 0.09,
    hex('#7d8ca6'),
  );

  // Screw heads: two on the upper plate, one on the lower.
  const heads = [
    [0.52, 0.17, '#e6394a'],
    [0.84, 0.42, '#f5c518'],
    [0.22, 0.74, '#2b7fe8'],
  ];

  const headRadius = area * 0.1;
  for (const [fx, fy, color] of heads) {
    const cx = inset + area * fx;
    const cy = inset + area * fy;
    fillRoundedRect(
      canvas,
      cx - headRadius,
      cy - headRadius,
      headRadius * 2,
      headRadius * 2,
      headRadius,
      hex(color),
    );
    // Slot across the head.
    fillRoundedRect(
      canvas,
      cx - headRadius * 0.62,
      cy - headRadius * 0.16,
      headRadius * 1.24,
      headRadius * 0.32,
      headRadius * 0.16,
      hex('#101a2e'),
      0.55,
    );
  }

  return encodePng(size, size, canvas.data);
}

/**
 * A bus with three coloured windows over three waiting heads in the same
 * colours. Reads at 48px as "match these people to that bus", which is the
 * whole game.
 */
function drawBusJam(size, { maskable }) {
  const canvas = createCanvas(size);

  const inset = maskable ? size * 0.19 : size * 0.11;
  const radius = maskable ? 0 : size * 0.22;

  fillRoundedRect(canvas, 0, 0, size, size, radius, BACKGROUND);

  const area = size - inset * 2;
  const colors = ['#e6394a', '#2b7fe8', '#35b56a'];

  // Bus body across the top two fifths.
  const bodyY = inset + area * 0.06;
  const bodyH = area * 0.44;
  fillRoundedRect(canvas, inset, bodyY, area, bodyH, area * 0.13, hex('#dfe6f2'));

  // Three windows, one per colour, so the bus is not committed to one hue.
  const windowW = area * 0.22;
  const windowGap = (area - windowW * 3) / 4;
  colors.forEach((color, i) => {
    fillRoundedRect(
      canvas,
      inset + windowGap + i * (windowW + windowGap),
      bodyY + bodyH * 0.2,
      windowW,
      bodyH * 0.44,
      area * 0.035,
      hex(color),
    );
  });

  // Wheels, tucked under the body so the shape reads as a vehicle.
  const wheelR = area * 0.075;
  for (const fx of [0.24, 0.76]) {
    fillRoundedRect(
      canvas,
      inset + area * fx - wheelR,
      bodyY + bodyH - wheelR * 0.5,
      wheelR * 2,
      wheelR * 2,
      wheelR,
      hex('#39445c'),
    );
  }

  // The crowd waiting below: a head and shoulders each.
  const headR = area * 0.082;
  colors.forEach((color, i) => {
    const cx = inset + area * (0.22 + i * 0.28);
    const cy = inset + area * 0.78;
    fillRoundedRect(canvas, cx - headR, cy - headR, headR * 2, headR * 2, headR, hex(color));
    fillRoundedRect(
      canvas,
      cx - headR * 1.15,
      cy + headR * 1.15,
      headR * 2.3,
      headR * 1.5,
      headR * 0.55,
      hex(color),
    );
  });

  return encodePng(size, size, canvas.data);
}


/**
 * The lane in miniature: a red horde across the top, two gates below it in the
 * colours the game uses for add and multiply, and the squad at the bottom.
 * Reads at 48px as "get past those to reach that", which is the whole game.
 */
function drawSurvival(size, { maskable }) {
  const canvas = createCanvas(size);

  const inset = maskable ? size * 0.19 : size * 0.11;
  const radius = maskable ? 0 : size * 0.22;

  fillRoundedRect(canvas, 0, 0, size, size, radius, BACKGROUND);

  const area = size - inset * 2;

  // The horde: a packed band across the top.
  fillRoundedRect(canvas, inset, inset, area, area * 0.24, area * 0.06, hex('#b6303f'));
  const headR = area * 0.037;
  for (let column = 0; column < 6; column++) {
    for (let rank = 0; rank < 2; rank++) {
      const cx = inset + area * (0.11 + column * 0.156);
      const cy = inset + area * (0.08 + rank * 0.09);
      fillRoundedRect(canvas, cx - headR, cy - headR, headR * 2, headR * 2, headR, hex('#8e2331'));
    }
  }

  // Two gates, one per operation, side by side the way a row of them sits.
  const gateW = area * 0.44;
  const gateH = area * 0.23;
  const gateY = inset + area * 0.36;
  fillRoundedRect(canvas, inset, gateY, gateW, gateH, area * 0.05, hex('#35b56a'));
  fillRoundedRect(canvas, inset + area - gateW, gateY, gateW, gateH, area * 0.05, hex('#2b7fe8'));

  // A plus on the left gate and a cross on the right, drawn as bars so they
  // survive the downscale to 48px where a glyph would turn to mush.
  const bar = area * 0.045;
  const armL = gateW * 0.3;
  const leftX = inset + gateW / 2;
  const midY = gateY + gateH / 2;
  fillRoundedRect(canvas, leftX - armL / 2, midY - bar / 2, armL, bar, bar / 2, hex('#ffffff'));
  fillRoundedRect(canvas, leftX - bar / 2, midY - armL / 2, bar, armL, bar / 2, hex('#ffffff'));

  const rightX = inset + area - gateW / 2;
  for (const sign of [1, -1]) {
    // A rotated bar, rasterised as a short stack of offset segments.
    const steps = 9;
    for (let i = 0; i < steps; i++) {
      const t = (i / (steps - 1) - 0.5) * armL * 0.78;
      fillRoundedRect(
        canvas,
        rightX + t - bar / 2,
        midY + t * sign - bar / 2,
        bar,
        bar,
        bar / 2,
        hex('#ffffff'),
      );
    }
  }

  // The squad: a small wedge of soldiers at the bottom, in the accent blue.
  const soldierR = area * 0.055;
  const wedge = [
    [0.5, 0.74],
    [0.38, 0.86],
    [0.62, 0.86],
    [0.5, 0.94],
  ];
  for (const [fx, fy] of wedge) {
    const cx = inset + area * fx;
    const cy = inset + area * fy;
    fillRoundedRect(
      canvas,
      cx - soldierR,
      cy - soldierR,
      soldierR * 2,
      soldierR * 2,
      soldierR,
      hex('#4da3ff'),
    );
  }

  return encodePng(size, size, canvas.data);
}

/**
 * Two dice, the larger showing five.
 *
 * A whole hand of five would be five specks at 48px. One die reads as dice
 * immediately, and the second one behind it says there is more than one — which
 * is the difference between this icon and a generic app tile.
 */
function drawFiveDice(size, { maskable }) {
  const canvas = createCanvas(size);

  const inset = maskable ? size * 0.19 : size * 0.11;
  const radius = maskable ? 0 : size * 0.22;

  fillRoundedRect(canvas, 0, 0, size, size, radius, BACKGROUND);

  const area = size - inset * 2;
  const pip = (die, fx, fy, color) => {
    const r = die.w * 0.105;
    fillRoundedRect(canvas, die.x + die.w * fx - r, die.y + die.w * fy - r, r * 2, r * 2, r, color);
  };

  // The one behind, top right: smaller, dimmer, and clipped by the front die.
  const back = { x: inset + area * 0.44, y: inset + area * 0.02, w: area * 0.44 };
  fillRoundedRect(canvas, back.x, back.y, back.w, back.w, back.w * 0.2, hex('#2b3f66'));
  for (const [fx, fy] of [
    [0.26, 0.26],
    [0.5, 0.5],
    [0.74, 0.74],
  ]) {
    pip(back, fx, fy, hex('#8fa6c9'));
  }

  // The front die: accent blue, white pips, showing five.
  const front = { x: inset + area * 0.02, y: inset + area * 0.28, w: area * 0.7 };
  fillRoundedRect(canvas, front.x, front.y, front.w, front.w, front.w * 0.2, hex('#4da3ff'));
  for (const [fx, fy] of [
    [0.26, 0.26],
    [0.74, 0.26],
    [0.5, 0.5],
    [0.26, 0.74],
    [0.74, 0.74],
  ]) {
    pip(front, fx, fy, hex('#ffffff'));
  }

  return encodePng(size, size, canvas.data);
}

/* --------------------------------------------------------------- generate */

mkdirSync(OUT_DIR, { recursive: true });

/**
 * A red car boxed in by two others, with the gap it is aiming for on the right.
 * Reads at 48px as "get that one out", which is the whole game.
 */
function drawGridlock(size, { maskable }) {
  const canvas = createCanvas(size);

  const inset = maskable ? size * 0.19 : size * 0.11;
  const radius = maskable ? 0 : size * 0.22;

  fillRoundedRect(canvas, 0, 0, size, size, radius, BACKGROUND);

  const area = size - inset * 2;
  // A four-by-four park rather than the game's six-by-six: at 48px, six bays
  // put every car below two pixels and the whole thing turns to grey mush.
  const cell = area / 4;

  fillRoundedRect(canvas, inset, inset, area, area, area * 0.07, hex('#1b2a45'));

  // Bay markings, kept faint — they are texture, not information.
  for (let line = 1; line < 4; line++) {
    fillRoundedRect(canvas, inset + line * cell - area * 0.004, inset, area * 0.008, area, 0, hex('#33507f'));
    fillRoundedRect(canvas, inset, inset + line * cell - area * 0.004, area, area * 0.008, 0, hex('#33507f'));
  }

  const car = (column, row, length, vertical, color) => {
    const pad = cell * 0.13;
    fillRoundedRect(
      canvas,
      inset + column * cell + pad,
      inset + row * cell + pad,
      (vertical ? 1 : length) * cell - pad * 2,
      (vertical ? length : 1) * cell - pad * 2,
      cell * 0.2,
      hex(color),
    );
  };

  // The red car in the exit row, and the two verticals standing in its way.
  car(0, 1, 2, false, '#e6394a');
  car(2, 0, 2, true, '#4da3ff');
  car(3, 1, 2, true, '#f5c518');

  // The gap in the wall: a break in the right-hand edge on the exit row.
  const wall = area * 0.05;
  const wallX = inset + area - wall * 0.4;
  fillRoundedRect(canvas, wallX, inset, wall, cell, 0, hex('#e6394a'), 0.25);
  fillRoundedRect(canvas, wallX, inset + cell * 2, wall, area - cell * 2, 0, hex('#e6394a'), 0.25);

  return encodePng(size, size, canvas.data);
}

const targets = [
  ['colorsort-180.png', 180, { maskable: false }, drawColorSort],
  ['colorsort-192.png', 192, { maskable: false }, drawColorSort],
  ['colorsort-512.png', 512, { maskable: false }, drawColorSort],
  ['colorsort-maskable-512.png', 512, { maskable: true }, drawColorSort],
  ['screwland-180.png', 180, { maskable: false }, drawScrewLand],
  ['screwland-192.png', 192, { maskable: false }, drawScrewLand],
  ['screwland-512.png', 512, { maskable: false }, drawScrewLand],
  ['screwland-maskable-512.png', 512, { maskable: true }, drawScrewLand],
  ['busjam-180.png', 180, { maskable: false }, drawBusJam],
  ['busjam-192.png', 192, { maskable: false }, drawBusJam],
  ['busjam-512.png', 512, { maskable: false }, drawBusJam],
  ['busjam-maskable-512.png', 512, { maskable: true }, drawBusJam],
  ['survival-180.png', 180, { maskable: false }, drawSurvival],
  ['survival-192.png', 192, { maskable: false }, drawSurvival],
  ['survival-512.png', 512, { maskable: false }, drawSurvival],
  ['survival-maskable-512.png', 512, { maskable: true }, drawSurvival],
  ['fivedice-180.png', 180, { maskable: false }, drawFiveDice],
  ['fivedice-192.png', 192, { maskable: false }, drawFiveDice],
  ['fivedice-512.png', 512, { maskable: false }, drawFiveDice],
  ['fivedice-maskable-512.png', 512, { maskable: true }, drawFiveDice],
  ['gridlock-180.png', 180, { maskable: false }, drawGridlock],
  ['gridlock-192.png', 192, { maskable: false }, drawGridlock],
  ['gridlock-512.png', 512, { maskable: false }, drawGridlock],
  ['gridlock-maskable-512.png', 512, { maskable: true }, drawGridlock],
];

for (const [name, size, options, draw] of targets) {
  writeFileSync(join(OUT_DIR, name), draw(size, options));
  console.log(`wrote icons/${name} (${size}x${size})`);
}
