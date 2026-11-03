import type { Segment } from "../meta/sam.ts";

export type Mask = Uint8Array; // width * height, 0 or 1

/**
 * Windows worth dressing: SAM also finds specks, reflections and tiny panes, so keep windows of at least 0.5% of
 * the frame. The bar relative to the largest window stays low on purpose: in a room with a row of windows the far
 * ones look ten or twenty times smaller than the near one, and they get curtains too.
 */
export function mainWindows(windows: Segment[], width: number, height: number): Segment[] {
  const largest = Math.max(0, ...windows.map((w) => w.area));
  return frontWindows(windows.filter((w) => w.area >= largest * 0.04 && w.area >= width * height * 0.005));
}

/**
 * Drops a window that lies almost wholly inside a larger window's or door's outline: it is either seen through
 * it (the balcony's windows behind a balcony door) or one of its own panes. The curtains belong to the front one.
 */
export function frontWindows(windows: Segment[]): Segment[] {
  const boxArea = (b: Segment["box"]) => Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  return windows.filter((w) => {
    const own = boxArea(w.box);
    return !windows.some((o) => {
      if (o === w || boxArea(o.box) <= own) return false;
      const inside = boxArea({
        x1: Math.max(w.box.x1, o.box.x1),
        y1: Math.max(w.box.y1, o.box.y1),
        x2: Math.min(w.box.x2, o.box.x2),
        y2: Math.min(w.box.y2, o.box.y2),
      });
      return own > 0 && inside / own >= 0.8;
    });
  });
}

/**
 * Windows standing side by side, closer than a fifth of the wider one's width and level with each other, as one
 * box: the two leaves of a balcony door, or a door with the balcony window seen through it, get curtains as one
 * opening.
 */
export function windowGroups(windows: Segment[]): Segment["box"][] {
  const boxes = windows.map((w) => ({ ...w.box }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!, b = boxes[j]!;
        const gap = Math.max(a.x1, b.x1) - Math.min(a.x2, b.x2);
        const overlapY = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
        const minH = Math.min(a.y2 - a.y1, b.y2 - b.y1);
        if (gap <= 0.2 * Math.max(a.x2 - a.x1, b.x2 - b.x1) && overlapY >= 0.5 * minH) {
          boxes[i] = { x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) };
          boxes.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return boxes;
}

/**
 * Where curtains are allowed to be: for each group of windows, from the top of the photo (rods and ceiling tracks
 * often sit at the ceiling, well above the frame) down to the bottom, and 60% of the group's width out to each
 * side (rods usually run wider than the frame). Existing curtains are added too, since they have to be replaced
 * wherever they hang.
 */
export function allowedRegion(
  windows: Segment[],
  oldCurtains: Segment[],
  width: number,
  height: number,
): Mask {
  const region = new Uint8Array(width * height);
  for (const box of windowGroups(windows)) {
    const ww = box.x2 - box.x1;
    const left = Math.max(0, Math.floor(box.x1 - ww * 0.6));
    const right = Math.min(width, Math.ceil(box.x2 + ww * 0.6));
    for (let y = 0; y < height; y++) region.fill(1, y * width + left, y * width + right);
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

export function erode(mask: Mask, width: number, height: number, r: number): Mask {
  const inverse = mask.map((v) => (v ? 0 : 1));
  return dilate(inverse, width, height, r).map((v) => (v ? 0 : 1));
}

/** Dilate then erode: merges fragments a few pixels apart into one solid shape and fills small holes. */
export function close(mask: Mask, width: number, height: number, r: number): Mask {
  return erode(dilate(mask, width, height, r), width, height, r);
}

/** Drops connected pieces smaller than `minArea` pixels (SAM leaves crumbs where curtains peek behind furniture). */
export function dropSmall(mask: Mask, width: number, height: number, minArea: number): Mask {
  const out = mask.slice();
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  const piece: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    stack.push(start);
    seen[start] = 1;
    piece.length = 0;
    while (stack.length) {
      const i = stack.pop()!;
      piece.push(i);
      const x = i % width;
      const y = (i - x) / width;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < width - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && mask[i - width] && !seen[i - width]) { seen[i - width] = 1; stack.push(i - width); }
      if (y < height - 1 && mask[i + width] && !seen[i + width]) { seen[i + width] = 1; stack.push(i + width); }
    }
    if (piece.length < minArea) for (const i of piece) out[i] = 0;
  }
  return out;
}
