/**
 * Solidify scratchy / perforated black outline & shadow on the logo PNG.
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
let { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;

refineInkBuffer(data, W, H);

const pngBuf = await sharp(Buffer.from(data), {
  raw: { width: W, height: H, channels: 4 },
})
  .png({ compressionLevel: 9 })
  .toBuffer();

await sharp(pngBuf)
  .trim({ threshold: 30 })
  .png({ compressionLevel: 9 })
  .toFile(tmpPath);

fs.renameSync(tmpPath, logoPath);
const meta = await sharp(logoPath).metadata();
console.log('Refined ink + trim:', logoPath, `${meta.width}x${meta.height}`);
