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
| Five Dice | Playable |
| Gridlock | Playable |

## Working on it

```bash
npm install
npm run dev        # http://localhost:5273
npm test           # solver, generator, layout, curve, clock, dice fairness
npm run build      # -> dist/
npm run icons      # regenerate PWA icons (output is committed)
```

## How it works

**Five of the six are puzzles. Five Dice is not, and it bends the house rules
on purpose.** Everything below about verified levels, measured difficulty and
unlimited undo describes Color Sort, Screw Land, Bus Jam, Survival and
Gridlock. Yahtzee
is a game of chance: there is no board to verify, no difficulty to curve, and
rewinding a throw would be reading the answer. What it keeps is everything that
made this collection worth building — no ads, no servers, no currency, nothing
locked, and a free unlimited hint — and what it puts in place of the rest is set
out under *Five Dice* below.

**Every level is verified before it is shown.** Levels are dealt at random from
a seed, then solved. A board the solver cannot finish is discarded, so unlike
the games this replaces, a level is never a dead end. The same solver drives the
hint button, which is free and unlimited.

**Difficulty is measured, not assumed.** In four of the five puzzles the signal
is *trap rate*: the fraction of naive playthroughs that dead-end. It models the
player we are building for — someone enjoying a puzzle on the couch, not running
a search. See `colorsort/generate.ts`. Gridlock is the exception and gets
something better; see below.

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

**Every game explains itself once, then gets out of the way.** Five of the six
have a rule you cannot infer by tapping: Screw Land loses the level when the
tray overflows, Bus Jam only lets you tap someone with a clear walk to the top
edge, Survival's reach limit is invisible until a tap is refused, Five Dice
takes two taps to write a box, and Gridlock counts a slide of any length as one
move — which is the unit the "best 14" in its top bar is quoted in. A new player discovers those by losing, which
reads as the game being unfair rather than as a rule. `shared/how-to-play.ts` is a short illustrated sheet per game —
diagrams rather than prose, because the rules are all spatial — shown once on a
save that has never cleared a level, and available forever from the `?` in the
top bar or from Settings. Each step is one diagram, a title and a single line of
caption: the sheet is there to name the rules a player cannot infer, not to sell
the game or to be read twice.

`shouldAutoShow` is deliberately not just `!seenHowToPlay`: adding the flag to
the save format makes every existing player read as never having seen it, and
interrupting someone on level 60 to explain the tap target is worse than not
explaining it at all.

**Five Dice cannot make the guarantee the puzzles make.** There is nothing to
verify: every round can be finished, since writing a zero in a box is always
legal. What it offers instead is that **the dice are fair and were fixed before
you touched them**, and both halves of that are tested rather than asserted. `dice.test.ts` is where the generator invariant
sweep would be in any other game here — chi-square on the faces overall and per
slot, per throw and per turn; independence between neighbouring dice; and the
rate of the rare hands against the arithmetic, because a per-face check passes
happily while the five dice lean on each other.

**Every face is a pure function of `(seed, turn, throw, slot)`.** Indexing by
slot and throw number rather than by a running counter is what makes it honest
rather than merely seeded: throwing one die and throwing three both give slot 0
the same face, so choosing differently cannot change what a throw was going to
give you. That also keeps the save a move list, exactly as in the other games.

**Which is why Five Dice has no undo, and no restart.** Both would be exploits
rather than kindnesses. Determinism means a rewind is an oracle — throw all
five, read the faces, rewind, and throw back only the ones that disappointed you
— and a replayed round is the whole deck face up. Undo exists in the puzzles so
that a wrong move is not a punishment; here it would simply delete the game.
What undo was actually protecting against is the misfire, the stray tap that
writes a zero in Five of a kind twenty minutes into a good card, and that is
handled directly: **a box takes two taps**, the first of which only shows what
it would pay. Abandoning a card lives in the top bar behind a confirmation, is
never counted in the record, and costs nothing, because rounds are not a ladder.

**Its hint plays the odds, not the answer.** `advise.ts` may not touch `dieFace`
and does not: it reasons about the distribution of a fair die exactly as a
player must, and `advise.test.ts` holds it to that by asserting that the same
position gets the same advice from two different rounds. Within a turn the
arithmetic is exact — 252 distinct hands, every way of holding, two throws of
lookahead — and a box is priced at what a whole turn spent chasing it would
earn, which is what stops the hint handing over Five of a kind for a five-point
hand. It does not plan across turns, so it is a strong player rather than a
perfect one: `tools/dice.ts` measures it at a mean of 233 a card, against
roughly 254 for perfect play and 200-220 for a good human.

There is also no hint ping-pong to guard against here, and it is worth knowing
why. The other games cache a winning line because re-solving from an adjacent
position can return a different one whose opening move undoes the last. Advice
here is a pure function of the position, so two answers to the same question are
the same answer; the cache in `game.ts` saves recomputation and nothing else.

**Gridlock is the one puzzle that cannot be lost, and that changes everything
about how it is built.** Every slide is reversible — a car leaves the bays it
came from empty, so sliding it back is always legal — which makes its state
space an *undirected* graph with no dead ends. Trap rate, the signal the other
four are calibrated on, therefore has nothing to measure: there is nothing to
trap on. What it gets instead is worth more. The graph is small enough to
enumerate completely, so difficulty is **the exact length of a shortest
solution**. "This park needs nineteen slides" means no eighteen-slide sequence
exists, which is a far stronger claim than the other games can make, and the
generator picks the starting position *at* the depth the curve asks for rather
than dealing until something scores near it.

**Gridlock's levels are built backwards from a finished one.** The generator
starts from a park that is already solved — the target parked against the exit
wall — so the component reached from it contains a win by definition, and
reversibility means every position in that component can get back to it. Any
starting position drawn from the component is therefore solvable *by
construction*, and the solver measures rather than filters.

**And it searches the layout, not the deal.** This is the part that was measured
rather than assumed, and the measurement changed the design. `tools/gridlock.ts`
surveyed what random parks actually produce: a median component depth of *two or
three slides*, with anything past eighteen turning up about once in a hundred
layouts. Dealing parks and keeping the hard ones was never going to work. But
depth is a property of the layout — which vehicles exist and which row or column
each is locked to — so the generator hill-climbs it: replace one vehicle, keep
the change if the component got deeper, reseed when a climb stops improving.
That reaches the target depth in 97% of runs at ten slides and 88% at sixteen.

The same survey paid for itself twice more. Deep layouts have *small* components,
three to seven thousand positions — a park with a hundred thousand reachable
positions is a wide-open one where the target is three slides from the exit — so
the state cap is 8,000 and throws away only layouts that were going to be
discarded anyway. And a hard park has vertical cars standing across the exit row,
so the seed layout plants two or three of them rather than making the climb
rediscover that every time.

**Two of the five puzzles share an engine.** Screw Land has a five-slot tray and
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
src/fivedice/         model, advise (the hint), render, game, main, rules —
                      no generate and no solve: there is no level to build or
                      verify, only fair dice
src/gridlock/         model, solve, generate, render, game, main, rules, plus
                      ascii — a six-by-six park as six lines of six characters,
                      imported only by the tests and tools
public/               icons, per-game manifest, a two-line sw.js per game,
                      game-sw (the shared worker body) and warm (downloads every
                      game from any page) — copied verbatim, never bundled
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

### Cut from Five Dice v1

The bonus for a second five-of-a-kind, and the joker rules for where one may be
written. Both are rare, and each adds a whole dimension to every decision on the
card. So a full house here is exactly three of one face and two of another, and
five alike is not a run — the strict reading, and the one most implementations
quietly do not use.

The name is the other departure. Yahtzee is Hasbro's trademark; the game is not.
The categories keep the names anyone would look for — full house, small
straight, chance — and the fifty-point row is Five of a kind. If the title
should be otherwise it is one string in four files.

### Cut from Gridlock v1

Immovable one-cell blocks, a second exit, and any of the modifiers the various
mobile versions layer on. Blocks are the one genuinely tempting omission — they
add constraint rather than noise and the generator would handle them for free —
but they are another rule to explain, and the core wants calibrating first. A
second exit mostly makes boards easier.

Four-cell vehicles *are* in, at about one park in ten at the top of the curve.
On a six-wide board they have three positions and spend the level being
something to route around, which is the point.

The name is a departure for the usual reason: Rush Hour is ThinkFun's trademark
and Unblock Me is Kiragames'. The game is not.

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
  hint button ping-pongs forever. Every game here caches a plan and consumes it.
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
  measurement trustworthy for every game here.

- **A reversible puzzle needs a different difficulty signal, and gets a better
  one.** Trap rate assumes a directed state space with dead ends in it. Gridlock
  has neither, so the rollout measured nothing — but the same property that
  kills the signal (every move undoable, so the graph is undirected) is what
  makes an exhaustive sweep affordable and turns difficulty into an exact fact.
  Check whether a new game can be lost *before* reaching for the shared model.
- **Hill-climbing wanted diversity, not small steps.** The obvious improvement to
  Gridlock's layout search was a nudge — shift one vehicle a row or a column,
  the classic local move. Measured, it made the generator *worse*: levels landing
  inside their band fell from 23 in 23 to 20, and the slowest level nearly
  doubled. Small moves rarely change a component's depth at all, so the climb
  spent its budget on them and reseeded less often. The lever that actually
  worked was a short stall limit and more restarts.
- **A stalled search must restart, not settle.** Gridlock's first climb took the
  deepest layout it had found when it ran out of budget. On a park that had
  jammed — four hundred reachable positions, almost every mutation colliding —
  that meant shipping a six-slide board against a target of twenty. Level 150,
  trivial, dressed as a hard one. Nothing failed and no test caught it; only the
  curve dump showed it.
- **A probe that has only ever passed is not evidence, and sometimes the honest
  answer is that there was nothing to measure.** The board-over-sheet probe found
  zero leaked points in Gridlock — and zero again with `isolation` switched off
  at runtime. The negative control was the useful half: it showed the isolation
  was not doing the work, because this game's z-indexes are small fixed constants
  topping out at 6 against the sheet's 20, rather than Screw Land's `layer * 10`.
  It stays as insurance, and the comment in the CSS says which it is.
- **A hardcoded copy of a CSS value drifts.** Gridlock's fit subtracted a guessed
  8px for the board's padding, which left the gap in the exit wall hanging four
  pixels off the right of the screen — invisible at desktop width and obvious on
  a phone. Reading `getComputedStyle` for the padding costs one call on resize
  and cannot go stale.
- **Check the arithmetic before blaming the generator.** Five Dice's fairness
  sweep failed on large straights at nearly twice the expected rate, which looks
  exactly like a hash mixing its inputs badly — and five hashing variants were
  measured before the actual bug turned up in the test itself: a large straight
  is `2 x 5! = 240` ordered outcomes out of 7776, not 120. The dice had been
  fine the whole time.
- **A CSS class beats an SVG presentation attribute, and it bites both ways.**
  The known half is that `fill="var(--accent)"` does nothing. The other half:
  `.ha-label` in shell.css sets `text-anchor: middle`, so `text-anchor="start"`
  on a rules diagram's label is silently ignored and every label centres on the
  box's left edge with half of it outside the tile. Those diagrams now lay their
  text out in centred zones, which cannot quietly stop working.
- **Percentage padding resolves against the containing block's width, not the
  element's.** `padding: 14%` on a die was 52px a side, which pushed each die's
  min-content width past 100px and ran the tray off the screen while crushing
  the pips to nothing — with the width property still reading 60. Size padding
  from the element's own custom property.
- **A fixed-size board still has to be fitted.** Five Dice is always seven rows
  by two columns and five dice, so there is no level-to-level variation to solve
  for — but phones vary by three hundred pixels of height, and a scorecard that
  needs scrolling is one you cannot plan from. The row height is solved for the
  space available, and what the cap leaves over collects above the dice, where
  it reads as the gap between the card and the tray.

## Notes for later

- **Five Dice's record rides in `stats`.** It is the one game whose outcome is a
  number rather than cleared-or-not, so `bestScore` and `scoreTotal` are optional
  fields on the shared save. They live there rather than in a store of their own
  so that the save code in Settings — the entire backup story for a server-free
  game — carries a player's record with it. A finished card is banked and
  `inProgress` cleared in the same breath, so closing the app on the result sheet
  keeps the score and reopening cannot count it twice.
- **The shared chrome takes a few opt-outs.** `showTimer`, `showShapes`,
  `levelNoun` and `progressLine` on the settings sheet. All default to the puzzle
  behaviour, so the other four call sites are unchanged. Offering a row that does
  nothing is worse than not offering it.
- **Saves are per-device.** iOS can evict local storage under disk pressure or
  when Safari data is cleared, and nothing follows the player to a new phone.
  Settings → *Copy save code* is the backup; it is the reason a server is not
  needed.
- **Opening any page downloads every game.** `public/warm.js` runs on the
  launcher and on each game, reads the launcher's cards to find out which games
  exist, then registers every game's worker and tells it to fill its own cache.
  Before it, flying with all of them meant deliberately visiting all of them, and the
  one that was forgotten failed on the plane. **A new game joins by having a
  launcher card** — there is no second list, and `offline-warm.test.ts` fails if
  a game in `vite.config.ts` has no card or no worker.
- **Each game's `sw.js` is a stub** binding a slug and a cache version;
  the body is `public/game-sw.js`, shared by every game. Imported scripts count
  towards the update byte-check, so editing the body still reaches installed
  workers. Bump that game's `CACHE_VERSION` when its cached contents go stale,
  or returning players can stay pinned to an old build.
- **Cache lookups pass `ignoreVary`.** Every URL a worker holds is either
  hashed or the shell, so the URL alone decides the response. Honouring `Vary`
  gains nothing and silently breaks offline play: a host that sends
  `Vary: Origin` makes a stored response unmatchable by the requests that need
  it, because Vite tags its module and stylesheet links `crossorigin` while the
  worker's own fetch carried no `Origin`. The cache looks complete and correct
  and serves nothing. It only shows up offline, on a cold start.
- **Warming crawls, it does not read a manifest.** Each worker starts from its
  own `index.html` and follows what it names, including into the entry chunk —
  the level generator worker is a bare string there and appears in no tag. That
  is what keeps these workers unbundled and free of hashed filenames.
- **The games site has no catch-all rewrite**, on purpose. A mistyped asset path
  returns a real 404 instead of silently serving HTML with a 200.
