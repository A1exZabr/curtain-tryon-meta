import { metaKey, META_BASE_URL, MODELS } from "../config.ts";
import { PRICES, reserve, type CostLog } from "../budget.ts";

/** Seconds of audio in a PCM WAV file, read from its header. */
export function wavSeconds(wav: Buffer): number {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV file");
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === "fmt ") byteRate = wav.readUInt32LE(offset + 16);
    if (id === "data") return byteRate ? size / byteRate : 0;
    offset += 8 + size + (size % 2);
  }
  return 0;
}

/** Turns a client's voice note (WAV, up to a couple of minutes) into text with Muse Voice Transcribe. */
export async function transcribe(wav: Buffer, costs: CostLog): Promise<string> {
  const seconds = wavSeconds(wav);
  if (seconds > 120) throw new Error("voice note is longer than two minutes");
  const usd = (seconds / 3600) * PRICES.transcribePerHour;
  reserve(usd);
  const started = Date.now();
  const form = new FormData();
  form.append(
    "request",
    new Blob([JSON.stringify({ model: MODELS.transcribe, audioEncoding: "WAV", mode: "PUSH_TO_TALK" })], {
      type: "application/json",
    }),
  );
  form.append("audio", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "note.wav");
  const response = await fetch(`${META_BASE_URL}/asr/transcribe`, {
    method: "POST",
    headers: { Authorization: `Bearer ${metaKey()}`, Accept: "application/json" },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`transcribe answered ${response.status}: ${text.slice(0, 300)}`);
  costs.add("muse voice transcribe", usd, Date.now() - started);
  const body = JSON.parse(text) as { transcript?: string };
  return (body.transcript ?? "").replace(/\.{2,}$/, ".").trim();
}
