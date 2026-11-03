import type { Segment } from "../meta/sam.ts";

export type Mask = Uint8Array; // width * height, 0 or 1

/**
 * Windows worth dressing: SAM also finds small panes, reflections and pictures, so keep only windows at least a
 * quarter the size of the largest one and at least 1% of the frame.
 */
export function mainWindows(windows: Segment[], width: number, height: number): Segment[] {
  const largest = Math.max(0, ...windows.map((w) => w.area));
  return windows.filter((w) => w.area >= largest * 0.25 && w.area >= width * height * 0.01);
}

/**
 * Where curtains are allowed to be: for each window, from a little above the frame (where a rod hangs) down to
 * the bottom of the photo, and 60% of the window's width out to each side (rods usually run wider than the
 * frame). Existing curtains are added too, since they have to be replaced wherever they hang.
 */
export function allowedRegion(
  windows: Segment[],
  oldCurtains: Segment[],
  width: number,
  height: number,
): Mask {
  const region = new Uint8Array(width * height);
  for (const w of windows) {
    const ww = w.box.x2 - w.box.x1;
    const wh = w.box.y2 - w.box.y1;
    const left = Math.max(0, Math.floor(w.box.x1 - ww * 0.6));
    const right = Math.min(width, Math.ceil(w.box.x2 + ww * 0.6));
    const top = Math.max(0, Math.floor(w.box.y1 - Math.max(wh * 0.15, height * 0.04)));
    for (let y = top; y < height; y++) region.fill(1, y * width + left, y * width + right);
  }
  for (const c of oldCurtains) or(region, dilate(c.mask, width, height, Math.round(width * 0.01)));
  return region;
}

export function union(masks: Mask[], size: number): Mask {
  const out = new Uint8Array(size);
  for (const m of masks) or(out, m);
  return out;
}

export function or(into: Mask, other: Mask): void {
  for (let i = 0; i < into.length; i++) if (other[i]) into[i] = 1;
}

export function and(a: Mask, b: Mask): Mask {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] && b[i] ? 1 : 0;
  return out;
}

export function area(mask: Mask): number {
  let n = 0;
  for (const v of mask) n += v;
  return n;
}

/** Square dilation by `r` pixels, done as two 1-D passes so it stays linear in the image size. */
export function dilate(mask: Mask, width: number, height: number, r: number): Mask {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    let last = -Infinity;
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) last = x;
      if (x - last <= r) tmp[y * width + x] = 1;
    }
    last = Infinity;
    for (let x = width - 1; x >= 0; x--) {
      if (mask[y * width + x]) last = x;
      if (last - x <= r) tmp[y * width + x] = 1;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < width; x++) {
    let last = -Infinity;
    for (let y = 0; y < height; y++) {
      if (tmp[y * width + x]) last = y;
      if (y - last <= r) out[y * width + x] = 1;
    }
    last = Infinity;
    for (let y = height - 1; y >= 0; y--) {
      if (tmp[y * width + x]) last = y;
      if (last - y <= r) out[y * width + x] = 1;
    }
  }
  return out;
}
