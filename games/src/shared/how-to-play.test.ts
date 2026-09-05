import { describe, expect, it } from 'vitest';

import { RULES as BUSJAM } from '../busjam/rules';
import { RULES as COLORSORT } from '../colorsort/rules';
import { RULES as DEPOT } from '../depot/rules';
import { RULES as SCREWLAND } from '../screwland/rules';
import { RULES as SURVIVAL } from '../survival/rules';
import { shouldAutoShow } from './how-to-play';
import { defaultSave, migrate } from './progress';

const RULES = [COLORSORT, SCREWLAND, BUSJAM, SURVIVAL, DEPOT];

/**
 * The diagrams are strings of SVG assembled by hand, which means a stray
 * template literal or a helper returning `undefined` produces a picture that
 * simply does not draw — and nothing else in the project would notice. These
 * assertions are cheap and catch exactly that.
 */
describe('rules sheets', () => {
  for (const rules of RULES) {
    describe(rules.gameName, () => {
      it('states a goal and at least three steps', () => {
        expect(rules.goal.length).toBeGreaterThan(10);
        expect(rules.steps.length).toBeGreaterThanOrEqual(3);
      });

      /* The captions are deliberately short — one line each — so these only
         check that a step still has one, not that it says much. */
      it('gives every step a title, some text, and art that draws', () => {
        for (const step of rules.steps) {
          expect(step.title.length, rules.gameName).toBeGreaterThan(5);
          expect(step.text.length, step.title).toBeGreaterThan(10);
          expect(step.art, step.title).not.toContain('undefined');
          expect(step.art, step.title).not.toContain('NaN');
          // Every mark is one of these three, so art with none of them is empty.
          expect(step.art, step.title).toMatch(/<(rect|circle|path|text)/);
        }
      });

      it('stays inside the 92x64 art box', () => {
        // Only catches the gross mistakes — a coordinate off by a whole board —
        // but those are exactly the ones that silently clip.
        for (const step of rules.steps) {
          for (const [, value] of step.art.matchAll(/\s(?:x|cx)="(-?[\d.]+)"/g)) {
            expect(Number(value), `${step.title}: x`).toBeLessThanOrEqual(92);
          }
          for (const [, value] of step.art.matchAll(/\s(?:y|cy)="(-?[\d.]+)"/g)) {
            expect(Number(value), `${step.title}: y`).toBeLessThanOrEqual(64);
          }
        }
      });
    });
  }

  it('gives each game its own sheet', () => {
    const names = RULES.map((r) => r.gameName);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('shouldAutoShow', () => {
  it('offers the sheet on a brand-new save', () => {
    expect(shouldAutoShow(defaultSave('colorsort'))).toBe(true);
  });

  it('does not offer it again once it has been seen', () => {
    expect(shouldAutoShow({ ...defaultSave('colorsort'), seenHowToPlay: true })).toBe(false);
  });

  /**
   * The flag is new, so every existing save reads as never having seen it.
   * Interrupting someone on level 60 to explain the tap target is worse than
   * not explaining it, which is why clearing anything at all opts you out.
   */
  it('leaves a player who has already cleared levels alone', () => {
    const existing = defaultSave<number>('colorsort');
    existing.stats.levelsCleared = 1;
    expect(existing.seenHowToPlay).toBe(false);
    expect(shouldAutoShow(existing)).toBe(false);
  });

  it('survives a round trip through migrate', () => {
    const seen = { ...defaultSave('colorsort'), seenHowToPlay: true };
    expect(migrate(seen, 'colorsort').seenHowToPlay).toBe(true);
    expect(migrate({ ...seen, seenHowToPlay: undefined }, 'colorsort').seenHowToPlay).toBe(false);
  });
});
