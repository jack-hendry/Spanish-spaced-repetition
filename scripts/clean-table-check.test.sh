#!/usr/bin/env bash
# Regression matrix for gate 5 of clean-table-check.sh -- the rule that every
# '### Step' in a live tasks.md carries a '**Status:**' line.
#
# Gate 5 is the only gate that reads inside a file's content rather than just
# its path and size, so its failure modes are invisible to the other jobs: an
# over-tight matcher blocks every legitimate push that touches a tasks.md, and
# a loose one lets a half-marked run through as if it were complete. Both
# cases live here.
#
# Everything runs in a throwaway repo under mktemp -- nothing touches the repo
# this is invoked from.
#
# Usage: scripts/clean-table-check.test.sh [path-to-clean-table-check.sh]
set -uo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/clean-table-check.sh}"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
cd "$T" || exit 1

git init -q .
git config user.email t@t.t
git config user.name t
mkdir -p scripts specs/014-demo specs/archive/2026-01-01-old
cp "$SCRIPT" scripts/clean-table-check.sh

# Baseline: an already-archived spec whose tasks.md predates the Status:
# convention, so the exemption cases below are MODIFY, not ADD, and cannot be
# confounded by gate 1 (the archive gate).
cat >specs/archive/2026-01-01-old/tasks.md <<'EOF'
### Step 1 — historical, no Status field existed yet

**Model:** haiku
EOF
mkdir -p specs && printf '# STATE\n' >specs/STATE.md
echo x >README.md
git add -A && git commit -qm base

pass=0
fail=0
OUT="$T/out"

check() { # name expected_exit actual_exit
  if [[ "$2" == "$3" ]]; then echo "  PASS  $1"; pass=$((pass + 1));
  else
    echo "  FAIL  $1 (expected exit $2, got $3)"; fail=$((fail + 1))
    sed 's/^/          | /' "$OUT"
  fi
}
run() { RANGE_OVERRIDE="$1" bash scripts/clean-table-check.sh >"$OUT" 2>&1; echo $?; }

# --- Case 1: compliant tasks.md -> pass
cat >specs/014-demo/tasks.md <<'EOF'
### Step 1 — do a thing

**Model:** haiku

**Status:** not started

### Step 2 — do another

**Model:** haiku

**Status:** done (2026-08-27, `commit abc1234`)
EOF
git add -A && git commit -qm c1
check "compliant tasks.md passes" 0 "$(run 'HEAD~1..HEAD')"

# --- Case 2: a step with no Status -> fail, and name it
cat >specs/014-demo/tasks.md <<'EOF'
### Step 1 — do a thing

**Model:** haiku

**Status:** not started

### Step 2 — no status here

**Model:** haiku
EOF
git add -A && git commit -qm c2
check "missing Status on one step fails" 1 "$(run 'HEAD~1..HEAD')"
if grep -q 'Step 2 — no status here' "$OUT"; then
  echo "  PASS  names the offending step"; pass=$((pass + 1))
else
  echo "  FAIL  did not name the offending step"; fail=$((fail + 1)); sed 's/^/          | /' "$OUT"
fi

# --- Case 3: N status lines bunched into one step -> still fails
cat >specs/014-demo/tasks.md <<'EOF'
### Step 1 — hoards both statuses

**Model:** haiku

**Status:** not started
**Status:** done (2026-08-27, x)

### Step 2 — starved

**Model:** haiku
EOF
git add -A && git commit -qm c3
check "count parity alone does not satisfy the gate" 1 "$(run 'HEAD~1..HEAD')"

# --- Case 4: MODIFYING an archived tasks.md with no Status lines -> exempt
cat >specs/014-demo/tasks.md <<'EOF'
### Step 1 — fine

**Model:** haiku

**Status:** done (2026-08-27, x)
EOF
cat >>specs/archive/2026-01-01-old/tasks.md <<'EOF'

### Step 2 — appended, still no Status
**Model:** haiku
EOF
git add -A && git commit -qm c4
check "modifying an archived tasks.md is exempt" 0 "$(run 'HEAD~1..HEAD')"

# --- Case 5: ARCHIVING a live spec (rename into specs/archive/) -> exempt
cat >specs/014-demo/tasks.md <<'EOF'
### Step 1 — about to be archived, no Status

**Model:** haiku
EOF
git add -A && git commit -qm c5-pre >/dev/null 2>&1 || true
mkdir -p specs/archive/2026-02-02-demo
git mv specs/014-demo/tasks.md specs/archive/2026-02-02-demo/tasks.md
printf '# STATE\nupdated\n' >specs/STATE.md
git add -A && git commit -qm c5
check "archiving a spec does not demand a retrofit" 0 "$(run 'HEAD~1..HEAD')"

# --- Case 6: deleting a live tasks.md -> nothing to check
mkdir -p specs/015-tmp
printf '### Step 1 — x\n\n**Model:** haiku\n\n**Status:** not started\n' >specs/015-tmp/tasks.md
git add -A && git commit -qm c6-pre
git rm -q specs/015-tmp/tasks.md
git commit -qm c6
check "deleted tasks.md does not trip the gate" 0 "$(run 'HEAD~1..HEAD')"

# --- Case 7: a tasks.md with no '### Step' headers at all -> passes
mkdir -p specs/012-legacy
printf 'T001 old format, no step headers.\n' >specs/012-legacy/tasks.md
git add -A && git commit -qm c7
check "stepless tasks.md passes" 0 "$(run 'HEAD~1..HEAD')"

echo ""
echo "gate5: ${pass} passed, ${fail} failed"
[[ "$fail" -eq 0 ]]
