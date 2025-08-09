#!/usr/bin/env bash
set -euo pipefail

# purge-file-history.sh
# Rewrites the repo to remove ALL history of a given file, then re-adds its current contents.
# Usage: ./purge-file-history.sh path/to/file.ext [branch=main] [remote=origin]

FILE="${1:?Usage: $0 path/to/file.ext [branch=main] [remote=origin]}"
BRANCH="${2:-main}"
REMOTE="${3:-origin}"

if ! command -v git >/dev/null 2>&1; then
  echo "git not found"; exit 1
fi

# Ensure git-filter-repo is available
if ! command -v git-filter-repo >/dev/null 2>&1 && ! git filter-repo -h >/dev/null 2>&1; then
  echo "git-filter-repo not found. Install with one of:"
  echo "  brew install git-filter-repo"
  echo "  python3 -m pip install --user git-filter-repo"
  exit 1
fi

# Make sure we're in a git repo
git rev-parse --is-inside-work-tree >/dev/null

# Sync and ensure clean tree
git fetch --all --prune
git checkout "$BRANCH"
git pull --ff-only "$REMOTE" "$BRANCH"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree not clean. Commit/stash your changes and re-run."; exit 1
fi

# Keep the current file contents
if [[ ! -f "$FILE" ]]; then
  echo "File '$FILE' does not exist in working tree. Aborting."; exit 1
fi

BASENAME="$(basename "$FILE")"
TMPDIR="$(mktemp -d)"
BACKUP="$TMPDIR/$BASENAME"
cp -- "$FILE" "$BACKUP"

# Rewrite: remove the file from *all* history
# NOTE: If the file had renames, add multiple --path entries for older names.
git filter-repo --path "$FILE" --invert-paths --force

# Re-add the file as a fresh, historyless blob
mkdir -p "$(dirname "$FILE")"
mv -- "$BACKUP" "$FILE"
git add -- "$FILE"
git commit -m "Re-add $FILE (purged historical versions)"

# Optional: local cleanup
git reflog expire --expire-unreachable=now --all || true
git gc --prune=now --aggressive || true

# Force-push rewritten history
git push --force --all "$REMOTE"
git push --force --tags "$REMOTE"

echo "Done. '$FILE' now exists only from this new commit onward on $REMOTE/$BRANCH."
echo "Note: anyone who cloned/forked earlier still has the old history in their clones."
