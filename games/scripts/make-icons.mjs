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

/**
 * Coverage of a pixel by a triangle, sampled 3x3 for antialiasing.
 *
 * The rounded rectangle is the only shape this file needed until backgammon,
 * which is nothing but triangles. Same sampling, same compositing — an edge
 * function per side, and a point is inside when all three agree on its sign.
 */
function fillTriangle(canvas, [ax, ay], [bx, by], [cx, cy], color, alpha = 1) {
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const x1 = Math.min(canvas.size, Math.ceil(Math.max(ax, bx, cx)));
  const y1 = Math.min(canvas.size, Math.ceil(Math.max(ay, by, cy)));

  const edge = (px, py, sx, sy, ex, ey) => (px - sx) * (ey - sy) - (py - sy) * (ex - sx);

  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      let hits = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const qx = px + (sx + 0.5) / 3;
          const qy = py + (sy + 0.5) / 3;
          const e0 = edge(qx, qy, ax, ay, bx, by);
          const e1 = edge(qx, qy, bx, by, cx, cy);
          const e2 = edge(qx, qy, cx, cy, ax, ay);
          if ((e0 >= 0 && e1 >= 0 && e2 >= 0) || (e0 <= 0 && e1 <= 0 && e2 <= 0)) hits++;
        }
      }
      if (hits > 0) canvas.set(px, py, color, (hits / 9) * alpha);
    }
  }
}


/**
 * A thick line, as two triangles.
 *
 * Artillery wanted this: a tank barrel and a shell's arc are both strokes, and
 * everything else in this file is a rounded rectangle or a triangle because
 * nothing had needed one before. Same sampling, same compositing.
 */
function fillLine(canvas, [ax, ay], [bx, by], width, color, alpha = 1) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy) || 1;
  const px = (-dy / length) * (width / 2);
  const py = (dx / length) * (width / 2);

  fillTriangle(canvas, [ax + px, ay + py], [ax - px, ay - py], [bx - px, by - py], color, alpha);
  fillTriangle(canvas, [ax + px, ay + py], [bx - px, by - py], [bx + px, by + py], color, alpha);
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


/**
 * A jammed lot with one bay above it.
 *
 * At 48px the buses are three pixels of colour each, so the mark has to read
 * from the *arrangement* rather than from any one shape: a tight interlocking
 * block of colours with one pulled clear above it says "get that one out"
 * without a single legible detail.
 */
function drawDepot(size, { maskable }) {
  const canvas = createCanvas(size);

  const inset = maskable ? size * 0.19 : size * 0.11;
  const radius = maskable ? 0 : size * 0.22;

  fillRoundedRect(canvas, 0, 0, size, size, radius, BACKGROUND);

  const area = size - inset * 2;

  // The bay across the top third, with the bus that has just pulled into it.
  const bayH = area * 0.2;
  fillRoundedRect(canvas, inset + area * 0.3, inset, area * 0.4, bayH, area * 0.05, hex('#33507f'));
  fillRoundedRect(
    canvas,
    inset + area * 0.34,
    inset + bayH * 0.22,
    area * 0.32,
    bayH * 0.56,
    area * 0.035,
    hex('#e6394a'),
  );

  // The lot below it: a four-by-four grid of buses, each two cells long, laid
  // out so no two neighbours share a colour and the block reads as interlocked.
  const lotY = inset + area * 0.3;
  const lotH = area * 0.7;
  fillRoundedRect(canvas, inset, lotY, area, lotH, area * 0.06, hex('#1b2a45'));

  const cell = area / 4;
  const pad = cell * 0.14;
  const bus = (column, row, length, vertical, color) => {
    fillRoundedRect(
      canvas,
      inset + column * cell + pad,
      lotY + row * (lotH / 4) + pad,
      (vertical ? 1 : length) * cell - pad * 2,
      (vertical ? length : 1) * (lotH / 4) - pad * 2,
      cell * 0.18,
      hex(color),
    );
  };

  bus(0, 0, 2, false, '#f5c518');
  bus(2, 0, 2, true, '#35b56a');
  bus(3, 0, 2, true, '#9b5de5');
  bus(0, 1, 2, true, '#2b7fe8');
  bus(1, 1, 2, true, '#f56cae');
  bus(2, 2, 2, false, '#24c8d8');
  bus(0, 3, 2, false, '#f47b20');
  bus(2, 3, 2, false, '#e6394a');

  return encodePng(size, size, canvas.data);
}

/**
 * Four points down, four up, and two checkers.
 *
 * The alternating triangles are the whole mark — nothing else in a phone's home
 * screen looks like them — so they get the space, and the game's six-a-side is
 * cut to four for the same reason Gridlock's park is: at 48px, twelve points
 * across turn into grey mush.
 */
function drawBackgammon(size, { maskable }) {
  const canvas = createCanvas(size);

  const inset = maskable ? size * 0.19 : size * 0.11;
  const radius = maskable ? 0 : size * 0.22;

  fillRoundedRect(canvas, 0, 0, size, size, radius, BACKGROUND);

  const area = size - inset * 2;
  fillRoundedRect(canvas, inset, inset, area, area, area * 0.07, hex('#16233c'));

  const column = area / 4;
  const depth = area * 0.42;
  const shades = [hex('#33507f'), hex('#1e2e4b')];

  for (let index = 0; index < 4; index++) {
    const left = inset + index * column;
    const pad = column * 0.08;
    // Hanging from the top, and standing up from the bottom offset by one, so
    // no point sits directly under one of its own colour.
    fillTriangle(
      canvas,
      [left + pad, inset],
      [left + column - pad, inset],
      [left + column / 2, inset + depth],
      shades[index % 2],
    );
    fillTriangle(
      canvas,
      [left + pad, inset + area],
      [left + column - pad, inset + area],
      [left + column / 2, inset + area - depth],
      shades[(index + 1) % 2],
    );
  }

  // Two checkers, one a side, big enough to read as checkers at 48px.
  const checker = column * 0.78;
  const place = (fx, fy, color, edge) => {
    const cx = inset + area * fx;
    const cy = inset + area * fy;
    fillRoundedRect(canvas, cx - checker / 2, cy - checker / 2, checker, checker, checker / 2, edge);
    fillRoundedRect(
      canvas,
      cx - checker / 2 + checker * 0.13,
      cy - checker / 2 + checker * 0.13,
      checker * 0.74,
      checker * 0.74,
      checker * 0.37,
      color,
    );
  };

  place(0.375, 0.79, hex('#edf2fb'), hex('#93a8c8'));
  place(0.625, 0.21, hex('#d2455a'), hex('#8b2534'));

  return encodePng(size, size, canvas.data);
}

/**
 * A fanned hand with the top card face up.
 *
 * At 48px a suit pip is a red smudge and a rank is nothing at all, so the mark
 * has to read from the *silhouette*: three stepped white rectangles is "cards"
 * before a single detail on them is legible.
 */
function drawSolitaire(size, { maskable }) {
  const canvas = createCanvas(size);

  const inset = maskable ? size * 0.2 : size * 0.12;
  const radius = maskable ? 0 : size * 0.22;

  fillRoundedRect(canvas, 0, 0, size, size, radius, BACKGROUND);

  const area = size - inset * 2;
  const cardW = area * 0.5;
  const cardH = cardW * 1.4;
  const corner = cardW * 0.14;
  const step = area * 0.12;

  // Two backs behind, stepped up and left, then the face on top.
  const top = inset + (area - cardH) / 2 + step;
  const left = inset + (area - cardW) / 2 - step;

  fillRoundedRect(canvas, left, top, cardW, cardH, corner, hex('#2f4f86'));
  fillRoundedRect(canvas, left + step, top - step, cardW, cardH, corner, hex('#4067a8'));
  fillRoundedRect(canvas, left + step * 2, top - step * 2, cardW, cardH, corner, hex('#fbfaf7'));

  // A diamond, because it is the one suit two triangles can draw honestly.
  const cx = left + step * 2 + cardW / 2;
  const cy = top - step * 2 + cardH / 2;
  const r = cardW * 0.3;
  const red = hex('#cf2f3f');
  // Overlapping across the waist on purpose: two triangles that merely meet
  // leave a hairline of card showing between them at 512px.
  fillTriangle(canvas, [cx, cy - r * 1.2], [cx - r, cy + 0.5], [cx + r, cy + 0.5], red);
  fillTriangle(canvas, [cx, cy + r * 1.2], [cx - r, cy - 0.5], [cx + r, cy - 0.5], red);

  return encodePng(size, size, canvas.data);
}

/**
 * Ten columns, one of them a run coming together.
 *
 * Spider's whole shape on screen is a wall of narrow columns, and the moment
 * that matters is a descending run assembling in one of them. Four columns
 * rather than ten: at 48px, ten are each two pixels wide and the mark turns to
 * grey corduroy.
 */
function drawSpider(size, { maskable }) {
  const canvas = createCanvas(size);

  const inset = maskable ? size * 0.2 : size * 0.12;
  const radius = maskable ? 0 : size * 0.22;

  fillRoundedRect(canvas, 0, 0, size, size, radius, BACKGROUND);

  const area = size - inset * 2;
  const columns = 4;
  const gap = area * 0.07;
  const cardW = (area - gap * (columns - 1)) / columns;
  const corner = cardW * 0.2;
  const cardH = area * 0.3;
  const step = area * 0.17;

  // Every card is drawn on a slightly larger dark rectangle. Without it the
  // stacked backs in a column merge into one bar and the mark reads as a bar
  // chart rather than as cards.
  const edge = Math.max(1, size * 0.012);
  const card = (x, y, color) => {
    fillRoundedRect(canvas, x - edge, y - edge, cardW + edge * 2, cardH + edge * 2, corner, BACKGROUND);
    fillRoundedRect(canvas, x, y, cardW, cardH, corner, color);
  };

  const backs = [3, 2, 3, 2];
  for (let column = 0; column < columns; column++) {
    const x = inset + column * (cardW + gap);
    for (let index = 0; index < backs[column]; index++) {
      card(x, inset + index * step, hex('#2f4f86'));
    }
  }

  // The run: three face-up cards stepping down the second column, each with a
  // pip, so one column is visibly coming together while the rest are shut.
  const runX = inset + (cardW + gap);
  for (let index = 0; index < 3; index++) {
    const y = inset + (index + 1) * step;
    card(runX, y, hex('#fbfaf7'));
    fillRoundedRect(
      canvas,
      runX + cardW * 0.24,
      y + cardH * 0.16,
      cardW * 0.3,
      cardH * 0.3,
      cardW * 0.12,
      hex('#cf2f3f'),
    );
  }

  return encodePng(size, size, canvas.data);
}

/**
 * A nine-by-nine reduced to what reads at 48px: the three heavy rules that make
 * the boxes, and four filled cells. Drawing all eighty-one produces a grey
 * texture — the box structure is the thing that says "sudoku" rather than
 * "grid", so it is the thing that survives the shrink.
 */
function drawSudoku(size, { maskable }) {
  const canvas = createCanvas(size);

  const inset = maskable ? size * 0.2 : size * 0.12;
  const radius = maskable ? 0 : size * 0.22;

  fillRoundedRect(canvas, 0, 0, size, size, radius, BACKGROUND);

  const area = size - inset * 2;
  const cell = area / 9;
  const rule = Math.max(1, size * 0.012);
  const heavy = Math.max(1.5, size * 0.028);

  fillRoundedRect(canvas, inset, inset, area, area, size * 0.04, hex('#1b2a45'));

  // Filled cells go down before the rules, so a rule always reads on top.
  const filled = [
    [0, 0, '#4da3ff'],
    [4, 1, '#f5c518'],
    [7, 4, '#35b56a'],
    [2, 6, '#e6394a'],
    [5, 7, '#4da3ff'],
  ];
  for (const [column, row, color] of filled) {
    fillRoundedRect(
      canvas,
      inset + column * cell + cell * 0.12,
      inset + row * cell + cell * 0.12,
      cell * 0.76,
      cell * 0.76,
      cell * 0.2,
      hex(color),
      0.92,
    );
  }

  const light = hex('#8fa6c9');

  for (let line = 1; line < 9; line++) {
    if (line % 3 === 0) continue;
    const offset = inset + line * cell - rule / 2;
    fillRoundedRect(canvas, offset, inset, rule, area, 0, light, 0.22);
    fillRoundedRect(canvas, inset, offset, area, rule, 0, light, 0.22);
  }

  for (let line = 0; line <= 3; line++) {
    const offset = inset + line * cell * 3 - heavy / 2;
    const clamped = Math.min(Math.max(offset, inset - heavy / 2), inset + area - heavy / 2);
    fillRoundedRect(canvas, clamped, inset, heavy, area, heavy / 2, light, 0.62);
    fillRoundedRect(canvas, inset, clamped, area, heavy, heavy / 2, light, 0.62);
  }

  return encodePng(size, size, canvas.data);
}

/**
 * A small grid part-painted, with its clue numbers suggested as dashes down the
 * left and across the top. Numbers do not survive the shrink to 48px, so the
 * gutters are drawn as marks — enough to say "this grid has clues attached",
 * which is what separates a nonogram icon from a generic grid one.
 */
function drawNonogram(size, { maskable }) {
  const canvas = createCanvas(size);

  const inset = maskable ? size * 0.2 : size * 0.12;
  const radius = maskable ? 0 : size * 0.22;

  fillRoundedRect(canvas, 0, 0, size, size, radius, BACKGROUND);

  const area = size - inset * 2;
  // A quarter of the box is clue gutter, the rest is the grid itself.
  const gutter = area * 0.26;
  const gridSize = area - gutter;
  const cells = 5;
  const cell = gridSize / cells;
  const left = inset + gutter;
  const top = inset + gutter;

  fillRoundedRect(canvas, left, top, gridSize, gridSize, size * 0.03, hex('#1b2a45'));

  // A blocky shape rather than scattered cells: the icon should look like a
  // picture coming out, which is the point of the game.
  const painted = [
    [1, 0], [2, 0],
    [0, 1], [1, 1], [2, 1], [3, 1],
    [1, 2], [2, 2], [3, 2], [4, 2],
    [1, 3], [2, 3],
    [0, 4], [3, 4],
  ];
  for (const [column, row] of painted) {
    fillRoundedRect(
      canvas,
      left + column * cell + cell * 0.1,
      top + row * cell + cell * 0.1,
      cell * 0.8,
      cell * 0.8,
      cell * 0.18,
      hex('#4da3ff'),
    );
  }

  const light = hex('#8fa6c9');
  const tick = Math.max(1, size * 0.016);

  // The clue gutters, as marks rather than digits.
  for (let row = 0; row < cells; row++) {
    const y = top + row * cell + cell / 2 - tick / 2;
    const runs = row === 1 || row === 2 ? 2 : 1;
    for (let run = 0; run < runs; run++) {
      const width = gutter * (run === 0 ? 0.34 : 0.24);
      const x = inset + gutter - (run + 1) * (gutter * 0.42);
      fillRoundedRect(canvas, x, y, width, tick, tick / 2, light, 0.66);
    }
  }

  for (let column = 0; column < cells; column++) {
    const x = left + column * cell + cell / 2 - tick / 2;
    const runs = column === 1 || column === 2 ? 2 : 1;
    for (let run = 0; run < runs; run++) {
      const height = gutter * (run === 0 ? 0.34 : 0.24);
      const y = inset + gutter - (run + 1) * (gutter * 0.42);
      fillRoundedRect(canvas, x, y, tick, height, tick / 2, light, 0.66);
    }
  }

  return encodePng(size, size, canvas.data);
}

/**
 * A short run of pipework with one elbow left turned the wrong way, which is
 * the whole game in one picture. The lit part is accent and the stray tile is
 * grey, so even at 48px it reads as "this one needs turning".
 */
function drawPipes(size, { maskable }) {
  const canvas = createCanvas(size);

  const inset = maskable ? size * 0.21 : size * 0.13;
  const radius = maskable ? 0 : size * 0.22;

  fillRoundedRect(canvas, 0, 0, size, size, radius, BACKGROUND);

  const area = size - inset * 2;
  const cell = area / 3;
  const pipe = Math.max(2, cell * 0.26);
  const half = pipe / 2;

  const wet = hex('#4da3ff');
  const dry = hex('#6d7f9e');

  // Centre of tile (column, row).
  const cx = (column) => inset + column * cell + cell / 2;
  const cy = (row) => inset + row * cell + cell / 2;

  /** A stub from a tile's middle to one of its edges. */
  const stub = (column, row, side, color) => {
    const x = cx(column);
    const y = cy(row);
    if (side === 'n') fillRoundedRect(canvas, x - half, y - cell / 2, pipe, cell / 2 + half, half, color);
    if (side === 's') fillRoundedRect(canvas, x - half, y - half, pipe, cell / 2 + half, half, color);
    if (side === 'w') fillRoundedRect(canvas, x - cell / 2, y - half, cell / 2 + half, pipe, half, color);
    if (side === 'e') fillRoundedRect(canvas, x - half, y - half, cell / 2 + half, pipe, half, color);
  };

  const hub = (column, row, color, r) =>
    fillRoundedRect(canvas, cx(column) - r, cy(row) - r, r * 2, r * 2, r, color);

  // The fed run: a well at the top left, down and across to a tap.
  stub(0, 0, 's', wet);
  stub(0, 1, 'n', wet);
  stub(0, 1, 'e', wet);
  stub(1, 1, 'w', wet);
  stub(1, 1, 'e', wet);
  stub(2, 1, 'w', wet);

  // The stray tile, pointing the wrong way and dry.
  stub(2, 2, 'n', dry);
  stub(2, 2, 'w', dry);

  hub(0, 0, wet, cell * 0.2);
  fillRoundedRect(
    canvas,
    cx(0) - cell * 0.1,
    cy(0) - cell * 0.1,
    cell * 0.2,
    cell * 0.2,
    cell * 0.1,
    hex('#101a2e'),
  );
  hub(2, 1, wet, cell * 0.17);
  hub(2, 2, dry, cell * 0.13);

  return encodePng(size, size, canvas.data);
}

/**
 * Four tiles of the ladder, warm through cool, with the biggest in the corner
 * where it belongs. The gradient across them is the thing that reads at 48px —
 * the numbers do not survive the shrink, and they are not what the game looks
 * like from across a room anyway.
 */
function drawTwenty48(size, { maskable }) {
  const canvas = createCanvas(size);

  const inset = maskable ? size * 0.2 : size * 0.12;
  const radius = maskable ? 0 : size * 0.22;

  fillRoundedRect(canvas, 0, 0, size, size, radius, BACKGROUND);

  const area = size - inset * 2;
  const gap = area * 0.06;
  const cell = (area - gap) / 2;

  // Read as a board rather than as four loose squares.
  fillRoundedRect(canvas, inset - gap, inset - gap, area + gap * 2, area + gap * 2, size * 0.08, hex('#1b2a45'));

  const tiles = [
    [0, 0, '#f7c98b'],
    [1, 0, '#f2874f'],
    [0, 1, '#d94f52'],
    [1, 1, '#5c44a8'],
  ];

  for (const [column, row, color] of tiles) {
    fillRoundedRect(
      canvas,
      inset + column * (cell + gap),
      inset + row * (cell + gap),
      cell,
      cell,
      cell * 0.16,
      hex(color),
    );
  }

  // Two bars on the largest tile, standing in for the digits it is too small
  // to carry. Enough to say "there is a number on these".
  const bigX = inset + cell + gap;
  const bigY = inset + cell + gap;
  const bar = Math.max(1, cell * 0.09);
  fillRoundedRect(canvas, bigX + cell * 0.22, bigY + cell * 0.38, cell * 0.56, bar, bar / 2, hex('#ffffff'), 0.85);
  fillRoundedRect(canvas, bigX + cell * 0.3, bigY + cell * 0.56, cell * 0.4, bar, bar / 2, hex('#ffffff'), 0.6);

  return encodePng(size, size, canvas.data);
}

/**
 * Two rows of a board mid-guess: a green, a yellow, and the greys around them.
 * No letters — they do not survive the shrink — because the colours alone are
 * what anybody recognises this game by.
 */
function drawWordle(size, { maskable }) {
  const canvas = createCanvas(size);

  const inset = maskable ? size * 0.2 : size * 0.13;
  const radius = maskable ? 0 : size * 0.22;

  fillRoundedRect(canvas, 0, 0, size, size, radius, BACKGROUND);

  const area = size - inset * 2;
  const gap = area * 0.05;
  const cell = (area - gap * 2) / 3;

  // Green in place, yellow adrift, grey for the rest — the three colours in the
  // order a real board tends to show them.
  const rows = [
    ['#3aa757', '#4a5a7d', '#d4a72c'],
    ['#4a5a7d', '#3aa757', '#4a5a7d'],
    ['#3aa757', '#3aa757', '#3aa757'],
  ];

  for (let row = 0; row < rows.length; row++) {
    for (let column = 0; column < 3; column++) {
      fillRoundedRect(
        canvas,
        inset + column * (cell + gap),
        inset + row * (cell + gap),
        cell,
        cell,
        cell * 0.14,
        hex(rows[row][column]),
      );
    }
  }

  return encodePng(size, size, canvas.data);
}

/**
 * A board with its pits and a store, and seeds in the pits.
 *
 * Six pits a side do not survive the shrink — at 48px they are a row of grey
 * dust — so the icon draws three, which is what the shape means rather than
 * what it counts. The seeds are the only warm colour in the set and are what
 * makes this read as mancala rather than as another grid.
 */
function drawMancala(size, { maskable }) {
  const canvas = createCanvas(size);

  const inset = maskable ? size * 0.2 : size * 0.12;
  const radius = maskable ? 0 : size * 0.22;

  fillRoundedRect(canvas, 0, 0, size, size, radius, BACKGROUND);

  const area = size - inset * 2;
  const boardHeight = area * 0.74;
  const boardTop = inset + (area - boardHeight) / 2;
  fillRoundedRect(canvas, inset, boardTop, area, boardHeight, area * 0.13, hex('#253a5f'));

  const pad = area * 0.07;
  const innerTop = boardTop + pad;
  const innerHeight = boardHeight - pad * 2;

  // The store takes the right end, the three pit columns share the rest.
  const storeWidth = innerHeight * 0.42;
  const storeX = inset + area - pad - storeWidth;
  fillRoundedRect(canvas, storeX, innerTop, storeWidth, innerHeight, storeWidth / 2, hex('#16233c'));

  const pitArea = storeX - (inset + pad) - pad * 0.6;
  const gap = pitArea * 0.07;
  const pit = Math.min((pitArea - gap * 2) / 3, (innerHeight - gap) / 2);
  const pitsTop = innerTop + (innerHeight - (pit * 2 + gap)) / 2;

  const SEEDS = [hex('#e8c27a'), hex('#d6a85c'), hex('#c8e0a8'), hex('#efdcb4')];
  const seed = pit * 0.3;

  let tint = 0;
  for (let row = 0; row < 2; row++) {
    for (let column = 0; column < 3; column++) {
      const x = inset + pad + column * (pit + gap);
      const y = pitsTop + row * (pit + gap);
      fillRoundedRect(canvas, x, y, pit, pit, pit / 2, hex('#16233c'));

      // Two seeds per pit, offset so they read as loose rather than as a mark.
      const spots = [
        [0.34, 0.38],
        [0.6, 0.6],
      ];
      for (const [fx, fy] of spots) {
        fillRoundedRect(
          canvas,
          x + pit * fx - seed / 2,
          y + pit * fy - seed / 2,
          seed,
          seed,
          seed / 2,
          SEEDS[tint++ % SEEDS.length],
        );
      }
    }
  }

  // The store is where the game is won, so it is the fullest thing on the icon.
  const storeSeed = storeWidth * 0.34;
  const stack = [
    [0.5, 0.22],
    [0.32, 0.4],
    [0.68, 0.42],
    [0.46, 0.58],
    [0.62, 0.76],
    [0.36, 0.78],
  ];
  for (const [fx, fy] of stack) {
    fillRoundedRect(
      canvas,
      storeX + storeWidth * fx - storeSeed / 2,
      innerTop + innerHeight * fy - storeSeed / 2,
      storeSeed,
      storeSeed,
      storeSeed / 2,
      SEEDS[tint++ % SEEDS.length],
    );
  }

  return encodePng(size, size, canvas.data);
}

/**
 * Two dominoes, one of them a double laid crosswise.
 *
 * The crosswise tile is the whole reason this is the icon it is: a domino on
 * its own says dominoes, and a domino with another one across it says a train
 * with a double sitting in it, which is this game and not the other one.
 */
function drawDominoes(size, { maskable }) {
  const canvas = createCanvas(size);

  const inset = maskable ? size * 0.21 : size * 0.14;
  const radius = maskable ? 0 : size * 0.22;

  fillRoundedRect(canvas, 0, 0, size, size, radius, BACKGROUND);

  const area = size - inset * 2;
  const half = area * 0.36;
  const pip = half * 0.15;
  const face = hex('#f2f5fb');
  const ink = hex('#16233c');
  const bar = hex('#b9c6de');

  // Pip layouts, in a three-by-three grid of cells. Same arrangement the game
  // itself draws; see PIPS in src/dominoes/render.ts.
  const layouts = {
    2: [
      [0, 0],
      [2, 2],
    ],
    3: [
      [0, 0],
      [1, 1],
      [2, 2],
    ],
    5: [
      [0, 0],
      [0, 2],
      [1, 1],
      [2, 0],
      [2, 2],
    ],
  };

  const drawHalf = (x, y, value) => {
    const cell = half / 3;
    for (const [row, column] of layouts[value]) {
      fillRoundedRect(
        canvas,
        x + (column + 0.5) * cell - pip / 2,
        y + (row + 0.5) * cell - pip / 2,
        pip,
        pip,
        pip / 2,
        ink,
      );
    }
  };

  // The tile lying along the train.
  const flatX = inset;
  const flatY = inset + area * 0.56;
  fillRoundedRect(canvas, flatX, flatY, half * 2, half, half * 0.12, face);
  fillRoundedRect(canvas, flatX + half - area * 0.008, flatY, area * 0.016, half, 0, bar);
  drawHalf(flatX, flatY, 3);
  drawHalf(flatX + half, flatY, 5);

  // The double across it, in accent blue — the one tile that stops the board.
  const crossX = inset + area - half;
  const crossY = inset;
  fillRoundedRect(canvas, crossX, crossY, half, half * 2, half * 0.12, face);
  fillRoundedRect(canvas, crossX, crossY + half - area * 0.008, half, area * 0.016, 0, bar);
  fillRoundedRect(canvas, crossX, crossY, half, half * 2, half * 0.12, hex('#4da3ff'), 0.22);
  drawHalf(crossX, crossY, 2);
  drawHalf(crossX, crossY + half, 2);

  return encodePng(size, size, canvas.data);
}

/**
 * The Simon board: four quarter-circle pads round a dark hub, one of them lit.
 *
 * Drawn per pixel rather than from rounded rectangles, because a quarter
 * circle is not one. The lit pad is what makes it read as the game rather than
 * as a pie chart.
 */
function drawSimon(size, { maskable }) {
  const canvas = createCanvas(size);

  const inset = maskable ? size * 0.18 : size * 0.09;
  const radius = maskable ? 0 : size * 0.22;

  fillRoundedRect(canvas, 0, 0, size, size, radius, BACKGROUND);

  const centre = size / 2;
  const outer = centre - inset;
  const hub = outer * 0.34;
  const gap = outer * 0.06;
  const ring = hex('#0a1222');

  // Top left, top right, bottom right, bottom left; the top right is lit.
  const pads = [
    [hex('#35b56a'), 0.55],
    [hex('#e6394a'), 1],
    [hex('#2b7fe8'), 0.55],
    [hex('#f5c518'), 0.55],
  ];

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let ringHits = 0;
      const padHits = [0, 0, 0, 0];
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const x = px + (sx + 0.5) / 3 - centre;
          const y = py + (sy + 0.5) / 3 - centre;
          const distance = Math.hypot(x, y);
          if (distance > outer) continue;
          ringHits++;
          if (distance < hub + gap * 0.5 || distance > outer - gap) continue;
          if (Math.abs(x) < gap / 2 || Math.abs(y) < gap / 2) continue;
          const index = y < 0 ? (x < 0 ? 0 : 1) : x < 0 ? 3 : 2;
          padHits[index]++;
        }
      }
      if (ringHits > 0) canvas.set(px, py, ring, ringHits / 9);
      padHits.forEach((hits, index) => {
        if (hits === 0) return;
        const [colour, level] = pads[index];
        const shaded = colour.map((channel) => Math.round(channel * level + 10 * (1 - level)));
        canvas.set(px, py, shaded, hits / 9);
      });
    }
  }

  return encodePng(size, size, canvas.data);
}


/**
 * A well with three pieces in it: an S wedged over a gap, an I bar coming down.
 *
 * The tile has to say "falling blocks" at 48px, and a full ten-by-twenty well
 * at that size is a grey smear. So it is drawn as a five-wide well with four
 * fat cells — the shapes are recognisable, the gap under the S reads as the
 * problem, and the bar above reads as the thing about to solve it.
 */
function drawTetris(size, { maskable }) {
  const canvas = createCanvas(size);

  const inset = maskable ? size * 0.2 : size * 0.12;
  const radius = maskable ? 0 : size * 0.22;

  fillRoundedRect(canvas, 0, 0, size, size, radius, BACKGROUND);

  const WELL = hex('#0a1222');
  // The four classic colours that read most distinctly at icon size.
  const CYAN = hex('#24c8d8');
  const GREEN = hex('#35b56a');
  const ORANGE = hex('#f47b20');
  const BLUE = hex('#2b7fe8');

  // Five columns by five rows inside the well, with a little breathing room.
  const wellSize = size - inset * 2;
  fillRoundedRect(canvas, inset, inset, wellSize, wellSize, size * 0.07, WELL);

  const pad = wellSize * 0.07;
  const cell = (wellSize - pad * 2) / 5;
  const gap = Math.max(1, cell * 0.08);

  const block = (col, row, colour) => {
    fillRoundedRect(
      canvas,
      inset + pad + col * cell + gap / 2,
      inset + pad + row * cell + gap / 2,
      cell - gap,
      cell - gap,
      cell * 0.2,
      colour,
    );
    // A lighter lip along the top, which is what keeps a flat square from
    // reading as a hole in the well rather than a brick in it.
    fillRoundedRect(
      canvas,
      inset + pad + col * cell + gap / 2,
      inset + pad + row * cell + gap / 2,
      cell - gap,
      (cell - gap) * 0.22,
      cell * 0.12,
      hex('#ffffff'),
      0.22,
    );
  };

  // The bar, still falling.
  for (let col = 1; col < 5; col++) block(col, 0, CYAN);

  // An S resting on the stack, with the gap it leaves under its left half.
  block(1, 3, GREEN);
  block(2, 3, GREEN);
  block(0, 4, GREEN);
  block(1, 4, GREEN);

  // The floor either side of it.
  block(2, 4, ORANGE);
  block(3, 4, BLUE);
  block(3, 3, BLUE);
  block(4, 4, ORANGE);

  return encodePng(size, size, canvas.data);
}


/**
 * A tank on the left, a hill in the middle, and the arc that clears it.
 *
 * The arc is the whole game, so it gets the strongest mark on the tile: at
 * 48px the hill and the dotted curve over it read as "lob something over
 * that", which is exactly what the game asks you to do.
 */
function drawArtillery(size, { maskable }) {
  const canvas = createCanvas(size);

  const inset = maskable ? size * 0.18 : size * 0.09;
  const radius = maskable ? 0 : size * 0.22;

  fillRoundedRect(canvas, 0, 0, size, size, radius, BACKGROUND);

  const GROUND = hex('#2f6b45');
  const EDGE = hex('#57c483');
  const TANK = hex('#4da3ff');
  const SHELL = hex('#ff9147');
  // The arc is pale rather than green: in the ground's own colour it read as a
  // second piece of terrain floating over the first.
  const ARC = hex('#cdd9ee');

  // Everything below is in percent of the tile, so it scales at every size.
  const u = size / 100;
  const at = (value) => value * u;

  // Ground: a flat base with one hill, drawn per pixel so the surface can carry
  // a lit edge of its own.
  const surface = (x) => 80 - 30 * Math.exp(-(((x - 60) / 15) ** 2));

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let below = 0;
      let edge = 0;
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const x = ((px + (sx + 0.5) / 2) / size) * 100;
          const y = ((py + (sy + 0.5) / 2) / size) * 100;
          const top = surface(x);
          if (y < top) continue;
          below++;
          if (y < top + 3) edge++;
        }
      }
      if (below > 0) canvas.set(px, py, GROUND, below / 4);
      if (edge > 0) canvas.set(px, py, EDGE, edge / 4);
    }
  }

  // The arc, dashed. A quadratic through the tank, over the hill, and down the
  // far side.
  const arc = (t) => {
    const p0 = [22, 67];
    const p1 = [54, 3];
    // Lands *on* the ground on the far side. Ending it in mid-air drew a shot
    // that had not happened yet.
    const p2 = [86, 77];
    const m = 1 - t;
    return [
      m * m * p0[0] + 2 * m * t * p1[0] + t * t * p2[0],
      m * m * p0[1] + 2 * m * t * p1[1] + t * t * p2[1],
    ];
  };

  const STEPS = 44;
  for (let i = 0; i < STEPS; i++) {
    // Two on, one off — a dashed line without having to measure arc length.
    if (i % 3 === 2) continue;
    const [x0, y0] = arc(i / STEPS);
    const [x1, y1] = arc((i + 1) / STEPS);
    fillLine(canvas, [at(x0), at(y0)], [at(x1), at(y1)], at(3), ARC, 0.8);
  }

  // The shell, on its way up.
  const [sx, sy] = arc(0.34);
  fillRoundedRect(canvas, at(sx) - at(4), at(sy) - at(4), at(8), at(8), at(4), SHELL);

  // The tank, on the flat to the left of the hill.
  const base = surface(18);
  fillLine(canvas, [at(18), at(base - 11)], [at(27), at(base - 20)], at(4), TANK);
  fillRoundedRect(canvas, at(11), at(base - 9), at(14), at(6), at(2.2), TANK);
  fillRoundedRect(canvas, at(18) - at(3.2), at(base - 11) - at(3.2), at(6.4), at(6.4), at(3.2), TANK);

  void inset;
  return encodePng(size, size, canvas.data);
}

/**
 * A road winding down into a castle, with one tower standing guard beside it.
 *
 * The castle is the mark — crenellations and a flag read at 48px where nothing
 * else here would — and the road is what says "they are coming to it". The
 * tower is the player's part, so it gets the brightest colour on the tile.
 */
function drawCastle(size, { maskable }) {
  const canvas = createCanvas(size);

  const inset = maskable ? size * 0.18 : size * 0.1;
  const radius = maskable ? 0 : size * 0.22;

  fillRoundedRect(canvas, 0, 0, size, size, radius, BACKGROUND);

  const area = size - inset * 2;
  const at = (fx) => fx * area;
  const x0 = inset;
  const y0 = inset;

  const GRASS = hex('#2f6b45');
  const ROAD = hex('#e6d3a3');
  const STONE = hex('#9aa2ae');
  const GATE = hex('#3a3326');
  const FLAG = hex('#e6394a');
  const TOWER = hex('#35b56a');

  fillRoundedRect(canvas, x0, y0, area, area, area * 0.12, GRASS);

  // The road: down, across, down, into the gate.
  const road = [
    [0.26, 0.0],
    [0.26, 0.4],
    [0.62, 0.4],
    [0.62, 0.78],
  ];
  for (let i = 0; i < road.length - 1; i++) {
    const [ax, ay] = road[i];
    const [bx, by] = road[i + 1];
    fillLine(canvas, [x0 + at(ax), y0 + at(ay)], [x0 + at(bx), y0 + at(by)], at(0.13), ROAD);
  }
  // Round the corners so it reads as one road rather than three sticks.
  for (const [cx, cy] of road.slice(1, -1)) {
    fillRoundedRect(canvas, x0 + at(cx - 0.065), y0 + at(cy - 0.065), at(0.13), at(0.13), at(0.065), ROAD);
  }

  // The castle: a wall with three merlons, a gate, a flag.
  const cx = x0 + at(0.4);
  const cy = y0 + at(0.66);
  const cw = at(0.46);
  const ch = at(0.28);
  fillRoundedRect(canvas, cx, cy, cw, ch, at(0.02), STONE);
  for (const f of [0, 0.4, 0.8]) {
    fillRoundedRect(canvas, cx + cw * f, cy - at(0.07), cw * 0.2, at(0.08), 0, STONE);
  }
  fillRoundedRect(canvas, cx + cw * 0.36, cy + ch * 0.35, cw * 0.28, ch * 0.66, cw * 0.14, GATE);
  fillLine(canvas, [cx + cw * 0.5, cy - at(0.07)], [cx + cw * 0.5, cy - at(0.2)], at(0.02), hex('#6b5a45'));
  fillTriangle(
    canvas,
    [cx + cw * 0.5, cy - at(0.2)],
    [cx + cw * 0.5 + at(0.12), cy - at(0.165)],
    [cx + cw * 0.5, cy - at(0.13)],
    FLAG,
  );

  // The tower beside the bend, with its arrowhead.
  const tx = x0 + at(0.08);
  const ty = y0 + at(0.52);
  const tw = at(0.24);
  fillRoundedRect(canvas, tx, ty, tw, tw * 1.05, at(0.03), TOWER);
  for (const f of [0, 0.4, 0.8]) {
    fillRoundedRect(canvas, tx + tw * f, ty - at(0.045), tw * 0.2, at(0.05), 0, TOWER);
  }
  fillTriangle(
    canvas,
    [tx + tw * 0.5, ty + tw * 0.18],
    [tx + tw * 0.8, ty + tw * 0.5],
    [tx + tw * 0.2, ty + tw * 0.5],
    hex('#ffffff'),
  );
  fillRoundedRect(canvas, tx + tw * 0.4, ty + tw * 0.48, tw * 0.2, tw * 0.34, 0, hex('#ffffff'));

  return encodePng(size, size, canvas.data);
}

/**
 * Battleship: a small sea with a fleet on it, the ships drawn as whole hulls
 * with rounded bows the way the game draws them, and a few squares of marked
 * water around them. No count digits — at 48px they are noise.
 */
function drawBattleship(size, { maskable }) {
  const canvas = createCanvas(size);

  const inset = maskable ? size * 0.2 : size * 0.13;
  const radius = maskable ? 0 : size * 0.22;

  fillRoundedRect(canvas, 0, 0, size, size, radius, BACKGROUND);

  const cells = 5;
  const area = size - inset * 2;
  const cell = area / cells;

  fillRoundedRect(canvas, inset, inset, area, area, size * 0.03, hex('#16233b'));

  // Marked water: every square the fleet does not use that touches it.
  const water = [
    [3, 0], [3, 1], [0, 1], [1, 1], [2, 1], [4, 1],
    [1, 2], [2, 2], [4, 2], [2, 3], [4, 3], [1, 3], [0, 2], [1, 4], [0, 4], [2, 4], [4, 4], [3, 4],
  ];
  for (const [column, row] of water) {
    fillRoundedRect(
      canvas,
      inset + column * cell + cell * 0.06,
      inset + row * cell + cell * 0.06,
      cell * 0.88,
      cell * 0.88,
      cell * 0.14,
      hex('#2b4c80'),
    );
  }

  const hull = (column, row, across, down, color) => {
    const pad = cell * 0.08;
    fillRoundedRect(
      canvas,
      inset + column * cell + pad,
      inset + row * cell + pad,
      across * cell - pad * 2,
      down * cell - pad * 2,
      cell * 0.42,
      color,
    );
  };

  hull(0, 0, 3, 1, hex('#eef3fb'));
  hull(4, 0, 1, 1, hex('#eef3fb'));
  hull(3, 2, 1, 2, hex('#4da3ff'));
  hull(0, 3, 1, 1, hex('#4da3ff'));

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
  ['depot-180.png', 180, { maskable: false }, drawDepot],
  ['depot-192.png', 192, { maskable: false }, drawDepot],
  ['depot-512.png', 512, { maskable: false }, drawDepot],
  ['depot-maskable-512.png', 512, { maskable: true }, drawDepot],
  ['backgammon-180.png', 180, { maskable: false }, drawBackgammon],
  ['backgammon-192.png', 192, { maskable: false }, drawBackgammon],
  ['backgammon-512.png', 512, { maskable: false }, drawBackgammon],
  ['backgammon-maskable-512.png', 512, { maskable: true }, drawBackgammon],
  ['solitaire-180.png', 180, { maskable: false }, drawSolitaire],
  ['solitaire-192.png', 192, { maskable: false }, drawSolitaire],
  ['solitaire-512.png', 512, { maskable: false }, drawSolitaire],
  ['solitaire-maskable-512.png', 512, { maskable: true }, drawSolitaire],
  ['spider-180.png', 180, { maskable: false }, drawSpider],
  ['spider-192.png', 192, { maskable: false }, drawSpider],
  ['spider-512.png', 512, { maskable: false }, drawSpider],
  ['spider-maskable-512.png', 512, { maskable: true }, drawSpider],
  ['sudoku-180.png', 180, { maskable: false }, drawSudoku],
  ['sudoku-192.png', 192, { maskable: false }, drawSudoku],
  ['sudoku-512.png', 512, { maskable: false }, drawSudoku],
  ['sudoku-maskable-512.png', 512, { maskable: true }, drawSudoku],
  ['nonogram-180.png', 180, { maskable: false }, drawNonogram],
  ['nonogram-192.png', 192, { maskable: false }, drawNonogram],
  ['nonogram-512.png', 512, { maskable: false }, drawNonogram],
  ['nonogram-maskable-512.png', 512, { maskable: true }, drawNonogram],
  ['pipes-180.png', 180, { maskable: false }, drawPipes],
  ['pipes-192.png', 192, { maskable: false }, drawPipes],
  ['pipes-512.png', 512, { maskable: false }, drawPipes],
  ['pipes-maskable-512.png', 512, { maskable: true }, drawPipes],
  ['twenty48-180.png', 180, { maskable: false }, drawTwenty48],
  ['twenty48-192.png', 192, { maskable: false }, drawTwenty48],
  ['twenty48-512.png', 512, { maskable: false }, drawTwenty48],
  ['twenty48-maskable-512.png', 512, { maskable: true }, drawTwenty48],
  ['wordle-180.png', 180, { maskable: false }, drawWordle],
  ['wordle-192.png', 192, { maskable: false }, drawWordle],
  ['wordle-512.png', 512, { maskable: false }, drawWordle],
  ['wordle-maskable-512.png', 512, { maskable: true }, drawWordle],
  ['mancala-180.png', 180, { maskable: false }, drawMancala],
  ['mancala-192.png', 192, { maskable: false }, drawMancala],
  ['mancala-512.png', 512, { maskable: false }, drawMancala],
  ['mancala-maskable-512.png', 512, { maskable: true }, drawMancala],
  ['dominoes-180.png', 180, { maskable: false }, drawDominoes],
  ['dominoes-192.png', 192, { maskable: false }, drawDominoes],
  ['dominoes-512.png', 512, { maskable: false }, drawDominoes],
  ['dominoes-maskable-512.png', 512, { maskable: true }, drawDominoes],
  ['simon-180.png', 180, { maskable: false }, drawSimon],
  ['simon-192.png', 192, { maskable: false }, drawSimon],
  ['simon-512.png', 512, { maskable: false }, drawSimon],
  ['simon-maskable-512.png', 512, { maskable: true }, drawSimon],
  ['tetris-180.png', 180, { maskable: false }, drawTetris],
  ['tetris-192.png', 192, { maskable: false }, drawTetris],
  ['tetris-512.png', 512, { maskable: false }, drawTetris],
  ['tetris-maskable-512.png', 512, { maskable: true }, drawTetris],
  ['artillery-180.png', 180, { maskable: false }, drawArtillery],
  ['artillery-192.png', 192, { maskable: false }, drawArtillery],
  ['artillery-512.png', 512, { maskable: false }, drawArtillery],
  ['artillery-maskable-512.png', 512, { maskable: true }, drawArtillery],
  ['battleship-180.png', 180, { maskable: false }, drawBattleship],
  ['battleship-192.png', 192, { maskable: false }, drawBattleship],
  ['battleship-512.png', 512, { maskable: false }, drawBattleship],
  ['battleship-maskable-512.png', 512, { maskable: true }, drawBattleship],
  ['castle-180.png', 180, { maskable: false }, drawCastle],
  ['castle-192.png', 192, { maskable: false }, drawCastle],
  ['castle-512.png', 512, { maskable: false }, drawCastle],
  ['castle-maskable-512.png', 512, { maskable: true }, drawCastle],
];

for (const [name, size, options, draw] of targets) {
  writeFileSync(join(OUT_DIR, name), draw(size, options));
  console.log(`wrote icons/${name} (${size}x${size})`);
}
