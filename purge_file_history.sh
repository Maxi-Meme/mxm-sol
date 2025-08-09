#!/usr/bin/env bash
set -euo pipefail

# purge-file-history.sh
# Rewrite history to remove ALL past versions of one file, then re-add its current contents.
# Usage: ./purge-file-history.sh path/to/file.ext [branch=main] [remote=origin]
#
# Notes:
# - Rewrites ALL branches & tags by default.
# - git-filter-repo removes remotes by design; this script backs them up and restores them.

FILE="${1:?Usage: $0 path/to/file.ext [branch=main] [remote=origin]}"
BRANCH="${2:-main}"
REMOTE="${3:-origin}"

if ! command -v git >/dev/null 2>&1; then
  echo "git not found"; exit 1
fi

# Ensure git-filter-repo is available
if ! command -v git-filter-repo >/dev/null 2>&1 && ! git filter-repo -h >/dev/null 2>&1; then
  echo "git-filter-repo not found. Install with one of:"
  echo "  sudo apt install -y git-filter-repo"
  echo "  python3 -m pip install --user git-filter-repo"
  echo "  or curl -LO https://raw.githubusercontent.com/newren/git-filter-repo/refs/heads/main/git-filter-repo && chmod +x git-filter-repo && mkdir -p ~/.local/bin && mv git-filter-repo ~/.local/bin"
  exit 1
fi

# Must be in a repo
git rev-parse --is-inside-work-tree >/dev/null

# Sync & ensure clean tree
git fetch --all --prune
git checkout "$BRANCH"
git pull --ff-only "${REMOTE}" "$BRANCH"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree not clean. Commit/stash changes and re-run."; exit 1
fi

# Ensure file exists and back it up
if [[ ! -f "$FILE" ]]; then
  echo "File '$FILE' does not exist in working tree. Aborting."; exit 1
fi
TMPDIR="$(mktemp -d)"
BACKUP="$TMPDIR/$(basename "$FILE")"
cp -- "$FILE" "$BACKUP"

# --- Backup remotes so we can restore them after filter-repo nukes them ---
# Primary remote (the one we'll push to)
PRIMARY_URL="$(git remote get-url "$REMOTE" 2>/dev/null || echo "")"
PRIMARY_PUSH_URL="$(git remote get-url --push "$REMOTE" 2>/dev/null || echo "")"

# Also back up ALL remotes (names + URLs) to restore them exactly
ALL_REMOTES=()
while IFS= read -r r; do [[ -n "$r" ]] && ALL_REMOTES+=("$r"); done < <(git remote)
declare -A REMOTE_URLS REMOTE_PUSH_URLS
for r in "${ALL_REMOTES[@]}"; do
  REMOTE_URLS["$r"]="$(git remote get-url "$r" 2>/dev/null || echo "")"
  REMOTE_PUSH_URLS["$r"]="$(git remote get-url --push "$r" 2>/dev/null || echo "")"
done

# Optional: capture custom fetch/push refspecs
declare -A REMOTE_FETCH_SPEC REMOTE_PUSH_SPEC
for r in "${ALL_REMOTES[@]}"; do
  REMOTE_FETCH_SPEC["$r"]="$(git config --get-all "remote.$r.fetch" | tr '\n' '\t' || true)"
  REMOTE_PUSH_SPEC["$r"]="$(git config --get-all "remote.$r.push" | tr '\n' '\t' || true)"
done

# --- Rewrite: remove the file from *all* history ---
# If the file had prior names, run again with multiple --path entries or
# adapt this line accordingly.
git filter-repo --path "$FILE" --invert-paths --force

# --- Restore remotes exactly as before ---
# (git filter-repo drops remotes; we add them back)
for r in "${ALL_REMOTES[@]}"; do
  url="${REMOTE_URLS[$r]}"
  [[ -n "$url" ]] && git remote add "$r" "$url" || true
  pushurl="${REMOTE_PUSH_URLS[$r]}"
  if [[ -n "$pushurl" && "$pushurl" != "$url" ]]; then
    git remote set-url --push "$r" "$pushurl" || true
  fi
  # restore any custom refspecs
  IFS=$'\t' read -r -a fss <<< "${REMOTE_FETCH_SPEC[$r]:-}"
  for fs in "${fss[@]}"; do [[ -n "${fs// }" ]] && git config --add "remote.$r.fetch" "$fs" || true; done
  IFS=$'\t' read -r -a pss <<< "${REMOTE_PUSH_SPEC[$r]:-}"
  for ps in "${ps[@]}"; do [[ -n "${ps// }" ]] && git config --add "remote.$r.push" "$ps" || true; done
done

# Re-add the file as a fresh, historyless blob
mkdir -p "$(dirname "$FILE")"
mv -- "$BACKUP" "$FILE"
git add -- "$FILE"
git commit -m "Re-add $FILE (purged historical versions)"

# Optional: local cleanup
git reflog expire --expire-unreachable=now --all || true
git gc --prune=now --aggressive || true

# Force-push rewritten history
if [[ -n "$PRIMARY_URL" ]]; then
  # Make sure the primary remote exists (in case there were none before)
  if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
    git remote add "$REMOTE" "$PRIMARY_URL"
    if [[ -n "$PRIMARY_PUSH_URL" && "$PRIMARY_PUSH_URL" != "$PRIMARY_URL" ]]; then
      git remote set-url --push "$REMOTE" "$PRIMARY_PUSH_URL"
    fi
  fi
  git push --force --all "$REMOTE"
  git push --force --tags "$REMOTE"
else
  echo "No '$REMOTE' remote URL was detected before rewrite; skipping push."
fi

echo "Done. '$FILE' exists only from this new commit onward on '$REMOTE/$BRANCH'."
echo "Verify: git log --all -- '$FILE'"
