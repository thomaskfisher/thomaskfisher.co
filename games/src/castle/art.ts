/**
 * The pieces, drawn once and used everywhere: the map, the tray, the wave
 * preview and the rules sheet all show the same silhouettes, so a knight on the
 * sheet is recognisably the knight on the road.
 *
 * **Every kind is a different shape as well as a different colour.** Arrow is
 * an arrowhead, cannon a ball, frost a snowflake; grunt a disc, runner a
 * diamond, knight a shield. That is why this game turns the shape overlay off,
 * as Artillery and Tetris do: colour is never the only thing telling two pieces
 * apart, so there is nothing for the overlay to add.
 *
 * Colours are fixed rather than themed. They sit on their own grass-and-road
 * field, which is themed, and a tower that changes colour with the theme is a
 * tower that has to be learned twice.
 */

import { type FoeKind, type TowerKind, CANNON, FROST, KNIGHT, RUNNER } from './model';

export const TOWER_COLORS: readonly string[] = ['#3f9d57', '#6a7690', '#2fa6de'];
export const FOE_COLORS: readonly string[] = ['#d5473f', '#eaa214', '#8a95a8'];

/**
 * A tower in a 24x24 box: a rounded keep in the tower's colour, and its glyph
 * in white on top.
 */
export function towerBody(kind: TowerKind): string {
  const color = TOWER_COLORS[kind] as string;
  const base =
    // Crenellations, then the keep. Drawn in one colour with a darker foot so
    // it reads as a solid block at 30px without any outline.
    `<path d="M4 7 h3 v-2.5 h3 v2.5 h4 v-2.5 h3 v2.5 h3 v13 a2 2 0 0 1 -2 2 h-12 a2 2 0 0 1 -2 -2 z" fill="${color}"/>` +
    `<rect x="4" y="18" width="16" height="4" rx="2" fill="#000" fill-opacity="0.18"/>`;
  return base + towerGlyph(kind, 12, 13.2, 1);
}

/** The white mark on a tower, centred on (cx, cy), at `scale` of the 24px size. */
export function towerGlyph(kind: TowerKind, cx: number, cy: number, scale: number): string {
  const s = (n: number): string => (n * scale).toFixed(2);
  const at = `transform="translate(${cx} ${cy})"`;
  if (kind === CANNON) {
    return (
      `<g ${at}><circle r="${s(3.6)}" fill="#fff"/>` +
      `<path d="M${s(2.2)} ${s(-2.6)} q${s(1.4)} ${s(-1.6)} ${s(2.6)} ${s(-1.4)}" ` +
      `stroke="#fff" stroke-width="${s(1.3)}" fill="none" stroke-linecap="round"/></g>`
    );
  }
  if (kind === FROST) {
    const arm = s(4.2);
    const lines = [0, 60, 120]
      .map((deg) => `<line x1="-${arm}" y1="0" x2="${arm}" y2="0" transform="rotate(${deg})"/>`)
      .join('');
    return (
      `<g ${at} stroke="#fff" stroke-width="${s(1.5)}" stroke-linecap="round">${lines}` +
      `<circle r="${s(1.2)}" fill="#fff" stroke="none"/></g>`
    );
  }
  // Arrow: a head and a shaft, pointing up and out of the keep.
  return (
    `<g ${at}><path d="M0 ${s(-4.4)} l${s(3.4)} ${s(3.6)} h${s(-2)} v${s(4.6)} h${s(-2.8)} ` +
    `v${s(-4.6)} h${s(-2)} z" fill="#fff"/></g>`
  );
}

/** An enemy centred on (cx, cy), `r` its rough radius. */
export function foeShape(kind: FoeKind, cx: number, cy: number, r: number): string {
  const color = FOE_COLORS[kind] as string;
  const n = (v: number): string => v.toFixed(2);
  if (kind === RUNNER) {
    // Smaller and pointed: the one that gets past you.
    return (
      `<path d="M${n(cx)} ${n(cy - r)} L${n(cx + r * 0.8)} ${n(cy)} L${n(cx)} ${n(cy + r)} ` +
      `L${n(cx - r * 0.8)} ${n(cy)} Z" fill="${color}"/>`
    );
  }
  if (kind === KNIGHT) {
    // A heater shield, with a pale band for the plate.
    return (
      `<path d="M${n(cx - r)} ${n(cy - r * 0.85)} H${n(cx + r)} V${n(cy)} ` +
      `Q${n(cx + r)} ${n(cy + r * 0.85)} ${n(cx)} ${n(cy + r * 1.05)} ` +
      `Q${n(cx - r)} ${n(cy + r * 0.85)} ${n(cx - r)} ${n(cy)} Z" fill="${color}"/>` +
      `<path d="M${n(cx)} ${n(cy - r * 0.85)} V${n(cy + r * 0.95)}" stroke="#fff" ` +
      `stroke-opacity="0.55" stroke-width="${n(r * 0.28)}"/>`
    );
  }
  return (
    `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${color}"/>` +
    `<circle cx="${n(cx - r * 0.32)}" cy="${n(cy - r * 0.18)}" r="${n(r * 0.17)}" fill="#fff"/>` +
    `<circle cx="${n(cx + r * 0.32)}" cy="${n(cy - r * 0.18)}" r="${n(r * 0.17)}" fill="#fff"/>`
  );
}

/** Rough size of each enemy relative to a cell — the knight is the big one. */
export const FOE_RADIUS: readonly number[] = [0.2, 0.17, 0.24];

/** A standalone 24x24 icon of an enemy, for the preview strip. */
export const foeIcon = (kind: FoeKind): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${foeShape(kind, 12, 12, 8.5)}</svg>`;

/** A standalone 24x24 icon of a tower, for the tray and the plots. */
export const towerIcon = (kind: TowerKind): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${towerBody(kind)}</svg>`;

/**
 * The castle at the end of the road, drawn into a one-cell box at (x, y).
 * It is what is being defended, so it is the one thing on the map with a flag.
 */
export function castle(x: number, y: number, size: number): string {
  const u = size / 24;
  const p = (v: number): string => (v * u).toFixed(3);
  return (
    `<g transform="translate(${x} ${y})">` +
    `<path d="M${p(2)} ${p(9)} h${p(4)} v${p(-3)} h${p(3)} v${p(3)} h${p(6)} v${p(-3)} h${p(3)} v${p(3)} h${p(4)} ` +
    `v${p(14)} h${p(-20)} z" fill="#9aa2ae"/>` +
    `<path d="M${p(9)} ${p(23)} v${p(-6)} a${p(3)} ${p(3)} 0 0 1 ${p(6)} 0 v${p(6)} z" fill="#3a3326"/>` +
    `<path d="M${p(12)} ${p(6)} v${p(-5)}" stroke="#6b5a45" stroke-width="${p(1)}"/>` +
    `<path d="M${p(12.4)} ${p(1)} h${p(5)} l${p(-1.4)} ${p(1.6)} l${p(1.4)} ${p(1.6)} h${p(-5)} z" fill="#d5473f"/>` +
    `</g>`
  );
}
