This is my portfolio website found at `thomaskfisher.com`

Repo is stored on GitHub `https://github.com/thomaskfisher/thomaskfisher.co`

## Two sites, one Firebase project

| Target | Serves | Source |
| --- | --- | --- |
| `portfolio` | `thomaskfisher.com` | `public/` |
| `games` | `games.thomaskfisher.com` | `games/dist/` (see [games/README.md](games/README.md)) |

```bash
firebase deploy --only hosting:portfolio   # the portfolio
firebase deploy --only hosting:games       # the games
firebase deploy                            # both
```

Deploying one no longer redeploys the other. Note that `firebase deploy` on its
own now covers both targets.
