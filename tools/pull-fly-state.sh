#!/usr/bin/env bash

set -euo pipefail

# Pull scheduling state from Fly.io to local data directory
# Usage: pull-fly-state.sh [--app <app-name>] [<destination-dir>]
# Default app name: spanish-srs
# Default destination: data/spanish

APP_NAME="spanish-srs"
DEST_DIR="data/spanish"
POSITIONAL_ARGS=0

# Parse options
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      APP_NAME="$2"
      shift 2
      ;;
    -*)
      echo "Error: Unknown option '$1'" >&2
      exit 1
      ;;
    *)
      ((POSITIONAL_ARGS++))
      if [[ $POSITIONAL_ARGS -gt 1 ]]; then
        echo "Error: Only one positional argument (destination dir) allowed" >&2
        exit 1
      fi
      DEST_DIR="$1"
      shift
      ;;
  esac
done

# Files to pull from Fly volume
declare -a FILES=(
  "collection.json"
  "notetypes.json"
  "decks.json"
  "deckoptions.json"
  "notes.json"
  "cards.json"
  "revlog.ndjson"
)

# Create destination directory if it doesn't exist
mkdir -p "$DEST_DIR"

# Create staging directory on the same filesystem as destination for atomic moves.
# mktemp -d without arguments uses /tmp, which may be on a different volume.
# Cross-filesystem moves are copy-then-unlink, not atomic renames, risking a
# half-written state (e.g., new cards.json beside stale revlog.ndjson).
# Staging in the destination's parent directory ensures mv is a true rename.
STAGE_DIR=$(mktemp -d "$(dirname "$DEST_DIR")/.pull-fly-state.XXXXXX")
trap 'rm -rf "$STAGE_DIR"' EXIT

# Download all files to staging directory
for file in "${FILES[@]}"; do
  remote_path="/data/spanish/$file"
  local_path="$STAGE_DIR/$file"

  fly ssh sftp get "$remote_path" "$local_path" \
    --app "$APP_NAME" \
    || {
      echo "Error: Failed to download $file from Fly volume" >&2
      exit 1
    }
done

# Verify all files arrived and are non-empty
for file in "${FILES[@]}"; do
  local_path="$STAGE_DIR/$file"

  if [[ ! -f "$local_path" ]]; then
    echo "Error: Missing file $file after download" >&2
    exit 1
  fi

  if [[ ! -s "$local_path" ]]; then
    echo "Error: File $file is empty (zero-length)" >&2
    exit 1
  fi
done

# Verify JSON files parse (optional, degrade gracefully if node unavailable)
for file in collection.json notetypes.json decks.json deckoptions.json notes.json cards.json; do
  local_path="$STAGE_DIR/$file"

  if command -v node &>/dev/null; then
    if ! node -e "JSON.parse(require('fs').readFileSync('$local_path', 'utf8'))" 2>/dev/null; then
      echo "Error: File $file is not valid JSON" >&2
      exit 1
    fi
  fi
done

# Count updates vs unchanged files
updated=0
unchanged=0

# Move files from staging directory to destination, tracking what changed
for file in "${FILES[@]}"; do
  if [[ -f "$DEST_DIR/$file" ]] && cmp -s "$STAGE_DIR/$file" "$DEST_DIR/$file"; then
    ((unchanged++))
  else
    ((updated++))
  fi
  mv "$STAGE_DIR/$file" "$DEST_DIR/$file"
done

# Print summary of what changed
echo "Successfully pulled ${#FILES[@]} state files from Fly app '$APP_NAME': updated $updated, unchanged $unchanged"
