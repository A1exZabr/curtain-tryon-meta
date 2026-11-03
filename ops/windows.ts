// Lists the windows SAM 3.1 finds on photos and which of them mainWindows keeps. Costs one SAM call per photo.
// Usage: ops/with-env.sh npx tsx ops/windows.ts <photo.jpg> [...]
import { readFileSync } from "node:fs";
import { CostLog } from "../src/budget.ts";
import { segment } from "../src/meta/sam.ts";
import { loadPhoto } from "../src/pipeline/images.ts";
import { mainWindows } from "../src/pipeline/region.ts";

const costs = new CostLog();
for (const path of process.argv.slice(2)) {
  const room = await loadPhoto(readFileSync(path));
  const found = await segment(room, "window", costs);
  const kept = new Set(mainWindows(found, room.width, room.height));
  const largest = Math.max(1, ...found.map((w) => w.area));
  const frame = room.width * room.height;
  console.log(`${path}: ${found.length} found, ${kept.size} kept`);
  for (const w of [...found].sort((a, b) => b.area - a.area)) {
    const { x1, y1, x2, y2 } = w.box;
    console.log(
      `  ${kept.has(w) ? "keep" : "drop"} ${((100 * w.area) / frame).toFixed(1)}% of frame, ${((100 * w.area) / largest).toFixed(0)}% of largest,` +
        ` box ${Math.round(x1)},${Math.round(y1)}-${Math.round(x2)},${Math.round(y2)} conf ${w.confidence?.toFixed(2) ?? "?"}`,
    );
  }
}
console.log(`cost $${costs.totalUsd.toFixed(4)}`);
