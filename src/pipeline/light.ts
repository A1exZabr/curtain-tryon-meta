import type { Mask } from "./region.ts";

// Muse Image lights curtains evenly, as if a lamp stood behind the camera: a curtain in the far, shaded corner comes
// out as bright as one by the nearest window. Here the curtains take the room's own light instead. The light map is
// how bright the room's opaque surfaces are around each point of the original photo (window glass and sky left
// out), blurred so that only the way light falls across the room remains. The curtains keep their folds and their
// average brightness; their large-scale brightness follows the map.

const LINEAR = Float32Array.from({ length: 256 }, (_, v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
function toSrgb(v: number): number {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(c * 255)));
}
function luminance(rgb: Buffer, i: number): number {
  return 0.2126 * LINEAR[rgb[i * 3]!]! + 0.7152 * LINEAR[rgb[i * 3 + 1]!]! + 0.0722 * LINEAR[rgb[i * 3 + 2]!]!;
}

const STEP = 4; // the maps are built at a quarter of the photo's size
const STRENGTH = 0.8; // how far the curtains follow the map (1 = all the way)
const GAIN_MIN = 0.4;
const GAIN_MAX = 1.25;
const SKY = 0.8; // linear luminance above which a pixel is sky, glass glare or a lamp, not a lit surface

/** A coarse map: the mean of `value` over the pixels `use` keeps, smoothed by normalised blurring. */
export class CoarseMap {
  readonly w: number;
  readonly h: number;
  readonly v: Float32Array;

  constructor(width: number, height: number, radius: number, use: (i: number) => boolean, value: (i: number) => number) {
    this.w = Math.ceil(width / STEP);
    this.h = Math.ceil(height / STEP);
    const sum = new Float32Array(this.w * this.h);
    const count = new Float32Array(this.w * this.h);
    for (let y = 0; y < height; y++) {
      const row = Math.floor(y / STEP) * this.w;
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!use(i)) continue;
        const k = row + Math.floor(x / STEP);
        sum[k]! += value(i);
        count[k]! += 1;
      }
    }
    const s = blur(sum, this.w, this.h, radius);
    const c = blur(count, this.w, this.h, radius);
    this.v = new Float32Array(this.w * this.h);
    for (let k = 0; k < this.v.length; k++) this.v[k] = c[k]! > 1e-3 ? s[k]! / c[k]! : Number.NaN;
  }

  /** Bilinear read at a full-size pixel. */
  at(x: number, y: number): number {
    const fx = Math.min(this.w - 1, Math.max(0, (x + 0.5) / STEP - 0.5));
    const fy = Math.min(this.h - 1, Math.max(0, (y + 0.5) / STEP - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(this.w - 1, x0 + 1), y1 = Math.min(this.h - 1, y0 + 1);
    const ax = fx - x0, ay = fy - y0;
    const v = this.v;
    const top = v[y0 * this.w + x0]! * (1 - ax) + v[y0 * this.w + x1]! * ax;
    const bottom = v[y1 * this.w + x0]! * (1 - ax) + v[y1 * this.w + x1]! * ax;
    return top * (1 - ay) + bottom * ay;
  }
}

/** Three passes of a separable box blur: close to a Gaussian, linear in the map's size. */
function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  let a = src.slice();
  let b = new Float32Array(src.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[y * w + Math.min(w - 1, Math.max(0, x))]!;
      for (let x = 0; x < w; x++) {
        b[y * w + x] = acc / (2 * r + 1);
        acc += a[y * w + Math.min(w - 1, x + r + 1)]! - a[y * w + Math.max(0, x - r)]!;
      }
    }
    [a, b] = [b, a];
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += a[Math.min(h - 1, Math.max(0, y)) * w + x]!;
      for (let y = 0; y < h; y++) {
        b[y * w + x] = acc / (2 * r + 1);
        acc += a[Math.min(h - 1, y + r + 1) * w + x]! - a[Math.max(0, y - r) * w + x]!;
      }
    }
    [a, b] = [b, a];
  }
  return a;
}

export interface Relight {
  /** The room's light map as an 8-bit grey image at a quarter size, for the debug view. */
  map: { data: Buffer; width: number; height: number };
  /** Smallest and largest brightness factor applied to the curtains. */
  minGain: number;
  maxGain: number;
}

/**
 * Relights the curtains in `generated` (in place) with the light of `original`. `glass` is the window area, left out
 * of the light map along with anything as bright as the sky.
 */
/** The room's light map: how bright its opaque surfaces are around each point, glass and sky left out. */
export function roomLight(original: Buffer, glass: Mask, width: number, height: number): CoarseMap {
  const lowW = Math.ceil(width / STEP);
  return new CoarseMap(width, height, Math.max(3, Math.round(lowW / 12)), (i) => !glass[i] && luminance(original, i) < SKY, (i) =>
    luminance(original, i),
  );
}

/**
 * The light map as an 8-bit grey image at a quarter size, stretched from the darkest to the brightest place so it
 * shows where the room is lit and where it isn't.
 */
export function lightImage(room: CoarseMap): { data: Buffer; width: number; height: number } {
  let low = Infinity, top = 0;
  for (const v of room.v) if (Number.isFinite(v)) { low = Math.min(low, v); top = Math.max(top, v); }
  const data = Buffer.alloc(room.w * room.h);
  for (let k = 0; k < data.length; k++) {
    const v = room.v[k]!;
    data[k] = Number.isFinite(v) && top > low ? Math.round((255 * (v - low)) / (top - low)) : 0;
  }
  return { data, width: room.w, height: room.h };
}

export function relightCurtains(original: Buffer, generated: Buffer, curtains: Mask, glass: Mask, width: number, height: number): Relight {
  const lowW = Math.ceil(width / STEP);
  const room = roomLight(original, glass, width, height);
  const drape = new CoarseMap(width, height, Math.max(2, Math.round(lowW / 30)), (i) => curtains[i] === 1, (i) => luminance(generated, i));

  // Averages over the curtains, so the curtains keep their overall brightness and only its spread changes.
  let lightSum = 0, drapeSum = 0, n = 0;
  for (let i = 0; i < curtains.length; i += 2) {
    if (!curtains[i]) continue;
    const x = i % width, y = (i - x) / width;
    const light = room.at(x, y);
    if (!Number.isFinite(light)) continue;
    lightSum += light;
    drapeSum += luminance(generated, i);
    n++;
  }
  let minGain = 1, maxGain = 1;
  if (n > 0 && lightSum > 0) {
    const meanLight = lightSum / n;
    const meanDrape = drapeSum / n;
    for (let i = 0; i < curtains.length; i++) {
      if (!curtains[i]) continue;
      const x = i % width, y = (i - x) / width;
      const light = room.at(x, y);
      const level = drape.at(x, y);
      if (!Number.isFinite(light) || !Number.isFinite(level) || level <= 1e-5) continue;
      const wanted = (meanDrape * light) / meanLight;
      const gain = Math.min(GAIN_MAX, Math.max(GAIN_MIN, (wanted / level) ** STRENGTH));
      minGain = Math.min(minGain, gain);
      maxGain = Math.max(maxGain, gain);
      const j = i * 3;
      generated[j] = toSrgb(LINEAR[generated[j]!]! * gain);
      generated[j + 1] = toSrgb(LINEAR[generated[j + 1]!]! * gain);
      generated[j + 2] = toSrgb(LINEAR[generated[j + 2]!]! * gain);
    }
  }

  return { map: lightImage(room), minGain, maxGain };
}
