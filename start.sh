#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 24.15.0 or newer is required. Install Node.js from https://nodejs.org/ and rerun ./start.sh."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Reinstall Node.js 24.15.0 or newer with npm included, then rerun ./start.sh."
  exit 1
fi

exec node scripts/start-dev.mjs
