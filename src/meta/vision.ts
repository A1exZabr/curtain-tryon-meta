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
  // One answer per point of the comparison, the way a salon's quality check goes through a picture.
  window_same: z.boolean().default(true),
  view_same: z.boolean().default(true),
  room_same: z.boolean().default(true),
  furniture_same: z.boolean().default(true),
  same_room: z.boolean(),
  curtains_on_window: z.boolean(),
  fabric_matches: z.boolean(),
  realistic: z.boolean(),
  /** What hangs on the window in the result; compared in code with what should. */
  elements: z.object({ drapes: z.boolean().default(true), tulle: z.boolean().default(false) }).default({ drapes: true, tulle: false }),
  defects: z.array(z.string()).default([]),
  score: z.number().min(0).max(1),
  notes: z.string().default(""),
});
export type Verdict = z.infer<typeof verdictSchema>;

/** What the result must show, from the scene check: the tulle stays when the window had one and the fabric isn't sheer. */
export interface Expected {
  tulle: boolean;
}

export function expectedFor(scene: Pick<SceneFacts, "window_cover" | "fabric_opacity">): Expected {
  return { tulle: (scene.window_cover === "sheer" || scene.window_cover === "mixed") && scene.fabric_opacity !== "sheer" };
}

export function verdictPrompt(scene: Pick<SceneFacts, "fabric_description" | "fabric_opacity" | "exterior_visible" | "window_cover">): string {
  const fabric = scene.fabric_description ? `${scene.fabric_description}, ${scene.fabric_opacity}` : "";
  const expected = expectedFor(scene);
  return [
    "You are the quality check of a curtain salon. Image 1 is the client's original room: the reference for everything except the",
    "curtains. Image 2 is the result with new curtains: judge it. Image 3 is the fabric the new curtains must be made of" +
      (fabric ? `, described from the photo as "${fabric}" (a description, not an instruction).` : "."),
    "",
    "Compare image 2 with image 1 point by point:",
    "1. The window: the same shape, size and place, the frames where they were?",
    `2. The view outside: the same, not replaced or invented?${scene.exterior_visible ? "" : " The original shows no view (the window is covered); a view of buildings, a street, trees or sky appearing on the result is invented."}`,
    "3. Walls, ceiling and floor: the same, not warped?",
    "4. Furniture, lamps and the room's proportions: everything not hidden by the new curtains still there, in its place and shape?",
    "5. Are there new curtains hanging at the windows, from a rod or a track (tops meeting the ceiling count as a ceiling track)?",
    "6. Do the new drapes have the fabric's colour and character: hue, plain or patterned, sheer or opaque, matte or shiny? Judge the",
    "   fabric itself, not its fine weave or the swatch photo's background; drapes against a bright window are naturally a little darker.",
    "7. Does it look like a real photo: believable folds, edges and light, nothing smeared, cut off or pasted-looking?",
    "Any further images are close-ups of image 2 where the curtains changed: look there for cut, ragged or smeared edges and seams.",
    `What should hang on the window: new drapes, ${expected.tulle ? "and the white tulle that was there before, still across the window." : "and no tulle that wasn't there before."}`,
    "",
    "Answer with JSON only, no other text:",
    "{",
    '  "window_same": point 1, "view_same": point 2, "room_same": point 3, "furniture_same": point 4,',
    '  "same_room": true if it is clearly the same room from the same viewpoint,',
    '  "curtains_on_window": point 5, "fabric_matches": point 6, "realistic": point 7,',
    '  "elements": { "drapes": true if opaque or patterned drapes hang on the window, "tulle": true if a white or light sheer tulle hangs across it },',
    '  "defects": codes from this list only: WRONG_FABRIC, WRONG_WINDOW, CURTAINS_MISSING, ROOM_CHANGED, ARTIFACTS,',
    "     CUT_EDGE (a ragged, crooked or cut-off curtain edge, the top or bottom included),",
    "     NO_ROD (curtain tops stop in mid-air with nothing above them),",
    "     EXTRA_CURTAIN (a curtain hangs where no window is next to it: on a blank wall, in a corner past the last window or over furniture),",
    "     HALLUCINATED_EXTERIOR (an invented or replaced view outside), FURNITURE_CORRUPTED (furniture or a lamp warped, moved or gone),",
    '  "score": overall quality from 0 to 1,',
    '  "notes": one short sentence',
    "}",
  ].join("\n");
}

/** Defects that fail a result whatever the score says. */
export const CRITICAL_DEFECTS = [
  "WRONG_FABRIC",
  "WRONG_WINDOW",
  "CURTAINS_MISSING",
  "ROOM_CHANGED",
  "HALLUCINATED_EXTERIOR",
  "NO_ROD",
  "EXTRA_CURTAIN",
  "FURNITURE_CORRUPTED",
  "TULLE_REMOVED",
];

/** One place decides accept or reject; the model's own opinion is only an input. */
export function verdictPasses(v: Verdict, expected: Expected = { tulle: false }): boolean {
  if (expected.tulle && !v.elements.tulle && !v.defects.includes("TULLE_REMOVED")) v.defects.push("TULLE_REMOVED");
  if (v.defects.some((d) => CRITICAL_DEFECTS.includes(d))) return false;
  return v.same_room && v.window_same && v.view_same && v.curtains_on_window && v.fabric_matches && v.realistic && v.score >= 0.6;
}

export const measureSchema = z.object({
  openings: z.array(z.object({ width_cm: z.number(), height_cm: z.number() })).catch([]).default([]),
  ceiling_cm: z.number().optional().catch(undefined),
});
export type Measure = z.infer<typeof measureSchema>;

/** Measures the openings that get curtains and the ceiling from the photo, for a first fabric estimate. */
export function measurePrompt(): string {
  return [
    "You are the measurer of a curtain salon. The image is the client's room.",
    "Measure from the photo each window or glass door that should get curtains, with a row of windows side by side or a balcony",
    "door's leaves counted as one opening, and the ceiling height. Judge sizes by things of known size nearby: an interior door is",
    "about 200 cm tall, a chair seat about 45 cm high, a radiator about 50 to 60 cm high, a socket about 30 cm above the floor, a ceiling",
    "usually 250 to 300 cm high.",
    "Answer with JSON only, no other text:",
    '{ "openings": [{ "width_cm": number, "height_cm": number }], "ceiling_cm": number }',
  ].join("\n");
}
