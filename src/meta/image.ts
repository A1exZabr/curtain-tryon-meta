import { metaKey, META_BASE_URL, MODELS } from "../config.ts";
import { PRICES, reserve, type CostLog } from "../budget.ts";
import { postJson } from "./http.ts";

/** Picks a "WxH" size string with the photo's aspect ratio; Muse Image treats it as an aspect, not exact pixels. */
export function sizeFor(width: number, height: number): string {
  const long = 1536;
  return width >= height
    ? `${long}x${Math.round((long * height) / width)}`
    : `${Math.round((long * width) / height)}x${long}`;
}

/** Edits the first image with Muse Image, using the rest as references. Returns the edited picture as PNG. */
export async function editImage(
  images: string[],
  prompt: string,
  size: string,
  costs: CostLog,
): Promise<Buffer> {
  const release = reserve(PRICES.museImage);
  const started = Date.now();
  let first: { b64_json?: string; url?: string } | undefined;
  let body: unknown;
  try {
    const response = await postJson(
      `${META_BASE_URL}/images/edits`,
      { Authorization: `Bearer ${metaKey()}` },
      {
        model: MODELS.image,
        prompt,
        images: images.map((image_url) => ({ image_url })),
        n: 1,
        size,
        response_format: "b64_json",
        output_format: "png",
      },
      { timeoutMs: 240_000, attempts: 2 },
    );
    body = await response.json();
    first = (body as { data?: { b64_json?: string; url?: string }[] }).data?.[0];
    costs.add("muse image edit", PRICES.museImage, Date.now() - started);
  } finally {
    release();
  }
  if (first?.b64_json) return Buffer.from(first.b64_json, "base64");
  if (first?.url) return Buffer.from(await (await fetch(first.url, { signal: AbortSignal.timeout(60_000) })).arrayBuffer());
  throw new Error(`Muse Image returned no image: ${JSON.stringify(body).slice(0, 300)}`);
}
