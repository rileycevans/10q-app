/**
 * Optional logo helper:
 * - Real transparent PNG → trim empty edges only (leaves pixels untouched).
 * - Opaque / JPEG-style matte → remove black matte + solidify ink + trim.
 *
 * For a clean PNG export: you can skip this script entirely — just save as
 * `public/brand/10q-logo.png`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { refineInkBuffer } from './logo-ink-refine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logoPath = path.join(__dirname, '../public/brand/10q-logo.png');
const tmpPath = logoPath + '.tmp.png';

const buf = fs.readFileSync(logoPath);
const meta = await sharp(buf).metadata();

// Already a PNG with alpha — only crop transparent margins, do not re-key or refine.
if (meta.format === 'png' && meta.hasAlpha) {
  await sharp(buf)
    .trim({ threshold: 30 })
    .png({ compressionLevel: 9 })
    .toFile(tmpPath);
  fs.renameSync(tmpPath, logoPath);
  const out = await sharp(logoPath).metadata();
  console.log('Transparent PNG — trimmed only →', logoPath, `${out.width}x${out.height}`);
  process.exit(0);
}

const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

const { width, height, channels } = info;
if (channels !== 4) {
  throw new Error(`Expected 4 channels, got ${channels}`);
}

const threshold = 22;
for (let i = 0; i < data.length; i += 4) {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const neutral = max - min < 18;
  if (max <= threshold && neutral) {
    data[i + 3] = 0;
  }
}

refineInkBuffer(data, width, height);

const pngBuf = await sharp(Buffer.from(data), {
  raw: { width, height, channels: 4 },
})
  .png({ compressionLevel: 9 })
  .toBuffer();

await sharp(pngBuf)
  .trim({ threshold: 30 })
  .png({ compressionLevel: 9 })
  .toFile(tmpPath);

fs.renameSync(tmpPath, logoPath);
const finalMeta = await sharp(logoPath).metadata();
console.log('Keyed + refined + trimmed →', logoPath, `${finalMeta.width}x${finalMeta.height}`);
