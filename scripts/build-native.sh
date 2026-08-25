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

# Finder-style duplicates ("Package 2.swift", "App 2") break the native build
# in a way that is hard to read: Swift compiles both copies and reports
# "Invalid redeclaration of 'isCapacitorApp'" rather than anything mentioning
# a duplicate file. They appear from editor or sync accidents, are untracked,
# and CI never sees them — so this only ever bites locally, which is exactly
# when the error is most confusing.
if [ -d "$WEB/ios" ] || [ -d "$WEB/android" ]; then
  # Sources that feed a build, plus the native projects themselves.
  #
  # src/ and packages/ matter most: a `foo 2.ts` beside `foo.ts` is picked up
  # by module resolution and the build silently uses the STALE copy. That is
  # not hypothetical — an OAuth fix was built three times against a duplicate
  # before anyone noticed, and a `capacitor.config 2.ts` was still carrying
  # the contentInset value that put a black band under the notch.
  #
  # The SYNCED copies under ios/App/App/public and android/.../assets/public
  # are wiped and recreated by cap sync every run, so they are excluded — they
  # are symptoms of a duplicate in apps/web/public, which is itself checked.
  # `|| true` because grep exits 1 when it filters everything out, and under
  # `set -e` that fails the build in exactly the case where nothing is wrong.
  DUPES="$(find "$WEB/ios" "$WEB/android" "$WEB/src" "$WEB/public" "$ROOT/packages" \
      -not -path '*/node_modules/*' \
      \( -name '* [0-9]' -o -name '* [0-9].*' -o -name '* [0-9][0-9]' -o -name '* [0-9][0-9].*' \) 2>/dev/null \
    | grep -vE '/(ios|android)/.*/(public|assets)/' | head -20 || true)"
  if [ -n "$DUPES" ]; then
    echo "Duplicate files in the native projects will break the build:" >&2
    echo "$DUPES" | sed 's/^/  /' >&2
    echo >&2
    echo "They are untracked copies. Remove them with:" >&2
    echo "  find $WEB/ios $WEB/android $WEB/src $WEB/public $ROOT/packages -not -path '*/node_modules/*' \\( -name '* [0-9]*' \\) -exec rm -rf {} +" >&2
    exit 1
  fi
fi

echo "Hiding server-only files..."
for f in "${HIDE[@]}"; do
  if [ -e "$f" ]; then
    mv "$f" "$f$SUFFIX"
    echo "  hidden  ${f#"$WEB/"}"
  fi
done

# CLIENT_PLATFORM drives two things: the identifiers stamped into the bundle
# (version.mjs) and which implementations the platform seam selects
# (src/platform/index.ts keys off NEXT_PUBLIC_CLIENT_PLATFORM !== 'web').
#
# Without it, version.mjs defaults to 'web' and the native app silently ships
# the WEB seam — localStorage instead of Preferences, detectSessionInUrl true
# against a deep-link handler that also wants the code. The export builds
# perfectly and is wrong.
#
# One export serves both stores, so the caller picks:
#   CLIENT_PLATFORM=android ./scripts/build-native.sh
CLIENT_PLATFORM="${CLIENT_PLATFORM:-ios}"
case "$CLIENT_PLATFORM" in
  ios|android) ;;
  *) echo "CLIENT_PLATFORM must be ios or android for a native build, got '$CLIENT_PLATFORM'" >&2; exit 1 ;;
esac
export CLIENT_PLATFORM

echo
echo "Building static export (BUILD_TARGET=native CLIENT_PLATFORM=$CLIENT_PLATFORM)..."
BUILD_TARGET=native npm run build --workspace=apps/web

OUT="$WEB/out"
[ -d "$OUT" ] || { echo "expected export at $OUT — not found" >&2; exit 1; }

# The Capacitor CLI requires Node >= 22, and a machine can easily default to
# an older one — nvm's default, a system install, whatever the shell picked
# up. CI pins 22 explicitly, so this failing locally while passing in CI is
# the expected shape of the problem.
#
# Rather than making every caller remember to switch, find a suitable Node and
# put it on PATH for the sync step only.
if [ -d "$WEB/ios" ] || [ -d "$WEB/android" ]; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$NODE_MAJOR" -lt 22 ]; then
    FOUND=""
    # nvm keeps versions here; take the highest that satisfies the requirement.
    for candidate in $(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | sort -V -r); do
      major="${candidate#v}"; major="${major%%.*}"
      if [ "$major" -ge 22 ] && [ -x "$HOME/.nvm/versions/node/$candidate/bin/node" ]; then
        FOUND="$HOME/.nvm/versions/node/$candidate/bin"
        break
      fi
    done

    if [ -n "$FOUND" ]; then
      echo "Node $(node --version) is too old for the Capacitor CLI; using $(basename "$(dirname "$FOUND")") for sync."
      PATH="$FOUND:$PATH"
      export PATH
    else
      echo "The Capacitor CLI needs Node >= 22 and this shell has $(node --version)." >&2
      echo "Install it, then re-run:" >&2
      echo "  nvm install 22 && nvm use 22" >&2
      exit 1
    fi
  fi
fi

# Copy the export into the native projects and refresh plugin registrations.
# Skipped when the platforms are absent so the script still works as an
# export-only build (which is what CI runs — it validates the export without
# needing Xcode or the Android SDK).
if [ -d "$WEB/ios" ] || [ -d "$WEB/android" ]; then
  echo
  echo "Syncing native projects..."
  ( cd "$WEB" && npx cap sync )
else
  echo
  echo "No native projects present — skipping cap sync."
fi

echo
echo "Export written to $OUT"
echo "  $(find "$OUT" -name 'index.html' | wc -l | tr -d ' ') routes"
echo "  $(du -sh "$OUT" | cut -f1) total"
