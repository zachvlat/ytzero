#!/usr/bin/env bash

set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

run_check() {
  local label="$1"
  local directory="$2"
  shift 2

  echo
  echo "==> ${label}"
  (
    cd "${REPOSITORY_ROOT}/${directory}"
    "$@"
  )
}

echo "Running pre-commit checks..."

run_check "Large files" "." bun scripts/check-large-files.ts
run_check "Database migrations" "." bun scripts/check-database-migrations.ts
run_check "App typecheck" "app" bun run typecheck
run_check "UI typecheck" "ui" bun run typecheck
run_check "App tests" "app" bun run test
run_check "App tests in random order" "app" bun run test:random
run_check "UI tests" "ui" bun run test
run_check "UI build" "ui" bun run build:prepared
