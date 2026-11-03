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
 * Generators drift the fabric's colour (usually darker and more saturated). Pulls the curtains' mean colour to the
 * fabric's hue, and half of the lightness gap, by scaling each linear RGB channel, the way a white balance does.
 * Scaling keeps every fold and shadow in proportion: a dark fold stays as dark relative to the lit cloth around it
 * and doesn't turn milky or oversaturated, which a flat Lab offset did. Lightness only moves halfway because
 * curtains against a bright window really are darker than a swatch.
 */
export function lockFabricColour(rgb: Buffer, curtains: Mask, fabric: [number, number, number]): ColourLock {
  let R = 0, G = 0, B = 0, n = 0;
  for (let i = 0; i < curtains.length; i += 3) {
    if (!curtains[i]) continue;
    R += srgbToLinear(rgb[i * 3]!); G += srgbToLinear(rgb[i * 3 + 1]!); B += srgbToLinear(rgb[i * 3 + 2]!);
    n++;
  }
  if (!n) return { before: fabric, target: fabric, deltaE: 0 };
  const mean = [R / n, G / n, B / n] as const;
  const before = rgbToLab(linearToSrgb(mean[0]), linearToSrgb(mean[1]), linearToSrgb(mean[2]));
  // The fabric's colour at the lightness halfway between the curtains' and the swatch's.
  const target = labToLinear((before[0] + fabric[0]) / 2, fabric[1], fabric[2]);
  const gain = [0, 1, 2].map((c) => Math.min(5, Math.max(0.2, target[c]! / Math.max(1e-4, mean[c]!))));
  for (let i = 0; i < curtains.length; i++) {
    if (!curtains[i]) continue;
    const j = i * 3;
    rgb[j] = linearToSrgb(srgbToLinear(rgb[j]!) * gain[0]!);
    rgb[j + 1] = linearToSrgb(srgbToLinear(rgb[j + 1]!) * gain[1]!);
    rgb[j + 2] = linearToSrgb(srgbToLinear(rgb[j + 2]!) * gain[2]!);
  }
  const deltaE = Math.hypot(fabric[0] - before[0], fabric[1] - before[1], fabric[2] - before[2]);
  return { before, target: fabric, deltaE };
}

function labToLinear(L: number, a: number, bb: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const x = fInv(fy + a / 500) * 0.95047, y = fInv(fy), z = fInv(fy - bb / 200) * 1.08883;
  return [
    Math.max(0, 3.2406 * x - 1.5372 * y - 0.4986 * z),
    Math.max(0, -0.9689 * x + 1.8758 * y + 0.0415 * z),
    Math.max(0, 0.0557 * x - 0.204 * y + 1.057 * z),
  ];
}
