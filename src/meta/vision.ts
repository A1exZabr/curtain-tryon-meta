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
  /** What hangs over the glass now. A covered window must stay covered: a generator that opens it invents a view. */
  window_cover: z.enum(["none", "sheer", "curtains", "blinds", "mixed"]).catch("none").default("none"),
  exterior_visible: z.boolean().default(true),
  fabric_visible: z.boolean(),
  fabric_colour_hex: z.string().default(""),
  fabric_description: z.string().default(""),
  /** Sheer or opaque decides more about how curtains look than the exact colour does. */
  fabric_opacity: z.enum(["sheer", "semi", "opaque"]).catch("opaque").default("opaque"),
  problems: z.array(z.string()).default([]),
  message_for_client: z.string().default(""),
});
export type SceneFacts = z.infer<typeof sceneSchema>;

export function scenePrompt(): string {
  return [
    "You check photos sent to a curtain try-on service before any image is generated.",
    "Look at the room photo and the fabric photo and answer with JSON only, no other text:",
    "{",
    '  "is_room_photo": true if the first photo is a real photo of a room interior (false for a screenshot, a render or a photo of a screen),',
    '  "window_visible": true if at least one window or glass balcony door is clearly visible, even if curtains or tulle cover it,',
    '  "window_count": number of windows visible,',
    '  "existing_curtains": true if curtains, drapes or tulle already hang on a window,',
    '  "window_cover": what covers the glass now: "none", "sheer" (tulle or voile), "curtains" (drawn opaque curtains), "blinds", or "mixed",',
    '  "exterior_visible": true if the view outside can be seen through the window,',
    '  "fabric_visible": true if the fabric photo shows a textile clearly enough to see its colour and texture,',
    '  "fabric_colour_hex": the fabric\'s main colour as #rrggbb as it looks in daylight, not the colour of its shadows,',
    '  "fabric_description": a short description of the fabric (material look, colour, pattern) in under 15 words,',
    '  "fabric_opacity": "sheer" if light and shapes show through it, "semi" if it is translucent, "opaque" if it blocks the view,',
    '  "problems": a list using only these codes: NOT_A_ROOM, SCREENSHOT, NO_WINDOW, NO_FABRIC, TOO_DARK, TOO_BLURRY,',
    '  "message_for_client": if there is a problem, one friendly sentence telling the client what photo to send instead; otherwise ""',
    "}",
  ].join("\n");
}

/**
 * Fixed answers for the refusals, so the client always reads a tested sentence that says what to send instead.
 * The model's own message is used only for a code that isn't listed here.
 */
export const REFUSALS: Record<string, string> = {
  SCREENSHOT: "This looks like a screenshot or a picture of a screen. Please send the photo itself, taken with the camera.",
  NOT_A_ROOM: "The first photo doesn't look like a room. Please send a photo of the room with the window in it.",
  NO_WINDOW: "We couldn't find a window on the room photo. Please take it facing the window, with the whole window in the frame.",
  NO_FABRIC: "We couldn't see the fabric. Please send a close-up of the swatch in daylight, filling the frame.",
  TOO_DARK: "The photo is too dark to work with. Please take it in daylight, without the flash.",
  TOO_BLURRY: "The photo is too blurry. Please hold the phone still and take it again.",
};

export function refusalMessage(scene: SceneFacts): string {
  const order = ["SCREENSHOT", "NOT_A_ROOM", "NO_WINDOW", "NO_FABRIC", "TOO_DARK", "TOO_BLURRY"];
  const code = order.find((c) => scene.problems.includes(c));
  return (code && REFUSALS[code]) || scene.message_for_client || REFUSALS.NO_WINDOW!;
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

export function verdictPrompt(scene: Pick<SceneFacts, "fabric_description" | "fabric_opacity" | "exterior_visible">): string {
  const fabric = scene.fabric_description ? `${scene.fabric_description}, ${scene.fabric_opacity}` : "";
  return [
    "You judge the output of a curtain try-on service. The first image is the client's original room, the second is",
    "the result with new curtains, the third is the fabric the curtains must be made of" + (fabric ? ` (described from the photo as: "${fabric}").` : "."),
    "Answer with JSON only, no other text:",
    "{",
    '  "same_room": true if the result is clearly the same room from the same viewpoint,',
    '  "curtains_on_window": true if new curtains hang on the window (not floating, not on a wall without a window),',
    '  "fabric_matches": true if the curtains have the fabric\'s colour and character: its hue, whether it is plain or patterned,',
    "     sheer or opaque, matte or shiny. Judge the fabric itself, not its fine weave and not the background of the swatch photo.",
    "     Curtains hanging against a bright window are naturally somewhat darker than a swatch in daylight, so don't judge exact brightness,",
    '  "realistic": true if the curtains look like a real photo: plausible folds, no smears, no seams at their edges,',
    '  "defects": a list using only these codes: WRONG_FABRIC, WRONG_WINDOW, CURTAINS_MISSING, ROOM_CHANGED, ARTIFACTS, CUT_EDGE,' +
      (scene.exterior_visible ? "" : " HALLUCINATED_EXTERIOR (the window was covered in the original and the result shows a view outside),"),
    '  "score": overall quality from 0 to 1,',
    '  "notes": one short sentence',
    "}",
  ].join("\n");
}

/** Defects that fail a result whatever the score says. */
export const CRITICAL_DEFECTS = ["WRONG_FABRIC", "WRONG_WINDOW", "CURTAINS_MISSING", "ROOM_CHANGED", "HALLUCINATED_EXTERIOR"];

/** One place decides accept or reject; the model's own opinion is only an input. */
export function verdictPasses(v: Verdict): boolean {
  if (v.defects.some((d) => CRITICAL_DEFECTS.includes(d))) return false;
  return v.same_room && v.curtains_on_window && v.fabric_matches && v.realistic && v.score >= 0.6;
}

export const designSchema = z.object({
  style: z.string(),
  reason: z.string().default(""),
});
export type Design = z.infer<typeof designSchema>;

/** The designer step: picks the curtain style for this room and fabric from the catalogue. */
export function designPrompt(styles: { id: string; name: string; suits: string }[], scene: SceneFacts, wish?: string): string {
  const quote = (text: string) => `"${text.replace(/"/g, "'")}"`;
  return [
    "You are the designer at a curtain salon. The first image is the client's room, the second is the fabric" +
      (scene.fabric_description ? ` (described from the photo as ${quote(`${scene.fabric_description}, ${scene.fabric_opacity}`)}).` : "."),
    "Choose the one curtain style from this list that suits this room, its windows and this fabric best:",
    ...styles.map((s) => `- ${s.id}: ${s.name}. Suits ${s.suits}.`),
    "Consider the style of the room, the windows (how many, how wide, whether they reach the ceiling or the floor, what stands next to them),",
    "the height of the ceiling and how heavy the fabric is." +
      (wish ? ` The client wrote ${quote(wish)}; if that names a style or a way of hanging, follow it.` : ""),
    "Answer with JSON only, no other text:",
    '{ "style": one id from the list, "reason": one short sentence to the client on why this style suits their room }',
  ].join("\n");
}
