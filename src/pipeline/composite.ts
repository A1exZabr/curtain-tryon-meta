import sharp from "sharp";
import type { Mask } from "./region.ts";

/**
 * Takes the generated pixels only inside `paste` and the original pixels everywhere else, with a soft edge of
 * about `feather` pixels inside the mask. The opacity starts from 0 at the mask's border and reaches 1 a little
 * under `feather` pixels in, so there is no step at the border and whatever lies deeper than that (the curtain
 * itself, when the mask was grown by `feather`) is fully opaque. Outside the mask the output is byte-for-byte the
 * original photo.
 */
export async function composite(
  original: Buffer,
  generated: Buffer,
  paste: Mask,
  width: number,
  height: number,
  feather: number,
): Promise<Buffer> {
  const hard = Buffer.from(paste.map((v) => (v ? 255 : 0)));
  // sharp's blur on one-channel raw input comes back with three channels; keep the first.
  const soft =
    feather > 0
      ? await sharp(hard, { raw: { width, height, channels: 1 } })
          .blur(Math.max(0.3, feather / 2))
          .extractChannel(0)
          .raw()
          .toBuffer()
      : hard;
  const out = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    // The blurred mask is 0.5 right at the border and close to 1 two sigmas in; stretch that to 0..1. Outside the
    // hard mask alpha is exactly 0.
    const alpha = paste[i] ? Math.min(1, Math.max(0, ((soft[i] ?? 0) / 255 - 0.5) / 0.45)) : 0;
    for (let c = 0; c < 3; c++) {
      const j = i * 3 + c;
      out[j] = alpha === 0 ? original[j]! : Math.round(original[j]! * (1 - alpha) + generated[j]! * alpha);
    }
  }
  return out;
}

/** Draws masks over the photo in colour, for the debug view and the demo's "how it works" panel. */
export async function overlay(
  rgb: Buffer,
  width: number,
  height: number,
  layers: { mask: Mask; colour: [number, number, number]; alpha: number }[],
): Promise<Buffer> {
  const out = Buffer.from(rgb);
  for (const { mask, colour, alpha } of layers) {
    for (let i = 0; i < width * height; i++) {
      if (!mask[i]) continue;
      for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(out[i * 3 + c]! * (1 - alpha) + colour[c]! * alpha);
    }
  }
  return sharp(out, { raw: { width, height, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
}
