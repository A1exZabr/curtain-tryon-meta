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

export async function loadPhoto(input: Buffer, longSide = WORK_LONG_SIDE): Promise<Photo> {
  const resized = sharp(input)
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
  return sharp(input).removeAlpha().resize(width, height, { fit: "fill" }).toColourspace("srgb").raw().toBuffer();
}

export async function rgbToJpeg(rgb: Buffer, width: number, height: number, quality = 92): Promise<Buffer> {
  return sharp(rgb, { raw: { width, height, channels: 3 } }).jpeg({ quality }).toBuffer();
}

export function jpegDataUrl(jpeg: Buffer): string {
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}
