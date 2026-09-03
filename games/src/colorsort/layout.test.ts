import { describe, expect, it } from 'vitest';
import { chooseLayout } from './layout';

/** A typical portrait phone board area, in CSS pixels. */
const PHONE = { width: 366, height: 640 };

describe('chooseLayout', () => {
  it('keeps every tube on screen', () => {
    for (const count of [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
      for (const capacity of [4, 5]) {
        const layout = chooseLayout(count, capacity, PHONE.width, PHONE.height);

        const rowWidth = layout.tubeWidth * layout.cols + layout.colGap * (layout.cols - 1);
        const tubeHeight = layout.bandHeight * capacity + 10;
        const stackHeight = tubeHeight * layout.rows + layout.rowGap * (layout.rows - 1);

        expect(rowWidth, `${count} tubes overflow horizontally`).toBeLessThanOrEqual(
          PHONE.width + 0.5,
        );
        expect(stackHeight, `${count} tubes overflow vertically`).toBeLessThanOrEqual(
          PHONE.height + 0.5,
        );
        expect(layout.cols * layout.rows).toBeGreaterThanOrEqual(count);
      }
    }
  });

  it('prefers fewer rows unless an extra row is a real size win', () => {
    // Seven tubes fit three rows of 3+3+1 marginally larger than two of 4+3,
    // but the balanced two-row version looks considerably tidier.
    const layout = chooseLayout(7, 4, PHONE.width, PHONE.height);
    expect(layout.rows).toBe(2);
    expect(layout.cols).toBe(4);
  });

  it('keeps the early tutorial boards to one or two chunky rows', () => {
    for (const count of [3, 4, 5]) {
      const layout = chooseLayout(count, 4, PHONE.width, PHONE.height);
      expect(layout.rows).toBeLessThanOrEqual(2);
      // Few tubes should mean big ones, not a thin row across the top.
      expect(layout.bandHeight).toBeGreaterThan(40);
    }
  });

  it('reports a board width that holds exactly one row', () => {
    const layout = chooseLayout(9, 4, PHONE.width, PHONE.height);
    expect(layout.boardWidth).toBeCloseTo(
      layout.tubeWidth * layout.cols + layout.colGap * (layout.cols - 1),
      5,
    );
  });

  it('makes tubes bigger when there is more room', () => {
    const small = chooseLayout(8, 4, 320, 480);
    const large = chooseLayout(8, 4, 700, 900);
    expect(large.bandHeight).toBeGreaterThan(small.bandHeight);
  });

  it('still returns a usable layout in a cramped landscape window', () => {
    const layout = chooseLayout(14, 4, 640, 180);
    expect(layout.bandHeight).toBeGreaterThan(0);
    expect(layout.tubeWidth).toBeGreaterThan(0);
    expect(layout.cols * layout.rows).toBeGreaterThanOrEqual(14);
  });
});
