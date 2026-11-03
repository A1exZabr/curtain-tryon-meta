import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  try {
    const state = JSON.parse(readFileSync(SPEND_FILE, "utf8")) as SpendState;
    return state.day === today() ? state : { day: today(), usd: 0 };
  } catch {
    return { day: today(), usd: 0 };
  }
}

function save(state: SpendState): void {
  mkdirSync(dirname(SPEND_FILE), { recursive: true });
  writeFileSync(SPEND_FILE, JSON.stringify(state));
}

/**
 * Called before every paid request with its worst-case cost. Throws once the day's total would pass the cap,
 * so a burst of demo traffic cannot run up the card. The spend is persisted, so restarts don't reset it.
 */
export function reserve(estimateUsd: number): void {
  const state = load();
  if (state.usd + estimateUsd > SPEND_CAP_USD_PER_DAY) throw new BudgetExceeded(state.usd, SPEND_CAP_USD_PER_DAY);
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
