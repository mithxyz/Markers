#!/usr/bin/env bash
# Pre-deploy gate for cue.mith.studio (markers).
# Run BEFORE every deploy. Fails fast if type-check or tests are broken.
#
# Usage:
#   scripts/predeploy.sh && npm run client:build && sudo systemctl restart markers
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== [1/2] Type-check (client) ==="
cd "$ROOT/client" && npm run check
echo "    ✓ type-check passed"

echo "=== [2/2] Server tests ==="
cd "$ROOT"
if ls server/test/*.test.js 2>/dev/null | grep -q .; then
  node --test server/test/*.test.js
  echo "    ✓ tests passed"
else
  echo "    (no test files found — add server/test/*.test.js)"
fi

echo ""
echo "✓ Pre-deploy gate passed — safe to build and restart."
