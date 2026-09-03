# Games

Ad-free replicas of a few mobile puzzle games, served from
`games.thomaskfisher.com`. No ads, no accounts, no tracking, no servers, and no
in-game currency. Everything is static; all state lives on the player's device.

| Game | Status |
| --- | --- |
| Color Sort | Playable |
| Screw Land | Playable |
| Bus Jam | Playable |

## Working on it

```bash
npm install
npm run dev        # http://localhost:5273
npm test           # solver, generator, layout
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
`(profileSeed, level, difficultyOffset)`, so a save stores a move list rather
than a board, levels are reproducible from a bug report, and the whole save fits
in well under a kilobyte.

**Two of the three games share an engine.** Screw Land has a five-slot tray and
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

**The difficulty curve hides a rubber band.** A monotonic ramp eventually walls
the player. `shared/difficulty.ts` adds a saturating curve, per-level jitter,
deliberate breather levels, and a hidden offset that eases off after a run of
failures. None of it is ever shown in the UI.

### Layout

```
index.html            launcher
colorsort/index.html  one entry per game
src/shared/           rng, storage, progress, difficulty, audio, ui, pwa,
                      buffer-sink (Screw Land + Bus Jam), levelSource
src/colorsort/        model, solve, generate, layout, render, game, main
src/screwland/        model, solve, generate, render, game, main
src/busjam/           model, solve, generate, render, game, main
public/               icons, per-game manifest + service worker (copied verbatim)
examples/             reference material for the originals — never deployed
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
