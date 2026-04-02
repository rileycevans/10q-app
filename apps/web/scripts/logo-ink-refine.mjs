/** Shared pixel passes: solid + multi-pass dilation to kill scratchy ink pinholes */

export const IR = 26;
export const IG = 26;
export const IB = 33;

export function refineInkBuffer(data, W, H) {
  function idx(x, y) {
    return (y * W + x) * 4;
  }

  function isLikelyCyanFace(buf, i) {
    const r = buf[i];
    const g = buf[i + 1];
    const b = buf[i + 2];
    const a = buf[i + 3];
    if (a < 200) return false;
    const mx = Math.max(r, g, b);
    return mx > 118 && (g > 75 || b > 85);
  }

  function isInkPixel(buf, i) {
    const r = buf[i];
    const g = buf[i + 1];
    const b = buf[i + 2];
    const a = buf[i + 3];
    if (a < 165) return false;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    if (mx > 108) return false;
    if (mx - mn > 44) return false;
    return true;
  }

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 6) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const neutral = max - min < 42;
    if (neutral && max < 125 && a < 252) {
      data[i] = IR;
      data[i + 1] = IG;
      data[i + 2] = IB;
      data[i + 3] = 255;
    }
  }

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 32 && Math.max(r, g, b) < 60) {
      data[i + 3] = 0;
    }
  }

  const R = 4;
  const ITERS = 8;
  const needNeighbors = 5;

  for (let iter = 0; iter < ITERS; iter++) {
    const src = Buffer.from(data);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = idx(x, y);
        if (isLikelyCyanFace(src, i)) continue;

        let inkNeighbors = 0;
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            if (dx * dx + dy * dy > R * R) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const j = idx(nx, ny);
            if (isInkPixel(src, j)) inkNeighbors++;
          }
        }

        if (inkNeighbors >= needNeighbors) {
          data[i] = IR;
          data[i + 1] = IG;
          data[i + 2] = IB;
          data[i + 3] = 255;
        }
      }
    }
  }

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 10 || a > 253) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max < 130 && max - min < 48) {
      data[i] = IR;
      data[i + 1] = IG;
      data[i + 2] = IB;
      data[i + 3] = 255;
    }
  }
}
