import sharp from "sharp";
import type { Mask } from "./region.ts";

export interface Alignment {
  scale: number;
  dx: number; // in full-size pixels
  dy: number;
  /** Mean absolute grey difference over the compared area after alignment, 0..255. */
  residual: number;
  /** Same measure before alignment, for the report. */
  before: number;
}

async function grey(rgb: Buffer, width: number, height: number, w: number, h: number): Promise<Buffer> {
  return sharp(rgb, { raw: { width, height, channels: 3 } }).resize(w, h, { fit: "fill" }).greyscale().blur(1).raw().toBuffer();
}

/**
 * The generator redraws the whole frame and sometimes zooms or shifts it slightly. This finds the scale and shift
 * that best lay the result over the original, comparing only the pixels in `compare` (the window and its frame,
 * which must not move; the room's edges may be redrawn, but they are never pasted). Coarse search on a 256 px
 * thumbnail, then a fine one at 512 px.
 */
export async function findAlignment(
  original: Buffer,
  result: Buffer,
  width: number,
  height: number,
  compare: Mask,
): Promise<Alignment> {
  const levels = [256, 512];
  let best = { scale: 1, dx: 0, dy: 0, cost: Infinity };
  let before = 0;
  for (const [level, tw] of levels.entries()) {
    const th = Math.round((tw * height) / width);
    const a = await grey(original, width, height, tw, th);
    const b = await grey(result, width, height, tw, th);
    const use = await sharp(Buffer.from(compare.map((v) => (v ? 255 : 0))), { raw: { width, height, channels: 1 } })
      .resize(tw, th, { fit: "fill" })
      .raw()
      .toBuffer();
    const k = tw / width;
    const cost = (scale: number, dx: number, dy: number): number => {
      // Sample b at the position that maps onto pixel (x, y) of a: b(x') with x = cx + scale * (x' - cx) + dx.
      const cx = tw / 2;
      const cy = th / 2;
      let sum = 0;
      let n = 0;
      for (let y = 2; y < th - 2; y += 1) {
        const sy = Math.round(cy + (y - cy - dy * k) / scale);
        if (sy < 0 || sy >= th) continue;
        for (let x = 2; x < tw - 2; x += 1) {
          if ((use[y * tw + x] ?? 0) < 128) continue;
          const sx = Math.round(cx + (x - cx - dx * k) / scale);
          if (sx < 0 || sx >= tw) continue;
          sum += Math.abs((a[y * tw + x] ?? 0) - (b[sy * tw + sx] ?? 0));
          n++;
        }
      }
      return n > tw * th * 0.01 ? sum / n : Infinity;
    };
    if (level === 0) before = cost(1, 0, 0);
    const span = level === 0 ? { s: [0.94, 1.06, 0.01], d: Math.round(width * 0.04) } : { s: [best.scale - 0.008, best.scale + 0.008, 0.002], d: Math.round(2 / k) };
    const stepD = Math.max(1, Math.round(1 / k));
    const centre = level === 0 ? { dx: 0, dy: 0 } : { dx: best.dx, dy: best.dy };
    for (let scale = span.s[0]!; scale <= span.s[1]! + 1e-9; scale += span.s[2]!) {
      for (let dy = centre.dy - span.d; dy <= centre.dy + span.d; dy += stepD) {
        for (let dx = centre.dx - span.d; dx <= centre.dx + span.d; dx += stepD) {
          const c = cost(scale, dx, dy);
          if (c < best.cost) best = { scale, dx, dy, cost: c };
        }
      }
    }
  }
  return { scale: best.scale, dx: best.dx, dy: best.dy, residual: best.cost, before };
}

/**
 * The generator also shifts the overall tone (often a little darker or warmer). Fits, per colour channel,
 * `original ≈ gain * generated + offset` over the pixels that should not change and applies it to the whole
 * generated image, so pasted curtains carry the original photo's exposure.
 */
export function matchTone(original: Buffer, generated: Buffer, keepOut: Mask): Buffer {
  const out = Buffer.alloc(generated.length);
  const pixels = keepOut.length;
  const step = Math.max(1, Math.floor(pixels / 200_000));
  for (let c = 0; c < 3; c++) {
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < pixels; i += step) {
      if (keepOut[i]) continue;
      const x = generated[i * 3 + c]!;
      const y = original[i * 3 + c]!;
      n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
    }
    const varX = sxx - (sx * sx) / Math.max(1, n);
    const gain = n > 100 && varX > 1 ? Math.min(1.6, Math.max(0.6, (sxy - (sx * sy) / n) / varX)) : 1;
    const offset = n > 0 ? (sy - gain * sx) / n : 0;
    for (let i = 0; i < pixels; i++) {
      const v = gain * generated[i * 3 + c]! + offset;
      out[i * 3 + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
    }
  }
  return out;
}

/** Applies an alignment to the full-size result, returning raw RGB at the original size. */
export async function applyAlignment(result: Buffer, width: number, height: number, al: Alignment): Promise<Buffer> {
  if (al.scale === 1 && al.dx === 0 && al.dy === 0) return result;
  const out = Buffer.alloc(width * height * 3);
  const cx = width / 2;
  const cy = height / 2;
  for (let y = 0; y < height; y++) {
    const sy = Math.min(height - 1, Math.max(0, Math.round(cy + (y - cy - al.dy) / al.scale)));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(width - 1, Math.max(0, Math.round(cx + (x - cx - al.dx) / al.scale)));
      const s = (sy * width + sx) * 3;
      const d = (y * width + x) * 3;
      out[d] = result[s]!;
      out[d + 1] = result[s + 1]!;
      out[d + 2] = result[s + 2]!;
    }
  }
  return out;
}

/**
 * Is the window where it was? Compares grey levels inside the original window mask after alignment and returns
 * the 40th percentile of the absolute difference (0..255). New curtains cover part of the window and differ a
 * lot there, but as long as the rest of the glass and frame match, the 40th percentile stays low; a window that
 * moved or was redrawn differs everywhere.
 */
export async function windowMatch(original: Buffer, aligned: Buffer, width: number, height: number, windowMask: Mask): Promise<number> {
  const tw = 512;
  const th = Math.round((tw * height) / width);
  const a = await grey(original, width, height, tw, th);
  const b = await grey(aligned, width, height, tw, th);
  const m = await sharp(Buffer.from(windowMask.map((v) => (v ? 255 : 0))), { raw: { width, height, channels: 1 } })
    .resize(tw, th, { fit: "fill" })
    .raw()
    .toBuffer();
  const diffs: number[] = [];
  for (let i = 0; i < tw * th; i++) if ((m[i] ?? 0) >= 128) diffs.push(Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  if (diffs.length === 0) return 255;
  diffs.sort((x, y) => x - y);
  return diffs[Math.floor(diffs.length * 0.4)]!;
}
