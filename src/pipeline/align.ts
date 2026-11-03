import sharp from "sharp";
import { dilate, erode, type Mask } from "./region.ts";

export interface Alignment {
  scale: number;
  dx: number; // in full-size pixels
  dy: number;
  /** Mean absolute grey difference over the compared area after alignment, 0..255. */
  residual: number;
  /** Same measure before alignment, for the report. */
  before: number;
  /** How many windows got their own alignment because the overall one left them off (see warpByColumns). */
  localWindows?: number;
}

/**
 * A mask scaled to w x h, one byte per pixel. sharp hands back three channels for one-channel raw input unless
 * told otherwise; reading that buffer as one channel samples the wrong pixels.
 */
async function scaledMask(mask: Mask, width: number, height: number, w: number, h: number): Promise<Buffer> {
  return sharp(Buffer.from(mask.map((v) => (v ? 255 : 0))), { raw: { width, height, channels: 1 } })
    .resize(w, h, { fit: "fill" })
    .extractChannel(0)
    .raw()
    .toBuffer();
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
  /** Search near this alignment instead of from scratch; `before` is then the cost at it, on the same pixels. */
  around?: Alignment,
): Promise<Alignment> {
  const levels = [256, 512];
  let best = { scale: around?.scale ?? 1, dx: around?.dx ?? 0, dy: around?.dy ?? 0, cost: Infinity };
  let before = 0;
  for (const [level, tw] of levels.entries()) {
    const th = Math.round((tw * height) / width);
    const a = await grey(original, width, height, tw, th);
    const b = await grey(result, width, height, tw, th);
    const use = await scaledMask(compare, width, height, tw, th);
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
    if (level === 0 && !around) before = cost(1, 0, 0);
    if (level === levels.length - 1 && around) before = cost(around.scale, around.dx, around.dy);
    const span =
      level === 0
        ? around
          ? { s: [around.scale - 0.03, around.scale + 0.03, 0.01], d: Math.round(width * 0.02) }
          : { s: [0.94, 1.06, 0.01], d: Math.round(width * 0.04) }
        : { s: [best.scale - 0.008, best.scale + 0.008, 0.002], d: Math.round(2 / k) };
    const stepD = Math.max(1, Math.round(1 / k));
    const centre = level === 0 ? { dx: around?.dx ?? 0, dy: around?.dy ?? 0 } : { dx: best.dx, dy: best.dy };
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

/**
 * Lays the result over the original with an alignment that changes along the width: each anchor is a window's own
 * alignment at its centre, and columns between two anchors take a blend of the two, so the picture bends smoothly
 * with no seam (a drape between two windows would show one). The generator does not shift a wide frame evenly: one
 * wall can move left while the other moves right.
 */
export function warpByColumns(result: Buffer, width: number, height: number, anchors: { x: number; al: Alignment }[]): Buffer {
  const sorted = [...anchors].sort((a, b) => a.x - b.x);
  const out = Buffer.alloc(width * height * 3);
  const cx = width / 2;
  const cy = height / 2;
  for (let x = 0; x < width; x++) {
    let al: { scale: number; dx: number; dy: number };
    const right = sorted.findIndex((a) => a.x >= x);
    if (right <= 0) al = sorted[right === 0 ? 0 : sorted.length - 1]!.al;
    else {
      const a = sorted[right - 1]!, b = sorted[right]!;
      const t = (x - a.x) / Math.max(1, b.x - a.x);
      al = { scale: a.al.scale + (b.al.scale - a.al.scale) * t, dx: a.al.dx + (b.al.dx - a.al.dx) * t, dy: a.al.dy + (b.al.dy - a.al.dy) * t };
    }
    const sx = Math.min(width - 1, Math.max(0, Math.round(cx + (x - cx - al.dx) / al.scale)));
    for (let y = 0; y < height; y++) {
      const sy = Math.min(height - 1, Math.max(0, Math.round(cy + (y - cy - al.dy) / al.scale)));
      const s = (sy * width + sx) * 3;
      const d = (y * width + x) * 3;
      out[d] = result[s]!;
      out[d + 1] = result[s + 1]!;
      out[d + 2] = result[s + 2]!;
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
 * Whether the window stayed where it was: the grey difference along the window's outline (its frame and the wall
 * right at it) after alignment, at the 40th percentile. The glass itself is left out: the generator may brighten
 * or blur the view, but the view is never pasted, so only the outline matters for where the curtains land.
 * `outline` comes from windowOutline. Returns 0 when nothing of the outline is visible to compare.
 */
export async function windowMatch(original: Buffer, aligned: Buffer, width: number, height: number, outline: Mask): Promise<number> {
  const tw = 512;
  const th = Math.round((tw * height) / width);
  const a = await grey(original, width, height, tw, th);
  const b = await grey(aligned, width, height, tw, th);
  const m = await scaledMask(outline, width, height, tw, th);
  const diffs: number[] = [];
  for (let i = 0; i < tw * th; i++) if ((m[i] ?? 0) >= 128) diffs.push(Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  if (diffs.length < 50) return 0;
  diffs.sort((x, y) => x - y);
  return diffs[Math.floor(diffs.length * 0.4)]!;
}

/** The band along the window's border, minus whatever the new curtains and rod cover. */
export function windowOutline(window: Mask, covered: Mask, width: number, height: number): Mask {
  const r = Math.max(2, Math.round(width * 0.012));
  const outer = dilate(window, width, height, r);
  const inner = erode(window, width, height, r);
  const hidden = dilate(covered, width, height, r);
  return outer.map((v, i) => (v && !inner[i] && !hidden[i] ? 1 : 0));
}
