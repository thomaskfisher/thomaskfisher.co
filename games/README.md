# Games

Ad-free replicas of a few mobile puzzle games, served from
`games.thomaskfisher.com`. No ads, no accounts, no tracking, no servers, and no
in-game currency. Everything is static; all state lives on the player's device.

| Game | Status |
| --- | --- |
| Color Sort | Playable |
| Screw Land | Playable |
| Bus Jam | Playable |
| Survival | Playable |

## Working on it

```bash
npm install
npm run dev        # http://localhost:5273
npm test           # solver, generator, layout, curve, clock
npm run build      # -> dist/
npm run icons      # regenerate PWA icons (output is committed)
```

## How it works

**Every level is verified before it is shown.** Levels are dealt at random from
a seed, then solved. A board the solver cannot finish is discarded, so unlike
the games this replaces, a level is never a dead end. The same solver drives the
hint button, which is free and unlimited.

**Difficulty is measured, not assumed.** The signal is *trap rate*: the fraction
of naive playthroughs that dead-end. It models the player we are building for —
someone enjoying a puzzle on the couch, not running a search. See
`colorsort/generate.ts`.

**Generation is deterministic.** A board is a pure function of
`(profileSeed, level)`, so a save stores a move list rather than a board, levels
are reproducible from a bug report, and the whole save fits in well under a
kilobyte.

**Survival gives you one lane of movement per row, from level 1.** Reach 2 let
the squad cross the whole board in a step, so there was no route to plan and the
opening levels were a pure arithmetic warm-up. The gate values on a row are also
deliberately close together — within a factor of about 2.5 — because a row
holding +15, +22 and +2,759 has no decision in it.

**Survival is a route, not a runner.** The original is a real-time lane game —
your squad scrolls towards a wall of gates and you drag left and right to weave
between them. The maths in it is trivial (99 beats 1) and the difficulty is
thumb speed, which is the half worth keeping least. Rows of gates across a few
lanes, one lane of sideways movement per row, and the whole board visible turns
the same fantasy into a planning puzzle: the `x4` four rows up may not be
reachable from the `+900` in front of you, and `x3` then `+50` is not `+50` then
`x3`. Each step still runs when you commit it — the run is per row rather than a
replay at the end, which also means undo never has a multi-second animation to
race.

**Survival's solver is exact rather than bounded.** Every operation is monotone
non-decreasing in the incoming soldier count — more soldiers is never worse,
barriers included — so of two ways to reach the same cell, the one carrying more
is at least as good from there on. One number per cell is therefore enough, and
the sweep is O(rows x lanes). "Unsolvable" means unsolvable, not "the budget ran
out". `model.test.ts` checks monotonicity over the whole node space, because if
it ever stops holding this file silently stops being correct.

**Survival's horde is a percentile, not a fraction.** Deriving it as
`best x margin` put deep levels at four winning routes out of fourteen hundred:
arithmetically a puzzle, in practice a lottery. Generation now enumerates what
every route on the board actually finishes on — nine rows of at most three
onward lanes is a few thousand walks — and places the horde so that a target
share of them get through. "How many ways are there to win" becomes the literal
difficulty dial, it means the same thing on a board full of multipliers and a
board full of barriers, and at least one winner is guaranteed by construction.

**Every game explains itself once, then gets out of the way.** Three of the
four have a rule you cannot infer by tapping: Screw Land loses the level when
the tray overflows, Bus Jam only lets you tap someone with a clear walk to the
top edge, and Survival's reach limit is invisible until a tap is refused. A new
player discovers those by losing, which reads as the game being unfair rather
than as a rule. `shared/how-to-play.ts` is a short illustrated sheet per game —
diagrams rather than prose, because the rules are all spatial — shown once on a
save that has never cleared a level, and available forever from the `?` in the
top bar or from Settings. The closing promises (verified solvable, free undo and
hints, nothing locked) are written once in the shared module rather than four
times, because they are the same promise in all four games.

`shouldAutoShow` is deliberately not just `!seenHowToPlay`: adding the flag to
the save format makes every existing player read as never having seen it, and
interrupting someone on level 60 to explain the tap target is worse than not
explaining it at all.

**Two of the four games share an engine.** Screw Land has a five-slot tray and
boxes taking three matching screws; Bus Jam has a five-slot bench and buses
taking three matching passengers. Same thing — `shared/buffer-sink.ts`. Bus Jam
adds grid pathfinding on top.

**Bus Jam levels are built by playing them backwards.** Dealing a crowd at
random and hoping does not work: the physical constraint and the colour
constraint have to line up, and a random board is nearly always unsolvable or
trivial. So generation plays a legal *colour* order forward first — easy,
because a bus at the stop always has someone left on the board who matches it —
then walks that order from the last tap to the first, seating each passenger
somewhere that still has a clear path to the exit at that point in the reverse
sequence. At forward step i the grid holds exactly the people placed at reverse
steps i..n, which is the state person i was placed against, so the board is
solvable by construction. The solver then proves it anyway.

People are seated deepest-first, so crowds pack from the back like a real queue.
How far forward of the deepest free cell someone may sit is itself a difficulty
lever: wide at low pressure gives the scattered tutorial boards, zero at high
pressure gives the packed columns.

**Screw Land is 2D on purpose.** The original is a 3D object you rotate, but the
3D is skin: the puzzle is that plates overlap, so a screw under another plate is
unreachable until the plate above loses all of *its* screws and falls. Layered
rectangles express that exactly, and unlike a library of hand-modelled 3D
objects, they can be generated forever. Structures are assembled bottom-up, so
they always come apart physically — which leaves colour as the only thing the
solver has to verify.

**Fifty levels that mean something, then an endless supply of them.**
`shared/difficulty.ts` opens at roughly a quarter of full intensity, reaches
full intensity by level 50, and stays there. Levels past 50 keep coming forever
and are all pitched at the ceiling — what varies up there is the board, not the
pressure.

Level 1 is meant to be hard. There is no funnel to protect here, and the failure
mode worth guarding against is a hundred levels of imperceptible increments, not
a player bouncing off level 3.

Two things an earlier version did are deliberately gone: the hidden rubber band
that eased difficulty by up to forty effective levels after a losing streak
(on a fifty-level curve that is the whole game), and most of the breather
levels. **Level N means one thing, forever, on every device.**

**The clock is optional and is not a difficulty setting.** `shared/timer.ts` is
a time *budget*, not a countdown: every success — a bus away, a box filled, a
tube finished, a row survived — pays time back, so a player who is solving it
never runs out and a player who is staring at it does. The board is identical
either way. It is off by default and one tap away in the top bar, because "I
want to race" and "I want to sit and think" are both real moods and a setting
buried in a sheet serves neither.

### Layout

```
index.html            launcher
colorsort/index.html  one entry per game
src/shared/           rng, storage, progress, difficulty, audio, ui, pwa,
                      buffer-sink (Screw Land + Bus Jam), levelSource,
                      timer + timed-play + timer-chip (the optional clock),
                      how-to-play (the rules sheet + its drawing helpers)
src/colorsort/        model, solve, generate, layout, render, game, main, rules
src/screwland/        model, solve, generate, render, game, main, rules
src/busjam/           model, solve, generate, render, game, main, rules
src/survival/         model, solve, generate, render, game, main, rules
public/               icons, per-game manifest + service worker (copied verbatim)
examples/             reference material for the originals — never deployed
tools/                calibration harnesses — not built, not in `npm test`
scripts/make-icons.mjs
```

## Deploying

The games are a second Firebase Hosting site in the existing project, so
deploying them does not touch the portfolio.

```bash
npm run build

# Test on a real phone. Service workers need HTTPS, so a LAN address will
# silently register nothing — use a preview channel instead.
firebase hosting:channel:deploy preview --only games

# Ship
firebase deploy --only hosting:games
```

### Cut from Survival v1

Boss enemies with their own health bars, squad splitting across two lanes
("PICK YOUR LANE" in `examples/survival/survival1.png`), and weapon or fire-rate
upgrades. The first is a barrier with different art and adds no decision; the
other two each add a whole second thing to reason about, and neither is worth
carrying while the core is still being calibrated.

### Cut from Bus Jam v1

The `?` unknown-colour passengers, ice-encased passengers, and numbered spawn
tunnels visible in `examples/bus-jam/busjam2.png`. The core is solid without
them; they belong in later as optional modifiers, not as load-bearing rules.

### Things worth not relearning

- **Measure the difficulty signal before trusting it.** Both of the first two
  games' scoring attempts were mis-calibrated by an order of magnitude and
  produced a flat curve. Probe the achievable range first, then set the band to
  it. Bus Jam's trap rate was probed across the pressure range before the score
  was written, and landed right first time.
- **Check that a difficulty lever can actually fire.** Bus Jam's four-seat bench
  was gated on having two buses at the stop, which only happens below the
  pressure at which the gate opens — so the lever was unreachable dead code that
  read as deliberate. Levers that are conditioned on each other need the ranges
  checked, not just the intent.
- **Hints must follow one cached plan.** Re-solving after every move can return
  a different winning line whose opening move undoes the previous one, and the
  hint button ping-pongs forever. All three games cache a plan and consume it.
- **Punishing rows compound downwards.** Survival prices barriers and negative
  gates as a fraction of the count reaching them, exactly as multipliers are a
  multiple of it. Spending more than about two rows in five on them makes the
  board net-deflationary, and the first build finished deep levels on eight
  soldiers against a horde of seven — a fine puzzle, entirely the wrong feeling.
  Barriers and hostile rows now share one row budget, and the difficulty that
  used to come from them comes from the horde percentile, which costs no
  magnitude at all.
- **A per-board difficulty target normalises the other levers away.** Once
  Survival's horde was calibrated to a fixed share of winning routes, adding
  barriers stopped moving the measured trap rate — the horde simply moved to
  compensate. That is not the band rejecting candidates (rejection stayed at
  one or two attempts a level); it is the signal being defined in terms of the
  answer. The other levers still change what a board *feels* like, and it is
  worth knowing that is now all they do.
- **Colours, sinks, buffer and capacity are one budget, not four levers.** The
  obvious ask for Screw Land and Bus Jam is "more colours *and* fewer holding
  slots", and the two draw on the same account: `tools/probe.ts` measures a
  two-box Screw Land board with a four-screw box as solvable in 7 deals in 20 at
  six colours and 2 in 20 at seven. Past the edge, levels do not come out hard —
  they fail to come out, and the generator burns every attempt and throws.
  Difficulty at the top has to come from the levers that *don't* draw on it: box
  capacity, queue preview, plate occlusion.
- **Generation cost is the hidden constraint on the shape function.** The same
  Screw Land change took level 20 from 400ms to 34 *seconds*, because a
  candidate that fails the solver costs the whole verify budget and the shape
  had drifted into a region where two thirds of deals fail. `tools/timing.ts`
  exists to catch this: the background worker has about one level's play to
  finish in, and past that the main-thread fallback freezes the board. A lever
  that costs six seconds of latency to move one notch is not worth the notch.
- **Don't stack four thresholds at the same pressure.** Screw Land's boxes,
  capacity, tray and preview all stepped between pressure 0.25 and 0.35, and
  levels 2-8 lurched 0.34 → 0.82 → 0.61. Staggering them across the curve is the
  difference between a ramp and a cliff.
- **A symmetric difficulty band drifts low.** Generators take the first board
  that lands inside the band, and the cheap boards are the ones found first — so
  an equal window above and below the target is not neutral in practice. Level 1
  was landing at 0.13 against a 0.26 target in three of the four games. The band
  is now generous upwards and strict downwards, which costs a few attempts and
  makes "harder than asked" the failure mode.
- **`var()` does not work in an SVG presentation attribute.** An attribute is
  not a CSS declaration, so `fill="var(--accent)"` is ignored and the shape
  renders black — in both themes. Every colour in the rules diagrams that has to
  follow the theme is therefore a class, defined under `.howto-art` in
  shell.css. The same rule bites the other way round: a CSS class beats a
  presentation attribute, so `class="ha-fill-strong" fill-opacity="0.6"` keeps
  the class's 0.3 and the override silently does nothing.
- **A sheet focuses its first button, and that scrolls.** `openSheet` focuses
  the first control so the keyboard works, which for How to play — whose only
  button is its last element — opened the sheet scrolled to its own footer. The
  fix is `focus({ preventScroll: true })`, and it is right for every sheet.
- **shell.css owns some very ordinary class names.** `field`, `note` and
  `button` are all defined globally, and Survival's board wrapper was called
  `.field` — so it silently inherited a text input's border, which showed up as
  a mystery rounded rectangle around the whole board. Check the shared sheet
  before naming a container something generic.
- **Never size a board from an element that the board can resize.** `.app` is a
  grid, and a grid item defaults to sizing its column to its content. A board
  wider than the phone therefore widened its own container, `fitBoard` measured
  the widened box, and the board grew again — walking off the right edge of the
  screen. `.app` now pins its column to `minmax(0, 1fr)`, which makes that
  measurement trustworthy for all three games.

## Notes for later

- **Saves are per-device.** iOS can evict local storage under disk pressure or
  when Safari data is cleared, and nothing follows the player to a new phone.
  Settings → *Copy save code* is the backup; it is the reason a server is not
  needed.
- **Bump `CACHE_VERSION`** in `public/<game>/sw.js` when the cached shell
  changes, or returning players can stay pinned to an old build.
- **The games site has no catch-all rewrite**, on purpose. A mistyped asset path
  returns a real 404 instead of silently serving HTML with a 200.
