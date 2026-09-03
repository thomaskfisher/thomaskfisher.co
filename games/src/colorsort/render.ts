/**
 * Board rendering.
 *
 * DOM and CSS transforms rather than canvas: hit-testing, focus, and screen
 * reader labels all come free, and at these element counts it is plenty fast.
 * Nothing here runs on a timer — the renderer redraws when the game says the
 * state changed and is otherwise completely idle.
 */

import { glyphSvg, paint } from '../shared/palette';
import type { Effect, GameState } from './game';
import { type Board, type Tube, isComplete } from './model';

const POUR_MS = 380;

export interface RenderOptions {
  showGlyphs: boolean;
  reducedMotion: boolean;
  onTapTube: (index: number) => void;
}

export class BoardRenderer {
  private tubeEls: HTMLButtonElement[] = [];
  private liquidEls: HTMLDivElement[] = [];
  private signature = '';
  private pourTimer: ReturnType<typeof setTimeout> | null = null;
  private hintTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly root: HTMLElement,
    private options: RenderOptions,
  ) {
    // One delegated listener rather than one per tube, so rebuilding the board
    // never leaks handlers.
    this.root.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest('[data-tube]');
      if (!target) return;
      const index = Number((target as HTMLElement).dataset.tube);
      if (Number.isInteger(index)) this.options.onTapTube(index);
    });
  }

  setOptions(patch: Partial<RenderOptions>): void {
    const glyphsChanged =
      patch.showGlyphs !== undefined && patch.showGlyphs !== this.options.showGlyphs;
    this.options = { ...this.options, ...patch };
    if (glyphsChanged) this.signature = ''; // force a rebuild
  }

  /** Board identity — a change here means "new level", so rebuild rather than diff. */
  private signatureOf(state: GameState): string {
    return `${state.level}:${state.board.tubes.length}:${state.board.height}`;
  }

  render(state: GameState): void {
    if (this.signatureOf(state) !== this.signature) {
      this.build(state);
      this.signature = this.signatureOf(state);
    }
    this.paintTubes(state);
    this.applyEffect(state);
  }

  private build(state: GameState): void {
    const { board } = state;
    const count = board.tubes.length;

    this.root.replaceChildren();
    // Grid columns and tube sizing come from `chooseLayout`, applied by the
    // caller — the two must agree, so only one of them decides.
    this.root.style.setProperty('--capacity', String(board.height));

    this.tubeEls = [];
    this.liquidEls = [];

    for (let i = 0; i < count; i++) {
      const tube = document.createElement('button');
      tube.type = 'button';
      tube.className = 'tube';
      tube.dataset.tube = String(i);

      const glass = document.createElement('span');
      glass.className = 'tube-glass';

      const liquid = document.createElement('div');
      liquid.className = 'tube-liquid';

      glass.append(liquid);
      tube.append(glass);
      this.root.append(tube);

      this.tubeEls.push(tube);
      this.liquidEls.push(liquid);
    }
  }

  private bandMarkup(color: number, extraClass = ''): string {
    const p = paint(color);
    const glyph = this.options.showGlyphs ? glyphSvg(color) : '';
    return (
      `<div class="band ${extraClass}" style="--fill:${p.hex};--edge:${p.shade}">${glyph}</div>`
    );
  }

  private paintTubes(state: GameState): void {
    const { board } = state;
    const pour = state.effect.kind === 'pour' ? state.effect : null;

    for (let i = 0; i < board.tubes.length; i++) {
      const tube = board.tubes[i] as Tube;
      const el = this.tubeEls[i];
      const liquid = this.liquidEls[i];
      if (!el || !liquid) continue;

      // Only the bands that just landed animate; the rest are painted flat so a
      // redraw never restarts an animation that is already finished.
      const animateFrom =
        pour && pour.to === i && !this.options.reducedMotion ? tube.length - pour.amount : -1;

      liquid.innerHTML = tube
        .map((color, index) =>
          this.bandMarkup(color, index >= animateFrom && animateFrom >= 0 ? 'band-pouring' : ''),
        )
        .join('');

      const complete = isComplete(tube, board.height);
      el.classList.toggle('is-complete', complete);
      el.classList.toggle('is-selected', state.selected === i);
      el.classList.toggle('is-empty', tube.length === 0);
      el.setAttribute('aria-label', describeTube(i, tube, board));
      el.disabled = state.phase === 'loading';
    }
  }

  private applyEffect(state: GameState): void {
    const { effect } = state;
    if (this.options.reducedMotion) return;

    if (this.pourTimer) {
      clearTimeout(this.pourTimer);
      this.pourTimer = null;
    }

    if (effect.kind === 'pour') this.animatePour(effect);
    else if (effect.kind === 'reject') this.animateReject(effect.tube);
    else if (effect.kind === 'hint') this.animateHint(effect.move.to);
  }

  private animatePour(effect: Extract<Effect, { kind: 'pour' }>): void {
    const source = this.tubeEls[effect.from];
    if (!source) return;

    // Tilt toward the destination, so the gesture reads as pouring into it.
    source.style.setProperty('--tilt', effect.to > effect.from ? '18deg' : '-18deg');
    source.classList.add('is-pouring');

    this.pourTimer = setTimeout(() => {
      source.classList.remove('is-pouring');
      this.pourTimer = null;
    }, POUR_MS);
  }

  private animateReject(index: number): void {
    const el = this.tubeEls[index];
    if (!el) return;
    el.classList.remove('is-rejected');
    void el.offsetWidth; // restart the animation
    el.classList.add('is-rejected');
  }

  private animateHint(index: number): void {
    const el = this.tubeEls[index];
    if (!el) return;

    // Clear any highlight still fading from a previous hint. Without this, two
    // hints in quick succession leave two tubes glowing and the suggestion
    // becomes ambiguous.
    if (this.hintTimer) clearTimeout(this.hintTimer);
    for (const tube of this.tubeEls) tube.classList.remove('is-hinted');

    void el.offsetWidth; // restart the animation
    el.classList.add('is-hinted');
    this.hintTimer = setTimeout(() => {
      el.classList.remove('is-hinted');
      this.hintTimer = null;
    }, 1200);
  }

  /** Bounce every tube once, on a win. */
  celebrate(): void {
    if (this.options.reducedMotion) return;
    this.tubeEls.forEach((el, i) => {
      el.style.setProperty('--celebrate-delay', `${i * 45}ms`);
      el.classList.add('is-celebrating');
    });
    setTimeout(() => {
      this.tubeEls.forEach((el) => el.classList.remove('is-celebrating'));
    }, 1400);
  }
}

/** Screen reader description. Colors alone would be useless here. */
function describeTube(index: number, tube: Tube, board: Board): string {
  if (tube.length === 0) return `Tube ${index + 1}, empty`;

  const contents = tube
    .map((color) => paint(color).name)
    .reverse()
    .join(', ');

  const state = isComplete(tube, board.height) ? ', complete' : '';
  return `Tube ${index + 1}, top to bottom: ${contents}${state}`;
}
