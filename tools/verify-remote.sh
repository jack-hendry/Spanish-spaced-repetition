#!/bin/bash
set -euo pipefail

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Parse arguments
BASE="${1:?usage: verify-remote.sh <base-url> <user:pass>}"
AUTH="${2:?usage: verify-remote.sh <base-url> <user:pass>}"

# Validate BASE starts with http:// or https://
if ! [[ "$BASE" =~ ^https?:// ]]; then
  echo "Error: BASE must start with http:// or https://" >&2
  exit 1
fi

# Helper function to check assertion
assert_code() {
  local description="$1"
  local expected="$2"
  local actual="$3"

  if [ "$actual" = "$expected" ]; then
    echo -e "${GREEN}✓${NC} $description → $actual"
    return 0
  else
    echo -e "${RED}✗${NC} $description → $actual (expected $expected)"
    return 1
  fi
}

PASSED=0
FAILED=0

echo "=== REMOTE VERIFICATION MATRIX ==="
echo "Testing: $BASE"
echo

# Unauthenticated tests (should all be 401)
echo "Unauthenticated tests (should all be 401):"
echo

# GET /
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")
if assert_code "GET /" "401" "$CODE"; then ((PASSED++)); else ((FAILED++)); fi

# GET /api/collection
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/collection")
if assert_code "GET /api/collection" "401" "$CODE"; then ((PASSED++)); else ((FAILED++)); fi

# POST /api/review
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/review")
if assert_code "POST /api/review" "401" "$CODE"; then ((PASSED++)); else ((FAILED++)); fi

# GET /media/test (generic media path, should 401)
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/media/test.json")
if assert_code "GET /media/test.json" "401" "$CODE"; then ((PASSED++)); else ((FAILED++)); fi

echo

# Unauthenticated /api/health should return 200 with exact body
echo "Unauthenticated /api/health:"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health")
if assert_code "GET /api/health" "200" "$CODE"; then ((PASSED++)); else ((FAILED++)); fi

BODY=$(curl -s "$BASE/api/health")
if [ "$BODY" = '{"ok":true}' ]; then
  echo -e "${GREEN}✓${NC} Body matches exactly"
  ((PASSED++))
else
  echo -e "${RED}✗${NC} Body does not match (expected {\"ok\":true}, got $BODY)"
  ((FAILED++))
fi

echo

# Path traversal test with --path-as-is
echo "Path traversal test (--path-as-is):"
CODE=$(curl -s --path-as-is -o /dev/null -w '%{http_code}' "$BASE/api/health/../collection")
if assert_code "curl --path-as-is '/api/health/../collection'" "401" "$CODE"; then ((PASSED++)); else ((FAILED++)); fi

echo

# HTTP → 308 redirect test (only if BASE is https)
echo "HTTP → HTTPS redirect test:"
if [[ "$BASE" == https://* ]]; then
  HTTP_BASE="${BASE//https:/http:}"
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$HTTP_BASE")
  if assert_code "HTTP redirect (no follow)" "308" "$CODE"; then ((PASSED++)); else ((FAILED++)); fi
else
  echo "Skipping HTTP→308 test (BASE is already http://)"
fi

echo

# CORS check (should be absent)
echo "CORS check (access-control-allow-origin should be absent):"
CORS=$(curl -s -i "$BASE/api/health" 2>&1 | grep -ic "^access-control-allow-origin" || true)
if [ "$CORS" -eq 0 ]; then
  echo -e "${GREEN}✓${NC} access-control-allow-origin is absent"
  ((PASSED++))
else
  echo -e "${RED}✗${NC} access-control-allow-origin header is present (security issue!)"
  ((FAILED++))
fi

echo

# Authenticated tests
echo "Authenticated tests (with -u <user:pass>):"
echo

# GET /
CODE=$(curl -s -u "$AUTH" -o /dev/null -w '%{http_code}' "$BASE/")
if assert_code "GET /" "200" "$CODE"; then ((PASSED++)); else ((FAILED++)); fi

BODY=$(curl -s -u "$AUTH" "$BASE/")
if echo "$BODY" | grep -q '<app-root'; then
  echo -e "${GREEN}✓${NC} GET / contains <app-root"
  ((PASSED++))
else
  echo -e "${RED}✗${NC} GET / does not contain <app-root"
  ((FAILED++))
fi

echo

# GET /api/collection
CODE=$(curl -s -u "$AUTH" -o /dev/null -w '%{http_code}' "$BASE/api/collection")
if assert_code "GET /api/collection" "200" "$CODE"; then ((PASSED++)); else ((FAILED++)); fi

echo

# GET /study/somedeckid (SPA fallback)
CODE=$(curl -s -u "$AUTH" -o /dev/null -w '%{http_code}' "$BASE/study/somedeckid")
if assert_code "GET /study/somedeckid" "200" "$CODE"; then ((PASSED++)); else ((FAILED++)); fi

BODY=$(curl -s -u "$AUTH" "$BASE/study/somedeckid")
if echo "$BODY" | grep -q '<app-root'; then
  echo -e "${GREEN}✓${NC} GET /study/somedeckid contains <app-root"
  ((PASSED++))
else
  echo -e "${RED}✗${NC} GET /study/somedeckid does not contain <app-root"
  ((FAILED++))
fi

echo

# POST /api/import (should be 404)
CODE=$(curl -s -u "$AUTH" -o /dev/null -w '%{http_code}' -X POST "$BASE/api/import")
if assert_code "POST /api/import" "404" "$CODE"; then ((PASSED++)); else ((FAILED++)); fi

echo

# Path traversal with URL encoding (should not be 200)
echo "Path traversal test (URL encoded):"
CODE=$(curl -s -u "$AUTH" -o /dev/null -w '%{http_code}' "$BASE/media/%2e%2e%2fcards.json")
if [ "$CODE" = "200" ]; then
  echo -e "${RED}✗${NC} GET /media/%2e%2e%2fcards.json returned 200 (security issue!)"
  ((FAILED++))
else
  echo -e "${GREEN}✓${NC} GET /media/%2e%2e%2fcards.json did not return 200 (got $CODE)"
  ((PASSED++))
fi

echo
echo "=== END OF VERIFICATION MATRIX ==="
echo
echo "Results: $PASSED passed, $FAILED failed against $BASE"

if [ "$FAILED" -gt 0 ]; then
  exit 1
else
  exit 0
fi
