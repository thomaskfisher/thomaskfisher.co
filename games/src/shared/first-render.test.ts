import { describe, expect, it } from 'vitest';

import { ColorSortGame } from '../colorsort/game';
import { ScrewLandGame } from '../screwland/game';
import { BusJamGame } from '../busjam/game';
import { SurvivalGame } from '../survival/game';

/**
 * The first render happens before the save has loaded.
 *
 * `subscribe` notifies its listener synchronously, and `start()` is awaited
 * separately afterwards — so every game paints one frame with no save behind
 * it. That frame is the "Preparing…" state.
 *
 * This is the regression test for a bug that took all four games down at once:
 * the timer's on/off check reads `game.settings` from inside the subscribe
 * listener, `save` was declared `private save!: SaveData<M>` and was genuinely
 * undefined at that point, and the resulting TypeError killed the listener on
 * every notify. The games rendered "Preparing…" and nothing else, forever, with
 * no board and no error a player could see.
 *
 * The existing code hinted at the hazard — `snapshot()` already wrote
 * `this.save?.level ?? 1` — but a defensive `?.` at one call site does not
 * protect a getter reached from another. The save is now initialised at
 * construction instead.
 */
const games = [
  ['Color Sort', () => new ColorSortGame()],
  ['Screw Land', () => new ScrewLandGame()],
  ['Bus Jam', () => new BusJamGame()],
  ['Survival', () => new SurvivalGame()],
] as const;

describe('before start() resolves', () => {
  for (const [name, create] of games) {
    it(`${name} exposes settings without a loaded save`, () => {
      const game = create();
      expect(() => game.settings).not.toThrow();
      expect(typeof game.settings.timed).toBe('boolean');
      expect(typeof game.settings.sound).toBe('boolean');
      expect(game.currentSave.level).toBeGreaterThanOrEqual(1);
    });

    it(`${name} notifies its first listener without throwing`, () => {
      const game = create();
      let seen = 0;
      expect(() => {
        game.subscribe((state) => {
          seen++;
          // Everything a main.ts listener touches on the very first frame.
          expect(state.phase).toBe('loading');
          expect(state.level).toBeGreaterThanOrEqual(1);
          expect(game.settings.timed).toBe(false);
        });
      }).not.toThrow();
      expect(seen, 'subscribe must notify synchronously').toBe(1);
    });
  }
});
