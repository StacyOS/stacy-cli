#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=./release-lib.sh
. "$REPO_ROOT/scripts/release-lib.sh"

dry_run=false
init_notes=false
allow_draft_notes=false
version=""

usage() {
  cat <<'EOF'
Usage:
  ./scripts/create-github-release.sh <version> [--dry-run] [--init-notes] [--allow-draft-notes]

Examples:
  ./scripts/create-github-release.sh 2026.318.0
  ./scripts/create-github-release.sh 2026.318.0 --dry-run
  ./scripts/create-github-release.sh 2026.318.0 --init-notes

Notes:
  - Run this after pushing the stable tag.
  - Resolves the git remote automatically.
  - In GitHub Actions, origin is used explicitly.
  - If the release already exists, this script updates its title and notes.
  - --init-notes creates releases/v<version>.md when missing, then stops so you
    can edit and mark the notes ready before publishing.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=true ;;
    --init-notes) init_notes=true ;;
    --allow-draft-notes) allow_draft_notes=true ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [ -n "$version" ]; then
        echo "Error: only one version may be provided." >&2
        exit 1
      fi
      version="$1"
      ;;
  esac
  shift
done

if [ -z "$version" ]; then
  usage
  exit 1
fi

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: version must be a stable calendar version like 2026.318.0." >&2
  exit 1
fi

tag="v$version"
notes_file="$REPO_ROOT/releases/${tag}.md"

if [ ! -f "$notes_file" ]; then
  if [ "$init_notes" = true ]; then
    if [ "$dry_run" = true ]; then
      echo "[dry-run] node scripts/create-release-notes.mjs --version $version"
      echo "[dry-run] Edit $notes_file, remove the draft status, then re-run create-github-release."
      exit 0
    fi
    node "$REPO_ROOT/scripts/create-release-notes.mjs" --version "$version"
    echo "Created release notes at $notes_file"
    echo "Edit the notes, remove or update the draft status, then re-run create-github-release."
    exit 1
  fi
  echo "Error: release notes file not found at $notes_file." >&2
  echo "Create it with: pnpm release:notes -- --version $version" >&2
  exit 1
fi

if [ "$allow_draft_notes" != true ] && grep -Eiq '^> Status:[[:space:]]*Draft[[:space:]]*$' "$notes_file"; then
  echo "Error: release notes are still marked as draft in $notes_file." >&2
  echo "Edit the notes and remove or update '> Status: Draft' before creating the GitHub release." >&2
  exit 1
fi

if [ "${GITHUB_ACTIONS:-}" = "true" ] && [ -z "${PUBLISH_REMOTE:-}" ] && git_remote_exists origin; then
  PUBLISH_REMOTE=origin
fi
PUBLISH_REMOTE="$(resolve_release_remote)"
if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh CLI is required to create GitHub releases." >&2
  exit 1
fi

GITHUB_REPO="$(github_repo_from_remote "$PUBLISH_REMOTE" || true)"
if [ -z "$GITHUB_REPO" ]; then
  echo "Error: could not determine GitHub repository from remote $PUBLISH_REMOTE." >&2
  exit 1
fi

if ! git -C "$REPO_ROOT" rev-parse "$tag" >/dev/null 2>&1; then
  echo "Error: local git tag $tag does not exist." >&2
  exit 1
fi

if [ "$dry_run" = true ]; then
  echo "[dry-run] gh release create $tag -R $GITHUB_REPO --title $tag --notes-file $notes_file"
  exit 0
fi

if ! git -C "$REPO_ROOT" ls-remote --exit-code --tags "$PUBLISH_REMOTE" "refs/tags/$tag" >/dev/null 2>&1; then
  echo "Error: remote tag $tag was not found on $PUBLISH_REMOTE. Push the release commit and tag first." >&2
  exit 1
fi

if gh release view "$tag" -R "$GITHUB_REPO" >/dev/null 2>&1; then
  gh release edit "$tag" -R "$GITHUB_REPO" --title "$tag" --notes-file "$notes_file"
  echo "Updated GitHub Release $tag"
else
  gh release create "$tag" -R "$GITHUB_REPO" --title "$tag" --notes-file "$notes_file"
  echo "Created GitHub Release $tag"
fi
