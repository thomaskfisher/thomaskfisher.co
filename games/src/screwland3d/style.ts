/**
 * How each object family looks: a colour per part, and a small set of tones
 * its plates cycle through.
 *
 * The look is toy plastic: bright, warm, a little candy. Plates take tones
 * that belong to the object — green tiles on a green-roofed house, white
 * panels on a rocket — so the object reads as built from its plates rather
 * than having steel bolted to it. Plate tones stay lighter than the parts
 * they sit on, so where one ends and the next begins is always visible, and
 * none of them is as saturated as a screw head: the screws are what the eye is
 * hunting for.
 */

import type { TemplateName } from './templates';

export interface TemplateStyle {
  parts: Record<string, string>;
  plates: string[];
}

export const TEMPLATE_STYLES: Record<TemplateName, TemplateStyle> = {
  house: {
    parts: { wall: '#f6e6c6', roof: '#58b36a', chimney: '#d9734f', porch: '#c98b55' },
    plates: ['#9be3a4', '#c2f0c6', '#7fd38b', '#f9efd9'],
  },
  car: {
    parts: { body: '#ff6a5c', cabin: '#bfe7ff', wheel: '#3c404b', spoiler: '#ffc94d' },
    plates: ['#ffe39a', '#fff0c7', '#ffd36b', '#ffd0c9'],
  },
  tree: {
    parts: { trunk: '#a8703f', leaves: '#5fcf62' },
    plates: ['#a8eea6', '#cdf6c6', '#8fe08e', '#e7c79f'],
  },
  boat: {
    parts: { hull: '#3d8cf0', cabin: '#fff3da', mast: '#c98b55' },
    plates: ['#ffffff', '#dff0ff', '#c6e2ff', '#ffe9b8'],
  },
  rocket: {
    parts: { body: '#f2f5fb', nose: '#ff5b5b', fin: '#ff5b5b' },
    plates: ['#cfe3ff', '#e9f2ff', '#b5d3ff', '#ffd6d6'],
  },
  robot: {
    parts: { leg: '#8d97aa', torso: '#ffc53f', head: '#ffd975', arm: '#8d97aa', antenna: '#ff5b5b' },
    plates: ['#dfe5ee', '#f2f5f9', '#c6d0de', '#fff0c2'],
  },
  table: {
    parts: { top: '#d99659', leg: '#b0723e', shelf: '#c4834b' },
    plates: ['#f7d5a9', '#fbe6c9', '#efc08c', '#ffffff'],
  },
  train: {
    parts: { base: '#3c404b', boiler: '#ff5b5b', cab: '#3d8cf0', funnel: '#3c404b', wheel: '#3c404b' },
    plates: ['#ffe18c', '#fff1c4', '#ffd25f', '#d7ecff'],
  },
  burger: {
    parts: {
      bun: '#f0a43f',
      dome: '#f4b24f',
      patty: '#7b4229',
      cheese: '#ffd23c',
      lettuce: '#78d653',
      tomato: '#ff5a4e',
    },
    plates: ['#fff2c6', '#ffe08f', '#ffd9b0', '#e9f9d9'],
  },
  tower: {
    parts: { light: '#f7dcb0', dark: '#b97b4c', cap: '#e8b678' },
    plates: ['#fbe9cc', '#ffffff', '#f2d4a6', '#ffe3c2'],
  },
};

const FALLBACK: TemplateStyle = {
  parts: {},
  plates: ['#d9dfe9', '#eef1f6', '#c5cede', '#ffffff'],
};

export function styleFor(template: string): TemplateStyle {
  return (TEMPLATE_STYLES as Record<string, TemplateStyle>)[template] ?? FALLBACK;
}

/** Corner radius of a solid part, in grid units. */
export const PART_RADIUS = 0.3;
/** Corner radius of a plate. Plates are thin, so this is capped by thickness. */
export const PLATE_RADIUS = 0.12;
/** Outline thickness in CSS pixels, converted to object units per frame. */
export const OUTLINE_PX = 1.6;
