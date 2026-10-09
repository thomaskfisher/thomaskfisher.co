import { describe, expect, it } from 'vitest';
import { roundedBox } from './gl';
import type { Vec3 } from './model';

describe('rounded box mesh', () => {
  for (const [size, radius] of [
    [[2, 1, 3], 0.3],
    [[4, 0.25, 2], 0.12],
    [[1, 1, 1], 0.3],
    [[3, 2, 1], 0],
  ] as [Vec3, number][]) {
    it(`stays inside ${size.join('x')} and faces outward (r=${radius})`, () => {
      const { data, indices } = roundedBox(size, radius);
      const vertex = (i: number): Vec3 => [data[i * 6]!, data[i * 6 + 1]!, data[i * 6 + 2]!];
      const normal = (i: number): Vec3 => [data[i * 6 + 3]!, data[i * 6 + 4]!, data[i * 6 + 5]!];

      for (let i = 0; i < data.length / 6; i++) {
        const p = vertex(i);
        for (let k = 0; k < 3; k++) {
          expect(p[k]).toBeGreaterThanOrEqual(-1e-6);
          expect(p[k]).toBeLessThanOrEqual(size[k]! + 1e-6);
        }
        expect(Math.hypot(...normal(i))).toBeCloseTo(1, 5);
      }

      // Back-face culling and the outline shell both depend on every triangle
      // winding counter-clockwise when seen from outside.
      const center: Vec3 = [size[0] / 2, size[1] / 2, size[2] / 2];
      let checked = 0;
      for (let t = 0; t < indices.length; t += 3) {
        const a = vertex(indices[t]!);
        const b = vertex(indices[t + 1]!);
        const c = vertex(indices[t + 2]!);
        const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const v: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const area = Math.hypot(...n);
        if (area < 1e-9) continue; // degenerate where a face is exactly 2r wide
        const mid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
        const out = n[0] * (mid[0] - center[0]) + n[1] * (mid[1] - center[1]) + n[2] * (mid[2] - center[2]);
        expect(out).toBeGreaterThan(0);
        checked++;
      }
      expect(checked).toBeGreaterThan(11);
      expect(data.length / 6).toBeLessThan(65536);
    });
  }
});
