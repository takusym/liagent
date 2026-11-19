#!/bin/sh
# pre-push: refuse unless the pushed HEAD contains upstream/main. Never rebases.
set -eu
UPSTREAM_URL="${LIAGENT_UPSTREAM_URL:-https://github.com/snolab/liagent.git}"
REMOTE="${LIAGENT_UPSTREAM_REMOTE:-upstream}"
if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  echo "pre-push: adding remote '$REMOTE' -> $UPSTREAM_URL"
  git remote add "$REMOTE" "$UPSTREAM_URL"
fi
if ! git fetch --quiet "$REMOTE" main; then
  echo "pre-push: could not fetch $REMOTE/main; refusing push (set LEFTHOOK=0 to skip)" >&2
  exit 1
fi
if ! git merge-base --is-ancestor "$REMOTE/main" HEAD; then
  echo "pre-push: HEAD does not contain $REMOTE/main. Rebase first:" >&2
  echo "  git fetch $REMOTE && git rebase $REMOTE/main" >&2
  exit 1
fi
