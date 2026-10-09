/**
 * Screw Land 3D rendering.
 *
 * Two layers. A WebGL canvas draws the object — blocks and plates — and a layer
 * of ordinary `<button data-screw>` elements sits over it, one per screw,
 * projected to where the screw head is and squashed into the ellipse a round
 * head makes from this angle. Keeping screws in the DOM means they are
 * tappable, labelled for screen readers, carry the colour-vision glyphs, and
 * can be driven by the same automated playthrough as every other game.
 *
 * A screw button is shown only when the screw is free to take *and*
 * `isVisibleFrom` says it can be seen from the current angle — the same test
 * the difficulty model uses. A screw round the back is not dimmed or hinted at;
 * it is simply not there until you turn the object, which is the whole game.
 *
 * A screw that is not free is never shown, even where a gap lets you see it
 * past the edge of whatever covers it. On screen, a visible screw always means
 * one you can take: finding a glimpse of a deeper screw must never look like a
 * way to skip the pieces on top of it.
 *
 * Rotation is view state. It lives here, is never saved, and never touches
 * undo. Every deferred thing — the fall animation, the hint turn, the hint glow
 * — keeps its handle and is cancelled by a rebuild, an undo, or a new drag.
 */

import { glyphSvg, paint } from '../shared/palette';
import type { GameState } from './game';
import { BoxRenderer, type DrawBox } from './gl';
import { OUTLINE_PX, PART_RADIUS, PLATE_RADIUS, styleFor } from './style';
import {
  type Piece,
  type Screw,
  type Structure,
  type Vec3,
  isAccessible,
  isPlate,
  isVisibleFrom,
  structureBounds,
} from './model';
import {
  type Mat3,
  defaultRotation,
  discMatrix,
  dragRotate,
  facing,
  fromQuat,
  hintRotation,
  slerp,
  toQuat,
  toView,
  viewerDirection,
} from './view';

const FALL_MS = 460;
const TURN_MS = 380;
/** Movement past which a press is a drag rather than a tap. */
const DRAG_SLOP_PX = 8;
/** Below this a screw is too edge-on to tap reliably, so it is not offered. */
const MIN_FACING = 0.2;

export interface RenderOptions {
  showGlyphs: boolean;
  reducedMotion: boolean;
  onTapScrew: (screwId: number) => void;
}

/** sRGB hex to 0..1 floats. */
function rgb(hex: string): Vec3 {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

interface Turn {
  from: Mat3;
  to: Mat3;
  start: number;
  then: (() => void) | null;
}

export class ObjectRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly screwLayer: HTMLElement;
  private readonly gl: BoxRenderer;

  private rotation: Mat3 = defaultRotation();
  private structure: Structure | null = null;
  private state: GameState | null = null;
  private center: Vec3 = [0, 0, 0];
  private radius = 1;
  private cssW = 0;
  private cssH = 0;

  private screwEls = new Map<number, HTMLButtonElement>();
  /** Last on-screen rect of each screw, for the flight after it is taken. */
  private lastRects = new Map<number, DOMRect>();

  /** Plates seen down, and when their fall started (absent once finished). */
  private fallen = new Set<number>();
  private falling = new Map<number, number>();
  private turn: Turn | null = null;
  private frameHandle: number | null = null;
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  private celebrateTimer: ReturnType<typeof setTimeout> | null = null;

  private press: { id: number; x: number; y: number; lastX: number; lastY: number; dragging: boolean; screw: number | null } | null = null;

  constructor(
    private readonly root: HTMLElement,
    private options: RenderOptions,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'object-canvas';
    this.screwLayer = document.createElement('div');
    this.screwLayer.className = 'screw-layer';
    this.root.append(this.canvas, this.screwLayer);
    this.gl = new BoxRenderer(this.canvas, () => this.draw());

    this.root.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.root.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.root.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.root.addEventListener('pointercancel', () => {
      this.press = null;
    });
    // Keyboard activation and scripted `.click()` arrive with detail 0. Real
    // taps are handled on pointerup, so the click they also fire is ignored.
    this.root.addEventListener('click', (event) => {
      if (event.detail !== 0) return;
      const target = (event.target as HTMLElement).closest('[data-screw]');
      if (!target) return;
      const id = Number((target as HTMLElement).dataset.screw);
      if (Number.isInteger(id)) this.tap(id);
    });
  }

  get webglAvailable(): boolean {
    return this.gl.ok;
  }

  setOptions(patch: Partial<RenderOptions>): void {
    const glyphsChanged =
      patch.showGlyphs !== undefined && patch.showGlyphs !== this.options.showGlyphs;
    this.options = { ...this.options, ...patch };
    if (glyphsChanged) for (const el of this.screwEls.values()) delete el.dataset.painted;
  }

  /* ------------------------------------------------------------- state */

  render(state: GameState): void {
    this.state = state;
    if (!state.generated || !state.index) return;

    if (state.generated.structure !== this.structure) this.build(state.generated.structure, state);

    this.trackFalls(state);
    if (state.effect.kind === 'reset' || state.effect.kind === 'take') this.clearHint();
    this.draw();
    this.applyEffect(state);
  }

  private build(structure: Structure, state: GameState): void {
    this.structure = structure;
    this.cancelTurn();
    this.clearHint();
    this.falling.clear();
    this.fallen.clear();
    this.lastRects.clear();
    this.rotation = defaultRotation();

    // Pieces already down when the level loads (a restored save) start down,
    // rather than all tumbling off at once.
    structure.pieces.forEach((piece, i) => {
      if (state.board.remainingPerPiece[i] === 0) this.fallen.add(piece.id);
    });

    const bounds = structureBounds(structure);
    this.center = [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    ];
    // Fit the farthest corner of anything, so every orientation fits and the
    // board never needs to resize mid-drag.
    let r = 0;
    for (const box of structure.pieces) {
      for (const x of [box.min[0], box.max[0]]) {
        for (const y of [box.min[1], box.max[1]]) {
          for (const z of [box.min[2], box.max[2]]) {
            r = Math.max(r, Math.hypot(x - this.center[0], y - this.center[1], z - this.center[2]));
          }
        }
      }
    }
    this.radius = Math.max(1, r);

    this.screwLayer.replaceChildren();
    this.screwEls.clear();
    for (const screw of structure.screws) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'screw';
      el.dataset.screw = String(screw.id);
      this.screwLayer.append(el);
      this.screwEls.set(screw.id, el);
    }
  }

  /** Sizes the canvas to the board. Called by main.ts on layout changes. */
  fit(width: number, height: number): void {
    this.cssW = Math.max(1, Math.floor(width));
    this.cssH = Math.max(1, Math.floor(height));
    this.root.style.width = `${this.cssW}px`;
    this.root.style.height = `${this.cssH}px`;
    this.gl.resize(this.cssW, this.cssH);
    this.draw();
  }

  /** CSS pixels per object unit. */
  private get scale(): number {
    return Math.min(this.cssW, this.cssH) / 2 / this.radius;
  }

  /* -------------------------------------------------------------- falls */

  private trackFalls(state: GameState): void {
    const structure = this.structure;
    if (!structure) return;
    const now = performance.now();
    structure.pieces.forEach((piece, i) => {
      const down = state.board.remainingPerPiece[i] === 0;
      if (down && !this.fallen.has(piece.id)) {
        this.fallen.add(piece.id);
        if (!this.options.reducedMotion) this.falling.set(piece.id, now);
      } else if (!down && this.fallen.has(piece.id)) {
        // Undo put it back: whatever was animating it is simply forgotten,
        // because the next frame is computed from state, not from the timer.
        this.fallen.delete(piece.id);
        this.falling.delete(piece.id);
      }
    });
    if (this.falling.size > 0) this.requestFrame();
  }

  /* -------------------------------------------------------------- frame */

  /** Bounded animation: runs only while something is moving, then stops. */
  private requestFrame(): void {
    if (this.frameHandle !== null) return;
    this.frameHandle = requestAnimationFrame(() => {
      this.frameHandle = null;
      const now = performance.now();
      for (const [id, start] of this.falling) if (now - start >= FALL_MS) this.falling.delete(id);

      if (this.turn) {
        const t = Math.min(1, (now - this.turn.start) / TURN_MS);
        const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        this.rotation = fromQuat(slerp(toQuat(this.turn.from), toQuat(this.turn.to), eased));
        if (t >= 1) {
          const then = this.turn.then;
          this.rotation = this.turn.to;
          this.turn = null;
          this.draw();
          then?.();
        }
      }

      this.draw();
      if (this.falling.size > 0 || this.turn) this.requestFrame();
    });
  }

  private draw(): void {
    const structure = this.structure;
    const state = this.state;
    if (!structure || !state || this.cssW <= 1) return;

    const style = styleFor(structure.template);
    const plateTones = style.plates.map(rgb);

    const boxes: DrawBox[] = [];
    const now = performance.now();
    let plateNumber = 0;
    structure.pieces.forEach((piece: Piece) => {
      const plate = isPlate(piece);
      // Cycle plate tones by placement order, as Screw Land does, so a deep
      // stack stays legible as separate pieces.
      const color = plate
        ? (plateTones[plateNumber++ % plateTones.length] as Vec3)
        : rgb(style.parts[piece.kind] ?? '#c9ced8');

      let alpha = 1;
      let offset: Vec3 | undefined;
      if (this.fallen.has(piece.id)) {
        const start = this.falling.get(piece.id);
        if (start === undefined) return;
        const t = Math.min(1, (now - start) / FALL_MS);
        alpha = 1 - t;
        // Drop down the screen and slightly towards the viewer, so it clears
        // the object rather than sinking into it.
        offset = [0, -t * t * this.radius * 1.4, t * 0.6];
      }
      boxes.push({
        min: piece.min,
        max: piece.max,
        color,
        alpha,
        radius: plate ? PLATE_RADIUS : PART_RADIUS,
        offset,
      });
    });

    this.gl.draw(boxes, {
      rotation: this.rotation,
      center: this.center,
      halfExtent: this.radius,
      depth: this.radius * 3,
      outline: OUTLINE_PX / this.scale,
    });

    this.placeScrews(structure, state);
  }

  private placeScrews(structure: Structure, state: GameState): void {
    const index = state.index;
    if (!index) return;
    const eye = viewerDirection(this.rotation);
    const scale = this.scale;
    const cx = this.cssW / 2;
    const cy = this.cssH / 2;
    const size = Math.max(16, Math.round(scale * 0.72));
    this.screwLayer.style.setProperty('--screw-size', `${size}px`);
    const rootRect = this.root.getBoundingClientRect();

    for (const screw of structure.screws) {
      const el = this.screwEls.get(screw.id);
      if (!el) continue;

      const gone = state.board.removed[screw.id] === true;
      const pieceFalling = this.falling.has(screw.pieceId);
      const visible =
        !gone &&
        !pieceFalling &&
        isAccessible(index, state.board, screw.id) &&
        facing(this.rotation, screw) > MIN_FACING &&
        isVisibleFrom(structure, state.board, screw.id, eye, MIN_FACING);

      el.classList.toggle('is-gone', gone);
      el.hidden = !visible;
      el.disabled = !visible || state.phase === 'loading';
      if (!visible) continue;

      this.paintScrew(el, screw);
      el.setAttribute('aria-label', `${paint(screw.color).name} screw`);

      const v = toView(this.rotation, screw.point, this.center);
      const x = cx + v[0] * scale;
      const y = cy - v[1] * scale;
      const [a, b, c, d] = discMatrix(this.rotation, screw.axis);
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) matrix(${a.toFixed(3)}, ${b.toFixed(3)}, ${c.toFixed(3)}, ${d.toFixed(3)}, 0, 0)`;
      // Nearer screws paint over farther ones.
      el.style.zIndex = String(Math.round(1000 + v[2] * 10));

      this.lastRects.set(
        screw.id,
        new DOMRect(rootRect.left + x - size / 2, rootRect.top + y - size / 2, size, size),
      );
    }
  }

  private paintScrew(el: HTMLButtonElement, screw: Screw): void {
    const key = `${screw.color}:${this.options.showGlyphs ? 1 : 0}`;
    if (el.dataset.painted === key) return;
    el.dataset.painted = key;
    const p = paint(screw.color);
    el.style.setProperty('--head', p.hex);
    el.style.setProperty('--head-edge', p.shade);
    el.innerHTML = this.options.showGlyphs
      ? glyphSvg(screw.color, 'screw-glyph')
      : '<span class="screw-slot"></span>';
  }

  /* -------------------------------------------------------------- input */

  private onPointerDown(e: PointerEvent): void {
    if (this.press) return;
    const target = (e.target as HTMLElement).closest('[data-screw]') as HTMLElement | null;
    const screw = target ? Number(target.dataset.screw) : null;
    this.press = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      dragging: false,
      screw: screw !== null && Number.isInteger(screw) ? screw : null,
    };
    // Keeps the drag going when the finger leaves the board. Throws for a
    // pointer the browser no longer considers active, which is harmless.
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable; the drag still works inside the board */
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const press = this.press;
    if (!press || press.id !== e.pointerId) return;
    if (!press.dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_SLOP_PX) {
      press.dragging = true;
      this.cancelTurn();
      this.clearHint();
      this.root.classList.add('is-dragging');
    }
    if (!press.dragging) return;

    const dx = e.clientX - press.lastX;
    const dy = e.clientY - press.lastY;
    press.lastX = e.clientX;
    press.lastY = e.clientY;
    // A drag across the shorter side of the board turns the object about 200
    // degrees: far enough to reach the back in one sweep, slow enough to aim.
    const perPx = 3.5 / Math.max(200, Math.min(this.cssW, this.cssH));
    this.rotation = dragRotate(this.rotation, dx, dy, perPx);
    this.draw();
  }

  private onPointerUp(e: PointerEvent): void {
    const press = this.press;
    if (!press || press.id !== e.pointerId) return;
    this.press = null;
    this.root.classList.remove('is-dragging');
    if (!press.dragging && press.screw !== null) this.tap(press.screw);
  }

  private tap(screwId: number): void {
    const el = this.screwEls.get(screwId);
    if (!el || el.hidden || el.disabled) return;
    this.options.onTapScrew(screwId);
  }

  /* ------------------------------------------------------------ effects */

  private applyEffect(state: GameState): void {
    const { effect } = state;
    if (effect.kind === 'reject') {
      const el = this.screwEls.get(effect.screwId);
      if (el && !this.options.reducedMotion) {
        el.classList.remove('is-rejected');
        void el.offsetWidth;
        el.classList.add('is-rejected');
      }
    } else if (effect.kind === 'hint') {
      this.showHint(effect.screwId);
    }
  }

  /** Turns the object to face the hinted screw if it has to, then lights it. */
  private showHint(screwId: number): void {
    const structure = this.structure;
    const state = this.state;
    if (!structure || !state) return;
    this.cancelTurn();
    this.clearHint();

    const target = hintRotation(structure, state.board, screwId, this.rotation);
    const glow = (): void => this.highlight(screwId);
    if (!target) {
      glow();
      return;
    }
    if (this.options.reducedMotion) {
      this.rotation = target;
      this.draw();
      glow();
      return;
    }
    this.turn = { from: this.rotation, to: target, start: performance.now(), then: glow };
    this.requestFrame();
  }

  private highlight(screwId: number): void {
    this.clearHint();
    const el = this.screwEls.get(screwId);
    if (!el || el.hidden) return;
    void el.offsetWidth;
    el.classList.add('is-hinted');
    this.hintTimer = setTimeout(() => {
      el.classList.remove('is-hinted');
      this.hintTimer = null;
    }, 1400);
  }

  private clearHint(): void {
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintTimer = null;
    for (const el of this.screwEls.values()) el.classList.remove('is-hinted');
  }

  private cancelTurn(): void {
    // Its follow-up (the glow) is dropped with it: a turn interrupted by a
    // drag or an undo should not light a screw the player is no longer near.
    this.turn = null;
  }

  /** Back to the opening view. */
  resetView(): void {
    this.cancelTurn();
    this.clearHint();
    if (this.options.reducedMotion) {
      this.rotation = defaultRotation();
      this.draw();
      return;
    }
    this.turn = { from: this.rotation, to: defaultRotation(), start: performance.now(), then: null };
    this.requestFrame();
  }

  /** Viewport position of a screw, for the flight animation in main.ts. */
  screwRect(screwId: number): DOMRect | null {
    return this.lastRects.get(screwId) ?? null;
  }

  celebrate(): void {
    if (this.options.reducedMotion) return;
    if (this.celebrateTimer) clearTimeout(this.celebrateTimer);
    this.root.classList.remove('is-celebrating');
    void this.root.offsetWidth;
    this.root.classList.add('is-celebrating');
    this.celebrateTimer = setTimeout(() => {
      this.root.classList.remove('is-celebrating');
      this.celebrateTimer = null;
    }, 1200);
  }
}
