#!/usr/bin/env bash
# Regression matrix for tools/archive_spec.py -- the executable half of
# CLAUDE.md's archive ritual (steps 3 and 4).
#
# The failure modes worth pinning are the quiet ones. This script MOVES and
# DELETES spec content, so the cases that matter are: a dry run that writes
# anyway, a prune that drops a section it was not asked to, a file reported
# clean while still over the 20 KB push gate, and an already-archived folder
# being archived twice. All four are invisible until a push is refused or a
# spec is silently half-gone, so they live here.
#
# Everything runs in a throwaway repo under mktemp -- nothing touches the repo
# this is invoked from.
#
# Usage: tools/archive_spec.test.sh [path-to-archive_spec.py]
set -uo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/archive_spec.py}"
SCRIPT="$(cd "$(dirname "$SCRIPT")" && pwd)/$(basename "$SCRIPT")"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
cd "$T" || exit 1

git init -q .
git config user.email t@t.t
git config user.name t

pass=0
fail=0

check() { # name expected actual
  if [[ "$2" == "$3" ]]; then
    echo "  PASS  $1"
    pass=$((pass + 1))
  else
    echo "  FAIL  $1 (expected '$2', got '$3')"
    fail=$((fail + 1))
  fi
}

filler() { # count prefix
  local i
  for ((i = 1; i <= $1; i++)); do
    printf '%s line %d with enough text on it to move the byte count along.\n' "$2" "$i"
  done
}

# An Analyst.md that is over the cap and STAYS over it after pruning -- the
# case the script must report rather than quietly accept.
big_analyst() { # path
  {
    printf '# Analyst — demo\n\nIntro that must survive.\n\n## 1. Problem\n\n'
    filler 400 Filler
    printf '\n## 6. How do we know it is done?\n\n'
    filler 60 Donewhen
    printf '\n## 9. Retrospective\n\n'
    filler 120 Retro
  } >"$1"
}

# Over the cap, but pruning brings it under.
trimmable_analyst() { # path
  {
    printf '# Analyst — demo\n\nIntro that must survive.\n\n## 1. Problem\n\n'
    filler 200 Filler
    printf '\n## 9. Retrospective\n\n'
    filler 200 Retro
  } >"$1"
}

new_spec() { # dirname  -- fresh checkout state for each case
  rm -rf specs
  mkdir -p "specs/$1" specs/archive
  printf '# STATE\n' >specs/STATE.md
  git add -A >/dev/null 2>&1
  git commit -qm "base $1" >/dev/null 2>&1
}

echo "archive_spec.test: matrix"

# --- 1. Dry run writes nothing --------------------------------------------
new_spec 021-demo
trimmable_analyst specs/021-demo/Analyst.md
git add -A >/dev/null && git commit -qm add >/dev/null
python3 "$SCRIPT" 021-demo --date 2026-01-02 >/dev/null 2>&1
check "dry run leaves the spec in place" "yes" "$([[ -f specs/021-demo/Analyst.md ]] && echo yes || echo no)"
check "dry run creates no archive folder" "no" "$([[ -d specs/archive/2026-01-02-021-demo ]] && echo yes || echo no)"

# --- 2. --apply moves, prunes, and reports still-over ----------------------
new_spec 022-demo
big_analyst specs/022-demo/Analyst.md
printf '# Critic\n\nshort\n' >specs/022-demo/CriticReview.md
filler 600 Task >specs/022-demo/tasks.md
git add -A >/dev/null && git commit -qm add >/dev/null
before=$(wc -c <specs/022-demo/Analyst.md)
python3 "$SCRIPT" 022-demo --date 2026-01-02 --apply >"$T/out" 2>&1
rc=$?
check "still-over-cap exits 1" "1" "$rc"
check "archive folder created" "yes" "$([[ -d specs/archive/2026-01-02-022-demo ]] && echo yes || echo no)"
check "source folder gone" "no" "$([[ -d specs/022-demo ]] && echo yes || echo no)"
check "oversized tasks.md dropped" "no" \
  "$([[ -f specs/archive/2026-01-02-022-demo/tasks.md ]] && echo yes || echo no)"
check "under-cap file moved" "yes" \
  "$([[ -f specs/archive/2026-01-02-022-demo/CriticReview.md ]] && echo yes || echo no)"
after=$(wc -c <specs/archive/2026-01-02-022-demo/Analyst.md)
check "pruned file got smaller" "yes" "$([[ $after -lt $before ]] && echo yes || echo no)"
check "still-over-cap is reported" "yes" \
  "$(grep -q 'STILL OVER THE CAP' "$T/out" && echo yes || echo no)"
check "moves are staged" "yes" \
  "$(git diff --cached --name-only | grep -q '2026-01-02-022-demo' && echo yes || echo no)"

# --- 3. Pruning drops only the named sections -----------------------------
body="specs/archive/2026-01-02-022-demo/Analyst.md"
check "H1 kept" "yes" "$(grep -q '^# Analyst' "$body" && echo yes || echo no)"
check "intro kept" "yes" "$(grep -q 'Intro that must survive' "$body" && echo yes || echo no)"
check "unnamed section kept" "yes" "$(grep -q '^## 1. Problem' "$body" && echo yes || echo no)"
check "retrospective dropped" "no" "$(grep -q '^## 9. Retrospective' "$body" && echo yes || echo no)"
# Anchored to '^## ' on purpose: the abridged notice NAMES the sections it
# removed, so an unanchored grep for the heading text matches the notice and
# reports the section as surviving. Assert on headings, not on prose.
check "done-when dropped" "no" "$(grep -q '^## 6. How do we know' "$body" && echo yes || echo no)"
check "retro body dropped too" "no" "$(grep -q 'Retro line 5' "$body" && echo yes || echo no)"
check "abridged notice added" "yes" "$(grep -q 'Abridged when archived' "$body" && echo yes || echo no)"

# --- 4. Prune that gets under the cap exits 0 -----------------------------
new_spec 023-demo
trimmable_analyst specs/023-demo/Analyst.md
git add -A >/dev/null && git commit -qm add >/dev/null
python3 "$SCRIPT" 023-demo --date 2026-01-02 --apply >/dev/null 2>&1
check "pruned under cap exits 0" "0" "$?"
size=$(wc -c <specs/archive/2026-01-02-023-demo/Analyst.md)
check "result is under the 20480 cap" "yes" "$([[ $size -le 20480 ]] && echo yes || echo no)"

# --- 5. Under-cap files are moved byte-identical --------------------------
new_spec 024-demo
printf '# Analyst\n\n## 9. Retrospective\n\nkept because the file is small.\n' \
  >specs/024-demo/Analyst.md
git add -A >/dev/null && git commit -qm add >/dev/null
sum_before=$(cksum <specs/024-demo/Analyst.md)
python3 "$SCRIPT" 024-demo --date 2026-01-02 --apply >/dev/null 2>&1
sum_after=$(cksum <specs/archive/2026-01-02-024-demo/Analyst.md)
check "small file untouched (retrospective survives)" "$sum_before" "$sum_after"

# --- 6. --keep-tasks overrides the drop -----------------------------------
new_spec 025-demo
printf '# Analyst\n\nsmall\n' >specs/025-demo/Analyst.md
filler 600 Task >specs/025-demo/tasks.md
git add -A >/dev/null && git commit -qm add >/dev/null
python3 "$SCRIPT" 025-demo --date 2026-01-02 --apply --keep-tasks >/dev/null 2>&1
check "--keep-tasks keeps an oversized tasks.md" "yes" \
  "$([[ -f specs/archive/2026-01-02-025-demo/tasks.md ]] && echo yes || echo no)"

# --- 7. Refusals -----------------------------------------------------------
new_spec 026-demo
printf '# Analyst\n\nsmall\n' >specs/026-demo/Analyst.md
git add -A >/dev/null && git commit -qm add >/dev/null

python3 "$SCRIPT" 026-demo --date not-a-date --apply >/dev/null 2>&1
check "bad --date refused" "1" "$?"

python3 "$SCRIPT" nonexistent-spec --apply >/dev/null 2>&1
check "missing spec refused" "1" "$?"

mkdir -p specs/archive/2026-01-02-026-demo
python3 "$SCRIPT" 026-demo --date 2026-01-02 --apply >/dev/null 2>&1
check "existing target refused" "1" "$?"
check "refusal left the spec alone" "yes" \
  "$([[ -f specs/026-demo/Analyst.md ]] && echo yes || echo no)"

python3 "$SCRIPT" specs/archive/2026-01-02-026-demo --apply >/dev/null 2>&1
check "already-archived folder refused" "1" "$?"

echo ""
echo "archive_spec.test: ${pass} passed, ${fail} failed"
[[ "$fail" -eq 0 ]]
