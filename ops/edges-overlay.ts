// Draws the photo's edges in red over the result, to see where the result's geometry left the photo's.
// Usage: npx tsx ops/edges-overlay.ts <runDir> <out.jpg>
import sharp from "sharp";
const [dir, out] = process.argv.slice(2) as [string, string];
const before = await sharp(`${dir}/before.jpg`).greyscale().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h } = before.info;
const result = await sharp(`${dir}/result.jpg`).removeAlpha().resize(w, h, { fit: "fill" }).raw().toBuffer();
const g = before.data;
const outBuf = Buffer.from(result);
for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
  const i = y * w + x;
  const gx = g[i + 1]! - g[i - 1]!, gy = g[i + w]! - g[i - w]!;
  if (Math.hypot(gx, gy) > 60) { outBuf[i * 3] = 255; outBuf[i * 3 + 1] = 0; outBuf[i * 3 + 2] = 0; }
}
await sharp(outBuf, { raw: { width: w, height: h, channels: 3 } }).resize({ height: 520 }).jpeg({ quality: 85 }).toFile(out);
