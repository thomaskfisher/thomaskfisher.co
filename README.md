This is my portfolio website found at `thomaskfisher.com`

Repo is stored on GitHub `https://github.com/thomaskfisher/thomaskfisher.co`

## Three sites, one Firebase project

| Target | Serves | Source |
| --- | --- | --- |
| `portfolio` | `thomaskfisher.com` | `public/` |
| `games` | `games.thomaskfisher.com` | `games/dist/` (see [games/README.md](games/README.md)) |
| `wedding` | `wedding.thomaskfisher.com` | `wedding/public/` |

```bash
firebase deploy --only hosting:portfolio   # the portfolio
firebase deploy --only hosting:games       # the games
firebase deploy --only hosting:wedding     # the wedding site
firebase deploy                            # all three
```

Deploying one no longer redeploys the others. Note that `firebase deploy` on its
own now covers every target.

`/ship` does the whole release in one command: it works out which targets the
changed files actually touch, builds and tests the games if they are among them,
deploys only those targets, then commits and pushes to `master`. Deploy runs
first on purpose, so a failed build never becomes a commit.

### The wedding site

`wedding/public/index.html` is the wedding page and `wedding/public/rsvp.html`
is the dinner RSVP; `cleanUrls` serves the latter at `/rsvp`. These two pages
used to live in `public/` and are still reachable through 301 redirects on the
portfolio (`/wedding` and `/rsvp`). The site carries its own copy of the Bootstrap
theme's `vendor/` assets so the portfolio and the wedding site can change
independently.
