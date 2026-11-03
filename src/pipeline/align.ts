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
 * The generator redraws the whole frame and often zooms or shifts it: by up to about 15%, more than a fine search
 * can cover at once. This finds the scale and shift that best lay the result over the original, comparing only the
 * pixels in `compare` (the window and its frame, which must not move). A wide search on a 128 px thumbnail, then
 * narrower ones at 256 and 512 px. A scale stuck at the edge of the range meant a picture laid on askew, which then
 * read as a changed room and a washed-out one.
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
  const levels = [128, 256, 512];
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
          : { s: [0.86, 1.16, 0.01], d: Math.round(width * 0.1) }
        : level === 1
          ? { s: [best.scale - 0.015, best.scale + 0.015, 0.005], d: Math.round(3 / k) }
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
 * The generator also shifts the tone: a little darker, warmer, hazier. This maps each colour channel of the result
 * onto the original's by their distributions over the room outside `keepOut` (quantile matching), not pixel by pixel:
 * a pixel-by-pixel fit on a picture that sits a few pixels off flattens the contrast and turns the room milky.
 */
export function matchTone(original: Buffer, generated: Buffer, keepOut: Mask): Buffer {
  const out = Buffer.alloc(generated.length);
  const pixels = keepOut.length;
  const step = Math.max(1, Math.floor(pixels / 300_000));
  for (let c = 0; c < 3; c++) {
    const ho = new Float64Array(256);
    const hg = new Float64Array(256);
    let n = 0;
    for (let i = 0; i < pixels; i += step) {
      if (keepOut[i]) continue;
      ho[original[i * 3 + c]!]!++;
      hg[generated[i * 3 + c]!]!++;
      n++;
    }
    const lut = new Uint8Array(256);
    if (n < 1000) for (let v = 0; v < 256; v++) lut[v] = v;
    else {
      // The generated value v sits at the middle of its share of the distribution; it becomes the original's value
      // at the same share.
      let below = 0, u = 0, upTo = ho[0]!;
      for (let v = 0; v < 256; v++) {
        const at = (below + hg[v]! / 2) / n;
        while (u < 255 && upTo / n < at) upTo += ho[++u]!;
        lut[v] = u;
        below += hg[v]!;
      }
    }
    for (let i = 0; i < pixels; i++) out[i * 3 + c] = lut[generated[i * 3 + c]!]!;
  }
  return out;
}

/**
 * What a global mapping can't fix: the generator lighting one part of the room more and another less. The
 * difference between the original and the result is averaged over a few percent of the width, outside `keepOut`,
 * and added back everywhere, curtains included (they get the light of the room around them). Being so blurred,
 * it does not bring the photo's details back into the picture; it only puts the light where the photo has it.
 */
export function matchLocalTone(original: Buffer, generated: Buffer, keepOut: Mask, width: number, height: number): Buffer {
  const w = 192;
  const h = Math.max(8, Math.round((w * height) / width));
  const fx = width / w, fy = height / h;
  const sum = new Float32Array(w * h * 3);
  const cnt = new Float32Array(w * h);
  for (let y = 0; y < height; y += 2) {
    const ty = Math.min(h - 1, Math.floor(y / fy));
    for (let x = 0; x < width; x += 2) {
      const i = y * width + x;
      if (keepOut[i]) continue;
      const t = ty * w + Math.min(w - 1, Math.floor(x / fx));
      cnt[t]!++;
      for (let c = 0; c < 3; c++) sum[t * 3 + c]! += original[i * 3 + c]! - generated[i * 3 + c]!;
    }
  }
  const field = (radius: number) => {
    const s = boxBlur(sum, w, h, 3, radius);
    const k = boxBlur(cnt, w, h, 1, radius);
    return { s, k };
  };
  const near = field(Math.round(w * 0.04));
  const far = field(Math.round(w * 0.2));
  const peak = Math.max(1e-6, ...far.k);
  const corr = new Float32Array(w * h * 3);
  for (let t = 0; t < w * h; t++) {
    // Close to the room the near average is used; deep inside a large curtain area it fades to the far one.
    const wn = Math.min(1, near.k[t]! / (peak * 0.3));
    for (let c = 0; c < 3; c++) {
      const n = near.k[t]! > 1e-6 ? near.s[t * 3 + c]! / near.k[t]! : 0;
      const f = far.k[t]! > peak * 0.02 ? far.s[t * 3 + c]! / far.k[t]! : 0;
      corr[t * 3 + c] = Math.max(-60, Math.min(60, wn * n + (1 - wn) * f));
    }
  }
  const out = Buffer.alloc(generated.length);
  for (let y = 0; y < height; y++) {
    const gy = Math.min(h - 1.001, Math.max(0, (y + 0.5) / fy - 0.5));
    const y0 = Math.floor(gy), ty = gy - y0;
    for (let x = 0; x < width; x++) {
      const gx = Math.min(w - 1.001, Math.max(0, (x + 0.5) / fx - 0.5));
      const x0 = Math.floor(gx), tx = gx - x0;
      const i = y * width + x;
      for (let c = 0; c < 3; c++) {
        const at = (yy: number, xx: number) => corr[((y0 + yy) * w + x0 + xx) * 3 + c]!;
        const d = (at(0, 0) * (1 - tx) + at(0, 1) * tx) * (1 - ty) + (at(1, 0) * (1 - tx) + at(1, 1) * tx) * ty;
        const v = generated[i * 3 + c]! + d;
        out[i * 3 + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
      }
    }
  }
  return out;
}

/** Three box blurs of the given radius, close to a Gaussian; `channels` values per pixel. */
function boxBlur(src: Float32Array, w: number, h: number, channels: number, radius: number): Float32Array {
  let a = Float32Array.from(src);
  let b = new Float32Array(src.length);
  const r = Math.max(1, radius);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++)
      for (let c = 0; c < channels; c++) {
        let acc = 0;
        for (let x = -r; x <= r; x++) acc += a[(y * w + Math.min(w - 1, Math.max(0, x))) * channels + c]!;
        for (let x = 0; x < w; x++) {
          b[(y * w + x) * channels + c] = acc / (2 * r + 1);
          acc += a[(y * w + Math.min(w - 1, x + r + 1)) * channels + c]! - a[(y * w + Math.max(0, x - r)) * channels + c]!;
        }
      }
    [a, b] = [b, a];
    for (let x = 0; x < w; x++)
      for (let c = 0; c < channels; c++) {
        let acc = 0;
        for (let y = -r; y <= r; y++) acc += a[(Math.min(h - 1, Math.max(0, y)) * w + x) * channels + c]!;
        for (let y = 0; y < h; y++) {
          b[(y * w + x) * channels + c] = acc / (2 * r + 1);
          acc += a[(Math.min(h - 1, y + r + 1) * w + x) * channels + c]! - a[(Math.max(0, y - r) * w + x) * channels + c]!;
        }
      }
    [a, b] = [b, a];
  }
  return a;
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
export interface Box { x1: number; y1: number; x2: number; y2: number }

/**
 * The part of the photo the aligned picture really covers. A generator that zoomed in drew less than the photo
 * shows; past its edges alignment can only repeat its last row or column, a smear. The shown pictures, before and
 * after, are cut to this box instead. With several alignments (warpByColumns) it is the part all of them cover.
 */
export function coveredBox(width: number, height: number, als: Alignment[]): Box {
  const cx = width / 2, cy = height / 2;
  const box = { x1: 0, y1: 0, x2: width, y2: height };
  for (const al of als) {
    box.x1 = Math.max(box.x1, Math.ceil(cx - al.scale * cx + al.dx));
    box.x2 = Math.min(box.x2, Math.floor(cx + al.scale * (width - cx) + al.dx));
    box.y1 = Math.max(box.y1, Math.ceil(cy - al.scale * cy + al.dy));
    box.y2 = Math.min(box.y2, Math.floor(cy + al.scale * (height - cy) + al.dy));
  }
  return box;
}

/** 1 outside the box, 0 inside. */
export function outsideBox(width: number, height: number, box: Box): Mask {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) if (x < box.x1 || x >= box.x2 || y < box.y1 || y >= box.y2) out[y * width + x] = 1;
  return out;
}

export function cropRgb(rgb: Buffer, width: number, box: Box): Buffer {
  const w = box.x2 - box.x1;
  const out = Buffer.alloc(w * (box.y2 - box.y1) * 3);
  for (let y = box.y1; y < box.y2; y++) rgb.copy(out, (y - box.y1) * w * 3, (y * width + box.x1) * 3, (y * width + box.x2) * 3);
  return out;
}

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
  return regionMatch(original, aligned, width, height, outline, 0.4);
}

/** The grey difference over `mask` after alignment at the given percentile (0..255); 0 when too little is visible. */
export async function regionMatch(original: Buffer, aligned: Buffer, width: number, height: number, mask: Mask, percentile: number): Promise<number> {
  const outline = mask;
  const tw = 512;
  const th = Math.round((tw * height) / width);
  const a = await grey(original, width, height, tw, th);
  const b = await grey(aligned, width, height, tw, th);
  const m = await scaledMask(outline, width, height, tw, th);
  const diffs: number[] = [];
  for (let i = 0; i < tw * th; i++) if ((m[i] ?? 0) >= 128) diffs.push(Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  if (diffs.length < 50) return 0;
  diffs.sort((x, y) => x - y);
  return diffs[Math.floor(diffs.length * percentile)]!;
}

/** The band along the window's border, minus whatever the new curtains and rod cover. */
export function windowOutline(window: Mask, covered: Mask, width: number, height: number): Mask {
  const r = Math.max(2, Math.round(width * 0.012));
  const outer = dilate(window, width, height, r);
  const inner = erode(window, width, height, r);
  const hidden = dilate(covered, width, height, r);
  return outer.map((v, i) => (v && !inner[i] && !hidden[i] ? 1 : 0));
}

/**
 * How much of the photo's structure a result kept: of the photo's clear edges outside `skip` (the new curtains),
 * the share that has an edge of the result within 3 px, on a 768 px copy. A generator that drops a lamp or moves a
 * chair loses those edges; tone and softness changes don't.
 */
export async function edgeKept(original: Buffer, result: Buffer, width: number, height: number, skip: Mask): Promise<number> {
  const tw = 768;
  const th = Math.round((tw * height) / width);
  const a = await grey(original, width, height, tw, th);
  const b = await grey(result, width, height, tw, th);
  const s = await scaledMask(dilate(skip, width, height, Math.round(width * 0.01)), width, height, tw, th);
  const edges = (g: Buffer) => {
    const m = new Uint8Array(tw * th);
    for (let y = 1; y < th - 1; y++) for (let x = 1; x < tw - 1; x++) {
      const i = y * tw + x;
      if (Math.hypot(g[i + 1]! - g[i - 1]!, g[i + tw]! - g[i - tw]!) > 40) m[i] = 1;
    }
    return m;
  };
  const ea = edges(a);
  const eb = dilate(edges(b), tw, th, 3);
  let total = 0, kept = 0;
  for (let i = 0; i < ea.length; i++) {
    if (!ea[i] || (s[i] ?? 0) >= 128) continue;
    total++;
    if (eb[i]) kept++;
  }
  return total ? kept / total : 1;
}
