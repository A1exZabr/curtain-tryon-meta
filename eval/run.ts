// Runs the engine over the fixed evaluation set in eval/photos.json and writes eval/RESULTS.md.
// Photos are fetched from their source URLs (they are not stored in the repo) and cached under data/.
// Usage: ops/with-env.sh npm run eval -- [--only room-01,room-02] [--parallel 3] [--checker spark|spark-open]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { tryOn, type TryOnReport } from "../src/pipeline/tryon.ts";
import { spentToday } from "../src/budget.ts";

interface Photo { id: string; url: string; source_page: string; author: string; license: string; notes?: string }
interface Set { rooms: Photo[]; fabrics: Photo[]; styles: Photo[] }

const { values } = parseArgs({
  options: {
    only: { type: "string" },
    parallel: { type: "string", default: "3" },
    checker: { type: "string" },
    out: { type: "string", default: "out/eval" },
    // Which stages run, for the ablation: raw (Muse Image and the checker only), paste, light, design, full.
    variant: { type: "string", default: "full" },
    results: { type: "string", default: "eval/RESULTS.md" },
  },
});
const set = JSON.parse(readFileSync("eval/photos.json", "utf8")) as Set;
const byId = new Map([...set.rooms, ...set.fabrics, ...set.styles].map((p) => [p.id, p]));

// The fixed list of runs. room-10 is left out (a person is visible); style-03 is CC BY-SA and not used.
// The last run sends a fabric close-up as the "room": it must be refused before any image is generated.
const JOBS: { id: string; room: string; fabric: string; style?: string; wish?: string; expect?: "rejected_input" }[] = [
  { id: "01", room: "room-01", fabric: "fabric-01" },
  { id: "02", room: "room-02", fabric: "fabric-02" },
  { id: "03", room: "room-03", fabric: "fabric-03" },
  { id: "04", room: "room-04", fabric: "fabric-04", style: "style-01" },
  { id: "05", room: "room-05", fabric: "fabric-05" },
  { id: "06", room: "room-06", fabric: "fabric-01" },
  { id: "07", room: "room-07", fabric: "fabric-02" },
  { id: "08", room: "room-08", fabric: "fabric-03", wish: "floor length, a little lighter than the swatch" },
  { id: "09", room: "room-09", fabric: "fabric-04" },
  { id: "11", room: "room-11", fabric: "fabric-05", style: "style-01" },
  { id: "12", room: "room-12", fabric: "fabric-01" },
  { id: "13-no-room", room: "fabric-02", fabric: "fabric-04", expect: "rejected_input" },
];

async function fetchPhoto(id: string): Promise<Buffer> {
  const cached = `data/eval-cache/${id}.jpg`;
  if (existsSync(cached)) return readFileSync(cached);
  const photo = byId.get(id);
  if (!photo) throw new Error(`unknown photo ${id}`);
  const response = await fetch(photo.url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${id}: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  mkdirSync("data/eval-cache", { recursive: true });
  writeFileSync(cached, buffer);
  return buffer;
}

// Each variant adds one stage to the one before it.
const STAGES = {
  raw: { paste: false, lightHint: false, relight: false, design: false, retryFixes: false },
  paste: { lightHint: false, relight: false, design: false, retryFixes: false },
  light: { design: false, retryFixes: false },
  design: { retryFixes: false },
  full: {},
};
if (!(values.variant in STAGES)) throw new Error(`unknown variant ${values.variant}`);

const only = values.only?.split(",");
const jobs = JOBS.filter((j) => !only || only.includes(j.id) || only.includes(j.room));
const results: { job: (typeof JOBS)[number]; report?: Omit<TryOnReport, "image" | "debug" | "before">; error?: string }[] = [];

async function runJob(job: (typeof JOBS)[number]): Promise<void> {
  const dir = `${values.out}/${job.id}`;
  mkdirSync(dir, { recursive: true });
  try {
    const report = await tryOn({
      room: await fetchPhoto(job.room),
      fabric: await fetchPhoto(job.fabric),
      style: job.style ? await fetchPhoto(job.style) : undefined,
      wish: job.wish,
      checker: values.checker === "spark" ? "spark" : values.checker === "spark-open" ? "spark-open" : undefined,
      ...STAGES[values.variant as keyof typeof STAGES],
    });
    if (report.image) writeFileSync(`${dir}/result.jpg`, report.image);
    if (report.before) writeFileSync(`${dir}/before.jpg`, report.before);
    for (const [name, jpeg] of Object.entries(report.debug)) writeFileSync(`${dir}/${name}.jpg`, jpeg);
    const { image, debug, before, ...summary } = report;
    writeFileSync(`${dir}/report.json`, JSON.stringify(summary, null, 2));
    results.push({ job, report: summary });
    console.log(`${job.id}: ${report.status} in ${report.attempts.length} attempt(s), $${report.totalUsd.toFixed(3)}, ${(report.ms / 1000).toFixed(0)} s ${report.reason ?? ""}`);
  } catch (error) {
    results.push({ job, error: String(error) });
    console.log(`${job.id}: ERROR ${String(error).slice(0, 200)}`);
  }
}

const queue = [...jobs];
await Promise.all(
  Array.from({ length: Number(values.parallel) }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) await runJob(job);
  }),
);
results.sort((a, b) => a.job.id.localeCompare(b.job.id));
writeFileSync(`${values.out}/summary.json`, JSON.stringify(results, null, 2));

// ---- Report ----
const real = results.filter((r) => !r.job.expect);
const accepted = real.filter((r) => r.report?.status === "accepted");
const refusedRight = results.filter((r) => r.job.expect === "rejected_input" && r.report?.status === "rejected_input");
const allCost = results.reduce((s, r) => s + (r.report?.totalUsd ?? 0), 0);
const times = accepted.map((r) => r.report!.ms / 1000).sort((a, b) => a - b);
const median = times.length ? times[Math.floor(times.length / 2)]! : 0;
const raw = real.flatMap((r) => r.report?.attempts.map((a) => a.rawChangedOutside).filter((v): v is number => v !== undefined) ?? []);
const rawMean = raw.length ? raw.reduce((s, v) => s + v, 0) / raw.length : 0;
const firstTry = accepted.filter((r) => r.report!.attempts.length === 1).length;
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

const lines = [
  "# Evaluation results",
  "",
  `Run on ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC with \`npm run eval -- --variant ${values.variant}\`, checker: ${results[0]?.report?.checker ?? "?"}.`,
  "Photos come from Unsplash, Pexels and Wikimedia Commons under their free licences; see `eval/photos.json` for authors and links.",
  "",
  `- Accepted try-ons: **${accepted.length} of ${real.length}** (${pct(accepted.length / Math.max(1, real.length))}), ${firstTry} on the first attempt.`,
  `- A photo with no room in it was refused before generation: ${refusedRight.length ? "yes" : "no"}.`,
  values.variant === "raw"
    ? "- Pixels of the room outside the curtains changed: not measured in this variant, the generator's picture is shown as it comes."
    : `- Pixels of the room outside the curtains changed by the engine: **0** (by construction: they are copied from the original).`,
  `- The same, if the raw Muse Image output were shown instead: **${pct(rawMean)}** of the room on average.`,
  `- Cost per accepted try-on: **$${(allCost / Math.max(1, accepted.length)).toFixed(3)}** (all calls of all runs, failures included, divided by accepted ones).`,
  `- Median time of an accepted try-on: **${median.toFixed(0)} s**.`,
  "",
  "| Run | Room | Fabric | Result | Attempts | Window difference (0–255) | Curtains in their area | Colour drift fixed (ΔE) | Raw output changed | Checker score | Cost | Time |",
  "|-|-|-|-|-|-|-|-|-|-|-|-|",
  ...results.map((r) => {
    const a = r.report?.attempts.at(-1);
    const cell = (v: string | undefined) => v ?? "–";
    return `| ${r.job.id} | ${r.job.room} | ${r.job.fabric}${r.job.style ? ` + ${r.job.style}` : ""} | ${r.error ? "error" : r.report!.status}${r.report?.reason ? `: ${r.report.reason.replace(/\|/g, "/")}` : ""} | ${r.report?.attempts.length ?? "–"} | ${cell(a ? String(a.geometry.windowDiff) : undefined)} | ${cell(a && pct(a.geometry.curtainsInsideRegion))} | ${cell(a?.colour?.deltaE.toFixed(1))} | ${cell(a?.rawChangedOutside !== undefined ? pct(a.rawChangedOutside) : undefined)} | ${cell(a?.verdict?.score.toFixed(2))} | ${r.report ? `$${r.report.totalUsd.toFixed(3)}` : "–"} | ${r.report ? `${(r.report.ms / 1000).toFixed(0)} s` : "–"} |`;
  }),
  "",
];
writeFileSync(values.results, lines.join("\n"));
writeFileSync(`${values.out}/headline.json`, JSON.stringify({
  variant: values.variant,
  accepted: accepted.length,
  of: real.length,
  firstTry,
  rawChanged: rawMean,
  costPerAccepted: allCost / Math.max(1, accepted.length),
  medianSeconds: median,
}, null, 2));
console.log(lines.slice(4, 11).join("\n"));
console.log(`spent today $${spentToday().toFixed(3)}`);
