// Runtime settings, all from the environment so the same code runs on a laptop and on the demo server.

export const META_BASE_URL = process.env.META_BASE_URL ?? "https://api.meta.ai/v1";
export const BASETEN_BASE_URL = process.env.BASETEN_BASE_URL ?? "https://inference.baseten.co/v1";

export const MODELS = {
  sam: "sam-3.1",
  image: "muse-image-1.0",
  spark: process.env.SPARK_MODEL ?? "muse-spark-1.3",
  sparkOpen: process.env.SPARK_OPEN_MODEL ?? "meta-models/muse-spark-open-1026",
  transcribe: "muse-voice-transcribe-1.0",
} as const;

/** Which model reads the photos before generation and judges the result after it. */
export type CheckerKind = "spark" | "spark-open";
export const DEFAULT_CHECKER: CheckerKind = process.env.CHECKER === "spark" ? "spark" : "spark-open";

/** Hard ceiling on spend per UTC day. The Meta "Spend Limit" only notifies, so the engine stops itself. */
export const SPEND_CAP_USD_PER_DAY = Number(process.env.SPEND_CAP_USD_PER_DAY ?? "5");
export const SPEND_FILE = process.env.SPEND_FILE ?? "data/spend.json";

/** Long side the room photo is scaled to before anything else; keeps cost and latency predictable. */
export const WORK_LONG_SIDE = Number(process.env.WORK_LONG_SIDE ?? "1536");

export function metaKey(): string {
  const key = process.env.META_MODEL_API_KEY;
  if (!key) throw new Error("META_MODEL_API_KEY is not set");
  return key;
}

export function basetenKey(): string {
  const key = process.env.BASETEN_API_KEY;
  if (!key) throw new Error("BASETEN_API_KEY is not set");
  return key;
}
