import { z } from "zod";
import { basetenKey, BASETEN_BASE_URL, metaKey, META_BASE_URL, MODELS, type CheckerKind } from "../config.ts";
import { PRICES, reserve, type CostLog } from "../budget.ts";
import { postJson } from "./http.ts";

interface ChatResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Asks a vision model about a few images and parses its JSON answer against a schema. Muse Spark 1.3 runs on the
 * Meta Model API; Muse Spark Open (the open-weight model) runs on Baseten. Both speak the chat completions format.
 */
export async function askJson<T>(
  checker: CheckerKind,
  label: string,
  prompt: string,
  images: { caption: string; dataUrl: string }[],
  schema: z.ZodType<T>,
  costs: CostLog,
): Promise<T> {
  const open = checker === "spark-open";
  const url = open ? `${BASETEN_BASE_URL}/chat/completions` : `${META_BASE_URL}/chat/completions`;
  const headers = open ? { Authorization: `Api-Key ${basetenKey()}` } : { Authorization: `Bearer ${metaKey()}` };
  const content: unknown[] = [];
  for (const image of images) {
    content.push({ type: "text", text: image.caption });
    content.push({ type: "image_url", image_url: { url: image.dataUrl } });
  }
  content.push({ type: "text", text: prompt });

  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    reserve(0.02);
    const started = Date.now();
    const response = await postJson(url, headers, {
      model: open ? MODELS.sparkOpen : MODELS.spark,
      messages: [{ role: "user", content }],
      max_tokens: 6000,
      reasoning_effort: "low",
      temperature: 0,
    });
    const body = (await response.json()) as ChatResponse;
    const inTok = body.usage?.prompt_tokens ?? 0;
    const outTok = body.usage?.completion_tokens ?? 0;
    const usd = open
      ? (inTok * PRICES.sparkOpenInputPerM + outTok * PRICES.sparkOpenOutputPerM) / 1e6
      : (inTok * PRICES.sparkInputPerM + outTok * PRICES.sparkOutputPerM) / 1e6;
    costs.add(`${open ? "muse spark open" : "muse spark"} ${label}`, usd, Date.now() - started);
    const text = body.choices?.[0]?.message?.content ?? "";
    const parsed = schema.safeParse(extractJson(text));
    if (parsed.success) return parsed.data;
    lastError = `${parsed.error.message.slice(0, 300)} in ${text.slice(0, 300)}`;
  }
  throw new Error(`${label}: the model did not return valid JSON: ${lastError}`);
}

export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

export const sceneSchema = z.object({
  is_room_photo: z.boolean(),
  window_visible: z.boolean(),
  window_count: z.number().int().min(0),
  existing_curtains: z.boolean(),
  fabric_visible: z.boolean(),
  fabric_colour_hex: z.string().default(""),
  fabric_description: z.string().default(""),
  problems: z.array(z.string()).default([]),
  message_for_client: z.string().default(""),
});
export type SceneFacts = z.infer<typeof sceneSchema>;

export function scenePrompt(): string {
  return [
    "You check photos sent to a curtain try-on service before any image is generated.",
    "Look at the room photo and the fabric photo and answer with JSON only, no other text:",
    "{",
    '  "is_room_photo": true if the first photo is a real interior of a room,',
    '  "window_visible": true if at least one window or glass balcony door is clearly visible,',
    '  "window_count": number of windows visible,',
    '  "existing_curtains": true if curtains, drapes or tulle already hang on a window,',
    '  "fabric_visible": true if the fabric photo shows a textile clearly enough to see its colour and texture,',
    '  "fabric_colour_hex": the fabric\'s main colour as #rrggbb, judged under neutral light,',
    '  "fabric_description": a short description of the fabric (material look, colour, pattern) in under 15 words,',
    '  "problems": a list using only these codes: NOT_A_ROOM, NO_WINDOW, NO_FABRIC, TOO_DARK, TOO_BLURRY,',
    '  "message_for_client": if there is a problem, one friendly sentence telling the client what photo to send instead; otherwise ""',
    "}",
  ].join("\n");
}

export const verdictSchema = z.object({
  same_room: z.boolean(),
  curtains_on_window: z.boolean(),
  fabric_matches: z.boolean(),
  realistic: z.boolean(),
  defects: z.array(z.string()).default([]),
  score: z.number().min(0).max(1),
  notes: z.string().default(""),
});
export type Verdict = z.infer<typeof verdictSchema>;

export function verdictPrompt(fabricDescription: string): string {
  return [
    "You judge the output of a curtain try-on service. The first image is the client's original room, the second is",
    "the result with new curtains, the third is the fabric the curtains must be made of" +
      (fabricDescription ? ` (${fabricDescription}).` : "."),
    "Answer with JSON only, no other text:",
    "{",
    '  "same_room": true if the result is clearly the same room from the same viewpoint,',
    '  "curtains_on_window": true if new curtains hang on the window (not floating, not on a wall without a window),',
    '  "fabric_matches": true if the curtains\' hue, pattern and texture match the fabric photo; curtains hanging against a',
    '     bright window are naturally somewhat darker than a swatch in daylight, so judge hue and texture, not exact brightness,',
    '  "realistic": true if the curtains look like a real photo: plausible folds, no smears, no seams at their edges,',
    '  "defects": a list using only these codes: WRONG_FABRIC, WRONG_WINDOW, CURTAINS_MISSING, ROOM_CHANGED, ARTIFACTS, CUT_EDGE,',
    '  "score": overall quality from 0 to 1,',
    '  "notes": one short sentence',
    "}",
  ].join("\n");
}

/** One place decides accept or reject; the model's own opinion is only an input. */
export function verdictPasses(v: Verdict): boolean {
  return v.same_room && v.curtains_on_window && v.fabric_matches && v.realistic && v.score >= 0.6;
}
