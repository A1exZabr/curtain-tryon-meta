import type { Mask } from "./region.ts";

// sRGB <-> CIE Lab (D65), enough precision for shifting a colour cast.
function srgbToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function linearToSrgb(v: number): number {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(c * 255)));
}
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (t * 24389) / 27 / 116 + 16 / 116);
const fInv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : ((116 * t - 16) * 27) / 24389);

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToRgb(L: number, a: number, bb: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - bb / 200;
  const x = fInv(fx) * 0.95047, y = fInv(fy), z = fInv(fz) * 1.08883;
  const R = 3.2406 * x - 1.5372 * y - 0.4986 * z;
  const G = -0.9689 * x + 1.8758 * y + 0.0415 * z;
  const B = 0.0557 * x - 0.204 * y + 1.057 * z;
  return [linearToSrgb(R), linearToSrgb(G), linearToSrgb(B)];
}

/** Mean Lab colour of the central part of a fabric photo (the edges are often shadow or background). */
export function fabricLab(rgb: Buffer, width: number, height: number): [number, number, number] {
  let L = 0, A = 0, B = 0, n = 0;
  for (let y = Math.floor(height * 0.2); y < height * 0.8; y += 2) {
    for (let x = Math.floor(width * 0.2); x < width * 0.8; x += 2) {
      const i = (y * width + x) * 3;
      const [l, a, b] = rgbToLab(rgb[i]!, rgb[i + 1]!, rgb[i + 2]!);
      L += l; A += a; B += b; n++;
    }
  }
  return [L / n, A / n, B / n];
}

export interface ColourLock {
  before: [number, number, number];
  target: [number, number, number];
  deltaE: number; // distance between the curtains' mean colour and the fabric before the lock
}

/**
 * Generators drift the fabric's colour (usually darker and more saturated). Moves the curtains' mean hue to the
 * fabric's, and half of the lightness gap, keeping every fold and shadow: each pixel is shifted by the same Lab
 * offset. Lightness only moves halfway because curtains against a bright window really are darker than a swatch.
 */
export function lockFabricColour(rgb: Buffer, curtains: Mask, fabric: [number, number, number]): ColourLock {
  let L = 0, A = 0, B = 0, n = 0;
  for (let i = 0; i < curtains.length; i += 3) {
    if (!curtains[i]) continue;
    const [l, a, b] = rgbToLab(rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!);
    L += l; A += a; B += b; n++;
  }
  const before: [number, number, number] = n ? [L / n, A / n, B / n] : fabric;
  const dL = (fabric[0] - before[0]) * 0.5;
  const dA = fabric[1] - before[1];
  const dB = fabric[2] - before[2];
  for (let i = 0; i < curtains.length; i++) {
    if (!curtains[i]) continue;
    const j = i * 3;
    const [l, a, b] = rgbToLab(rgb[j]!, rgb[j + 1]!, rgb[j + 2]!);
    const [r, g, bl] = labToRgb(l + dL, a + dA, b + dB);
    rgb[j] = r; rgb[j + 1] = g; rgb[j + 2] = bl;
  }
  const deltaE = Math.hypot(fabric[0] - before[0], fabric[1] - before[1], fabric[2] - before[2]);
  return { before, target: fabric, deltaE };
}
