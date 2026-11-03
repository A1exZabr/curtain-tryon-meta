// Re-measures the window check on saved runs: SAM finds the windows on before.jpg, and each generated-N.jpg (the
// aligned generator output) is compared with it inside them. Usage: npx tsx ops/window-diff.ts <runDir> [...]
import { existsSync, readFileSync } from "node:fs";
import { CostLog } from "../src/budget.ts";
import { segment } from "../src/meta/sam.ts";
import { loadPhoto, toSize } from "../src/pipeline/images.ts";
import { applyAlignment, findAlignment, windowMatch, windowOutline } from "../src/pipeline/align.ts";
import { dilate, mainWindows, union } from "../src/pipeline/region.ts";
import { jpegDataUrl } from "../src/pipeline/images.ts";

const costs = new CostLog();
for (const dir of process.argv.slice(2)) {
  const room = await loadPhoto(readFileSync(`${dir}/before.jpg`));
  const windows = mainWindows(await segment(room, "window", costs), room.width, room.height);
  const mask = union(windows.map((w) => w.mask), room.width * room.height);
  const report = existsSync(`${dir}/report.json`) ? JSON.parse(readFileSync(`${dir}/report.json`, "utf8")) : undefined;
  const parts: string[] = [];
  for (let n = 1; existsSync(`${dir}/generated-${n}.jpg`); n++) {
    // Lay the saved output over the photo again with the current alignment search.
    const raw = await toSize(readFileSync(`${dir}/generated-${n}.jpg`), room.width, room.height);
    const frame = dilate(mask, room.width, room.height, Math.round(room.width * 0.03));
    const alignment = await findAlignment(room.rgb, raw, room.width, room.height, frame);
    const gen = await applyAlignment(raw, room.width, room.height, alignment);
    const d = -1;
    const jpeg = readFileSync(`${dir}/generated-${n}.jpg`);
    const curtains = union((await segment({ dataUrl: jpegDataUrl(jpeg), width: room.width, height: room.height }, "curtains", costs)).map((c) => c.mask), mask.length);
    const dv = await windowMatch(room.rgb, gen, room.width, room.height, windowOutline(mask, curtains, room.width, room.height));
    parts.push(`outline diff ${dv}`);
    const a = report?.attempts?.[n - 1];
    parts.push(`#${n} diff ${d} (was ${a?.geometry?.windowDiff ?? "?"}, ${a?.passed ? "accepted" : a?.why?.slice(0, 50) ?? "?"})`);
  }
  console.log(`${dir}: ${windows.length} windows  ${parts.join("  ")}`);
}
console.log(`cost $${costs.totalUsd.toFixed(4)}`);
