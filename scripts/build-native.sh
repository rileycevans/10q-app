#!/usr/bin/env bash
#
# Build apps/web as a static export for the Capacitor shells.
#
# `output: 'export'` cannot represent middleware, route handlers, or the
# Sentry server/edge runtimes. Web still needs all of them, so this script
# moves them aside for the duration of the build and always puts them back.
#
# "Always" is the whole design. A build that fails halfway and leaves
# middleware.ts renamed would make the NEXT web deploy silently ship without
# middleware — a production incident caused by a native build nobody ran on
# purpose. Hence the EXIT trap, which fires on success, failure, and Ctrl-C
# alike.
#
#   npm run build:native --workspace=apps/web
#
set -euo pipefail

cd "$(dirname "$0")/.."
WEB="apps/web"

# Files the export cannot compile. Each is moved to <path>.native-hidden and
# restored by the trap.
HIDE=(
  "$WEB/src/middleware.ts"
  "$WEB/src/instrumentation.ts"
  "$WEB/sentry.server.config.ts"
  "$WEB/sentry.edge.config.ts"
  "$WEB/src/app/sentry-test/server/route.ts"
)

SUFFIX=".native-hidden"
restore() {
  local status=$?
  for f in "${HIDE[@]}"; do
    [ -e "$f$SUFFIX" ] && mv -f "$f$SUFFIX" "$f"
  done
  # An empty sentry-test/server directory left behind would make Next treat
  # it as a route with no handler.
  [ -d "$WEB/src/app/sentry-test/server" ] && rmdir "$WEB/src/app/sentry-test/server" 2>/dev/null || true
  if [ $status -ne 0 ]; then
    echo "native build failed (exit $status) — source tree restored" >&2
  fi
  return $status
}
trap restore EXIT INT TERM

echo "Hiding server-only files..."
for f in "${HIDE[@]}"; do
  if [ -e "$f" ]; then
    mv "$f" "$f$SUFFIX"
    echo "  hidden  ${f#"$WEB/"}"
  fi
done

echo
echo "Building static export (BUILD_TARGET=native)..."
BUILD_TARGET=native npm run build --workspace=apps/web

OUT="$WEB/out"
[ -d "$OUT" ] || { echo "expected export at $OUT — not found" >&2; exit 1; }

echo
echo "Export written to $OUT"
echo "  $(find "$OUT" -name 'index.html' | wc -l | tr -d ' ') routes"
echo "  $(du -sh "$OUT" | cut -f1) total"
