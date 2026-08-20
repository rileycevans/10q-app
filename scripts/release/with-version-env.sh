#!/usr/bin/env bash
#
# Export the five build identifiers, then exec whatever was passed.
#
#   scripts/release/with-version-env.sh npm run build --workspace=apps/web
#   CLIENT_PLATFORM=ios scripts/release/with-version-env.sh ./scripts/build-native.sh
#
# NEXT_PUBLIC_* is inlined by the bundler, so this has to happen *before*
# `next build` — there is no runtime lookup and no way to change these values
# in a shipped store binary. See docs/cross-platform/release/VERSIONING.md.
#
# CLIENT_PLATFORM and APP_ENVIRONMENT are read from the ambient environment by
# version.mjs, defaulting to web/production, so this wrapper stays platform
# agnostic and callers set only what differs.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# `env` prints KEY=value lines. Exporting via a loop rather than `eval` so a
# malformed value cannot execute anything.
while IFS='=' read -r key value; do
  [ -z "$key" ] && continue
  export "$key=$value"
done < <(node "$ROOT/scripts/release/version.mjs" env)

echo "build identity: ${NEXT_PUBLIC_CLIENT_PLATFORM}/${NEXT_PUBLIC_APP_VERSION}+${NEXT_PUBLIC_APP_BUILD} (${NEXT_PUBLIC_ENVIRONMENT})" >&2

exec "$@"
