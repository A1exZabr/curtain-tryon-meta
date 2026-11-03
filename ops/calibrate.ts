// Calibrates the "window still in place" measure on finished eval runs, and probes SAM phrases for glass walls.
import { existsSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { CostLog } from "../src/budget.ts";
import { segment } from "../src/meta/sam.ts";
import { loadPhoto } from "../src/pipeline/images.ts";
import { mainWindows, union } from "../src/pipeline/region.ts";
import { windowMatch } from "../src/pipeline/align.ts";
const costs = new CostLog();
for (const job of ["01", "02", "03", "04", "05", "06", "07", "09", "12"]) {
  const room = await loadPhoto(readFileSync(`out/eval/${job}/before.jpg`));
  const windows = mainWindows(await segment(room, "window", costs), room.width, room.height);
  const mask = union(windows.map((w) => w.mask), room.width * room.height);
  const status = JSON.parse(readFileSync(`out/eval/${job}/report.json`, "utf8")).status;
  const scores: string[] = [];
  for (const n of [1, 2]) {
    const path = `out/eval/${job}/generated-${n}.jpg`;
    if (!existsSync(path)) continue;
    const gen = await sharp(readFileSync(path)).resize(room.width, room.height, { fit: "fill" }).removeAlpha().raw().toBuffer();
    scores.push((await windowMatch(room.rgb, gen, room.width, room.height, mask)).toFixed(1));
  }
  console.log(job, status, "window diff p40:", scores.join(" / "));
}
for (const id of ["room-08", "room-11"]) {
  const room = await loadPhoto(readFileSync(`data/eval-cache/${id}.jpg`));
  for (const phrase of ["window", "glass door", "glass wall", "large window"]) {
    const s = await segment(room, phrase, costs);
    console.log(id, phrase, s.map((x) => `${((100 * x.area) / (room.width * room.height)).toFixed(1)}% c=${x.confidence?.toFixed(2)}`).join(", ") || "none");
  }
}
console.log(`$${costs.totalUsd.toFixed(4)}`);
