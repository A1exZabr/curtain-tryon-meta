import sharp from "sharp";
import { WORK_LONG_SIDE } from "../config.ts";

/** A photo held in memory as raw RGB at a fixed working size, plus a JPEG copy for the APIs. */
export interface Photo {
  width: number;
  height: number;
  rgb: Buffer; // width * height * 3
  jpeg: Buffer;
  dataUrl: string;
}

/**
 * Photos come from anyone on the internet: a small file can declare a huge picture and take the server's memory
 * when decoded. 40 megapixels is more than any phone camera gives; sharp refuses anything bigger before decoding.
 */
export const MAX_INPUT_PIXELS = 40_000_000;
export const PHOTO_FORMATS = new Set(["jpeg", "png", "webp"]);

/** Reads only the header: whether this is a photo the pipeline takes, in a format and size it decodes safely. */
export async function isPhoto(input: Buffer): Promise<boolean> {
  try {
    const meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    return PHOTO_FORMATS.has(meta.format ?? "") && (meta.width ?? 0) * (meta.height ?? 0) <= MAX_INPUT_PIXELS;
  } catch {
    return false;
  }
}

export async function loadPhoto(input: Buffer, longSide = WORK_LONG_SIDE): Promise<Photo> {
  const resized = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate() // apply the EXIF orientation phones write
    .resize({ width: longSide, height: longSide, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .toColourspace("srgb");
  const { data, info } = await resized.clone().raw().toBuffer({ resolveWithObject: true });
  const jpeg = await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();
  return {
    width: info.width,
    height: info.height,
    rgb: data,
    jpeg,
    dataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
  };
}

/** Scales an image (e.g. the generator's output) to exactly the given size, as raw RGB. */
export async function toSize(input: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).removeAlpha().resize(width, height, { fit: "fill" }).toColourspace("srgb").raw().toBuffer();
}

export async function rgbToJpeg(rgb: Buffer, width: number, height: number, quality = 92): Promise<Buffer> {
  return sharp(rgb, { raw: { width, height, channels: 3 } }).jpeg({ quality }).toBuffer();
}

export function jpegDataUrl(jpeg: Buffer): string {
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

/**
 * Close-ups of where `result` differs from `original` (the new curtains), for the result check: small cut edges and
 * seams are lost on a whole frame. A wide changed area is split into a left and a right close-up.
 */
export async function closeUps(original: Buffer, result: Buffer, width: number, height: number): Promise<string[]> {
  let x1 = width, y1 = height, x2 = -1, y2 = -1;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 3;
      if (Math.abs(original[i]! - result[i]!) + Math.abs(original[i + 1]! - result[i + 1]!) + Math.abs(original[i + 2]! - result[i + 2]!) > 60) {
        if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
      }
    }
  }
  if (x2 < 0) return [];
  const pad = Math.round(width * 0.03);
  x1 = Math.max(0, x1 - pad); y1 = Math.max(0, y1 - pad); x2 = Math.min(width - 1, x2 + pad); y2 = Math.min(height - 1, y2 + pad);
  const boxes = x2 - x1 > width * 0.5
    ? [{ left: x1, width: Math.round((x2 - x1) / 2) }, { left: x1 + Math.round((x2 - x1) / 2), width: x2 - x1 - Math.round((x2 - x1) / 2) }]
    : [{ left: x1, width: x2 - x1 }];
  return Promise.all(
    boxes.map(async (b) =>
      jpegDataUrl(
        await sharp(result, { raw: { width, height, channels: 3 } })
          .extract({ left: b.left, top: y1, width: Math.max(8, b.width), height: Math.max(8, y2 - y1) })
          .resize({ width: 1024, height: 1024, fit: "inside" })
          .jpeg({ quality: 88 })
          .toBuffer(),
      ),
    ),
  );
}
