/**
 * A very small WebGL renderer for rounded boxes — the only thing in the
 * collection that draws with the GPU.
 *
 * The rules see every piece as an axis-aligned box, and so does this file: what
 * changes is only how a box is drawn. Each one becomes a rounded box — a cube
 * whose edges and corners are bevelled into quarter-cylinders and spheres — lit
 * with soft banded "toy plastic" shading and a thin outline, which is what turns
 * a stack of blocks into something that looks like a toy rather than a voxel
 * model. The puzzle never knows.
 *
 * Meshes are built once per distinct (size, radius) and cached; a level has a
 * few dozen pieces but only a handful of distinct sizes.
 *
 * There is no render loop. `draw` paints one frame when asked; the caller asks
 * on state change, on drag, and for the few hundred milliseconds a plate is
 * falling or the hint is turning the object.
 */

import type { Vec3 } from './model';
import type { Mat3 } from './view';

export interface DrawBox {
  min: Vec3;
  max: Vec3;
  /** 0..1 RGB. */
  color: Vec3;
  alpha: number;
  /** Corner radius in object units, clamped to fit the box. */
  radius: number;
  /** Added in view space after rotation, for falling plates. */
  offset?: Vec3;
}

export interface Frame {
  rotation: Mat3;
  center: Vec3;
  /** Object units from the center to the edge of the shorter side. */
  halfExtent: number;
  /** Depth range in object units, generous enough for any orientation. */
  depth: number;
  /** Outline thickness in object units. */
  outline: number;
}

const VERTEX = `
attribute vec3 aPos;
attribute vec3 aNormal;
uniform mat3 uR;
uniform vec3 uMin;
uniform vec3 uCenter;
uniform vec3 uOffset;
uniform vec2 uScale;
uniform float uDepth;
uniform float uInflate;
varying vec3 vNormal;
void main() {
  vec3 p = uMin + aPos + aNormal * uInflate;
  vec3 v = uR * (p - uCenter) + uOffset;
  gl_Position = vec4(v.x * uScale.x, v.y * uScale.y, -v.z / uDepth, 1.0);
  vNormal = uR * aNormal;
}`;

const FRAGMENT = `
precision mediump float;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uOutline;
varying vec3 vNormal;
void main() {
  if (uOutline > 0.5) {
    // A darker shade of the piece's own colour rather than black ink: reads
    // as a cartoon edge without making the object look drawn in marker.
    gl_FragColor = vec4(uColor * 0.42, uAlpha);
    return;
  }
  vec3 n = normalize(vNormal);
  // Mostly from the front and above: the face the player is looking at is the
  // one that has to be brightest, or its plates read muddy.
  vec3 light = normalize(vec3(0.35, 0.62, 0.7));
  float d = dot(n, light);
  // Two soft bands instead of a smooth falloff: the toy-plastic look.
  float band = 0.78 + 0.16 * smoothstep(-0.1, 0.12, d) + 0.1 * smoothstep(0.32, 0.46, d);
  // Sky from above, warm bounce from below.
  vec3 hemi = mix(vec3(0.9, 0.88, 0.95), vec3(1.04, 1.02, 0.98), n.y * 0.5 + 0.5);
  // A glossy highlight and a pale rim, which is most of what makes it look
  // moulded rather than painted.
  vec3 h = normalize(light + vec3(0.0, 0.0, 1.0));
  float spec = smoothstep(0.86, 0.95, max(dot(n, h), 0.0)) * 0.22;
  float rim = pow(1.0 - max(n.z, 0.0), 3.0) * 0.14;
  vec3 color = uColor * band * hemi + vec3(spec + rim);
  gl_FragColor = vec4(min(color, vec3(1.0)), uAlpha);
}`;

interface Mesh {
  vertices: WebGLBuffer;
  indices: WebGLBuffer;
  count: number;
}

/** Segments across each bevel. Four is round enough at phone size. */
const BEVEL_STEPS = 4;

/**
 * A rounded box spanning [0, size] on each axis, as interleaved position and
 * normal plus triangle indices.
 *
 * Built from a cube whose faces are gridded densely near the edges and not at
 * all in the middle. Each grid point is pulled onto the rounded surface by
 * clamping it to the inner box (size shrunk by the radius) and pushing it back
 * out along the difference: on a flat face that is the face itself, on an
 * edge a quarter-cylinder, on a corner an eighth of a sphere. The difference
 * is also the normal, which is why the shading comes out smooth for free.
 */
export function roundedBox(size: Vec3, radius: number): { data: Float32Array; indices: Uint16Array } {
  const r = Math.max(0, Math.min(radius, size[0] / 2, size[1] / 2, size[2] / 2) * 0.999);
  const coords = (extent: number): number[] => {
    if (r < 1e-4) return [0, extent];
    const out: number[] = [];
    for (let i = 0; i <= BEVEL_STEPS; i++) out.push((r * i) / BEVEL_STEPS);
    for (let i = 0; i <= BEVEL_STEPS; i++) out.push(extent - r + (r * i) / BEVEL_STEPS);
    return out;
  };
  const axisCoords = [coords(size[0]), coords(size[1]), coords(size[2])];

  const data: number[] = [];
  const indices: number[] = [];

  const push = (p: Vec3, faceNormal: Vec3): void => {
    const c: Vec3 = [0, 0, 0];
    const d: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      c[k] = Math.min(Math.max(p[k]!, r), size[k]! - r);
      d[k] = p[k]! - c[k]!;
    }
    const len = Math.hypot(d[0], d[1], d[2]);
    const n: Vec3 = len > 1e-6 ? [d[0] / len, d[1] / len, d[2] / len] : faceNormal;
    data.push(c[0] + n[0] * r, c[1] + n[1] * r, c[2] + n[2] * r, n[0], n[1], n[2]);
  };

  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    for (const side of [0, 1]) {
      const normal: Vec3 = [0, 0, 0];
      normal[axis] = side ? 1 : -1;
      const us = axisCoords[u]!;
      const vs = axisCoords[v]!;
      const base = data.length / 6;
      for (const cu of us) {
        for (const cv of vs) {
          const p: Vec3 = [0, 0, 0];
          p[axis] = side ? size[axis]! : 0;
          p[u] = cu;
          p[v] = cv;
          push(p, normal);
        }
      }
      // (u, v, axis) is right-handed, so u-then-v winds counter-clockwise when
      // seen from +axis. The far side is flipped to face outward too.
      const cols = vs.length;
      for (let i = 0; i < us.length - 1; i++) {
        for (let j = 0; j < cols - 1; j++) {
          const a = base + i * cols + j;
          const b = base + (i + 1) * cols + j;
          const c = base + (i + 1) * cols + j + 1;
          const e = base + i * cols + j + 1;
          if (side) indices.push(a, b, c, a, c, e);
          else indices.push(a, c, b, a, e, c);
        }
      }
    }
  }

  return { data: new Float32Array(data), indices: new Uint16Array(indices) };
}

export class BoxRenderer {
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private attrPos = -1;
  private attrNormal = -1;
  private meshes = new Map<string, Mesh>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onRestored: () => void,
  ) {
    canvas.addEventListener('webglcontextlost', (event) => {
      // Without this the browser never offers the context back. iOS drops it
      // when the app is backgrounded for a while.
      event.preventDefault();
      this.gl = null;
      this.meshes.clear();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.init();
      this.onRestored();
    });
    this.init();
  }

  get ok(): boolean {
    return this.gl !== null;
  }

  private init(): void {
    const gl = this.canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
    });
    if (!gl) return;

    const compile = (type: number, source: string): WebGLShader | null => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
      console.error('Screw Land 3D shader:', gl.getShaderInfoLog(shader));
      return null;
    };
    const vs = compile(gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vs || !fs || !program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      // WebGL 1 refuses to link when the two stages declare the same uniform
      // at different default precisions, so no uniform is used in both.
      console.error('Screw Land 3D program:', gl.getProgramInfoLog(program));
      return;
    }

    gl.useProgram(program);
    this.attrPos = gl.getAttribLocation(program, 'aPos');
    this.attrNormal = gl.getAttribLocation(program, 'aNormal');
    gl.enableVertexAttribArray(this.attrPos);
    gl.enableVertexAttribArray(this.attrNormal);

    for (const name of [
      'uR',
      'uMin',
      'uCenter',
      'uOffset',
      'uScale',
      'uDepth',
      'uInflate',
      'uColor',
      'uAlpha',
      'uOutline',
    ]) {
      this.loc[name] = gl.getUniformLocation(program, name);
    }

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this.gl = gl;
    this.program = program;
  }

  /** Matches the backing store to the element's CSS size. */
  resize(cssWidth: number, cssHeight: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  private mesh(gl: WebGLRenderingContext, size: Vec3, radius: number): Mesh | null {
    const key = `${size[0].toFixed(3)},${size[1].toFixed(3)},${size[2].toFixed(3)},${radius.toFixed(3)}`;
    const cached = this.meshes.get(key);
    if (cached) return cached;
    const { data, indices } = roundedBox(size, radius);
    const vertices = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    if (!vertices || !indexBuffer) return null;
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    const mesh = { vertices, indices: indexBuffer, count: indices.length };
    this.meshes.set(key, mesh);
    return mesh;
  }

  draw(boxes: readonly DrawBox[], frame: Frame): void {
    const gl = this.gl;
    if (!gl || !this.program) return;
    const { width, height } = this.canvas;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const r = frame.rotation;
    // GLSL wants column-major.
    gl.uniformMatrix3fv(this.loc.uR!, false, [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]]);
    gl.uniform3fv(this.loc.uCenter!, frame.center);
    const short = Math.min(width, height);
    gl.uniform2f(
      this.loc.uScale!,
      short / width / frame.halfExtent,
      short / height / frame.halfExtent,
    );
    gl.uniform1f(this.loc.uDepth!, frame.depth);

    const opaque = boxes.filter((b) => b.alpha >= 0.999);
    const fading = boxes.filter((b) => b.alpha < 0.999);

    // Fill, then the outline as an inflated shell drawn inside-out: only its
    // back faces render, and the depth test hides all of it except the rim
    // around each silhouette.
    gl.depthMask(true);
    gl.cullFace(gl.BACK);
    for (const box of opaque) this.drawBox(gl, box, 0, false);
    gl.cullFace(gl.FRONT);
    for (const box of opaque) this.drawBox(gl, box, frame.outline, true);
    gl.cullFace(gl.BACK);

    // Anything fading draws last without depth writes, so a falling plate
    // never punches a hole in what is behind it.
    gl.depthMask(false);
    for (const box of fading) this.drawBox(gl, box, 0, false);
    gl.depthMask(true);
  }

  private drawBox(gl: WebGLRenderingContext, box: DrawBox, inflate: number, outline: boolean): void {
    const size: Vec3 = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
    const mesh = this.mesh(gl, size, box.radius);
    if (!mesh) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vertices);
    gl.vertexAttribPointer(this.attrPos, 3, gl.FLOAT, false, 24, 0);
    gl.vertexAttribPointer(this.attrNormal, 3, gl.FLOAT, false, 24, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indices);

    gl.uniform3fv(this.loc.uMin!, box.min);
    gl.uniform3fv(this.loc.uOffset!, box.offset ?? [0, 0, 0]);
    gl.uniform3fv(this.loc.uColor!, box.color);
    gl.uniform1f(this.loc.uAlpha!, box.alpha);
    gl.uniform1f(this.loc.uInflate!, inflate);
    gl.uniform1f(this.loc.uOutline!, outline ? 1 : 0);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
  }
}
