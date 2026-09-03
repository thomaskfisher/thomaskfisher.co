/**
 * Shared color palette.
 *
 * All three games are pure color-matching, which locks out anyone with color
 * vision deficiency. Every color is therefore paired with a distinct shape
 * glyph that can be overlaid from Settings, and with a name for screen readers.
 * Hues are ordered so that the first N colors of any level are well separated.
 */

export interface Paint {
  readonly name: string;
  readonly hex: string;
  /** Darker edge, used for the lip/shadow that gives bands depth. */
  readonly shade: string;
  /** SVG path in a 24x24 viewBox, centered. */
  readonly glyph: string;
  /** Some glyphs are drawn as outlines that subtract an inner region. */
  readonly evenOdd?: boolean;
}

export const PALETTE: readonly Paint[] = [
  {
    name: 'red',
    hex: '#e6394a',
    shade: '#b32636',
    glyph: 'M12 5a7 7 0 1 0 0 14a7 7 0 1 0 0-14z',
  },
  {
    name: 'blue',
    hex: '#2b7fe8',
    shade: '#1b5aad',
    glyph: 'M12 5 L19 18 L5 18 Z',
  },
  {
    name: 'green',
    hex: '#35b56a',
    shade: '#22874c',
    glyph: 'M6 6 H18 V18 H6 Z',
  },
  {
    name: 'yellow',
    hex: '#f5c518',
    shade: '#c29a08',
    glyph: 'M12 4 L20 12 L12 20 L4 12 Z',
  },
  {
    name: 'purple',
    hex: '#9b5de5',
    shade: '#7038b8',
    glyph:
      'M12 4 L14.2 10.2 L20.8 10.4 L15.6 14.4 L17.4 20.8 L12 17 L6.6 20.8 L8.4 14.4 L3.2 10.4 L9.8 10.2 Z',
  },
  {
    name: 'orange',
    hex: '#f47b20',
    shade: '#c25a0d',
    glyph: 'M12 4 L19 8 V16 L12 20 L5 16 V8 Z',
  },
  {
    name: 'cyan',
    hex: '#24c8d8',
    shade: '#1494a1',
    glyph: 'M9.5 4 H14.5 V9.5 H20 V14.5 H14.5 V20 H9.5 V14.5 H4 V9.5 H9.5 Z',
  },
  {
    name: 'pink',
    hex: '#f56cae',
    shade: '#c43f80',
    glyph: 'M5 6 H19 L12 19 Z',
  },
  {
    name: 'lime',
    hex: '#a8d63a',
    shade: '#7ba51e',
    glyph: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16z M12 8.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 1 1 0-7z',
    evenOdd: true,
  },
  {
    name: 'brown',
    hex: '#96603a',
    shade: '#6d4227',
    glyph:
      'M7 4.5 L12 9.5 L17 4.5 L19.5 7 L14.5 12 L19.5 17 L17 19.5 L12 14.5 L7 19.5 L4.5 17 L9.5 12 L4.5 7 Z',
  },
  {
    name: 'teal',
    hex: '#0e8a86',
    shade: '#07615e',
    glyph: 'M12 4 L20 9.8 L17 19.2 H7 L4 9.8 Z',
  },
  {
    name: 'magenta',
    hex: '#c4239f',
    shade: '#911673',
    glyph: 'M4 9 H20 V15 H4 Z',
  },
  {
    name: 'slate',
    hex: '#6b7fa8',
    shade: '#4a5a7d',
    glyph: 'M12 4 C16 9 19 12 19 15 a7 7 0 0 1 -14 0 C5 12 8 9 12 4 Z',
  },
  {
    name: 'cream',
    hex: '#efdcae',
    shade: '#bda877',
    glyph: 'M12 4 L20 11 L17 14 L12 9.5 L7 14 L4 11 Z',
  },
];

export const MAX_COLORS = PALETTE.length;

export function paint(colorIndex: number): Paint {
  const p = PALETTE[colorIndex % PALETTE.length];
  if (!p) throw new Error(`No paint for color index ${colorIndex}`);
  return p;
}

/** Inline SVG for the shape overlay. Kept tiny — one of these per band. */
export function glyphSvg(colorIndex: number, className = 'glyph'): string {
  const p = paint(colorIndex);
  const rule = p.evenOdd ? ' fill-rule="evenodd"' : '';
  return (
    `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">` +
    `<path d="${p.glyph}"${rule} /></svg>`
  );
}
