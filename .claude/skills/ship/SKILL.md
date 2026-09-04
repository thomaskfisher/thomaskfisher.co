---
name: ship
description: Deploy the changed sites to Firebase Hosting, then commit and push to the default branch — the whole release in one command. Use whenever Thomas says "ship it", "ship", "deploy and push", "deploy this", "push it live", "release", or asks to get the current work onto thomaskfisher.com, games.thomaskfisher.com or wedding.thomaskfisher.com. Works out which of the three hosting targets the changes actually affect and leaves the other two alone.
---

# Ship

One command: **deploy → commit → push**. That order is deliberate — a build or a
deploy that fails never becomes a commit, so the repo never records a release
that did not happen.

The cost of the order is the window between a successful deploy and a successful
push. Step 1 closes it: it refuses to deploy when the branch is behind
`origin`, which is the only realistic way the push fails after the deploy has
already gone out.

## 1. Preflight

```bash
.claude/skills/ship/scripts/preflight.sh
```

It fetches, then prints `key: value` lines. **If it prints a `stop:` line, do
not deploy.** Say what it said and what would clear it — the three stops are
being on a non-default branch, being behind `origin`, and having nothing to
ship. None of them are yours to resolve unilaterally; ask.

Otherwise it gives you:

| Key | Means |
| --- | --- |
| `targets` | Which hosting targets the changed files touch, or `none` |
| `needs_build` | Whether `games` is among them and so needs `npm run build` |
| `--- changed files` | Everything this ship will publish and record |

Targets come from paths: `games/**` → games, `public/**` → portfolio,
`wedding/**` → wedding, and `firebase.json` or `.firebaserc` → all three,
because hosting config can change how any site is served. A change to
`README.md` or `.claude/**` maps to nothing: **`targets: none` is not an error**,
it just means skip step 3 and go straight to committing.

Read the changed file list before going on. If it holds anything Thomas plainly
did not mean to publish — a scratch file, a stray credential, an unrelated
experiment — stop and ask rather than shipping it.

## 2. Gates

Only when `games` is a target, from `games/`:

```bash
npm test        # ~100s, 200+ tests
npm run build   # tsc --noEmit && vite build — also produces the deploy artifact
```

Both must pass. The build is not optional even if tests are skipped: `games/dist/`
is gitignored and rebuilt here, so **whatever is in `dist` at this moment is
exactly what goes live**. Never deploy games without building first, or you ship
the previous build.

Skip `npm test` only when the games changes are documentation alone
(`games/README.md`), or when Thomas passed `--no-tests`. Say which you did.

The portfolio and wedding sites are static — no build, no gate.

## 3. Deploy

Only the targets from step 1, in one command:

```bash
firebase deploy --only hosting:games,hosting:portfolio
```

If it fails, **stop**. Do not commit. Report the failure — nothing has been
recorded, so the repo and the live sites still agree.

## 4. Commit

Stage deliberately — read `git status` first rather than reaching for `git add -A`
on trust. `games/dist/`, `games/node_modules/` and `games/tools/*.txt` are
gitignored, so a full stage is usually right, but look before you do it.

Write a real message in this repo's voice. Look at `git log` and match it: an
imperative summary naming what changed for the reader ("Make the launcher work
offline, and stop the games evicting each other"), then paragraphs explaining
**why, and what the evidence was** — the bug that prompted it, the measurement
that settled it, the thing that turned out to be wrong. No conventional-commit
prefixes, no bulleted file lists, no "update files". If Thomas supplied a
message, use it as the summary line and write the body yourself.

End with the co-author trailer this session's attribution rules specify.

## 5. Push

```bash
git push origin HEAD
```

The default branch here is `master`, not `main` — the preflight resolves it from
`origin/HEAD` so this keeps working if it is ever renamed. Do not create a PR:
this flow is push-to-default by design.

## 6. Report

State plainly: which targets deployed and their URLs, whether tests ran, the
commit subject and short SHA, and that the push landed.

| Target | URL |
| --- | --- |
| `portfolio` | https://thomaskfisher.com |
| `games` | https://games.thomaskfisher.com |
| `wedding` | https://wedding.thomaskfisher.com |

**If the deploy succeeded but the commit or push then failed**, lead with that.
The live sites are ahead of the repo, that is the one genuinely bad state this
flow can reach, and Thomas needs to know immediately rather than at the end of a
success-shaped summary.

## Arguments

- *(none)* — everything the preflight found.
- `games` / `portfolio` / `wedding` — deploy only that target, whatever the
  preflight says. Still commit and push everything.
- `--no-tests` — skip `npm test`. Never skips the build.
- Anything else in quotes — the commit summary line.

## Not this skill's job

Preview channels. Before a first real deploy of something risky, the games
README's `firebase hosting:channel:deploy preview --only games` is the right
move — service workers need HTTPS, so a LAN address registers nothing and a
phone test over Wi-Fi proves nothing. Offer it, but do not fold it into a ship.
