#!/usr/bin/env bash
# Pre-push guard: typecheck + tests must be green before anything leaves the
# local machine. Enable with:
#   ln -sf ../../scripts/pre-push.sh .git/hooks/pre-push
# or run `pnpm hooks:install`.
set -e
cd "$(git rev-parse --show-toplevel)"

echo "[pre-push] pnpm -r typecheck"
pnpm -r typecheck

echo "[pre-push] pnpm -r test"
pnpm -r test

echo "[pre-push] ok"
