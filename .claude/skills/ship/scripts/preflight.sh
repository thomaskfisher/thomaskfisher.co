#!/usr/bin/env bash
#
# Works out what a ship would actually do, and refuses early if it should not
# happen at all. Prints `key: value` lines for the skill to read.
#
# Nothing here touches the network except `git fetch`, and nothing here changes
# the repo. It is safe to run twice.

set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

branch=$(git branch --show-current)
default=$(git rev-parse --abbrev-ref origin/HEAD 2>/dev/null | sed 's|^origin/||')
default=${default:-master}

echo "branch: $branch"
echo "default_branch: $default"

if [ "$branch" != "$default" ]; then
  echo "stop: on '$branch', not the default branch '$default'"
  exit 0
fi

if ! git fetch --quiet origin "$default" 2>/dev/null; then
  echo "warn: could not reach origin; the push at the end may fail"
fi

behind=$(git rev-list --count "HEAD..origin/$default" 2>/dev/null || echo 0)
ahead=$(git rev-list --count "origin/$default..HEAD" 2>/dev/null || echo 0)
echo "behind: $behind"
echo "ahead: $ahead"

if [ "$behind" -gt 0 ]; then
  # Deploying now would publish a tree that the push cannot then record.
  echo "stop: $behind commit(s) behind origin/$default — rebase or pull first"
  exit 0
fi

# Everything this ship would publish: what is not committed, plus what is
# committed but not pushed.
changed=$(
  {
    git status --porcelain | sed 's/^...//' | sed 's/.* -> //'
    [ "$ahead" -gt 0 ] && git diff --name-only "origin/$default...HEAD"
  } | sed '/^$/d' | sort -u
)

if [ -z "$changed" ]; then
  echo "stop: nothing to ship — working tree clean and nothing unpushed"
  exit 0
fi

echo "files: $(echo "$changed" | wc -l | tr -d ' ')"

targets=""
add() { case " $targets " in *" $1 "*) ;; *) targets="$targets $1" ;; esac; }

while IFS= read -r file; do
  case "$file" in
    # Hosting config can change how any of the three sites is served.
    firebase.json|.firebaserc) add portfolio; add games; add wedding ;;
    games/*)                   add games ;;
    public/*)                  add portfolio ;;
    wedding/*)                 add wedding ;;
  esac
done <<< "$changed"

targets=$(echo "$targets" | xargs)
echo "targets: ${targets:-none}"
case " $targets " in *" games "*) echo "needs_build: yes" ;; *) echo "needs_build: no" ;; esac

echo "--- changed files"
echo "$changed"
