/**
 * Generates the app icon set for the web manifest and the native shells.
 *
 * Source is public/brand/10q-logo.png, a wide transparent wordmark. App icons
 * are square, so the logo is centred on the brand purple with padding rather
 * than stretched. Apple flattens any alpha channel to black, so the iOS
 * marketing icon is written without transparency.
 *
 * Run: npm run generate:icons
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'public/brand/10q-logo.png');
const OUT = path.join(ROOT, 'public/icons');

// Brand tokens from src/app/globals.css
const PURPLE = { r: 0x41, g: 0x3d, b: 0xe1, alpha: 1 };

// The wordmark is roughly 2:1, so scaling it to most of the icon width still
// leaves generous space above and below. Pushed close to the edges it reads
// clearly at home-screen sizes without looking cramped.
const LOGO_SCALE = 0.86;
// Android adaptive icons crop to a circle inscribed in the square, so the
// corners of a wide wordmark get clipped. Keeping it inside ~66% of the width
// leaves the whole logo within the safe zone whatever mask the launcher uses.
const MASKABLE_LOGO_SCALE = 0.66;

/**
 * Composite the wordmark, scaled to `scale` of the canvas, onto a solid
 * background. `alpha` false produces an opaque icon (required by Apple).
 */
async function renderIcon(size, { scale = LOGO_SCALE, alpha = false } = {}) {
  const logoWidth = Math.round(size * scale);

  const logo = await sharp(SOURCE)
    .resize({ width: logoWidth, fit: 'inside', withoutEnlargement: false })
    .toBuffer();

  const canvas = sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: alpha ? { ...PURPLE, alpha: 0 } : PURPLE,
    },
  });

  const composited = canvas.composite([{ input: logo, gravity: 'centre' }]);

  // Apple's validator rejects an icon that merely *has* an alpha channel, even
  // when every pixel is opaque, so flatten it away for the icons it checks.
  return (alpha ? composited : composited.flatten({ background: PURPLE }).removeAlpha())
    .png()
    .toBuffer();
}

/** Web manifest icons, plus the maskable variant Android needs. */
const WEB_ICONS = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'icon-maskable-192.png', size: 192, maskable: true },
  { name: 'icon-maskable-512.png', size: 512, maskable: true },
];

/** apple-touch-icon must be opaque and is served from the web root. */
const APPLE_TOUCH = { name: 'apple-touch-icon.png', size: 180 };

/** 1024x1024 App Store marketing icon; no alpha, or Apple rejects the build. */
const APPLE_MARKETING = { name: 'ios-marketing-1024.png', size: 1024 };

/** Favicons for the browser tab. */
const FAVICONS = [
  { name: 'favicon-16.png', size: 16 },
  { name: 'favicon-32.png', size: 32 },
];

async function main() {
  await mkdir(OUT, { recursive: true });

  const written = [];

  for (const icon of [...WEB_ICONS, APPLE_TOUCH, APPLE_MARKETING, ...FAVICONS]) {
    const buf = await renderIcon(icon.size, {
      scale: icon.maskable ? MASKABLE_LOGO_SCALE : LOGO_SCALE,
      alpha: false,
    });
    const dest = path.join(OUT, icon.name);
    await writeFile(dest, buf);
    written.push(`${icon.name} (${icon.size}x${icon.size})`);
  }

  console.log(`Wrote ${written.length} icons to public/icons:`);
  for (const w of written) console.log(`  ${w}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
