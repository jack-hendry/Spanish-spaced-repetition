#!/usr/bin/env bash

set -euo pipefail

# Push scheduling state from local data directory to Fly.io volume
# Usage: push-fly-state.sh [--app <app-name>] [--yes] [<source-dir>]
# Default app name: spanish-srs
# Default source: data/spanish
# DANGEROUS: Overwrites the only remote copy of scheduling state. Requires --yes.

APP_NAME="spanish-srs"
SOURCE_DIR="data/spanish"
CONFIRMED=0
POSITIONAL_ARGS=0

# Parse options
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      APP_NAME="$2"
      shift 2
      ;;
    --yes)
      CONFIRMED=1
      shift
      ;;
    -*)
      echo "Error: Unknown option '$1'" >&2
      exit 1
      ;;
    *)
      ((POSITIONAL_ARGS++))
      if [[ $POSITIONAL_ARGS -gt 1 ]]; then
        echo "Error: Only one positional argument (source dir) allowed" >&2
        exit 1
      fi
      SOURCE_DIR="$1"
      shift
      ;;
  esac
done

# Files to push to Fly volume
declare -a FILES=(
  "collection.json"
  "notetypes.json"
  "decks.json"
  "deckoptions.json"
  "notes.json"
  "cards.json"
  "revlog.ndjson"
)

# Validate local store before attempting push
validate_local_store() {
  # Check all files exist and are non-empty
  for file in "${FILES[@]}"; do
    local_path="$SOURCE_DIR/$file"

    if [[ ! -f "$local_path" ]]; then
      echo "Error: Local file missing: $local_path" >&2
      return 1
    fi

    if [[ ! -s "$local_path" ]]; then
      echo "Error: Local file is empty (zero-length): $local_path" >&2
      return 1
    fi
  done

  # Verify JSON files parse (optional, degrade gracefully if node unavailable)
  for file in collection.json notetypes.json decks.json deckoptions.json notes.json cards.json; do
    local_path="$SOURCE_DIR/$file"

    if command -v node &>/dev/null; then
      if ! node -e "JSON.parse(require('fs').readFileSync('$local_path', 'utf8'))" 2>/dev/null; then
        echo "Error: Local file is not valid JSON: $local_path" >&2
        return 1
      fi
    fi
  done

  # Verify JSON arrays are non-empty for cards and notes
  for file in cards.json notes.json; do
    local_path="$SOURCE_DIR/$file"

    if command -v node &>/dev/null; then
      # Use a simple arithmetic check rather than parsing length, avoiding console.log color codes
      # Test: does the array have at least one element?
      if ! node -e "
        const arr = JSON.parse(require('fs').readFileSync('$local_path', 'utf8'));
        if (!Array.isArray(arr) || arr.length === 0) { process.exit(1); }
      " 2>/dev/null; then
        echo "Error: Local $file is empty or not an array (would destroy remote scheduling state)" >&2
        return 1
      fi
    fi
  done
}

# Print plan without --yes
print_plan() {
  echo "=== PUSH PLAN (dry run) ==="
  echo "App name: $APP_NAME"
  echo "Source directory: $SOURCE_DIR"
  echo ""
  echo "Files to push (${#FILES[@]} total):"
  echo ""

  local total_size=0
  for file in "${FILES[@]}"; do
    local_path="$SOURCE_DIR/$file"
    if [[ -f "$local_path" ]]; then
      local size
      size=$(stat -f%z "$local_path" 2>/dev/null || stat -c%s "$local_path" 2>/dev/null || echo "?")
      echo "  $file: $size bytes"
      if [[ "$size" != "?" ]]; then
        total_size=$((total_size + size))
      fi
    fi
  done

  echo ""
  echo "Total local size: $total_size bytes"
  echo ""
  echo "Remote destination: /data/spanish/ (Fly.io volume)"
  echo ""
  echo "To confirm and push, run: $0 --yes"
  echo ""
}

# Get remote file size (may not be available; degrade gracefully)
get_remote_size() {
  local remote_file="$1"
  # Try to get remote file size via sftp stat, but don't fail if it's not available
  fly ssh sftp stat "$remote_file" --app "$APP_NAME" 2>/dev/null | grep "Size:" | awk '{print $2}' || echo "?"
}

# Main validation
if ! validate_local_store; then
  exit 1
fi

# If --yes not provided, print plan and exit
if [[ $CONFIRMED -eq 0 ]]; then
  print_plan
  echo "SAFETY: Not pushing without --yes flag. Nothing written."
  exit 1
fi

# Create remote staging directory on the volume (not container's /tmp).
# The remote staging dir must live on the volume because /tmp is on the container's
# ephemeral root filesystem, a different device from /data. A move from /tmp to /data
# is a copy-then-unlink (non-atomic), risking a half-written remote store if push fails.
# Staging on the volume ensures mv is a true atomic rename.
REMOTE_STAGE_DIR="/data/.push-stage.$(date +%s)-$$"

# Trap to clean up remote staging dir on all exit paths
trap "fly ssh console --app '$APP_NAME' -C \"/bin/sh -c 'rm -rf \\\"$REMOTE_STAGE_DIR\\\"'\" 2>/dev/null || true" EXIT

echo "=== PUSH DETAILS ==="
echo "App name: $APP_NAME"
echo "Source directory: $SOURCE_DIR"
echo "Remote staging directory: $REMOTE_STAGE_DIR"
echo ""
echo "Local file sizes:"
echo ""

local_total=0
for file in "${FILES[@]}"; do
  local_path="$SOURCE_DIR/$file"
  if [[ -f "$local_path" ]]; then
    local size
    size=$(stat -f%z "$local_path" 2>/dev/null || stat -c%s "$local_path" 2>/dev/null || echo "?")
    echo "  $file: $size bytes"
    if [[ "$size" != "?" ]]; then
      local_total=$((local_total + size))
    fi
  fi
done

echo ""
echo "Total local size: $local_total bytes"
echo ""
echo "Pushing to Fly.io app '$APP_NAME'..."
echo ""

# Create remote staging directory
fly ssh console --app "$APP_NAME" -C "/bin/sh -c 'mkdir -p \"$REMOTE_STAGE_DIR\"'" || {
  echo "Error: Failed to create remote staging directory" >&2
  exit 1
}

# Upload all files to remote staging directory
uploaded=0
for file in "${FILES[@]}"; do
  local_path="$SOURCE_DIR/$file"
  remote_path="$REMOTE_STAGE_DIR/$file"

  fly ssh sftp put "$local_path" "$remote_path" \
    --app "$APP_NAME" \
    || {
      echo "Error: Failed to upload $file to Fly volume" >&2
      exit 1
    }

  n=$((uploaded + 1))
  uploaded=$n
done

echo "Uploaded $uploaded/${#FILES[@]} files to remote staging"
echo ""

# Verify all files arrived and are non-empty on remote
echo "Verifying remote staging files..."
for file in "${FILES[@]}"; do
  remote_path="$REMOTE_STAGE_DIR/$file"

  # Check if file exists and is non-empty.
  # Assumes `fly ssh console -C` propagates the remote exit code; unverified until
  # a deployment exists — confirm at Step 18.
  if ! fly ssh console --app "$APP_NAME" -C "test -s '$remote_path'" 2>/dev/null; then
    echo "Error: Remote file missing or empty: $remote_path" >&2
    exit 1
  fi
done

echo "All remote staging files verified (exist and non-empty)"
echo ""

# Print current remote sizes for comparison
echo "Current remote file sizes:"
echo ""
remote_total=0
for file in "${FILES[@]}"; do
  remote_path="/data/spanish/$file"
  size=$(get_remote_size "$remote_path")
  echo "  $file: $size bytes"
  if [[ "$size" != "?" ]]; then
    remote_total=$((remote_total + size))
  fi
done

if [[ $remote_total -ne 0 ]]; then
  echo ""
  echo "Total current remote size: $remote_total bytes"
fi

echo ""
echo "Moving staged files into place on remote..."
echo ""

# Move files from staging to final destination
for file in "${FILES[@]}"; do
  staged_path="$REMOTE_STAGE_DIR/$file"
  final_path="/data/spanish/$file"

  fly ssh console --app "$APP_NAME" -C "mv '$staged_path' '$final_path'" || {
    echo "Error: Failed to move $file into place" >&2
    exit 1
  }
done

echo "Successfully pushed ${#FILES[@]} state files to Fly app '$APP_NAME'"
echo ""
echo "Remote files updated:"
for file in "${FILES[@]}"; do
  echo "  /data/spanish/$file"
done
