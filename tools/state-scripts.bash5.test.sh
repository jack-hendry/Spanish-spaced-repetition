#!/usr/bin/env bash
# Regression matrix for push-fly-state.sh and pull-fly-state.sh under bash 5.
#
# Steps 1-2 fixed these scripts for bash 5 compatibility:
# - Step 1: removed `local` from a top-level context
# - Step 2: replaced ((VAR++)) with VAR=$((VAR+1)) to avoid post-increment
#   status-1 under set -e in bash 5+
#
# This script validates those fixes against the no-network paths: argument
# parsing, validation errors, and dry-run. Each test case runs in a throwaway
# fixture directory, leaving the real data/spanish/ untouched.
#
# Usage: tools/state-scripts.bash5.test.sh
set -uo pipefail

PUSH_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/push-fly-state.sh"
PULL_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pull-fly-state.sh"

echo "bash --version"
bash --version | head -1
echo ""

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
cd "$T" || exit 1

pass=0
fail=0

check() { # name expected_exit actual_exit [message_pattern]
  local name="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    echo "  PASS  $name"
    pass=$((pass + 1))
  else
    echo "  FAIL  $name (expected exit $expected, got $actual)"
    fail=$((fail + 1))
  fi
}

check_output() { # name pattern output
  local name="$1" pattern="$2" output="$3"
  if [[ "$output" =~ $pattern ]]; then
    echo "  PASS  $name"
    pass=$((pass + 1))
  else
    echo "  FAIL  $name (pattern '$pattern' not found in output)"
    fail=$((fail + 1))
  fi
}

check_output_not() { # name pattern output
  local name="$1" pattern="$2" output="$3"
  if [[ ! "$output" =~ $pattern ]]; then
    echo "  PASS  $name"
    pass=$((pass + 1))
  else
    echo "  FAIL  $name (pattern '$pattern' should not be in output)"
    fail=$((fail + 1))
  fi
}

# ===== PULL-FLY-STATE.SH TESTS =====

echo "pull-fly-state.sh:"

# Case 1: Unknown flag
output=$("$PULL_SCRIPT" --unknown 2>&1)
rc=$?
check "unknown flag exits 1" "1" "$rc"
check_output "unknown flag error message" "Unknown option" "$output"

# Case 2: Two positional args
fixture1="$T/fixture1"
fixture2="$T/fixture2"
mkdir -p "$fixture1" "$fixture2"
output=$("$PULL_SCRIPT" "$fixture1" "$fixture2" 2>&1)
rc=$?
check "two positional args exits 1" "1" "$rc"
check_output "two positional args error message" "Only one positional argument" "$output"

# ===== PUSH-FLY-STATE.SH VALIDATION & DRY-RUN TESTS =====

echo ""
echo "push-fly-state.sh:"

# Build a complete, minimal fixture store for later tests
make_fixture() { # target_dir
  local dir="$1"
  mkdir -p "$dir"
  echo '{"foo":"bar"}' >"$dir/collection.json"
  echo '[]' >"$dir/notetypes.json"
  echo '{}' >"$dir/decks.json"
  echo '{}' >"$dir/deckoptions.json"
  echo '[{"id":"1"}]' >"$dir/notes.json"
  echo '[{"id":"1"}]' >"$dir/cards.json"
  echo '{}' >"$dir/revlog.ndjson"
}

# Case 3: Unknown flag
output=$("$PUSH_SCRIPT" --unknown 2>&1)
rc=$?
check "unknown flag exits 1" "1" "$rc"
check_output "unknown flag error message" "Unknown option" "$output"

# Case 4: Two positional args
fixture3="$T/fixture3"
fixture4="$T/fixture4"
mkdir -p "$fixture3" "$fixture4"
output=$("$PUSH_SCRIPT" "$fixture3" "$fixture4" 2>&1)
rc=$?
check "two positional args exits 1" "1" "$rc"
check_output "two positional args error message" "Only one positional argument" "$output"

# Case 5: Missing file validation
fixture5="$T/fixture5"
mkdir -p "$fixture5"
echo '{"foo":"bar"}' >"$fixture5/collection.json"
# Leave other files missing
output=$("$PUSH_SCRIPT" "$fixture5" 2>&1)
rc=$?
check "missing file exits 1" "1" "$rc"
check_output "missing file error" "missing:" "$output"

# Case 6: Zero-length file validation
fixture6="$T/fixture6"
make_fixture "$fixture6"
: >"$fixture6/cards.json"  # truncate to zero length
output=$("$PUSH_SCRIPT" "$fixture6" 2>&1)
rc=$?
check "zero-length file exits 1" "1" "$rc"
check_output "zero-length file error" "empty|zero-length" "$output"

# Case 7: cards.json as empty array [] validation
fixture7="$T/fixture7"
make_fixture "$fixture7"
echo '[]' >"$fixture7/cards.json"  # empty array
output=$("$PUSH_SCRIPT" "$fixture7" 2>&1)
rc=$?
check "empty cards.json array exits 1" "1" "$rc"
check_output "empty array error" "destroy remote|would destroy|empty or not an array" "$output"

# Case 8: Dry-run plan path (no --yes)
fixture8="$T/fixture8"
make_fixture "$fixture8"
output=$("$PUSH_SCRIPT" "$fixture8" 2>&1)
rc=$?
check "dry-run (no --yes) exits 1" "1" "$rc"
check_output "dry-run prints PUSH PLAN" "PUSH PLAN" "$output"
check_output "dry-run prints total size" "Total local size" "$output"
check_output "dry-run says not pushing" "Not pushing without --yes" "$output"

# Case 9: Step 1 regression — --yes against bogus app, must NOT contain "can only be used in a function"
# This exercises the top-level code path that Step 1 fixed. The push will fail
# (no fly binary, or invalid app), but that's expected — we're checking for the
# bash syntax error that Step 1 fixed.
#
# CRITICAL: An absence assertion ("does not contain X") proves nothing unless we
# independently establish that (a) the output is non-empty and (b) execution
# actually reached the code path being tested. If validation fails or the script
# bails early, the output also lacks "can only be used in a function" and the
# test passes vacuously. Per L-019, we need positive controls.
#
# Positive controls: "Local file sizes:" is printed by the top-level loop
# immediately above the line Step 1 fixed, so its presence proves entry to that
# code path. "Total local size" is printed at the end of the loop, proving it
# ran to completion. On CI, there is no `fly` binary, so the fly-error path
# cannot be the proof of reachability — these controls must carry that weight.
fixture9="$T/fixture9"
make_fixture "$fixture9"
output=$("$PUSH_SCRIPT" --app bogus-app-xyz-nonexistent --yes "$fixture9" 2>&1)
rc=$?
# Positive control 1: loop entry proof
check_output "Step 1 regression positive control 1 (loop entered)" "Local file sizes:" "$output"
# Positive control 2: loop completion proof
check_output "Step 1 regression positive control 2 (loop completed)" "Total local size:" "$output"
# Absence assertion: the actual regression test
check_output_not "Step 1 regression: no 'can only be used in a function'" "can only be used in a function" "$output"
# Tolerate missing fly binary gracefully: if the output says "fly: command not found"
# or similar, that's fine — we're testing the bash syntax, not fly availability.
if [[ "$output" =~ "fly: command not found" ]] || [[ "$output" =~ "command not found: fly" ]]; then
  echo "  (fly binary not available; regression test valid via positive controls)"
fi

echo ""
echo "state-scripts.bash5.test: ${pass} passed, ${fail} failed"
[[ "$fail" -eq 0 ]]
