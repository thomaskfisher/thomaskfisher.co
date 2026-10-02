# Moving thomaskfisher.co to the new Mac

A checklist for moving this project off the Mac mini. Go through it in order. Don't wipe the mini until step 9.

**Shortcut:** Apple's Migration Assistant copies your whole user account, including `~/Code`, `~/.ssh`,
`~/.claude` and the Firebase login, so most of this list gets done for you. If you use it, skip to
**step 7 (Check that it works)**. The steps below are for setting the new Mac up from scratch.

---

## 1. On the Mac mini: make sure nothing is left only on this machine

- [ ] Check that everything is committed and pushed:
  ```bash
  cd ~/Code/thomaskfisher.co
  git status                                  # should say "working tree clean"
  git log --branches --not --remotes --oneline  # should print nothing
  ```
  (When this doc was written, both were clean. The local branch `claude/solitaire-spider-solitaire-mqtp18`
  has no remote branch, but all of its commits are already on GitHub, so you don't need to do anything with it.)

- [ ] Copy the files that git ignores but you'd want to keep. Use AirDrop, a USB drive or iCloud Drive:

  | Path | What it is | Needed? |
  | --- | --- | --- |
  | `games/examples/` (`bus-jam/`, `screw-land/`) | Reference material for the games. Gitignored, so it isn't on GitHub | **Yes**, it's the only copy |
  | `~/.claude/settings.json` | Your global Claude Code settings: model, permissions, extra directories | Recommended |
  | `.claude/settings.local.json` | Two permission entries for this project | Optional |
  | `~/.claude/projects/-Users-tfisher-Code-thomaskfisher-co/` | Past Claude Code sessions for this project (~140 MB) | Optional. Only needed if you want to `--resume` old sessions |

  You can skip these because they get rebuilt: `node_modules/`, `games/node_modules/`, `games/dist/`, `.firebase/`
  and `games/tools/*.txt` (the calibration scripts regenerate the last one).

## 2. On the new Mac: install the tools

Create the same macOS username, **`tfisher`**, if you can. Claude Code stores session history by the project's
full path, and your global settings point at `/Users/tfisher/Code/...`.

These are the versions on the mini today. Match the major versions.

- [ ] **Xcode Command Line Tools** (this gives you `git`): `xcode-select --install`
- [ ] **Node.js 24.x** (the mini has 24.14.0, npm 11.9.0). The mini used the official installer from nodejs.org,
      not Homebrew or nvm, which put it at `/usr/local/bin/node`. Doing it the same way keeps things identical.
- [ ] **Firebase CLI 15.x** (the mini has 15.8.0):
  ```bash
  sudo npm install -g firebase-tools
  firebase --version
  ```
- [ ] **Google Chrome.** The `new-game` skill uses headless Chrome to take screenshots of the games.
- [ ] **Visual Studio Code**, then the Claude Code extension
- [ ] **Claude Code CLI**, then sign in

## 3. Set up git and GitHub access

- [ ] Set your git identity. The mini only had an email set, with no name:
  ```bash
  git config --global user.email "tkfisher7@gmail.com"
  git config --global user.name  "Thomas Fisher"
  ```
- [ ] Set up an SSH key for GitHub. The remote is `git@github.com:thomaskfisher/thomaskfisher.co.git`, so you need SSH, not HTTPS.
  A new key is safer than copying the old one:
  ```bash
  ssh-keygen -t ed25519 -C "tkfisher7@gmail.com"
  pbcopy < ~/.ssh/id_ed25519.pub   # paste at github.com → Settings → SSH and GPG keys → New SSH key
  ```
- [ ] Create `~/.ssh/config` with the same contents as the mini, so the Keychain remembers the passphrase:
  ```
  Host github.com
    AddKeysToAgent yes
    UseKeychain yes
    IdentityFile ~/.ssh/id_ed25519
  ```
- [ ] Test it: `ssh -T git@github.com` should greet you by username.

## 4. Clone the repo

- [ ] Clone it to the same path as on the mini:
  ```bash
  mkdir -p ~/Code && cd ~/Code
  git clone git@github.com:thomaskfisher/thomaskfisher.co.git
  cd thomaskfisher.co
  ```
- [ ] Put back the files you copied in step 1:
  - `games/examples/` goes in `~/Code/thomaskfisher.co/games/examples/`
  - `settings.local.json` goes in `~/Code/thomaskfisher.co/.claude/` (if you copied it)

The project's Claude Code setup is committed to the repo: `.claude/settings.json` (permissions plus the
Ping sound hooks) and the `/ship` and `/new-game` skills. They come along with the clone.

## 5. Install the games' dependencies

Only `games/` has a `package.json`. The repo root has nothing to install.

- [ ] ```bash
  cd ~/Code/thomaskfisher.co/games
  npm install      # npm ci also works, since package-lock.json is committed
  ```

## 6. Log in to Firebase

All four sites (portfolio, games, wedding, blog) live in one Firebase project, `thomaskfisher-d6a4e`.
The project and the hosting targets are set in `.firebaserc`, which is in git, so you only need to log in.

- [ ] ```bash
  firebase login                   # use tfisher3035@gmail.com (the account the mini uses)
  firebase hosting:sites:list      # should show all four sites:
                                   #   thomaskfisher-d6a4e, thomaskfisher-games,
                                   #   thomaskfisher-wedding, thomaskfisher-blog
  ```

## 7. Check that it works

- [ ] The games pass type-checking and tests, and build:
  ```bash
  cd ~/Code/thomaskfisher.co/games
  npm test
  npm run build    # writes games/dist/, which the games hosting target deploys
  ```
- [ ] Optional: serve the sites locally to look at them: `firebase emulators:start --only hosting` from the repo root.
- [ ] Ship's preflight runs and reaches GitHub. It changes nothing, so it's safe to run:
  ```bash
  cd ~/Code/thomaskfisher.co
  .claude/skills/ship/scripts/preflight.sh
  ```
  On a clean tree it should end with `stop: nothing to ship`. It should **not** print `warn: could not reach origin`.
- [ ] Do one real release: make a small change and run `/ship` in Claude Code. That proves the deploy to
      Firebase and the push to GitHub both work from the new Mac.

## 8. Set up Claude Code

- [ ] Copy `~/.claude/settings.json` from step 1 into `~/.claude/` on the new Mac. Before you use it, edit
      `additionalDirectories`. It points at `/Users/tfisher/Code/keeptrack/.claude/skills` and
      `/Users/tfisher/Code/inventory-tracker`. Clone those repos too, or remove those lines.
- [ ] Optional: copy the session history folder from step 1 into `~/.claude/projects/` so you can resume old sessions.
      This only works if the repo is at the same path (`/Users/tfisher/Code/thomaskfisher.co`).
- [ ] Open the project in VS Code and run `/ship` or `/new-game`. Both should show up as available skills.

## 9. Retire the Mac mini

Do this only after step 7's real release worked from the new Mac.

- [ ] On the mini: `firebase logout`
- [ ] Remove the mini's SSH key from GitHub → Settings → SSH and GPG keys
- [ ] Sign out of Claude Code on the mini
- [ ] Any other projects under `~/Code` on the mini (`keeptrack`, `inventory-tracker`, `interview-coach`, …) need their own move. This doc only covers thomaskfisher.co.
