// How much of the photo's structure the result kept: the share of the photo's strong edges (outside the new
// curtains) that have an edge within a few pixels in the result. Usage: npx tsx ops/edge-kept.ts <runDir> [...]
import sharp from "sharp";
import { edgeKept } from "../src/pipeline/align.ts";
for (const dir of process.argv.slice(2)) {
  const before = await sharp(`${dir}/before.jpg`).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = before.info;
  const result = await sharp(`${dir}/result.jpg`).removeAlpha().resize(w, h, { fit: "fill" }).raw().toBuffer();
  const changed = new Uint8Array(w * h);
  for (let i = 0; i < changed.length; i++) {
    const d = Math.abs(before.data[i * 3]! - result[i * 3]!) + Math.abs(before.data[i * 3 + 1]! - result[i * 3 + 1]!) + Math.abs(before.data[i * 3 + 2]! - result[i * 3 + 2]!);
    changed[i] = d > 150 ? 1 : 0;
  }
  console.log(dir, (await edgeKept(before.data, result, w, h, changed)).toFixed(2));
}
