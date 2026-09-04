# Calibration harnesses

Not part of the build and not part of `npm test`. Each has its own vitest config
so it never runs by accident — these take minutes, not seconds.

| Script | Answers |
| --- | --- |
| `calibrate.ts` | What difficulty do the generators actually *produce* at each level, and how many attempts did it cost? |
| `probe.ts` | Which (colours, open sinks, buffer, capacity) combinations are solvable often enough to generate at all? |
| `timing.ts` | How long does one level take to build? The worker has about one level's play; past that the main-thread fallback freezes the board. |
| `sample.ts` | Prints Survival boards as text, so the gate spread can be looked at rather than trusted. |

```sh
npx vitest run --config tools/vitest.calibrate.config.ts --root .   # -> tools/calibration.txt
npx vitest run --config tools/vitest.probe.config.ts     --root .   # -> tools/probe.txt
npx vitest run --config tools/vitest.timing.config.ts    --root .   # -> tools/timing.txt
npx vitest run --config tools/vitest.sample.config.ts    --root .   # -> tools/sample.txt
```

**Run `calibrate` and `timing` after any change to a shape function.** Reading
the constants is not enough — the levers interact through the solver, and the
only honest signal is what comes out the far end. The difficulty rebuild that
these were written for moved level 1 from 0.06-0.10 to 0.22-0.29 and level 50
from 0.23-0.36 to 0.90-0.97, and it also silently made one game take 34 seconds
to generate a level until `timing.ts` caught it.
