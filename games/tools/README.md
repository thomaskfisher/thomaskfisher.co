# Calibration harnesses

Not part of the build and not part of `npm test`. Each has its own vitest config
so it never runs by accident — these take minutes, not seconds.

| Script | Answers |
| --- | --- |
| `calibrate.ts` | What difficulty do the generators actually *produce* at each level, and how many attempts did it cost? |
| `probe.ts` | Which (colours, open sinks, buffer, capacity) combinations are solvable often enough to generate at all? |
| `timing.ts` | How long does one level take to build? The worker has about one level's play; past that the main-thread fallback freezes the board. |
| `sample.ts` | Prints Survival boards as text, so the gate spread can be looked at rather than trusted. |
| `dice.ts` | How good is Yahtzee's hint? It has no difficulty band to calibrate, but a hint that plays badly is not worth pressing, so this prints what the policy averages over 400 cards and what it prices each box at. |

```sh
npx vitest run --config tools/vitest.calibrate.config.ts --root .   # -> tools/calibration.txt
npx vitest run --config tools/vitest.probe.config.ts     --root .   # -> tools/probe.txt
npx vitest run --config tools/vitest.timing.config.ts    --root .   # -> tools/timing.txt
npx vitest run --config tools/vitest.sample.config.ts    --root .   # -> tools/sample.txt
npx vitest run --config tools/vitest.dice.config.ts      --root .   # -> tools/dice.txt
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
