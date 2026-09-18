# Calibration harnesses

Not part of the build and not part of `npm test`. Each has its own vitest config
so it never runs by accident — these take minutes, not seconds.

| Script | Answers |
| --- | --- |
| `calibrate.ts` | What difficulty do the generators actually *produce* at each level, and how many attempts did it cost? |
| `probe.ts` | Which (colours, open sinks, buffer, capacity) combinations are solvable often enough to generate at all? |
| `timing.ts` | How long does one level take to build? The worker has about one level's play; past that the main-thread fallback freezes the board. |
| `sample.ts` | Prints Survival boards as text, so the gate spread can be looked at rather than trusted. |
| `sudoku.ts` | What does Sudoku's effort signal reach, and does the dig-then-restore search land in the band? |
| `nonogram.ts` | What does nonogram lookahead range over, and do size and fill rate predict it? (They do not.) |
| `pipes.ts` | Same question for Pipes — and it is where "every board is fully forced" was measured, which killed the first difficulty signal outright. |
| `twenty48.ts` | Trap rate by target, how *long* each target takes to reach, and whether a worker can verify a level in time. |
| `wordle.ts` | Does trap rate separate `LIGHT` from `PIZZA`, and does a longer word take more guesses? (It takes fewer.) |
| `dominoes.ts` | How often does a Mexican Train round end blocked, and how long does one run? It is what set the hand size, the opposite way round from the intuition. |
| `artillery.ts` | What does a battlefield cost to generate, how findable is a hit on it, and how many volleys does a match run? |
| `dice.ts` | How good is Yahtzee's hint? It has no difficulty band to calibrate, but a hint that plays badly is not worth pressing, so this prints what the policy averages over 400 cards and what it prices each box at. |

```sh
npx vitest run --config tools/vitest.calibrate.config.ts --root .   # -> tools/calibration.txt
npx vitest run --config tools/vitest.probe.config.ts     --root .   # -> tools/probe.txt
npx vitest run --config tools/vitest.timing.config.ts    --root .   # -> tools/timing.txt
npx vitest run --config tools/vitest.sample.config.ts    --root .   # -> tools/sample.txt
npx vitest run --config tools/vitest.dice.config.ts      --root .   # -> tools/dice.txt
npx vitest run --config tools/vitest.dominoes.config.ts  --root .   # -> tools/dominoes.txt
npx vitest run --config tools/vitest.artillery.config.ts --root .   # -> tools/artillery.txt
```

**Run `calibrate` and `timing` after any change to a shape function.** Reading
the constants is not enough — the levers interact through the solver, and the
only honest signal is what comes out the far end. The difficulty rebuild that
these were written for moved level 1 from 0.06-0.10 to 0.22-0.29 and level 50
from 0.23-0.36 to 0.90-0.97, and it also silently made one game take 34 seconds
to generate a level until `timing.ts` caught it.

`dice.ts` is the odd one out: Yahtzee has nothing to calibrate, because it has
no difficulty. What it measures instead is the hint, which is a heuristic rather
than a solver and so can quietly get worse. It is also how the one tuned
constant in `advise.ts` — how heavily to chase the upper bonus — was chosen: 1.0
earned the bonus on 17% of cards for a mean of 230.9, 1.4 on 22% for 232.8, 1.8
also 22% for 232.5, and 2.4 fell back to 226.8 by chasing it into cards that
could never pay.

## depot.ts

Calibration for Depot, and the evidence behind its shape function. Section 1 is
the level-by-level curve and is the one to re-run after a change. Sections 2 and
3 are skipped by default: they are the surveys the design came out of, and two
of their findings were the opposite of the intuition they were testing.

Trap rate spans 0.17 to 0.96 with a ~100% build rate throughout, so the
"colours and holding slots are one budget" cap the dealing games need does not
apply here — the queue is recorded from a play rather than dealt, and a
six-colour two-bay board builds 39 times in 40. And **more buses is harder**,
not easier: six trap 0.19 of naive runs, eighteen trap 0.91, because the lot is
not where a level is lost. The kerb is.

Two bays is the other finding worth keeping: it reads 0.84-0.96 across every
colour count, which makes it a ceiling rather than a dial. Reaching for it early
flattens every lever underneath it.

```bash
npx vitest run --config tools/vitest.depot.config.ts --root .
```

## gridlock.ts

Calibration for Gridlock, and the evidence behind `EASIEST_MOVES` and
`HARDEST_MOVES`. Three sections: what depth a *random* park's component reaches
(the answer — a median of two or three slides — is why the generator hill-climbs
the layout instead of dealing), the curve the finished generator produces level
by level, and what a level costs to generate.

The branching column in the second section is the guard a move count cannot
provide on its own: a thirty-move solution in which every position has one legal
move is thirty moves of no decisions.

```bash
npx vitest run --config tools/vitest.gridlock.config.ts --root .
```

## solitaire.ts

Calibration for Solitaire, and the evidence behind `VERIFY_BUDGET`. Three
sections: how far the trap rate spreads over random deals (0.0 to 1.0 with mass
everywhere, which is why deal selection is the only lever the game needs), what
a verification search costs at three budgets, and what the finished generator
delivers level by level.

The second section is the one that set the budget, and it is a ratio rather than
a rate: a deal this search *can* win is won in about 560ms, so almost all of a
larger budget is spent proving nothing about deals that were going to be
discarded either way. Failing cheaply is worth more than failing conclusively.

```bash
npx vitest run --config tools/vitest.solitaire.config.ts --root .
```

## spider.ts

Calibration for Spider, and the evidence behind `TWO_SUIT_FROM` and the shape of
`solve.ts`. Three sections: how far the signal spreads at one suit and at two,
what a search costs, and the curve the generator delivers.

The first section is the one that changed the design twice. It is why the signal
here is *how many sets naive play finished* rather than *did it finish* — the
binary version scored every two-suit board 1.00 — and it is why two suits start
where the curve's band saturates rather than wherever a ladder felt right: a
one-suit board scores 0.1 to 0.98 and a two-suit board scores 0.98 whatever else
is true about it.

```bash
npx vitest run --config tools/vitest.spider.config.ts --root .
```

## artillery.ts

Measurement for Artillery. There is no difficulty to curve — the opponent is the
person holding the other end of the phone — so what it measures is whether a
battlefield is a game at all. Three sections: what generation costs, how many
(angle, power) settings actually connect, and how many volleys a match runs when
both sides are played by a policy that ranges in the way a person does.

**Section 2 is the one that changed the design.** The lowest power that connects
came out at a mean of 86 with a tenth percentile of 79 — meaning ninety-one
positions on the power dial and about twenty of them did anything. Raising the
muzzle speed from 1.55 to 2.0 moved that to a mean of 67, roughly doubled the
number of connecting settings, and removed the one battlefield in eighty where
a coarse sweep found no shot at all. It is also where `MIN_REACH_SETTINGS` came
from: this harness sweeps a finer grid than the generator's own check and found
a side where exactly one coarse setting connected and the finer sweep found
none, which is a needle rather than a band.

Section 3 is the sanity check on the damage numbers rather than a dial: a median
of ten volleys means a match is decided inside the eight weapons each side
drafts, which is what makes the draft worth thinking about.

```bash
npx vitest run --config tools/vitest.artillery.config.ts --root .
```
