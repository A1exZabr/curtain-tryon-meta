// Blind pairwise comparison of two eval variants on the same rooms: Muse Spark Open sees the original room and the
// two results, unlabelled, and picks the one that looks more like a real photograph. Each pair is shown twice with
// the order swapped; a pick counts only when both orders agree, otherwise it is a tie.
// Usage: ops/with-env.sh npx tsx eval/compare.ts out/ablation/paste out/ablation/full [--all]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { z } from "zod";
import { CostLog } from "../src/budget.ts";
import { askJson } from "../src/meta/vision.ts";
import { jpegDataUrl } from "../src/pipeline/images.ts";

const [dirA, dirB] = process.argv.slice(2) as [string, string];
const all = process.argv.includes("--all"); // also compare results that failed a check
const costs = new CostLog();
const schema = z.object({ pick: z.enum(["first", "second"]), reason: z.string().default("") });
const prompt = [
  "The first image is a photo of a room. The second and third show the same room with new curtains, made two different ways.",
  "Which of the two looks more like a real, unedited photograph of that room? Judge how the curtains are lit compared with the",
  "rest of the room, whether their folds and edges are believable, whether they hang from something, and whether anything in the",
  "room looks pasted, smeared or out of place.",
  'Answer with JSON only: { "pick": "first" or "second", "reason": one short sentence }',
].join("\n");

const status = (dir: string, id: string) => JSON.parse(readFileSync(`${dir}/${id}/report.json`, "utf8")).status as string;
const ids = readdirSync(dirA).filter((id) => existsSync(`${dirA}/${id}/result.jpg`) && existsSync(`${dirB}/${id}/result.jpg`));
let winsA = 0, winsB = 0, ties = 0;
for (const id of ids) {
  if (!all && (status(dirA, id) !== "accepted" || status(dirB, id) !== "accepted")) continue;
  const room = jpegDataUrl(readFileSync(`${dirA}/${id}/before.jpg`));
  const a = jpegDataUrl(readFileSync(`${dirA}/${id}/result.jpg`));
  const b = jpegDataUrl(readFileSync(`${dirB}/${id}/result.jpg`));
  const ask = (first: string, second: string) =>
    askJson("spark-open", "compare", prompt, [
      { caption: "Room photo:", dataUrl: room },
      { caption: "Version 1:", dataUrl: first },
      { caption: "Version 2:", dataUrl: second },
    ], schema, costs);
  const [ab, ba] = await Promise.all([ask(a, b), ask(b, a)]);
  const pickA = ab.pick === "first" && ba.pick === "second";
  const pickB = ab.pick === "second" && ba.pick === "first";
  if (pickA) winsA++; else if (pickB) winsB++; else ties++;
  console.log(`${id}: ${pickA ? "A" : pickB ? "B" : "tie"}  (${ab.reason} | ${ba.reason})`);
}
console.log(`A ${dirA}: ${winsA}  B ${dirB}: ${winsB}  ties: ${ties}  cost $${costs.totalUsd.toFixed(3)}`);
