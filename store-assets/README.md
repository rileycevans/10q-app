# Store assets

Artwork for the App Store and Play listings. Not shipped in any build.

## `10q-feature-graphic.png` — 1024×500

Google Play's feature graphic: the banner at the top of the Play listing,
and the image Play uses when it promotes an app anywhere else. Apple has no
equivalent.

Built from the app's own brand tokens rather than redrawn — the purple
gradient, sunburst rays and dot texture are the same recipe as
`.bg-arcade` in `globals.css`, and the wordmark is `public/brand/10q-logo.png`.
That way the listing and the app look like the same product.

Play crops this asset on some surfaces, so nothing meaningful sits within
about 64px of any edge.

Regenerate from `feature-graphic-source.html` by opening it at a 1024×500
viewport and screenshotting at deviceScaleFactor 1. The logo is embedded as
a data URI, so the file is self-contained.
