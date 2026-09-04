# Calibration harnesses

Not part of the build and not part of `npm test`. Each has its own vitest config
so it never runs by accident — these take minutes, not seconds.

| Script | Answers |
| --- | --- |
| `calibrate.ts` | What difficulty do the generators actually *produce* at each level, and how many attempts did it cost? |
| `probe.ts` | Which (colours, open sinks, buffer, capacity) combinations are solvable often enough to generate at all? |
| `timing.ts` | How long does one level take to build? The worker has about one level's play; past that the main-thread fallback freezes the board. |
| `sample.ts` | Prints Survival boards as text, so the gate spread can be looked at rather than trusted. |
| `dice.ts` | How good is Five Dice's hint? It has no difficulty band to calibrate, but a hint that plays badly is not worth pressing, so this prints what the policy averages over 400 cards and what it prices each box at. |

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

`dice.ts` is the odd one out: Five Dice has nothing to calibrate, because it has
no difficulty. What it measures instead is the hint, which is a heuristic rather
than a solver and so can quietly get worse. It is also how the one tuned
constant in `advise.ts` — how heavily to chase the upper bonus — was chosen: 1.0
earned the bonus on 17% of cards for a mean of 230.9, 1.4 on 22% for 232.8, 1.8
also 22% for 232.5, and 2.4 fell back to 226.8 by chasing it into cards that
could never pay.

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
