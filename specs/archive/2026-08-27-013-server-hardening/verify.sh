#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Setup
SCRATCH="$(mktemp -d)"
trap 'kill $SERVER_PID 2>/dev/null || true; rm -rf "$SCRATCH"' EXIT

echo "Setting up scratch directory at $SCRATCH"
cp data/spanish/*.json "$SCRATCH/"
cp data/spanish/revlog.ndjson "$SCRATCH/"
ln -s "$(pwd)/data/spanish/media" "$SCRATCH/media"

# Start server
echo "Starting server..."
DATA_DIR="$SCRATCH" AUTH_USER=testuser AUTH_PASSWORD=testpass PORT=3999 node server/dist/index.js &
SERVER_PID=$!

# Poll for health with timeout
echo "Waiting for server to start..."
MAX_ATTEMPTS=30
ATTEMPT=0
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  if curl -s http://localhost:3999/api/health >/dev/null 2>&1; then
    echo "Server is ready"
    break
  fi
  ATTEMPT=$((ATTEMPT + 1))
  sleep 0.5
done

if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
  echo "Server failed to start"
  exit 1
fi

MEDIA=$(ls data/spanish/media | head -1)
echo "Using media file: $MEDIA"
echo

# Test matrix
echo "=== VERIFICATION MATRIX ==="
echo

# Unauthenticated endpoints should return 401
echo "Unauthenticated tests (should all be 401):"

# GET /
CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3999/)
echo "GET / → $CODE"

# GET /api/collection
CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3999/api/collection)
echo "GET /api/collection → $CODE"

# POST /api/review
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3999/api/review)
echo "POST /api/review → $CODE"

# GET /media/$MEDIA
CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:3999/media/$MEDIA")
echo "GET /media/$MEDIA → $CODE"

echo

# Unauthenticated /api/health should return 200 with exact body
echo "Unauthenticated /api/health:"
CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3999/api/health)
echo "GET /api/health → $CODE"
BODY=$(curl -s http://localhost:3999/api/health)
echo "Body: $BODY"
if [ "$BODY" = '{"ok":true}' ]; then
  echo -e "${GREEN}✓ Body matches exactly${NC}"
else
  echo -e "${RED}✗ Body does not match (expected {\"ok\":true})${NC}"
fi

echo

# Path normalization test
echo "Path normalization test (--path-as-is):"
CODE=$(curl -s --path-as-is -o /dev/null -w '%{http_code}' http://localhost:3999/api/health/../collection)
echo "curl --path-as-is '/api/health/../collection' → $CODE"
if [ "$CODE" = "401" ]; then
  echo -e "${GREEN}✓ Path not normalized${NC}"
else
  echo -e "${RED}✗ Unexpected code (should be 401)${NC}"
fi

echo

# Authenticated tests
echo "Authenticated tests (with -u testuser:testpass):"

# GET /
echo "GET / → should return 200 with <app-root"
CODE=$(curl -s -u testuser:testpass -o /dev/null -w '%{http_code}' http://localhost:3999/)
echo "Status: $CODE"
BODY=$(curl -s -u testuser:testpass http://localhost:3999/)
if echo "$BODY" | grep -q '<app-root'; then
  echo -e "${GREEN}✓ Contains <app-root${NC}"
else
  echo -e "${RED}✗ Does not contain <app-root${NC}"
fi

echo

# GET /api/collection
echo "GET /api/collection:"
CODE=$(curl -s -u testuser:testpass -o /dev/null -w '%{http_code}' http://localhost:3999/api/collection)
echo "Status: $CODE"

echo

# GET /study/somedeckid → should return 200 with <app-root (SPA fallback)
echo "GET /study/somedeckid (SPA fallback):"
CODE=$(curl -s -u testuser:testpass -o /dev/null -w '%{http_code}' http://localhost:3999/study/somedeckid)
echo "Status: $CODE"
BODY=$(curl -s -u testuser:testpass http://localhost:3999/study/somedeckid)
if echo "$BODY" | grep -q '<app-root'; then
  echo -e "${GREEN}✓ Contains <app-root${NC}"
else
  echo -e "${RED}✗ Does not contain <app-root${NC}"
fi

echo

# POST /api/import → should return 404
echo "POST /api/import (should be 404):"
CODE=$(curl -s -u testuser:testpass -o /dev/null -w '%{http_code}' -X POST http://localhost:3999/api/import)
echo "Status: $CODE"

echo

# Media path with URL encoding
echo "GET /media/%2e%2e%2fcards.json (should not be 200):"
CODE=$(curl -s -u testuser:testpass -o /dev/null -w '%{http_code}' "http://localhost:3999/media/%2e%2e%2fcards.json")
echo "Status: $CODE"
if [ "$CODE" = "200" ]; then
  echo -e "${RED}✗ Returned 200 (security issue!)${NC}"
else
  echo -e "${GREEN}✓ Did not return 200${NC}"
fi

echo

echo "=== END OF VERIFICATION MATRIX ==="

# Kill server gracefully (SIGINT)
echo
echo "Shutting down server..."
kill -INT $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

# Check git status
echo
echo "=== GIT STATUS CHECK ==="
git status --short
GIT_CLEAN=$(git status --short | grep -c '^' || echo 0)
if [ "$GIT_CLEAN" -eq 0 ]; then
  echo -e "${GREEN}✓ No dirty files${NC}"
else
  DIRTY_SPANISH=$(git status --short | grep '^.*data/spanish' | wc -l)
  if [ "$DIRTY_SPANISH" -eq 0 ]; then
    echo -e "${GREEN}✓ No dirty files under data/spanish/${NC}"
  else
    echo -e "${RED}✗ Dirty files under data/spanish/${NC}"
  fi
fi
