# Games

Ad-free replicas of a few mobile puzzle games, served from
`games.thomaskfisher.com`. No ads, no accounts, no tracking, and no in-game
currency. Everything is static; all game state lives on the player's device.

The one thing that leaves it is an anonymous daily count (see *Usage counts*).

| Game | Status |
| --- | --- |
| Color Sort | Playable |
| Screw Land | Playable |
| Bus Jam | Playable |
| Survival | Playable |
| Yahtzee | Playable |
| Gridlock | Playable |
| Depot | Playable |
| Backgammon | Playable |
| Solitaire | Playable |
| Spider | Playable |
| Sudoku | Playable |
| Nonogram | Playable |
| Pipes | Playable |
| 2048 | Playable |
| Wordle | Playable |
| Mancala | Playable |
| Mexican Train | Playable |
| Simon | Playable |
| Artillery | Playable |
| Tetris | Playable |
| Castle | Playable |
| Battleship | Playable |

## Working on it

```bash
npm install
npm run dev        # http://localhost:5273
npm test           # solvers, generators, layout, curve, clock, dice fairness
npm run build      # -> dist/
npm run icons      # regenerate PWA icons (output is committed)
```

## How it works

**Fifteen of the twenty-two are puzzles. Yahtzee, Backgammon, Mancala, Mexican
Train, Simon, Artillery and Tetris are not, and all seven bend the house rules on
purpose.** Everything below about verified levels, measured difficulty and
unlimited undo describes the puzzles. Yahtzee is a game of chance: there is no
board to verify, no difficulty to curve, and rewinding a throw would be reading
the answer. Four of the others have a second person in them, which takes the
hint with it and — in three of the four — puts a fence around undo. What all
seven keep is everything that made this collection worth building: no ads, no
servers, no currency, nothing locked. What they put in place of the rest is set
out under *Yahtzee*, *Backgammon*, *Mancala*, *Mexican Train*, *Simon*,
*Artillery* and *Tetris* below. Simon is a memory game: undo and a hint would
both be the answer. Tetris is the only real-time one, which takes undo, the hint
and the solver all three.

**Every level is verified before it is shown.** Levels are dealt at random from
a seed, then solved. A board the solver cannot finish is discarded, so unlike
the games this replaces, a level is never a dead end. The same solver drives the
hint button, which is free and unlimited.

**Difficulty is measured, not assumed.** In six of the eight puzzles the signal
is *trap rate*: the fraction of naive playthroughs that dead-end. It models the
player we are building for — someone enjoying a puzzle on the couch, not running
a search. See `colorsort/generate.ts`. Gridlock gets something better and Spider
something slightly different; both are below.

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

**Every game explains itself once, then gets out of the way.** Nine of the ten
have a rule you cannot infer by tapping: Screw Land loses the level when the
tray overflows, Bus Jam only lets you tap someone with a clear walk to the top
edge, Survival's reach limit is invisible until a tap is refused, Yahtzee
takes two taps to write a box, Gridlock counts a slide of any length as one
move — which is the unit the "best 14" in its top bar is quoted in — Depot
drives a bus along its arrow and nowhere else, and Backgammon needs two checkers
to hold a point against one, Solitaire never gives a card back once it has gone
home, and Spider's stock refuses to deal while any column is empty. A new player
discovers those by losing, which
reads as the game being unfair rather than as a rule. `shared/how-to-play.ts` is a short illustrated sheet per game —
diagrams rather than prose, because the rules are all spatial — shown once on a
save that has never cleared a level, and available forever from the `?` in the
top bar or from Settings. Each step is one diagram, a title and a single line of
caption: the sheet is there to name the rules a player cannot infer, not to sell
the game or to be read twice.

**The copy has a size, and it is smaller than it feels like it should be.**
Three steps, a title of three to six words, a caption of one line — around ten
words, two short sentences at the outside. A goal of one short sentence. A win
or loss sheet is a two- or three-word title, one `result-line` of a number and a
bare noun, and the buttons; no paragraph explaining what happened, because the
board behind the sheet is already showing it. Depot's first draft ran to four
steps with a twenty-three-word caption carrying two rules at once, and it read
as a manual next to the other six. A rule that will not fit is usually two
rules, and a rule nobody loses a level for not knowing does not belong here at
all — which is why Depot's `?` buses are not on its sheet.

`shouldAutoShow` is deliberately not just `!seenHowToPlay`: adding the flag to
the save format makes every existing player read as never having seen it, and
interrupting someone on level 60 to explain the tap target is worse than not
explaining it at all.

**Yahtzee cannot make the guarantee the puzzles make.** There is nothing to
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

**Which is why Yahtzee has no undo, and no restart.** Both would be exploits
rather than kindnesses. Determinism means a rewind is an oracle — throw all
five, read the faces, rewind, and throw back only the ones that disappointed you
— and a replayed round is the whole deck face up. Undo exists in the puzzles so
that a wrong move is not a punishment; here it would simply delete the game.
What undo was actually protecting against is the misfire, the stray tap that
writes a zero in Yahtzee twenty minutes into a good card, and that is
handled directly: **a box takes two taps**, the first of which only shows what
it would pay. Abandoning a card lives in the top bar behind a confirmation, is
never counted in the record, and costs nothing, because rounds are not a ladder.

**Its hint plays the odds, not the answer.** `advise.ts` may not touch `dieFace`
and does not: it reasons about the distribution of a fair die exactly as a
player must, and `advise.test.ts` holds it to that by asserting that the same
position gets the same advice from two different rounds. Within a turn the
arithmetic is exact — 252 distinct hands, every way of holding, two throws of
lookahead — and a box is priced at what a whole turn spent chasing it would
earn, which is what stops the hint handing over Yahtzee for a five-point
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

**Two of the eight puzzles share an engine.** Screw Land has a five-slot tray and
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

**Depot is Bus Jam turned inside out, and Gridlock's blocking underneath it.**
In Bus Jam the crowd is the board and the buses arrive on a fixed queue; in
Depot the buses are the board and the *crowd* arrives on a fixed queue. The
scarce holding area moved with it — a bench that held people became a kerb that
holds buses. What is new is the lot: buses are parked bumper to bumper, each
facing one way, and a tap drives one straight out along its arrow only if every
cell between its nose and the edge is empty. Which is Parking Jam, and it is
where the "which one do I dig out first" half comes from.

**Depot's lot cannot deadlock, and that is what makes it tractable.** Buses are
parked one at a time, each into a spot that still has a clear drive-out in the
grid as it stands, so reversing the parking order empties the lot. That survives
the player pulling in any order at all: taking a bus off the grid never blocks
another, so for any set still parked, the latest-placed member had a clear path
against a *superset* of what is now in its way. At least one bus is therefore
always drivable. Losing is only ever a colour problem — every bay full and
nobody at the front of the queue able to board — which is what lets the solver
ignore the geometry entirely, exactly as Bus Jam's does.

**And its queue is written down from a play rather than dealt.** The generator
walks the guaranteed pull order and, between pulls, emits a short run of
passengers for a colour some bus at the kerb is still waiting on — running them
through the game's own boarding rule rather than a model of it. So the queue it
records is one its own play finished, and the play it recorded is one the game
will accept. Seats per colour then equal passengers per colour exactly, which is
the invariant everything else rests on: one seat short and a bus holds a bay for
the rest of the level, one over and the queue can never drain.

**Backgammon is the only game here with two people in it, and that decides
everything unusual about it.** There is no level to generate, no solver deciding
whether a board can be finished, and no difficulty curve: the opponent is the
person holding the other end of the phone. What the collection's rules leave
behind still applies — no ads, no servers, nothing locked, nothing bought — and
the three that do not survive a second player are the hint, unlimited undo, and
the idea of a level at all. Games are numbered rather than levelled, and the
running tally rides in the save so an evening's score survives closing the app.

**Its dice are Yahtzee's dice.** Every face is a pure function of (seed, turn,
die), so a saved game is a move list rather than a board, a position is
reproducible from its game number, and neither player can be handed a roll that
depended on how the game was going. `dice.test.ts` holds it to that — uniform
per turn and per die, doubles at one in six, the whole 6x6 grid flat — and it
stands where the puzzles keep their generator sweep. The opening roll is a real
one: both players throw a die, ties are thrown again, and the higher starts and
plays that pair.

**Undo takes back checkers, not turns.** In the puzzles undo is unlimited
because the board is fully known and rewinding tells you nothing you could not
already see. Here the roll is the unknown, and determinism means an undo that
crossed a hand-over would be an oracle: play, watch the reply come up on the
board, take your own move back and play it again knowing the answer. So a
checker can be picked up and put down for as long as the turn is yours, and the
button that hands the board over is what spends it. Which is also how it works
on a real board. There is no hint for the same reason inverted: a hint here
would be an engine sitting at the table playing one side better than the other.
What replaces it is that the board marks every legal move and refuses none —
the half of a hint that teaches rather than the half that plays.

**The rule that makes it backgammon is "play both dice if you can", and it
cannot be decided a move at a time.** A move that is legal on its own can be
illegal because making it leaves the other die unplayable when some other move
would not have. `legal.ts` therefore searches whole sequences, and — like
Gridlock's sweep and unlike the puzzles' bounded solvers — **the search is
complete rather than budgeted**: a turn is at most four dice deep over a handful
of occupied points, so the space is walked exhaustively every time and "no legal
move" means there is none. That is what lets the board offer moves it will never
take back, and it carries the awkward corner of the rule too: when only one die
can be played and both would work alone, the larger is the one you have to play.

**The board is drawn in whichever player's numbering is on the move**, so it
turns over when the turn does — home board bottom right, checkers travelling
right to left along the bottom, for both of them. Two people sharing one phone
never read the board upside down, and the whole thing flipping is also the
clearest possible signal that the turn has changed hands.

**Solitaire turns one card and lets you go round the pack forever, which puts
every ounce of its difficulty in the deal.** Draw three and a redeal limit are
the usual ways to make Klondike hard, and both make it hard *at the rules*: the
same board is a wall on level 1 and a wall on level 400. Turning one card with
no limit means the rules never change and the only thing that varies between
levels is which fifty-two cards came out in which order — which is exactly what
the generator is for. The trap rate across random deals runs from 0.0 to 1.0
with real mass everywhere in between, so one lever turns out to be plenty.

**Finished cards fly home on their own.** A card sitting in the tableau is only
ever useful for one thing — holding the card one rank below it in the other
colour — so once both of those are already on the foundations it can never be
wanted again, and leaving it down there is busywork rather than a decision.
`autoPlay` sends every such card up after every move. That is a rule rather than
a convenience and it lives in the model, because the solver and the difficulty
rollouts have to be measuring the game the player is actually playing. It also
runs the endgame out instead of asking for forty taps.

**What goes home stays home**, and that one is a real rule you can lose to.
Banking a card that is *not* finished is still your call — burying a column
under a seven you had to move somewhere is a genuine decision — but there is no
move that takes it back off. It cannot cost a solution, because a line that
banks a card and later wants it back is the same line that never banked it. What
it does cost is a search that has to consider putting twenty-eight cards back on
the board at every position, and a definition of "finished" that could go
backwards. Undo is what protects a bank made in error.

**Being stuck in Solitaire is a question, not a state.** With unlimited redeals
there is nearly always *something* legal to do, so the position that actually
ends a game is the one that is still playable and no longer winnable — and
deciding that costs a whole search. Running one after every tap would be absurd;
running one when the player asks is exactly right. So the hint button is also
the "am I stuck?" button: it answers with a move, with the loss sheet, or — when
the search ran out of budget rather than out of positions — with nothing at all,
because a maybe is not worth showing anybody.

**Spider's solver is a player rather than a proof, and that was not the first
plan.** It started as Solitaire's: depth-first, transposition table, move
ordering, node budget. It solved *nothing* — not one deal in forty, at one suit
or at two, at any budget. A mid-game Spider position offers something like a
hundred legal moves of which two are worth making, and a depth-first search that
guesses wrong at move ten spends its whole budget three hundred moves down a
line that was dead before it started. What works is a heuristic player run over
and over: greedy most of the time, something else the rest of it, restarted from
the deal when it gets stuck. A hundred playouts cost less than one search did.

The trade is worth stating plainly. A playout that wins *is* a winning line, and
`generate.ts` replays it to check, so `solved` means here what it means
everywhere else in this collection. What is gone is the opposite answer:
playouts can never establish that no line exists, so **Spider has no
`unsolvable`**. The promise a player needs is the one-directional one — a level
ships only when a line through it has been found and replayed — and Spider does
not need the other half anyway, because it has no redeal: running out really
does produce a position with no legal move in it, which `isDead` catches exactly
and for nothing.

**Spider is graded on how far short naive play falls, not on whether it fell
short.** Trap rate, the signal five other games run on, turned out to have
nothing to say here: measured over two hundred boards, the naive player wins
about a quarter of one-suit deals and essentially none at two suits, so every
two-suit level scored 1.00 and the whole back half of the curve was a coin with
the same face on both sides. Grading the same rollouts by **how many of the
eight sets they finished** fixes it without changing what is being modelled — a
board where a player usually gets five sets out is plainly easier than one where
they usually get one — and a run that wins still scores all eight, so on a
one-suit board this tracks the trap rate it replaces.

**Two suits start at level 28, and that number is measured rather than chosen.**
The measurement is unusually blunt: a one-suit board scores anywhere from 0.1 to
0.98 on that signal, and a two-suit board scores 0.98 whatever else is true
about it. Two suits does not sit *on* the scale, it sits above the top of it. So
the step goes where the curve first asks for the top — where the band's upper
edge saturates. Putting it any earlier would have the generator dealing
two-suit boards that score above the band they were given and discarding every
one of them, which is the two-levers-cancelling failure that cost Screw Land a
week. It is keyed to the level number rather than to the band because the band
carries jitter, and deciding from it would flip a player between one suit and
two on consecutive levels.

**Both card games are dealt from `shared/cards.ts`,** which is a deck and
nothing more. It also carries the one accessibility question a card game asks
that the rest of the collection does not: the shape overlay every other game
offers is pointless here, because the suits *are* four distinct shapes and what
is hard to read is red against black. The answer to that is the four-colour deck
— diamonds blue, clubs green — and it rides on the same setting, doing the same
job in the only way these two games can do it.

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
                      cards (Solitaire + Spider), levelSource,
                      buffer-sink (Screw Land + Bus Jam),
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
src/depot/            model, solve, generate, render, game, main, rules
src/solitaire/        model, solve, generate, render, game, main, rules
src/spider/           model, solve, generate, render, game, main, rules — its
                      solve.ts is a player run many times rather than a search,
                      and reports no `unsolvable`; see above
src/backgammon/       board, legal, model, render, game, main, rules — no
                      generate and no solve: there is no level to build, and
                      what legal.ts searches is one turn rather than a level.
                      fixtures.ts builds a position from a sparse map and is
                      imported only by the tests
src/simon/            model, render, game, main, rules — no generate and no
                      solve: a game is one seeded stream of pads, and round n
                      shows the first n of it
src/tetris/            model, bag, run, clock, snapshot, bot, render, game,
                      main, rules — no generate and no solve: it is real-time,
                      so there is no board dealt in advance to verify. bag.ts
                      is the difficulty lever, clock.ts is the only thing in
                      the collection that knows what time it is without a frame
                      loop, snapshot.ts saves a position rather than a history,
                      and bot.ts is the naive player the probe measures with
src/artillery/        terrain, weapons, physics, model, generate, render, game,
                      main, rules — no solve: there is nothing to solve with two
                      players, and what generate.ts verifies instead is that
                      both tanks can reach each other. terrain.ts is the
                      heightmap and its blast operations; physics.ts is one
                      shell under gravity, and the only frame loop in the
                      collection walks the path it returns
public/               icons, per-game manifest, a two-line sw.js per game,
                      game-sw (the shared worker body) and warm (downloads every
                      game from any page) — copied verbatim, never bundled
examples/             reference material for the originals — never deployed
tools/                calibration harnesses — not built, not in `npm test`
scripts/make-icons.mjs
src/castle/           model, solve, generate, art, render, game, main, rules —
                      solve.ts visits every layout of the towers, so it is
                      exact; art.ts is the one set of silhouettes the map, the
                      tray, the preview and the rules sheet all draw
src/battleship/       model, solve, generate, render, game, main, rules —
                      solve.ts is six priced deduction rules, and a level
                      ships only if they finish it with no guessing
```

**Sudoku measures work, not technique.** The obvious difficulty signal is the
hardest technique a grid needs, and it was tried first and is far too coarse:
across two dozen dug grids, more than half needed nothing above a hidden single,
so they all collapsed onto one score and the entire easy half of the game was a
single difficulty. What separates an easy grid from a medium one is not which
techniques appear but **how much work there is**, so every deduction is priced —
1 for a naked single, 3 for a hidden one, up to 80 for an XY-wing — and the sum
is the signal. It spans 25 to about 280 and is mapped logarithmically.

**Sudoku's generator digs, then binary-searches back up.** Every clue removed
makes a grid weakly harder and every clue restored makes it weakly easier, so
rather than deal grids and keep the ones that score near the band — the
generate-and-test loop the other games use — it digs one grid to exhaustion and
then searches the restore order for the point that lands in the band. Six solver
runs instead of dozens of rejected candidates. The ladder is bounded by *clue
count* rather than by the dig; enforcing that inside the measurement instead was
the first attempt and it broke the search outright, because a too-full grid came
back as unmeasurable, the search read that as "too hard", and every level of the
game came out at the maximum clue count and one difficulty.

**Both Sudoku searches refuse a grid whose givens already contradict each
other.** The search only reasons about empty cells, so two 4s in one box are not
rejected — they are explored, in full, until every branch is dead, which is an
exponential proof of something one pass can see. The generator never produces
such a grid; the *player* does, and without the guard entering a contradiction
freezes the app.

**Nonogram is solvable one line at a time, which is stronger than unique.** A
uniquely-solvable nonogram that needs a two-line contradiction to crack is fair
in principle and miserable on a phone, so a puzzle is discarded unless repeated
single-line reasoning finishes it. Uniqueness comes free: every cell written was
the same in *every* arrangement consistent with the line, so the solver cannot
have ruled a second picture out.

**Nonogram pictures are grown, not dealt.** Independent coin flips produce clue
lists like `1 1 1 1 2 1` — ugly, unusually hard, and not a picture. Cells are
seeded at a density and then smoothed into blobs, which gives fewer, longer runs
and something recognisable at the end.

**Nonogram and Pipes share a difficulty signal, and it is not the obvious one.**
Both measure *lookahead*: how many lines or tiles the solver had to read before
one of them yielded something. A board where the next deduction is always beside
the last is one you run down; one where you sweep half the grid each time is one
you grind through. For Pipes this replaced "what share of the board is forced",
which was measured at **1.00 for every width and every tree shape** — a pipes
board grown from a spanning tree is always fully determined, so that term was a
constant and difficulty was grid size alone, with every level missing its band.

**Pipes boards are built backwards.** A spanning tree is grown over the grid,
each tile's stubs are read off the tree edges, and every tile is then given a
random quarter turn — so turning each one back is a solution by construction and
there is nothing for a solver to certify. A windier tree is the harder one
(4.20 lookahead against 3.57 at eight wide), which is the opposite of the
intuition: long corridors of straight pipe are quick to read off.

**2048's spawns are a pure function of the move number**, lifted straight from
Yahtzee. That is what makes unlimited undo survivable here: rewinding and
playing a different direction gets the same tile, because the tile was never a
property of the move — only where it lands can change. It also makes the game
fully deterministic, so the verifier plays each level through with a depth-five
search and a level ships only if it actually got there, and the next-tile
preview is honest rather than drawn afterwards and shown early.

**2048 stops at 1024, and picks its target from the band rather than the
pressure.** Reaching 2048 takes around nine hundred moves — half an hour, in one
sitting — and every level past 50 would be that. Choosing the target is the
other way round from every other game here because there are only five rungs:
mapping pressure onto the ladder linearly put level 12 on a 512 scoring 0.86
against a band topping out at 0.76 and missed four levels in fifteen. Trap rate
saturates above a 256 — a player with no lookahead essentially never reaches 512,
and giving the naive player a corner habit moved that from 0.97 to 0.97 — so the
target carries three quarters of the weight and trap rate separates the bottom.

## Wordle

**Length is variety, not difficulty — and the measurement says so.** The ladder
grows the word from five letters to seven, and the plan was for that to *be* the
difficulty curve. `tools/wordle.txt` says the opposite. Guesses a greedy solver
needs, by length and by how rare the answer is:

| rarity rank | 5 letters | 6 letters | 7 letters |
| --- | --- | --- | --- |
| 0-200 | 2.98 | 2.63 | 2.60 |
| 400-700 | 3.80 | 3.40 | 2.90 |
| 900-1200 | 4.13 | 3.58 | 3.25 |
| 1500-1900 | 4.30 | 3.85 | 3.23 |

Longer words are *easier* at every rarity, because every extra letter is another
constraint and the families that trap a player (`LIGHT`/`MIGHT`/`NIGHT`/`SIGHT`)
are a five-letter phenomenon. So length contributes nothing to `score`; it is
there because seven rows of seven letters is a different-looking board, and the
extra guess the ladder hands out at six letters is a courtesy rather than
compensation. **Rarity is what the table actually shows moving**, and it is the
half of the original plan that survived.

**What difficulty is instead: par, with trap rate as a tiebreak.** Par is how
many guesses a greedy player needs; trap rate is how often a naive one is left
choosing between words that differ by a letter. Par carries 85% of the weight
because it is the term that moves — mean trap rate is 0.00-0.03 in every band
above, and it only separates the handful of words that live in a crowd. It does
separate those, sharply: `LIGHT` measures 1.00 and `PIZZA` 0.00, which is the
one thing par and rarity cannot see. That is also why the generator
short-circuits it: when an answer's par alone puts it inside the band whatever
the traps do, the rollouts are skipped entirely.

**The word list is ENABLE, not a frequency list.** The first build filtered a
subtitle corpus against two name lists to throw out `marie` and `berlin`, and
that filter also threw out `going`, `never`, `police` and `wedding` — ten per
cent of the answers, including words nobody would call proper nouns. Switching
the dictionary to ENABLE and keeping the frequency list only for *ordering*
fixed it at the root: something is a word because a dictionary says so, and
common because a corpus says so, and those are two different questions.

## Mancala

**Kalah, six pits a side, and the board is one array of fourteen.** Indices 0-5
are south's pits, 6 is south's store, 7-12 are north's, 13 is north's. Sowing is
then "step forward, wrapping at fourteen", and the only special case in the
whole model is skipping the *other* player's store. It also makes the capture
rule exact arithmetic — the pit facing `i` is always `12 - i`, with nothing that
depends on whose turn it is.

**Undo is unlimited here, and in Backgammon it is not.** The two games look
alike and the rule differs, for one reason: there is no randomness in Mancala at
all. Both players can already see everything, so rewinding tells neither of them
anything they could not have worked out — where Backgammon's dice make a rewind
across a hand-over an oracle. For the same reason Restart is a real restart
rather than a fresh deal: twelve pits of four is the same opening every time, so
there is nothing to deal.

**The board is drawn on its end.** A mancala board is eight pits wide and two
deep, which on a portrait phone leaves six pits sharing three hundred pixels and
seeds too small to count — and counting seeds is the game. Turned ninety
degrees it is two wide and eight deep, which is the shape of the screen. The lap
survives the turn, each player's store still ends up nearest them, and the two
pits joined by the capture rule land side by side in the same row.

**Seeds are laid on a grid, not scattered.** The first version placed them on
rings, which looked right and sliced a third of them in half against the edge of
the bowl — a ring wide enough to spread eight seeds across a pit is taller than
the pit is. The grid also has the property the scatter was chosen for: seed *n*
is always in the same slot, so dropping another one moves nothing that was
already there, which is what makes a bowl countable during the move it matters.

## Mexican Train

**A double-nine set, one tile a turn, and a round is a level.** The traditional
game lays a whole train on the first turn and runs thirteen rounds off a
double-twelve set — a pleasant evening at a table and an unpleasant hour on a
phone. Kept is everything that makes it Mexican Train: your own train, the
communal one, trains that fall open when their owner cannot play, and doubles
that stop the board until somebody answers them. Round one runs off the double
nine and each round steps down a pip, and the score is the pips left in your
hand, added up across rounds, lowest wins.

**Hands are eight tiles, because larger ones end the round blocked.** The first
guess was fourteen for two players down to nine for four, reasoning that a
smaller table wants a bigger hand. Three hundred rounds a setting said the
opposite — the share of rounds that end with everybody stuck and nobody out
(`tools/dominoes.ts`):

| hand | 2 players | 3 players | 4 players |
| --- | --- | --- | --- |
| 14 | 53% | 70% | 58% |
| 12 | 45% | 50% | 57% |
| 10 | 41% | 30% | 41% |
| 8 | 33% | 24% | 18% |
| 6 | 32% | 15% | 8% |

A big hand does not make a longer round, it makes a blocked one: the tile that
would have unstuck somebody is sitting in a hand rather than on a train. A
blocked round is a real ending and still scores, but half of them ending in a
shrug is not a game. Six blocks less again and is where the trade stops being
free — a hand that size is four or five turns each and the round is over before
anybody's train has anywhere to go.

Trimming the boneyard instead was measured too and runs the wrong way: capping
it at ten tiles cuts a two-player round from 45 turns to 24 and pushes blocked
rounds from 33% back up to 67%, because blocking is precisely what happens once
the boneyard is empty.

**The curtain is the privacy model, and it withholds rather than hides.** This
is the only game here with something to conceal from the person you are handing
the phone to. Between turns the hand is not in the view at all — `game.ts`
returns an empty hand while the phase is `handover` — so there is nothing in the
DOM to find. The curtain sits over the tray and not over the board, because the
trains are public at a real table and stay public here: the player taking the
phone can study the layout before they see their own tiles.

**Nothing ends a turn on the player's behalf except a tile that fits.** Drawing
and failing does not, and neither does laying a double you cannot answer. Both
leave the player holding the board until they tap Pass. It costs a tap and buys
the only moment in the game in which somebody can look at the tile they just
drew — which is theirs alone, so the curtain must not come down on its own
before they have seen it. Undo is fenced by the same fact, and the fence is in
the model: it sits above the start of the turn and above every draw, because
undoing a draw would let a player peek at the boneyard and put it back.

## Simon

**Four pads, one more each round, and one wrong tap ends the game.** Losing
ending the game is the one house rule this bends furthest, and it is the game:
what "never back to level 1" becomes here is that nothing is lost *by* losing.
The best run rides in `stats.bestScore`, every game is a fresh seeded sequence
rather than a replay of the one that just beat you, and a game in progress
survives the app being closed — it comes back at the start of the round it was
on, waiting for a tap. No undo and no hint, because either is the answer. The
original's per-tap time limit is left out: it is pressure rather than play.

**The controller owns no timers.** Showing a sequence is a chain of them, so
they live in `render.ts`, all in one set that `cancel()` clears. The controller
hands out a `showId` with every showing and ignores a "finished showing" report
carrying any other id — so a new game, a reload or a sheet opening mid-show can
never be finished by the playback it interrupted. Any sheet, and backgrounding
the app, pauses the round back to its first pad.

**The pad count is a parameter.** Four ships; `sequenceFor` and the model take
any number, so a harder mode with more colours is a renderer change (a ring of
segments instead of quadrants), not a rules change. The flashes speed up at
rounds 6, 14 and 22, as the original does.

## Artillery

**Pocket Tanks: two tanks, one hill, and a hundred life points each.** A turn is
a few columns of movement, an angle, a power and one shot; a blast takes life
and rearranges the ground it lands on. Before the first shot the two players
take turns emptying a shop of sixteen weapons, and each drafted weapon fires
once.

**The ground is one integer height per column, and that decision carries the
game.** A bitmap of solid pixels — which the original uses — buys overhangs and
tunnels, and costs a fast collision test, a compact save and any simple answer
to "where does a tank sit". The heightmap gives all three: collision is one
interpolation, the whole battlefield is 96 bytes, and a tank's height *is* its
column's height. What it gives up is roofs, so the one weapon that wants them —
a shell that tunnels — gets an open shaft instead, which plays the same because
what a shaft is for is dropping the ground out from under somebody.

**There is no solver, and the promise it makes is kept by a different check.**
With two players there is nothing to solve, but a battlefield dealt from noise
can still be a fortress: put a tank in a bowl behind a forty-unit wall and no
angle and no power reaches the other side. So `generate.ts` fires at every
candidate before it ships. Both sides must have a plain shell that lands close
enough to do damage — and not just one, because the probe found a side where a
single coarse setting connected and a finer sweep found none at all. A lone hit
is a needle, so a battlefield has to offer a band of them.

**Three battlefields in four block the line of sight, and both halves are
checked.** The straight line between the two turrets has to pass through the
ground, because if you can point at your opponent there is nothing to work out.
The fourth is an open field on purpose, and it is *built* open rather than
searched for: requiring cover and merely hoping for the opposite gave 99% cover
over 200 matches, since a battlefield with a hill, a plateau or twin peaks in
the middle of it blocks the line whether or not anybody asked. An open field
gets the dip and flatter ground.

**The muzzle speed was measured, and the first guess wasted most of the dial.**
It started where full power at forty-five degrees carried a shade further than
the field is wide, which sounds right and is not: the tanks start about 150
units apart, so `tools/artillery.ts` measured the lowest power that connects at
a mean of 86 with a tenth percentile of 79. Ninety-one positions on the power
dial and about twenty of them did anything. At the current setting a crossing
sits around 67, full power reaches a little under twice the width of the field,
and the trade the game is about — less power flatter against more power steeper
— can actually be expressed. Full power going off the far edge is the cost of
having somewhere to go above the shot you need.

**A match in progress is saved as its position, not as its history.** Every
other game here stores a move list and replays it, which works because their
rules are integer arithmetic. This one is floating-point ballistics, and
replaying it would mean trusting that `Math.sin` returns the same double it
returned last week — a promise no engine makes, whose failure would be a saved
match reopening with the craters slightly out of place. The heightmap makes the
alternative cheap: a complete snapshot is about three hundred characters.

**Undo stops at the trigger, and the turn's moves ride in the save.** Where a
shell lands is the unknown here, so an undo across a shot would let a player
fire, read the arc off the screen, take it back and fire again knowing the
answer — free ranging rather than a kindness, which is Backgammon's argument
about the dice. Moving and aiming are yours to take back for as long as the turn
is. Which is why the columns the tank has already stood in are part of the
snapshot: ten bytes at most, and without them moving, putting the phone down and
picking it up again left a player looking at a move they could no longer undo.

**The only frame loop in the collection is in this game, and it is a camera.**
An artillery game cannot render on state change alone: the arc *is* the
feedback, and a shot that teleports to its crater teaches nobody how to correct
the next one. So the model resolves a whole shot first — every shell's flight,
the craters, the damage — and the renderer then walks a path it has already been
handed. It decides nothing, it is cancelled on reset, and the state changes once,
when it reports back. Drop every frame and the outcome is identical. The page
reports for it when hidden mid-flight, because a backgrounded tab stops
delivering frames and the turn would otherwise never end.

**Each drafted weapon fires once, and the plain shell never runs out.** That is
what keeps the draft the decision of the match rather than a menu nobody reads
after turn three — and the unlimited shell is what stops a long match becoming a
stalemate between two empty arsenals. Picks snake rather than alternate: with
one plainly best weapon in the pool, strict alternation is a coin flip decided
before anybody has aimed. The player who picks second fires first, which pays
back the rest of it.

**It is the first game here to decline the shape overlay.** The overlay exists
where colour is the only thing telling two pieces apart. These two seats never
swap ends, so position says everything colour does, and every number, gauge and
control belonging to a seat sits on that seat's side of the screen.

**And a warning for the next game that hides a row of its shell:** a
`display: none` grid child does not hold its track. The weapon shop hides the
life strip and the shot report, which slid the battlefield onto an `auto` row
and handed the `1fr` to a one-line paragraph — the shop sat at its content
height with a hand's width of dead space under it, and the board looked half the
size it is. Every row of `.app--artillery` names its own `grid-row`.

## Tetris

**The only real-time game here.** Ten columns, twenty rows, seven pieces, SRS
rotation with the full kick tables, hold, a three-deep preview and a ghost
showing where the piece will land.

**The well is the controller.** Tap turns the piece clockwise, a swipe left or
right moves it one column, a swipe down hard-drops it, and a swipe up (or a tap
on the Hold slot) holds. It shipped with a seven-key pad under the well, which
cost a fifth of the screen and put the player's eyes and thumbs in different
places. One swipe is one column on purpose: a drag that walked the piece would
overshoot on glass, and several flicks are easier to count than a distance. A
swipe fires as soon as it has travelled 24px rather than on lift, and a tap
anywhere on the board turns the piece, because the piece itself is a few
millimetres across. There is no soft drop on touch; the keyboard keeps it.

It shipped briefly as *Stack*, on the reasoning that the name belongs to
somebody. It is called Tetris because that is what it is, and because a name
nobody recognises is a game nobody opens — which is the only test that matters
for a collection with an audience of one.

**It bends more house rules than anything else in the collection, and the
bargain is Simon's.** Undo in a real-time game is a rewind of the clock — there
is no move to take back, the piece fell. A hint is where to put the piece, which
is the only question the game asks. And a solver has nothing to verify, because
no board is dealt in advance: the board is whatever the player has built. What
replaces all three is that nothing is lost *by* losing. The best score rides in
`stats.bestScore`, every game is a fresh seeded stream rather than a replay of
the one that just beat you, and a run in progress survives the app being closed.

**There is still no `requestAnimationFrame` loop, and that is not a technicality.**
A falling-block game sounds like it needs one and does not. The piece is on the
grid at every moment a player can act on it, so the state changes at discrete
ticks and the renderer draws on each one. What a frame loop would buy is a piece
sliding smoothly between two rows, and at ninety milliseconds a row nobody can
see it. Artillery needed frames because its arc *is* the feedback; this does
not, and her battery is the better for it. `clock.ts` is the whole of the
real-time machinery: one self-rescheduling `setTimeout`, one handle, one
`stop()`. Lock delay is not a second timer — it is the same timer scheduled
further out, which is the only reason there is one handle to cancel rather than
two.

**A tick that stops the clock has to win over its own rescheduling.** The first
version cleared the handle before calling the tick, so that a tick which
restarted the clock was not overwritten by the reschedule underneath it — and
that left the opposite case broken, because a handle being null is ambiguous
inside a tick: it means both "finished normally" and "the handler stopped us".
A tick that ended the game, opened a sheet or hid the tab therefore rescheduled
anyway and left gravity running behind the overlay. There is now an explicit
`stopping` flag alongside the handle, and `clock.test.ts` asserts both
directions. Neither was caught by playing it; both were caught by writing the
test that says only one timer may ever be outstanding.

**Difficulty is the bag, not the speed.** The guideline gravity curve keeps
accelerating past twenty rows a second, which is a fine number on a keyboard and
unreachable with thumbs on glass. So the speed ramp stops at ninety milliseconds
a row — level 11, or a hundred lines — and past that the difficulty comes from
*which pieces arrive*. This is the one lever a falling-block game has: the well
is ten wide because a phone is, and a bigger one is a longer game rather than a
harder one.

**The bag gets meaner by substitution, which is what keeps it fair.** The
standard seven-bag deals each piece once per seven, bounding the longest drought
at twelve. The obvious implementation — weight S and Z up — throws that away,
because the tail of a geometric distribution will eventually deal thirty pieces
with no I in them and the run ends to a coin rather than to a mistake. So a
biased bag is still seven pieces; some of them are swapped, a donor out and a
duplicate S or Z in. **The I is never a donor.** It is the only piece that
clears four rows and the only one that digs a four-deep well back out, so
withholding it does not make the game harder in an interesting way, it makes it
arbitrary. Keeping it out of the pool means every bag still holds exactly one,
the twelve-piece drought bound survives untouched, and the player always has the
tool — what they lose is everything they would rather use it with.

**The first version of that lever did almost nothing, and only the probe said
so.** It swapped *one* piece with a probability that rose with the level and
capped at 0.75, which sounded like a difficulty curve and measured as
136.6 pieces of naive survival at level 1 against 120.7 at the cap. Twelve
percent, non-monotonic — level 4 came out *higher* than level 1 — and identical
from level 13 onward, because the probability had saturated. Gravity floors at
level 11. So both of the game's levers stopped moving within two levels of each
other and the game simply stopped getting harder at 13, with a bias that read as
deliberate the whole way.

**What fixed it was swapping more of the bag rather than swapping more often.**
Swept by whole notches, the lever turned out to have had range all along: 138
pieces at no substitutions, 108 at one, 104 at two, 87 at three, 73 at four. The
first design was using the first notch of five. `biasDepth` is now a *fraction* —
a bag takes the whole part for certain and the remainder as a chance, so four
discrete steps spread smoothly across twenty levels instead of lurching — and it
ramps from level 4 to the whole donor pool at level 22. The measured curve runs
134.7 down to 70.0, monotonic, and is still falling for eleven levels after the
speed ramp has stopped. **A lever whose measured effect is far smaller than
expected is not always a weak lever; sometimes it is a strong one being asked
for one notch.**

**The bag's bias has to be pinned to when the bag was opened.** A bag is
regenerated from its index every time it is looked at — that is what lets a save
be a piece count rather than a generator's internal state — so reading the level
live meant the line that took a player from level 9 to level 10 re-dealt the
pieces still sitting in the open bag. The preview would change in front of them
and the piece that arrived would not be the one shown. `BagState` carries the
level the current bag was opened at, and `bag.test.ts` asserts that the three
pieces shown are exactly the three that arrive, at every offset.

**The save is a position, not a history.** Every puzzle here stores a move list
and replays it, which works because a board is a pure function of its seed and
the moves are integer arithmetic. A real-time game has no such list: what
happened is not "left, left, rotate" but "left, left, rotate, and forty-one
gravity ticks in between", and replaying that faithfully would mean the save
depending on how long the phone took to wake up. Artillery reached the same
conclusion from the other direction. A well is 220 cells of three bits, so the
whole run is about 250 characters — well inside the save code in Settings.
`decodeRun` refuses anything that does not describe a run somebody could carry
on, including a piece that does not fit the well it claims to be falling
through, which is what a block out leaves behind.

**Anything that interrupts play stops the clock and waits for a tap.** A sheet
opening, the tab being hidden, the page going away. Timers in a hidden tab are
throttled on some browsers and stopped on others, so catching up on return would
drop a piece into whatever the well now contains — and a piece that fell while
the phone was in a pocket fell in a game nobody was playing.

**It declines the shape overlay, as Artillery did, and for a cleaner reason.**
The overlay exists where colour is the only thing telling two pieces apart. Here
it never is: a falling piece is identified by its shape, which is the entire
subject of the game, and a locked cell is just a filled cell whose colour the
rules never consult. The classic colours are kept because anyone who has played
the original reads the piece before they read the shape.

**The difficulty signal is survival, not trap rate.** Trap rate asks what
fraction of naive playthroughs lose, and in a game that always ends that is a
constant. The same idea inverted works: how *long* a naive player lasts.
`bot.ts` is that player — it looks one piece ahead, prefers a flat stack with no
holes, and is careless about a tenth of the time. It deliberately does not use
hold, does not tuck or spin, and does not read the preview, because all three
would flatter the bag into looking harmless. `tools/tetris.ts` sweeps it with the
level pinned, so the bag can be measured with gravity held out of the picture.

## Castle

**Tower defense as a placement puzzle.** A road winds from the top of the map to
the castle gate. Beside it are a few stone plots, and the level hands over a
fixed set of towers — arrows, cannons, frost — to put on them. Press Go and a
wave walks the road; one enemy through the gate loses it. Kingdom Rush builds
*during* the wave, which makes it a game of timing and thumbs. Here every
decision is made before the first enemy moves, and the wave that follows is a
pure function of where the towers stand.

That reframing is what lets the genre keep the collection's promise. A level is
a finite set of layouts, so **every level is verified by trying all of them**:
`solve.ts` visits each distinct placement (identical towers counted once) and
the first that holds the gate ends the search. Nothing is pruned on a guess, so
running out of layouts means no layout wins. The top of the curve is ten plots
and five towers — 7,560 layouts — and most levels are a few hundred.

**The wave is integers all the way down.** Positions along the road are twelfths
of a cell, speeds are twelfths per tick, ranges are squared distances in the same
units. Nothing in `simulate` touches a float, so a layout wins or loses the same
on every engine forever, which is what lets the save be a move list — placements,
removals and Go, one integer each — when Artillery, with its floating-point
ballistics, had to store a snapshot.

**Each tower has one job, and each enemy is the answer to one of them.** Arrows
are quick and single-target, and do a single point against a knight's armour.
Cannons are slow, splash, and ignore armour. Frost does no damage at all and
halves the speed of everything inside it — worth most where the road passes it
twice. Grunts come in packs, runners outrun a cannon's reload, knights shrug off
arrows. Kinds arrive one at a time along the curve (arrows and cannons against
grunts, then runners, then frost, then knights), so a new thing is always shown
alone before it is combined with the others.

**Difficulty is a climb, not a deal.** A level is built — road, plots, a wave in
groups of one kind so the preview can say "three knights" — and then every layout
is played once at a gentle strength and the winners kept. Hit points then go up
eight per cent a step: the winners are re-checked, and a fixed sample of forty
*naive* layouts (each tower dropped where its own kind sees the most road,
weighted rather than argmaxed, and one in five placed anywhere) is re-played to
measure how many of them now lose. The first strength whose trap rate lands in
the band ships. A strength is never accepted without a layout that has been
played and seen to win at it, so solvability is structural rather than lucky.
`tools/castle.ts` measured the signal before the band was trusted: along one
board's climb the naive trap rate runs from 0.00 to about 0.9, smooth and
monotonic, and at the top of the curve 2-8% of all layouts win against roughly
half at level 1.

**The outcome is settled when Go is pressed; the show is decoration.** `simulate`
produces every frame before the first token moves, and playback walks that list
on one `setTimeout` with a CSS transition of exactly one tick easing tokens
between positions — still no frame loop. Skip, reduced motion and a hidden tab
all jump to the last frame. Undo is live during the show, which makes the timer
the one deferred mutation that matters: every `reset` effect stops it. A probe
that undoes mid-wave and then waits past the wave's length finds no tokens and
no sheet; with the `stopWave()` call removed it finds nine enemies still walking
a map that is back in planning.

**The hint follows one winning layout.** It is found once and followed while
every tower on the map agrees with it. When the towers already down cannot be
completed into a win, the hint picks the winning layout that keeps the most of
them and lights a tower to take back, in red. A wave launched before the app was
closed is not replayed on reopening — its result is.

**It declines the shape overlay and the clock.** Every tower and enemy is a
different shape as well as a different colour, so the overlay has nothing to
add; and a clock would run while the wave does, which measures nothing.

## Battleship

**The solitaire puzzle, not the two-player game.** A fleet is hidden in a square
sea; ships lie straight and never touch, not even at a corner. The player gets
the number of ship squares in each row and column, the fleet itself, and a few
squares outright — and deduces the rest. The two-player game was the obvious
recreation and was passed over deliberately: it is hide-and-seek against a
layout nobody can see, so no level of it can be verified before it is shown,
and a loss can be nobody's fault. Seas run from 6x6 to the classic 10x10.

**A level is verified by deduction, which is stronger than unique.** `solve.ts`
is six rules, each priced: a given piece's shape (1), water at every ship's
corners (1), a row or column whose count settles it (2), extending a ship that
is not yet whole (3), water wherever no unplaced ship could reach (4), and the
squares every position of the last ship of a length shares (6). A level ships
only if those finish it. As with Nonogram's line solver, every rule writes only
what is true in *every* consistent layout, so a finished solve proves there was
one answer; `countLayouts` checks that exhaustively on the small seas, and a
soundness test runs the rules over sixty random boards and finds no square
written against the answer.

**Levels are built answer first.** A fleet is dropped at random, the counts are
read off it, and squares of the answer are handed over as givens — each chosen
where the solver stalled, so it genuinely unlocks something — until deduction
finishes the board. Then every given the solver can do without is pruned. A
fully pruned board has two to six givens. The easy levels get a few spare ship
pieces back on top; pruning only part of the way was tried first and barely
moved anything, because "keep half" of three givens keeps one.

**Difficulty is how narrow the way through is.** The first signal tried, solver
work per square, came out flat — 0.6 to 1.0 at every size and every setting —
because the count rule writes a whole line for one price. What does vary is
*openness*: at each step, how many separate non-trivial deductions the board
offers. Corners and shapes are free and not counted, the way nobody counts
filling a Sudoku box's last digit. A pruned board averages about 4.5 options a
step across 2.5 to 7.5; spare givens push it past 8. The score is 35% sea size,
45% narrowness and 20% how often the two whole-board rules were needed, since
those are the ones a person finds last. `tools/battleship.ts` hits all 32
levels of its sweep in band, the slowest built in about 60ms.

**A ship square is drawn as the piece it has to be.** Two squares side by side
join into one hull; a run closed by water at one end gets a rounded bow there;
a lone square walled in on all four sides becomes a round single. Until a side
is closed the square stays a plain block, because a bow would claim something
the player has not decided. It answers "is this one finished?" without a count,
and the fleet list above the sea fades each ship as one of its length is closed
off. Ships the player places are the accent colour, given ones ink.

**Input and the hint are Nonogram's.** A Ship and a Water brush, tap or drag,
and a drag locks to the row or column its first two squares set. The hint names
a wrong mark first — water on a ship counts, unlike Nonogram's crosses, since it
poisons the counts and every placement around it the same way a wrong ship
does — and otherwise rings the next square, ghosts the mark it wants, and hands
over that brush. Water is never required to win.

## Usage counts

`public/visit.js`, loaded by every page next to `/warm.js`, adds one to
`visits/<day>/site` and `visits/<day>/<game>` in the project's Firebase Realtime
Database: at most once per device per game per calendar day. The device keeps
track of what it has already counted in its own localStorage. Nothing identifying is
sent or stored: no cookie, no ID, no fingerprint. Clearing site data only means
that device counts again. Offline, the request fails, nothing is marked, and the
next online load that day counts it.

`database.rules.json` (repo root) makes the counters public to read and
refuses every write except a +1 to a well-formed day and a lowercase slug.
Setting a value, deleting, or incrementing by more than one is denied. It deploys
with `firebase deploy --only database`, separately from hosting.

`/stats/` (`public/stats/index.html`, plain HTML like `warm.js`) charts the counts
as stacked daily columns: the top seven games by name, the rest as *Other*, with a
totals table under the chart. It reads game names from the launcher's cards, so a new
game needs no extra wiring beyond the usual `<script src="/visit.js" defer>`.
It has a *Don't count this device* switch, which is how the owner's own phones stay
out of the numbers. It is not linked from the launcher.

## Deploying

The games are a second Firebase Hosting site in the existing project, so
deploying them does not touch the portfolio.

```bash
# Icons BEFORE the build, always. Vite copies public/ into dist/ as part of
# the build, so icons regenerated afterwards are written to public/icons and
# never reach dist — which ships a launcher card pointing at an icon that was
# never uploaded. Tetris went out that way once; see below.
npm run icons
npm run build

# Test on a real phone. Service workers need HTTPS, so a LAN address will
# silently register nothing — use a preview channel instead.
firebase hosting:channel:deploy preview --only games

# Ship
firebase deploy --only hosting:games
```

**The one-command check before deploying a new game** is that the two icon
directories agree. The build is silent about a missing icon, and so is the
browser — a broken `<img>` in a card is just an empty square.

```bash
ls dist/icons | wc -l && ls public/icons | wc -l   # must match
```

### Cut from Yahtzee v1

The bonus for a second five-of-a-kind, and the joker rules for where one may be
written. Both are rare, and each adds a whole dimension to every decision on the
card. So a full house here is exactly three of one face and two of another, and
five alike is not a run — the strict reading, and the one most implementations
quietly do not use.

**The name is not a cut, and it used to be.** This shipped as *Five Dice*,
because Yahtzee is Hasbro's trademark even though the game itself — five dice,
thirteen boxes, three throws — is not, and it is the trademark rather than the
rules that a different name avoids. It was renamed on purpose: this site is
`noindex`, sells nothing, and is played by two people, so the name that everyone
already knows is worth more here than the distance from the trademark. On
anything public-facing the calculation goes the other way.

The rename is the display name only. The slug stays `fivedice` — so does the URL,
the storage key `save:fivedice`, the cache namespace and every identifier in the
code — because renaming those would orphan a save and turn an installed
home-screen icon into a 404, for a string nobody reads. `fivedice` is the id;
Yahtzee is the name. The categories keep the names anyone would look for — full
house, small straight, chance — and so, now, does the fifty-point row: it is
**Yahtzee**, which is what a player expects to see on a card headed Yahtzee. Its
id stays `five-of-a-kind`, on the same id-versus-name split as the game's own
slug; a card is saved by box position rather than by id, so nothing on disk
depends on either.

### Cut from Solitaire v1

Draw three and a redeal limit, which are the two usual ways to make Klondike
hard and both of which make it hard at the rules rather than at the deal. Also
the score, the timer, the "Vegas" mode, and every other number the originals put
on screen — none of them is a decision, and the level number is the only one
here.

Taking a card back off a foundation is a cut too, and a load-bearing one: see
*What goes home stays home* above.

### Cut from Spider v1

**Four suits.** It is the marquee mode and it is out on the strength of a
measurement rather than a preference: the heuristic player that verifies these
deals solves about half of two-suit boards within the budget a background worker
has, and four suits is a large step past that. Shipping it would mean either a
generator that takes a minute a level or a promise about solvability that is
softer than the rest of this collection's. One and two suits is the ladder most
people play anyway; four can come back when the player in `solve.ts` is stronger.

The score, the move counter as a target, the timer, and the "very hard" deal
selection some versions do by dealing *deliberately* awkward boards rather than
by verifying them.

### Cut from Backgammon v1

The doubling cube, match play, and the 2x and 3x that a gammon and a backgammon
are worth. The cube is a whole second game layered on the first and it is the
half most people never touch; without a match to play to, the multipliers have
nothing to multiply. A gammon and a backgammon are still *named* on the result
sheet, because they are what the two people at the table will notice, and naming
them costs one string and no rules.

Combined moves are the other departure: a checker is moved one die at a time
rather than dragged the sum of both in one go. Two taps instead of one, and in
exchange the move is unambiguous, the intermediate point is visibly legal or
not, and the move list stays one integer per die.

### Cut from Depot v1

The VIP bay and the locked bays — the `+` slots you open mid-level, which in the
original are a currency hook wearing a puzzle's clothes. A fixed bay count is a
cleaner lever and it is the one the difficulty curve is calibrated on.

The `?` buses and the varying seat counts **are** in, both deliberately. A bus
that holds six commits a bay for a long time in a way one that holds three does
not, and that is difficulty from constrained choice rather than from more stuff.

The hidden buses come with a caveat worth stating, because it is a judgement
call rather than a fact: **a `?` bus stays revealed once it has been seen**,
through undo and restart, for the rest of the level. Re-hiding it would make
undo a punishment, which is the one thing undo exists here not to be — but it
also means a careful player can spend a move to scout and take it back, so the
mechanic costs them a tap rather than a gamble. The trap rate models the player
who does not do that, which is why hidden buses still measure as difficulty.
They start at level 18 and never exceed one bus in seven.

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
- **A `cloneNode` carries the original's state classes with it.** Depot animates
  a bus driving off the lot as a *ghost* — a clone, because the state change
  that triggers the redraw has already taken the real bus off the board — and
  the clone inherited `is-hinted`. For the 460ms it lived, two elements matched
  `.bus.is-hinted`: the lit bus, and a bus that had already left. Invisible to
  a player and fatal to the browser playthrough, which clicks whatever is lit
  and found two. The ghost now sets its own `className` outright rather than
  inheriting one. **Anything cloned out of the board is not part of the board
  and should stop looking like it immediately.**
- **`[hidden]` is a user-agent rule and any `display` in a game's own
  stylesheet outranks it.** Mexican Train's curtain is `display: flex`, so
  `curtain.hidden = true` set the attribute, changed nothing on screen, and left
  the privacy model failing silently: `hidden` reported true, the tray reported
  the hand, and the next player was looking at the last one's tiles. Every
  element toggled with `.hidden` in this project needs its own
  `.thing[hidden] { display: none }`. Two other games already carried that rule
  and a comment saying why; the third was written without reading them. Caught
  by a browser pass, not by a test — the DOM was correct and the pixels were not.
- **Clearing a highlight has to happen before the early return, not after.**
  The same bug's second half: `paintLot` skipped the rest of the loop body for a
  bus that had left, and the `is-hinted` removal was in the part it skipped. A
  departed bus is only `hidden`, not gone, so it kept matching the selector
  forever. Caught by asserting exactly one lit element after every hint, and the
  assertion was then *proved* by re-breaking it at runtime — a stray lit ghost
  appended from the console took the count from 1 to 2 and back. A probe that
  has only ever passed is not evidence.
- **More stuff really is harder in Depot, which is the opposite of the rule
  everywhere else here.** The first difficulty score included a term for how few
  buses were drivable at once, on the intuition that a tight lot is a hard lot.
  `tools/depot.ts` measured six buses trapping 0.19 of naive runs and eighteen
  trapping 0.91: the lot is not where a level is lost, the kerb is, and every
  extra bus is another chance to commit a bay to the wrong colour. The term was
  not weak, it was *backwards*. Probe the sign of a lever, not only its size.
- **A lever that saturates is a ceiling, not a dial.** Two bays measured 0.84 to
  0.96 across every colour count from three to six — it flattens everything
  underneath it. It is worth having at the top of the curve and nowhere else,
  and reaching for it at level 26 skipped a third of the game.
- **Never size a board from an element that the board can resize.** `.app` is a
  grid, and a grid item defaults to sizing its column to its content. A board
  wider than the phone therefore widened its own container, `fitBoard` measured
  the widened box, and the board grew again — walking off the right edge of the
  screen. `.app` now pins its column to `minmax(0, 1fr)`, which makes that
  measurement trustworthy for every game here.

- **Regenerate icons before the build, never after.** Vite copies `public/`
  into `dist/` as part of the build, so icons written afterwards never reach
  the deployed site. The launcher ships a card pointing at a tile that was
  never uploaded, and nothing anywhere complains — the build is silent and a
  broken `<img>` in a card is an empty square. Tetris went live that way. The
  check is one command and takes a second: `ls dist/icons | wc -l` against
  `ls public/icons | wc -l`.
- **A slow test run with timeout failures is contention until proven
  otherwise.** The suite came back with seven failures across four files, all
  in generator tests with time budgets — and the run had taken 3821 seconds
  against its usual 67, because `npm run icons` had been started on top of it
  and renders eighty PNGs pixel by pixel in pure JS. Re-run alone: 1509 passed,
  nothing wrong with any of them. Check the duration before reading the
  failures.

- **A lever whose measured effect is far smaller than expected is not always a
  weak lever — sometimes it is a strong one being asked for one notch.** Tetris
  biases its bag towards the awkward pieces, and the first design did it by
  swapping one piece with a probability that rose to 0.75. Measured, that moved
  naive survival by twelve percent, non-monotonically, and stopped moving at
  level 13 — which, with gravity flooring at level 11, meant the game stopped
  getting harder two levels later. The instinct was that shape is a weak lever
  in a falling-block game. Sweeping *substitution depth* instead said otherwise:
  138 pieces at none, 108 at one, 87 at three, 73 at four. The lever had five
  notches and the design was using the first. Sweep what the lever *is*, not how
  often you pull it.
- **The floors that make a difficulty lever fair are worth designing before the
  lever.** The obvious way to make Tetris pieces nastier is to withhold the I,
  and it is the wrong one: it is the only piece that clears four rows and digs a
  four-deep well out, so taking it away is arbitrary rather than hard, and it
  costs the seven-bag's twelve-piece drought bound — the guarantee that a run
  ends to a mistake rather than to a coin. Keeping the I out of the donor pool
  entirely made the fairness argument trivial *and* the lever stronger, because
  everything else in the bag was then available to take.

- **Turning a board round for the other player is a reflection, not a rotation.**
  The obvious way to give each backgammon player their own view is to rotate the
  board 180 degrees, which is what walking round the table does — and it puts
  their home board in the wrong corner, because on a real board the two homes
  sit in the same half and only one player has theirs on the right. Every
  digital backgammon quietly mirrors instead, so that both players get home
  bottom-right, and the transform is `i -> 23 - i` on the point numbering with
  the screen slots left alone. Worth deriving on paper before writing the
  renderer: it looks like an off-by-one when you get it wrong, and it is not one.
- **A deterministic game can still have undo — inside a turn.** Yahtzee has
  none at all, because a rewind there is an oracle. Backgammon's rewind is only
  an oracle across a hand-over, where the opponent's roll has already been
  revealed; inside your own turn the dice are already on the table and taking a
  checker back tells you nothing. So the fence goes at the hand-over rather than
  round the whole button, which is both the correct rule and the one a real
  board enforces. The corollary is that the turn has to end on a tap rather than
  when the dice run out — otherwise the last move of a turn could never be taken
  back.
- **A game with two players still needs the shared save's level number.** It is
  the game counter, `completeLevel` still does the right thing, and the settings
  sheet's jump row becomes "deal me a different opening". Nothing in
  `shared/progress.ts` needed changing except two optional fields for the
  running tally — which is the same trick Yahtzee's `bestScore` plays, and the
  reason both live in `stats` is that the save code in Settings then carries
  them.
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
- **Check the arithmetic before blaming the generator.** Yahtzee's fairness
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
- **A fixed-size board still has to be fitted.** Yahtzee is always seven rows
  by two columns and five dice, so there is no level-to-level variation to solve
  for — but phones vary by three hundred pixels of height, and a scorecard that
  needs scrolling is one you cannot plan from. The row height is solved for the
  space available, and what the cap leaves over collects above the dice, where
  it reads as the gap between the card and the tray.

## Notes for later

- **Yahtzee's record rides in `stats`.** It is the one game whose outcome is a
  number rather than cleared-or-not, so `bestScore` and `scoreTotal` are optional
  fields on the shared save. They live there rather than in a store of their own
  so that the save code in Settings — the entire backup story for a server-free
  game — carries a player's record with it. A finished card is banked and
  `inProgress` cleared in the same breath, so closing the app on the result sheet
  keeps the score and reopening cannot count it twice.
- **The shared chrome takes a few opt-outs.** `showTimer`, `showShapes`,
  `levelNoun` and `progressLine` on the settings sheet. All default to the puzzle
  behaviour, so the other call sites are unchanged. Offering a row that does
  nothing is worse than not offering it. `extraRows` is the escape hatch: the
  caller builds the row and this file drops it in, because the alternative is a
  schema here for every row any game might ever want. Mexican Train's *Players*
  is the only one so far.
- **The two-player tallies ride in `stats` too.** Backgammon has `whiteWins` and
  `redWins`; Mancala and Mexican Train share `seatScores`, an array in seat
  order whose numbers mean whatever the game says they mean — games won in one,
  points against you in the other. Backgammon's pair predates the array and is
  left alone rather than migrated, because folding it in would rewrite every
  existing Backgammon save for a tidier field list. Mexican Train resets its
  array when the table changes size: a running total against a different set of
  people is not a running total.
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
