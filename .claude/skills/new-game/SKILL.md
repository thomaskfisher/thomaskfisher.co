---
name: new-game
description: Build a new ad-free puzzle game for the games.thomaskfisher.com collection. Use whenever Thomas has an idea for a game to recreate — trigger on "new game", "I want to build <game>", "recreate <game>", "let's add a game", "my wife likes <game>", or any description of a mobile puzzle game he wants a version of. Carries the standing goals and house rules so he never has to restate them, and the architecture, process and hard-won calibration lessons from Color Sort and Screw Land so a third game does not relearn them.
---

# New game for games.thomaskfisher.com

Thomas's wife plays mobile puzzle games and is tired of the ads, the fake-scarcity
monetization, and the data collection. This collection is the replacement.

**Never ask him to restate any of the following. They are settled.**

## Standing goals

1. A recreation of a mobile game his wife likes.
2. **No ads.** Ever, in any form.
3. **No servers.** Local storage only. Nothing leaves the device.
4. **Infinite procedurally generated levels** that increase in difficulty.
5. **Progress persists.** She never restarts at level 1 — and mid-level state
   survives closing the app, not just the level number.
6. **No in-game currency**, no purchasable add-ons or skins.

## House rules these imply

Established across Color Sort and Screw Land. Apply them without asking.

**In:** installable PWA per game (own home-screen icon, fullscreen, full offline);
unlimited undo; restart; a free unlimited hint; light/dark/auto theme; optional
shape-on-colour overlay for colour vision deficiency; a copy/paste save code in
Settings; a level jump (nothing is ever locked).

**Out, deliberately:** lives, refill timers, energy, coins, star ratings,
purchasable power-ups, locked "LVL 80" teasers, and anything that exists to
create pressure rather than play. Unlimited undo makes power-ups unnecessary.

**Every word on screen has a budget, and it is smaller than it will feel.** Copy
the existing games' phrasing before writing your own — open two `rules.ts` files
and a `showWin`/`showLose` and match what is there. The house sizes:

| Thing | Size | Example |
| --- | --- | --- |
| Rules sheet | **3 steps.** 4 only if a fourth rule genuinely loses levels | — |
| Goal | one short sentence, ~7 words | "Pour until every tube holds one colour." |
| Step title | 3-6 words, imperative | "Tap a tube to pick it up" |
| Step caption | **one line, ~10 words**, two short sentences at most | "Same colour on top, or an empty tube." |
| Win sheet | 2-3 word title, one `result-line` of a number and a **bare noun**, then the button | "All aboard" / `12` `passengers` |
| Loss sheet | 2-3 word title, then `Undo` and `Restart`. **No paragraph.** | "Bench is full" |

The sheet names rules a player cannot infer — not every rule, and never the
game's pitch. Three tests to apply:

- **A caption that will not fit is usually two rules.** Split it, or cut one.
- **A rule nobody loses a level for not knowing does not go on the sheet.** Nice
  little kindnesses (Depot's `?` bus staying revealed once seen) are discovered
  happily and explained nowhere.
- **A loss sheet never explains itself.** The board behind it is already showing
  why. Depot's first draft had a paragraph under the title, in a class that did
  not exist in `shell.css` — so it rendered as unstyled body text, which is what
  a sentence nobody asked for deserves.

Depot's first draft ran to four steps and a twenty-three-word caption carrying
two rules at once, and it read as a manual next to the other six games. Write
short first; it is much harder to cut afterwards.

**Non-negotiable technical rules:**

- **Every level is verified solvable by a solver before it is shown.** This is
  the promise the whole collection rests on. The originals ship dead ends.
- **Generation is seeded and deterministic** — a level is a pure function of
  `(profileSeed, level, difficultyOffset)`. Saves then store a move list, not a
  board; bugs reproduce exactly; levels are shareable by number.
- **Render on state change only.** No `requestAnimationFrame` loop. These are
  turn-based; her battery should outlast the originals.
- **Portrait, one-handed, controls in the bottom third.**
- **The board always fits without scrolling**, at every level size.

## Where it goes

Everything lives in `games/`. Read `games/README.md` first — it is current.

Reuse from `games/src/shared/` — do not reimplement:

| Module | What it gives you |
| --- | --- |
| `rng.ts` | seeded PRNG, `hashSeed`. **Never call `Math.random()` in generation.** |
| `storage.ts` | IndexedDB + localStorage mirror, debounced writes, save codes |
| `progress.ts` | save schema, migration, outcome tracking |
| `difficulty.ts` | saturating curve, jitter, breather levels, hidden rubber band |
| `levelSource.ts` | worker + prefetch of level N+1, main-thread fallback |
| `buffer-sink.ts` | limited buffer feeding colour-capacity sinks |
| `palette.ts` | 14 colours each paired with a shape glyph |
| `audio.ts` | synthesised sfx, no asset files |
| `ui.ts`, `settings-sheet.ts`, `shell.css` | chrome, sheets, touch hardening |
| `pwa.ts` | service worker registration + first-visit precache |

**`buffer-sink.ts` is worth checking first.** Screw Land (tray + boxes of three)
and Bus Jam (bench + buses of three) are the same game underneath. If the new
idea has "a limited holding area feeding things that want N of a colour", it is
already built.

Per game you write: `model.ts`, `solve.ts`, `generate.ts`, `render.ts`,
`game.ts`, `main.ts`, `generate.worker.ts`, `<game>.css`, plus
`<game>/index.html`, `public/<game>/manifest.webmanifest`, `public/<game>/sw.js`.
The worker is a two-line stub — copy another game's and change the slug; the
body is shared in `public/game-sw.js`. `<game>/index.html` needs
`<script src="/warm.js" defer>` alongside its module script.

Wiring points, all easy to forget: a `vite.config.ts` entry, a launcher card in
`games/index.html`, a `draw<Game>` function in `scripts/make-icons.mjs`, and the
status table in `games/README.md`.

**The launcher card is what makes the game work offline.** `public/warm.js`
reads the cards to find out which games exist, then has each game's worker
download itself, so one visit to any page arms all of them. A game with no card
is never warmed, and nobody finds out until they are on a plane.
`src/shared/offline-warm.test.ts` fails if a game in `vite.config.ts` is missing
its card or its worker stub — let it, rather than working around it.

## What to actually ask

Only the things that genuinely vary. Use `AskUserQuestion`, and keep it to the
mechanic — never the goals above.

- What the core mechanic is, and what makes a board hard rather than long.
- Which mechanics from the original to cut for v1. Always propose cuts; the
  originals pile on modifiers (unknown-colour tiles, frozen pieces, spawners)
  that are noise until the core is solid.
- If the original is 3D, whether to reframe it in 2D. Screw Land's 3D was skin
  over a layering rule; reframing kept the puzzle and made infinite generation
  tractable. A library of hand-modelled 3D objects caps "infinite" at however
  many someone modelled.

## Build order

Work in this order. It front-loads the risk.

1. **`model.ts`** — pure rules, no DOM, no randomness. Tests.
2. **`solve.ts`** — search that is *complete within a node budget*: exhausting
   the state space without a win must mean genuinely unsolvable, not "gave up".
   That distinction is what lets the generator guarantee solvability. Tests.
3. **`generate.ts`** — generate, verify with the solver, score difficulty.
4. **Probe the difficulty range before calibrating it.** See below.
5. **Tests** — the generator invariant sweep is the most valuable test in the
   project: for a sweep of levels, assert well-formed, not-already-solved,
   solvable, and that the solver's own solution actually wins when replayed.
6. **UI** — `game.ts` controller (owns state, knows nothing about the DOM),
   then `render.ts`, then CSS, then `main.ts`. Write `rules.ts` and the win/loss
   sheets against the copy budget above, with another game's open beside you —
   not in your own voice and trimmed later.
7. **Verify in a real browser** (below). Not optional — both real bugs found so
   far were invisible to the unit tests.
8. **Ship** — `npm run build`, then `firebase deploy --only hosting:games`.

## Lessons that cost real time. Do not relearn these.

**Measure the difficulty signal's achievable range before calibrating a band to
it.** Both games got this wrong first. Color Sort scored difficulty by solver
backtracking, which turned out nearly flat — greedy search almost never
backtracks, so the signal spanned 2^1.4 where the formula assumed 2^11, and
difficulty plateaued at 0.5 by level 100. Write a throwaway probe that prints
shape, difficulty and attempt count across a level sweep, look at it, *then* set
the band. A band the format cannot reach makes every attempt miss, costs dozens
of solver runs per level, and leaves difficulty noisy rather than high.

**Trap rate is the difficulty signal that works.** The fraction of *naive*
playthroughs that lose — a rollout that usually takes an obvious match and
otherwise picks at random. It models the player being built for, rather than the
search algorithm. Smooth, monotonic, wide range in both games.

**Difficulty comes from constrained choice, not from more stuff.** If the player
always has many options in front of them, one always fits and the level cannot
be lost however many colours are on screen. Color Sort: fewer spare tubes.
Screw Land: more, smaller plates so less is uncovered at once — and note that
*fewer, bigger* plates made it easier, which was the opposite of the intuition.
Cap board size at what fits a phone; past that, difficulty must come from the
measured signal.

**Guarantee the structural half by construction.** Screw Land assembles plates
bottom-up, so disassembly is always physically possible and the solver only has
to worry about colour. Bus Jam should generate by reverse play for the same
reason. Random boards are nearly always unsolvable or trivial.

**A hint must follow one cached plan.** Re-solving after every move can return a
different winning line whose opening move undoes the previous one — the hint
button then ping-pongs between two positions forever. Both games compute a
solution once, follow it, and discard it only when the player deviates.

**Set renderer options before the state change that triggers the redraw.**
Toggling a setting that calls `updateSettings` first means the redraw it fires
uses the old options and the change appears not to work.

**Fit the board to its actual content bounds**, not the nominal grid — plates or
tubes rarely reach the edges, and the dead margin shrinks everything for nothing.

**Clear transient highlight classes before applying a new one.** A lingering
`is-hinted` on several elements at once makes the suggestion ambiguous, and will
also quietly break any automated playthrough.

**Unlimited undo makes every deferred visual change a latent bug.** Undo is a
house rule, so any `setTimeout` that commits something visual is a race: the
player can revert the state inside its window and the timer still fires against
the new state. Screw Land hid a fallen plate 460ms after it started falling and
never kept the handle — an undo in that window put the plate back, then the
orphaned timer hid it again, permanently, because nothing cleared it a second
time. Each occurrence stranded another plate until the board was floating screws
with nothing under them. **Every deferred DOM mutation needs its handle stored,
cancelled when the state it assumes is reverted, and cleared on rebuild.** Audit
each one by asking: what if undo, restart, or a new level lands before this
fires?

**Give the board its own stacking context.** Anything that stacks pieces by
assigning `z-index` from game state — layers, depth, stacking order — is
computing numbers that climb without limit, and they compete with the whole page
unless something contains them. Screw Land's plates used `layer * 10`, which
reached 60 on a seven-plate board while the settings overlay sat at 20, so deep
plates painted straight over the sheet. `isolation: isolate` on the container is
the whole fix. Add it when you write the container, not after someone reports
the game drawing over a menu.

**The generator must measure the rule the game actually enforces.** Screw Land's
trap-rate rollouts counted an overflowing tray as a lost run, and the entire
difficulty curve was calibrated against that — while the game itself merely
refused the tap and played a buzz. The board could sit permanently full and the
level was still winnable. Nothing failed; the curve was just measuring a game
nobody was playing. **When you change a rule, grep the difficulty model for it,
and vice versa.**

**Two difficulty levers can silently cancel each other through the band.** The
generator only ships boards that score inside the target band, so pushing two
levers at once produces candidates that score *above* it and get thrown away —
handing back the lever you thought you pulled. Screw Land dropped open boxes to
two and raised colours to six; the mean open-box count refused to fall below
2.62 because every two-box board now measured as maximum difficulty and was
rejected. Capping colours relative to open boxes fixed it. **The signature is a
lever whose measured effect is far smaller than expected — check the rejection
rate before you assume the lever is weak.**

**When you tighten choice, show what is coming.** Constrained choice is where
difficulty comes from, but a constraint the player cannot see is a coin flip.
Once Screw Land's open boxes dropped to two, parking a screw was a blind bet on
a colour queue nobody could read, and losing felt like bad luck rather than a
bad decision. A three-deep preview of the queue was what made the same
difficulty feel fair. Ask, for every constraint: what does the player need to
see to make this a decision rather than a guess?

**`el.hidden` loses to any `display` rule you wrote yourself.** `[hidden]` is a
user-agent style, so a class rule like `display: flex` outranks it and the
element stays visible while claiming to be hidden. Any element toggled with
`.hidden` needs an explicit `.thing[hidden] { display: none }`.

## Verifying in a real browser

`scripts/cdp.mjs` in this skill folder drives headless Chrome over CDP: it
captures console output and exceptions, runs a script of evals, can go offline
or navigate, and screenshots.

```bash
node .claude/skills/new-game/scripts/cdp.mjs <url> <out.png> [actions.json]
```

`actions.json` is an array of `{"eval": "..."}`, `{"waitFor": "expr"}`,
`{"wait": ms}`, `{"offline": true}`, `{"navigate": "url"}`, and
`{"seedSave": {"game": "screwland", "level": 210}}`. Evals await promises, so an
async IIFE that plays the game works. Prefer `waitFor` over a fixed `wait`:
generation runs on a worker and a deep level takes seconds.

The highest-value check is **playing levels through the hint button**: click
Hint, click whatever it highlights, repeat until the win overlay appears, then
click through to the next level. That single loop found the hint ping-pong bug
and confirms generation, solving, rendering, input, win detection, persistence
and level advance all work together.

Also verify: mid-level state survives a reload byte-for-byte; the board does not
overflow at the largest level size; both themes; and — on a Firebase preview
channel, because **service workers need HTTPS and a LAN address silently
registers nothing** — Add to Home Screen, then airplane mode, then play a full
level offline.

**Testing offline in one browser session proves nothing.** A worker that is
already running has its handlers in memory and its responses in the HTTP cache,
so the game plays offline whether or not the Cache Storage path works at all.
The failure lives in the cold start: close the browser, kill the server, reopen.
That is the sequence that caught `cache.match` honouring `Vary` — a cache that
was complete, matched by URL from the console, and still served not one asset to
the page. `cdp.mjs` kills Chrome without letting it flush, so a two-run test
needs `Browser.close` and a wait on exit, or the second run starts with no
registrations and blames the wrong thing.

**Reaching a deep level.** Use the `seedSave` action rather than playing there.
Two traps it already handles: the localStorage key is `tf-games:save:<game>`
(not `tf-games:<game>`), and the IndexedDB copy must be deleted first or
`storage.ts` prefers whichever record is newer and ignores the seeded one.
Because generation is deterministic, a seeded level is byte-identical to the one
she would reach by playing, which makes deep-level bugs reproducible on demand.

**Do not reach for `chrome --headless --screenshot --virtual-time-budget`.**
Virtual time does not advance Web Worker time, and levels generate on a worker,
so the page sits on "Preparing…" forever however large the budget. Use the CDP
driver, which runs on real time and polls with `waitFor`.

**Reproduce the bug before fixing it, then add a negative control.** Write a
probe that asserts the invariant over live DOM state — "no plate is hidden while
a screw still fastens it", "with the overlay open, nothing from the board is the
topmost element at any point" — and confirm it *fails* first. Then, after
fixing, break the fix at runtime and confirm the probe screams again: disabling
`isolation` from the console turned 0 leaked points back into 261, which is what
proved the probe was measuring anything at all. A probe that has only ever
passed is not evidence.

## Finishing

- Run `npm test`, `npm run build`, regenerate icons.
- **Changing generation rewrites every in-progress board.** Levels are a pure
  function of `(profileSeed, level, difficultyOffset)`, so touching the shape
  function means anyone mid-level gets different geometry than they left; their
  move list replays against a board that no longer matches and is dropped. Not
  data loss, and not worth blocking a fix — but say so, because "my level
  changed" will otherwise arrive looking like a bug.
- Deploy a preview channel first so he can try it on her phone:
  `firebase hosting:channel:deploy preview --only games`.
- Then `firebase deploy --only hosting:games`. **Always the target, never a bare
  `firebase deploy`** — the portfolio site shares this repo and usually has
  unrelated uncommitted changes that would ship with it.
- Confirm what is live is what you built: the asset hashes in the deployed HTML
  should match `games/dist/assets/`, and grep the served bundle for a string
  only the new code contains. Hashed filenames make a stale cache easy to prove
  or rule out in one command.
- Update the status table and the layout list in `games/README.md`, and leave a
  short "picking this back up" note if the game is unfinished.
- **Do not commit unless he asks.**
