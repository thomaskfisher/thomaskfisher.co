import { describe, expect, it } from 'vitest';

import { CATEGORIES, MEMBERSHIP } from './categories';

/**
 * The bank is the whole of what the solver can see, so it gets the checks a
 * schema would: well-formed words, no duplicates, and enough of each category
 * to deal a group from.
 */
describe('category bank', () => {
  it('has names that are unique', () => {
    const names = CATEGORIES.map((category) => category.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('can deal four words from every category', () => {
    for (const category of CATEGORIES) {
      expect(category.words.length, category.name).toBeGreaterThanOrEqual(4);
    }
  });

  it('spells every word in capitals, short enough for a tile', () => {
    for (const word of MEMBERSHIP.keys()) {
      expect(word, word).toMatch(/^[A-Z]+$/);
      expect(word.length, word).toBeLessThanOrEqual(12);
    }
  });

  it('never lists a word twice in one category', () => {
    for (const category of CATEGORIES) {
      expect(new Set(category.words).size, category.name).toBe(category.words.length);
    }
  });

  it('has every tier represented well enough to deal from', () => {
    for (const tier of [1, 2, 3, 4]) {
      const count = CATEGORIES.filter((category) => category.tier === tier).length;
      expect(count, `tier ${tier}`).toBeGreaterThanOrEqual(40);
    }
  });

  it('puts every family in at least two categories', () => {
    const families = new Map<string, number>();
    for (const category of CATEGORIES) {
      if (category.family) families.set(category.family, (families.get(category.family) ?? 0) + 1);
    }
    for (const [family, count] of families) expect(count, family).toBeGreaterThanOrEqual(2);
  });

  it('resolves rule categories against the whole vocabulary', () => {
    const hidden = CATEGORIES.find((category) => category.name === 'Hidden numbers');
    const body = CATEGORIES.find((category) => category.name === 'Starts with a body part');
    // From three unrelated lists — which is the whole point of testing a rule
    // against every word rather than keeping a list.
    expect(hidden?.words).toEqual(expect.arrayContaining(['MONEY', 'TENNIS', 'OZONE']));
    expect(body?.words).toEqual(expect.arrayContaining(['CHINA', 'EARTH', 'NECKLACE']));
    expect(body?.words).not.toContain('ARM');
    expect(body?.words).not.toContain('EYES');
  });
});
