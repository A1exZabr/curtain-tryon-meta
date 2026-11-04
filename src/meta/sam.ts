import { decodeMaskToRaster, parseImageStream, recordsOfKind, type ResponsesEvent } from "@meta-sam/parser";
import { metaKey, META_BASE_URL, MODELS } from "../config.ts";
import { PRICES, reserve, type CostLog } from "../budget.ts";
import { postJson, sseEvents } from "./http.ts";

export interface Segment {
  box: { x1: number; y1: number; x2: number; y2: number };
  confidence?: number;
  /** Full-frame mask, width * height bytes of 0 or 1. */
  mask: Uint8Array;
  area: number;
}

/**
 * Segments every instance of a short noun phrase ("window", "curtains") with SAM 3.1 and returns full-frame
 * masks at the photo's own size.
 */
export async function segment(
  image: { dataUrl: string; width: number; height: number },
  phrase: string,
  costs: CostLog,
): Promise<Segment[]> {
  const release = reserve(PRICES.samImage);
  const started = Date.now();
  let result: Awaited<ReturnType<typeof parseImageStream>["finalResult"]>;
  try {
    const response = await postJson(
      `${META_BASE_URL}/responses`,
      { Authorization: `Bearer ${metaKey()}`, Accept: "text/event-stream" },
      {
        model: MODELS.sam,
        input: [
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: phrase },
              { type: "input_image", image_url: image.dataUrl },
            ],
          },
        ],
        stream: true,
        metadata: { include_confidence: "true", mask_encoding: "lossless" },
      },
    );
    result = await parseImageStream(sseEvents<ResponsesEvent>(response)).finalResult;
    costs.add(`sam "${phrase}"`, PRICES.samImage, Date.now() - started);
  } finally {
    release();
  }
  if (result.outcome.status !== "completed") {
    throw new Error(`SAM did not complete for "${phrase}": ${JSON.stringify(result.outcome)}`);
  }

  const segments: Segment[] = [];
  for (const record of recordsOfKind(result.records, "mask")) {
    const raster = decodeMaskToRaster(record.mask);
    const mask = placeRaster(raster, record.mask.width, record.mask.height, record.bounds, image.width, image.height);
    let area = 0;
    for (const v of mask) area += v;
    if (area === 0) continue;
    segments.push({
      box: { x1: record.bounds.left, y1: record.bounds.top, x2: record.bounds.right, y2: record.bounds.bottom },
      confidence: record.confidence,
      mask,
      area,
    });
  }
  return segments;
}

/** Puts a mask raster (which covers only its box, possibly at a lower resolution) into a full-frame mask. */
export function placeRaster(
  raster: Uint8Array,
  rw: number,
  rh: number,
  bounds: { left: number; top: number; right: number; bottom: number },
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(width * height);
  const bw = Math.max(1, bounds.right - bounds.left);
  const bh = Math.max(1, bounds.bottom - bounds.top);
  for (let y = Math.max(0, bounds.top); y < Math.min(height, bounds.bottom); y++) {
    const ry = Math.min(rh - 1, Math.floor(((y - bounds.top) * rh) / bh));
    for (let x = Math.max(0, bounds.left); x < Math.min(width, bounds.right); x++) {
      const rx = Math.min(rw - 1, Math.floor(((x - bounds.left) * rw) / bw));
      if (raster[ry * rw + rx]) out[y * width + x] = 1;
    }
  }
  return out;
}
