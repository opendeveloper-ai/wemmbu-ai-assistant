#!/bin/bash
set -u

PROJECT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$PROJECT_DIR" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 24.15.0 or newer is required. Install it from https://nodejs.org/ and reopen Terminal."
  read -r -p "Press Return to close this window... " _
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Reinstall Node.js 24.15.0 or newer with npm included."
  read -r -p "Press Return to close this window... " _
  exit 1
fi

node scripts/start-dev.mjs
STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  echo
  read -r -p "Startup failed. Press Return to close this window... " _
fi
exit "$STATUS"
