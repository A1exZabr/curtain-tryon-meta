// Measures the result check on labelled results: each case is a run folder (before.jpg, result.jpg, report.json)
// with the fabric photo and whether a careful person would accept the picture.
// Usage: ops/with-env.sh npx tsx ops/judge-eval.ts <cases.json>
import { readFileSync } from "node:fs";
import { CostLog } from "../src/budget.ts";
import { askJson, expectedFor, verdictPasses, verdictPrompt, verdictSchema } from "../src/meta/vision.ts";
import sharp from "sharp";
import { closeUps, jpegDataUrl, loadPhoto } from "../src/pipeline/images.ts";

const cases = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as { dir: string; fabric: string; good: boolean; note: string }[];
const costs = new CostLog();
let right = 0;
const rows = await Promise.all(cases.map(async (c) => {
  const report = JSON.parse(readFileSync(`${c.dir}/report.json`, "utf8"));
  const fabric = await loadPhoto(readFileSync(c.fabric), 1024);
  const before = await sharp(`${c.dir}/before.jpg`).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const after = await sharp(`${c.dir}/result.jpg`).removeAlpha().resize(before.info.width, before.info.height, { fit: "fill" }).raw().toBuffer();
  const close = process.env.NO_CLOSEUPS ? [] : await closeUps(before.data, after, before.info.width, before.info.height);
  const votes = Number(process.env.VOTES ?? 1);
  const ask = () => askJson("spark-open", "result check", verdictPrompt(report.scene), [
    { caption: "Original room:", dataUrl: jpegDataUrl(readFileSync(`${c.dir}/before.jpg`)) },
    { caption: "Result:", dataUrl: jpegDataUrl(readFileSync(`${c.dir}/result.jpg`)) },
    { caption: "Fabric:", dataUrl: fabric.dataUrl },
    ...close.map((dataUrl) => ({ caption: "Close-up of the result:", dataUrl })),
  ], verdictSchema, costs);
  const all = await Promise.all(Array.from({ length: votes }, ask));
  const passes = all.filter((v) => verdictPasses(v, expectedFor(report.scene))).length;
  const pass = passes * 2 > votes;
  const v = { score: all.map((x) => x.score).join("/"), defects: [...new Set(all.flatMap((x) => x.defects))] };
  return { c, pass, v };
}));
for (const { c, pass, v } of rows) {
  const ok = pass === c.good;
  if (ok) right++;
  console.log(`${ok ? "ok  " : "MISS"} ${c.good ? "good" : "bad "} -> ${pass ? "accept" : "reject"}  ${c.dir}  ${v.score} ${v.defects.join(",")}  | ${c.note}`);
}
console.log(`${right} of ${cases.length} right, cost $${costs.totalUsd.toFixed(3)}`);
