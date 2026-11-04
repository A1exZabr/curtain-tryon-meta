import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SPEND_CAP_USD_PER_DAY, SPEND_FILE } from "./config.ts";

// List prices from dev.meta.ai/docs/pricing-rate-limits (Standard mode). Baseten bills Muse Spark Open from
// hackathon credits; its per-token price is set from the environment and defaults to the Muse Spark price.
export const PRICES = {
  samImage: 0.0025,
  museImage: 0.01,
  sparkInputPerM: 1.25,
  sparkOutputPerM: 4.25,
  sparkOpenInputPerM: Number(process.env.SPARK_OPEN_INPUT_PER_M ?? "1.25"),
  sparkOpenOutputPerM: Number(process.env.SPARK_OPEN_OUTPUT_PER_M ?? "4.25"),
  transcribePerHour: 0.18,
} as const;

export class BudgetExceeded extends Error {
  constructor(spent: number, cap: number) {
    super(`daily spend cap reached: $${spent.toFixed(4)} of $${cap.toFixed(2)}`);
    this.name = "BudgetExceeded";
  }
}

interface SpendState {
  day: string;
  usd: number;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function load(): SpendState {
  let text: string;
  try {
    text = readFileSync(SPEND_FILE, "utf8");
  } catch {
    return { day: today(), usd: 0 };
  }
  try {
    const state = JSON.parse(text) as SpendState;
    if (typeof state.usd !== "number" || !Number.isFinite(state.usd)) throw new Error("bad spend file");
    return state.day === today() ? state : { day: today(), usd: 0 };
  } catch {
    // A file that is there but unreadable must not reset the day to zero: count the day as spent.
    return { day: today(), usd: SPEND_CAP_USD_PER_DAY };
  }
}

function save(state: SpendState): void {
  mkdirSync(dirname(SPEND_FILE), { recursive: true });
  // Written next to it and renamed, so a crash mid-write never leaves half a file.
  writeFileSync(`${SPEND_FILE}.tmp`, JSON.stringify(state));
  renameSync(`${SPEND_FILE}.tmp`, SPEND_FILE);
}

/** Worst-case costs of the calls still in flight; they count against the cap until the call settles. */
let pending = 0;

/**
 * Called before every paid request with its worst-case cost. Throws once the day's total, with the calls still
 * running, would pass the cap, so a burst of demo traffic cannot run up the card: calls that run side by side
 * can't all pass a cap that only one of them fits under. Returns the function that frees the reservation, to be
 * called once the call is over, paid or failed. The spend is persisted, so restarts don't reset it.
 */
export function reserve(estimateUsd: number): () => void {
  const state = load();
  if (state.usd + pending + estimateUsd > SPEND_CAP_USD_PER_DAY) throw new BudgetExceeded(state.usd + pending, SPEND_CAP_USD_PER_DAY);
  pending += estimateUsd;
  let freed = false;
  return () => {
    if (freed) return;
    freed = true;
    pending -= estimateUsd;
  };
}

export function record(usd: number): void {
  const state = load();
  state.usd += usd;
  save(state);
}

export function spentToday(): number {
  return load().usd;
}

/** Collects the cost of one try-on, call by call, for the report. */
export class CostLog {
  readonly items: { what: string; usd: number; ms: number }[] = [];

  add(what: string, usd: number, ms: number): void {
    this.items.push({ what, usd, ms });
    record(usd);
  }

  get totalUsd(): number {
    return this.items.reduce((sum, item) => sum + item.usd, 0);
  }
}
