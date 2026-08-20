#!/usr/bin/env bash
#
# Validate a static export before it is packaged into an app bundle.
#
# These failures are silent at runtime — a broken avatar, a page that 404s
# from inside the WebView — so they need to fail the build instead.
#
#   ./scripts/check-export.sh [out-dir]
#
set -euo pipefail

OUT="${1:-apps/web/out}"
[ -d "$OUT" ] || { echo "no export at $OUT — run build:native first" >&2; exit 1; }

fail=0
note() { echo "  FAIL  $1"; fail=1; }
ok()   { echo "  ok    $1"; }

echo "Checking export at $OUT"

# 1. Image optimizer URLs.
#
# Grepping for the bare string does NOT work: Next inlines its image config
# (including the literal "/_next/image" path and `unoptimized:!0`) into a
# framework chunk on every build. That is inert config, not a request.
#
# What actually breaks is a *generated* optimizer URL in emitted markup —
# `/_next/image?url=...` — because there is no server in an app bundle to
# serve it. Look only at HTML, and only for the query form.
if grep -rlE '/_next/image\?(url|&)' "$OUT" --include='*.html' >/dev/null 2>&1; then
  note "optimizer URLs in emitted HTML (images.unoptimized not applied)"
  grep -rlE '/_next/image\?' "$OUT" --include='*.html' | sed 's/^/        /' | head -5
else
  ok "no image-optimizer URLs in HTML"
fi

# 2. Every route is a real index.html. A route that exports as a bare
# directory is a 404 the moment someone deep-links to it.
# A directory is a ROUTE if it contains no files other than directories and
# index.html — static asset directories (public/ copied verbatim: brand/,
# icons/) hold images and are not routes, so exclude anything containing a
# non-HTML file.
missing=0
while IFS= read -r d; do
  # Skip asset dirs: any directory holding a file that is not index.html.
  if find "$d" -mindepth 1 -maxdepth 1 -type f ! -name 'index.html' | grep -q .; then
    continue
  fi
  # Skip pure parent dirs whose children are the real routes.
  if [ ! -f "$d/index.html" ] && find "$d" -mindepth 1 -maxdepth 1 -type d | grep -q .; then
    continue
  fi
  [ -f "$d/index.html" ] || { echo "        ${d#"$OUT"}"; missing=1; }
done < <(find "$OUT" -type d -not -path "$OUT/_next*" -not -path "$OUT")
[ "$missing" = "0" ] && ok "every route directory has an index.html" || note "route directories without index.html"

# 3. The quiz pages. The game is unplayable without all ten, and
# generateStaticParams failing silently would ship a broken app.
for i in $(seq 1 10); do
  [ -f "$OUT/play/q/$i/index.html" ] || { note "missing /play/q/$i"; break; }
done
[ -f "$OUT/play/q/10/index.html" ] && ok "all 10 question pages present"

# 4. The routes converted away from dynamic segments in Phase 3.
for r in invite u leagues/view; do
  [ -f "$OUT/$r/index.html" ] && ok "/$r exported" || note "/$r missing"
done

# 5. Nothing server-only survived the export.
if find "$OUT" -name '*.rsc' -o -name 'middleware*.js' 2>/dev/null | grep -q .; then
  note "server artifacts present in the export"
else
  ok "no server artifacts"
fi

echo
[ "$fail" = "0" ] && echo "Export looks valid." || { echo "Export FAILED validation."; exit 1; }
