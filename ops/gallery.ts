// Turns a CLI run into a gallery entry for the demo page.
// Usage: npx tsx ops/gallery.ts <runDir> <fabric.jpg> <id> "<caption>"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
const [run, fabricPath, id, caption = ""] = process.argv.slice(2) as [string, string, string, string?];
const dir = process.env.GALLERY_DIR ?? "gallery";
mkdirSync(dir, { recursive: true });
const report = JSON.parse(readFileSync(`${run}/report.json`, "utf8"));
if (report.status !== "accepted") throw new Error(`${run} was not accepted (${report.status})`);
await sharp(`${run}/before.jpg`).resize({ width: 1400, withoutEnlargement: true }).jpeg({ quality: 84 }).toFile(`${dir}/${id}-before.jpg`);
await sharp(`${run}/result.jpg`).resize({ width: 1400, withoutEnlargement: true }).jpeg({ quality: 84 }).toFile(`${dir}/${id}-after.jpg`);
await sharp(fabricPath).resize(160, 160).jpeg({ quality: 80 }).toFile(`${dir}/${id}-fabric.jpg`);
writeFileSync(`${dir}/${id}.json`, JSON.stringify({
  id, caption,
  before: `/gallery/${id}-before.jpg`, after: `/gallery/${id}-after.jpg`, fabric: `/gallery/${id}-fabric.jpg`,
  totalUsd: report.totalUsd, ms: report.ms, attempts: report.attempts.length,
}, null, 2));
console.log(`gallery/${id}.json`);
