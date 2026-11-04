import { metaKey, META_BASE_URL, MODELS } from "../config.ts";
import { PRICES, reserve, type CostLog } from "../budget.ts";

/** The page records 16 kHz mono 16-bit PCM; nothing else is taken. */
const BYTES_PER_SECOND = 16000 * 2;

/**
 * Seconds of audio in a WAV file from the page. Only the format the page sends is accepted, and the length comes
 * from the bytes actually sent, not from the header's own numbers, which the sender controls.
 */
export function wavSeconds(wav: Buffer): number {
  if (wav.length < 12 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV file");
  let offset = 12;
  let pcm16kMono = false;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === "fmt " && offset + 24 <= wav.length) {
      pcm16kMono =
        wav.readUInt16LE(offset + 8) === 1 && // PCM
        wav.readUInt16LE(offset + 10) === 1 && // mono
        wav.readUInt32LE(offset + 12) === 16000 &&
        wav.readUInt16LE(offset + 22) === 16;
    }
    if (id === "data") {
      if (!pcm16kMono) throw new Error("not 16 kHz mono 16-bit PCM");
      return (wav.length - offset - 8) / BYTES_PER_SECOND;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("WAV file without audio");
}

/** Turns a client's voice note (WAV, up to a couple of minutes) into text with Muse Voice Transcribe. */
export async function transcribe(wav: Buffer, costs: CostLog): Promise<string> {
  const seconds = wavSeconds(wav);
  if (seconds > 120) throw new Error("voice note is longer than two minutes");
  const usd = (seconds / 3600) * PRICES.transcribePerHour;
  const release = reserve(usd);
  const started = Date.now();
  let text: string;
  try {
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
    text = await response.text();
    if (!response.ok) throw new Error(`transcribe answered ${response.status}: ${text.slice(0, 300)}`);
    costs.add("muse voice transcribe", usd, Date.now() - started);
  } finally {
    release();
  }
  const body = JSON.parse(text) as { transcript?: string };
  return (body.transcript ?? "").replace(/\.{2,}$/, ".").trim();
}
