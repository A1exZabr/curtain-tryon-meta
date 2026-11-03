// Builds the still images for the demo video from one finished run.
// Usage: npx tsx ops/video-assets.ts <runDir> <attempt> <outDir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const [run, attempt = "1", out = "out/video-assets"] = process.argv.slice(2) as [string, string?, string?];
mkdirSync(out, { recursive: true });
const W = 1600;
const load = async (name: string) => {
  const img = sharp(`${run}/${name}`).resize({ width: W }).removeAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
};

const before = await load("before.jpg");
const generated = await load(`generated-${attempt}.jpg`);
const pasteOverlay = await load(`paste-${attempt}.jpg`);
const { w, h } = before;

// The paste mask is drawn green over the generated image; recover it by where the overlay turned green.
const pasted = new Uint8Array(w * h);
for (let i = 0; i < w * h; i++) {
  // The overlay is 60% image + 40% (0, 220, 120): red always drops by 40%, so look for that drop.
  const r0 = generated.data[i * 3]!;
  const r1 = pasteOverlay.data[i * 3]!;
  if (r0 > 20 && r0 - r1 > Math.max(12, r0 * 0.25) && pasteOverlay.data[i * 3 + 1]! >= r1) pasted[i] = 1;
}

// Red where the raw generator changed the room outside the pasted curtains.
const heat = Buffer.from(generated.data);
let changed = 0, outside = 0;
for (let i = 0; i < w * h; i++) {
  if (pasted[i]) continue;
  outside++;
  const j = i * 3;
  const d = (Math.abs(before.data[j]! - generated.data[j]!) + Math.abs(before.data[j + 1]! - generated.data[j + 1]!) + Math.abs(before.data[j + 2]! - generated.data[j + 2]!)) / 3;
  if (d > 16) {
    changed++;
    heat[j] = Math.round(heat[j]! * 0.35 + 235 * 0.65);
    heat[j + 1] = Math.round(heat[j + 1]! * 0.35 + 40 * 0.65);
    heat[j + 2] = Math.round(heat[j + 2]! * 0.35 + 40 * 0.65);
  }
}
const raw = (b: Buffer) => sharp(b, { raw: { width: w, height: h, channels: 3 } });
await raw(heat).jpeg({ quality: 88 }).toFile(`${out}/changed.jpg`);
await raw(before.data).jpeg({ quality: 90 }).toFile(`${out}/before.jpg`);
await raw(generated.data).jpeg({ quality: 90 }).toFile(`${out}/generated.jpg`);
await sharp(`${run}/segmentation.jpg`).resize({ width: W }).jpeg({ quality: 88 }).toFile(`${out}/segmentation.jpg`);
await sharp(`${run}/paste-${attempt}.jpg`).resize({ width: W }).jpeg({ quality: 88 }).toFile(`${out}/paste.jpg`);
await sharp(`${run}/result.jpg`).resize({ width: W }).jpeg({ quality: 90 }).toFile(`${out}/result.jpg`);
const report = JSON.parse(readFileSync(`${run}/report.json`, "utf8"));
writeFileSync(`${out}/facts.json`, JSON.stringify({ scene: report.scene, attempt: report.attempts.at(-1), costs: report.costs, totalUsd: report.totalUsd, ms: report.ms, changedShare: changed / outside }, null, 2));
console.log(`changed outside the curtains in the raw output: ${((100 * changed) / outside).toFixed(1)}%`);
