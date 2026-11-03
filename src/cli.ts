// Runs one try-on from the command line and writes the result, the debug pictures and a JSON report.
// Usage: ops/with-env.sh npm run tryon -- --room room.jpg --fabric fabric.jpg [--style style.jpg]
//        [--wish "text"] [--checker spark|spark-open] [--out out/run] [--reuse generated.png]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { tryOn } from "./pipeline/tryon.ts";
import { spentToday } from "./budget.ts";

const { values } = parseArgs({
  options: {
    room: { type: "string" },
    fabric: { type: "string" },
    style: { type: "string" },
    wish: { type: "string" },
    checker: { type: "string" },
    out: { type: "string", default: "out/run" },
    reuse: { type: "string" },
    attempts: { type: "string" },
  },
});
if (!values.room || !values.fabric) throw new Error("--room and --fabric are required");

const report = await tryOn({
  room: readFileSync(values.room),
  fabric: readFileSync(values.fabric),
  style: values.style ? readFileSync(values.style) : undefined,
  wish: values.wish,
  checker: values.checker === "spark" ? "spark" : values.checker === "spark-open" ? "spark-open" : undefined,
  reuseGenerated: values.reuse ? readFileSync(values.reuse) : undefined,
  maxAttempts: values.attempts ? Number(values.attempts) : undefined,
});

const out = values.out!;
mkdirSync(out, { recursive: true });
if (report.image) writeFileSync(`${out}/result.jpg`, report.image);
if (report.before) writeFileSync(`${out}/before.jpg`, report.before);
for (const [name, jpeg] of Object.entries(report.debug)) writeFileSync(`${out}/${name}.jpg`, jpeg);
const { image, debug, before, ...summary } = report;
writeFileSync(`${out}/report.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(`status ${report.status}, $${report.totalUsd.toFixed(4)}, ${(report.ms / 1000).toFixed(1)} s; spent today $${spentToday().toFixed(4)}`);
