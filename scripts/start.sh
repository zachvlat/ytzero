#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UI_DIST_DIR="$ROOT_DIR/ui/dist"

if [ ! -f "$UI_DIST_DIR/index.html" ]; then
  echo "ui/dist is missing. Building the frontend first..."
  cd "$ROOT_DIR/ui"
  bun run build
fi

cd "$ROOT_DIR/app"
UI_DIST="../ui/dist" bun run start
