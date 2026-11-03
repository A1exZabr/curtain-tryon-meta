import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
const key = process.env.META_MODEL_API_KEY!;
const base = "https://api.meta.ai/v1";
const info = await fetch(`${base}/models/muse-wonder-1.0`, { headers: { Authorization: `Bearer ${key}` } });
console.log("wonder model:", info.status, (await info.text()).slice(0, 600));
const info2 = await fetch(`${base}/models/muse-image-1.0`, { headers: { Authorization: `Bearer ${key}` } });
console.log("image model:", info2.status, (await info2.text()).slice(0, 600));
// A mask: white where curtains may go (left quarter), black elsewhere.
const room = await sharp("data/eval-cache/room-12.jpg").resize(1024).jpeg().toBuffer();
const meta = await sharp(room).metadata();
const w = meta.width!, h = meta.height!;
const m = Buffer.alloc(w * h, 0);
for (let y = 0; y < h; y++) for (let x = Math.round(w * 0.25); x < Math.round(w * 0.42); x++) m[y * w + x] = 255;
const mask = await sharp(m, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
const url = (b: Buffer, t: string) => `data:${t};base64,${b.toString("base64")}`;
for (const variant of ["mask-field", "mask-image-object"]) {
  const body: Record<string, unknown> = { model: process.argv[2] ?? "muse-image-1.0", prompt: "Hang a floor-length beige linen curtain in the masked area only; change nothing else.", images: [{ image_url: url(room, "image/jpeg") }], n: 1, size: `${w}x${h}`, response_format: "b64_json", output_format: "png" };
  if (variant === "mask-field") body.mask = url(mask, "image/png");
  else body.mask = { image_url: url(mask, "image/png") };
  const r = await fetch(`${base}/images/edits`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text();
  console.log(variant, r.status, text.slice(0, 300).replace(/"b64_json":"[^"]{50}[^"]*"/, '"b64_json":"…"'));
  if (r.ok) {
    const b64 = JSON.parse(text).data?.[0]?.b64_json;
    if (b64) {
      const out = await sharp(Buffer.from(b64, "base64")).resize(w, h, { fit: "fill" }).removeAlpha().raw().toBuffer();
      const orig = await sharp(room).removeAlpha().raw().toBuffer();
      let inside = 0, outside = 0, ni = 0, no = 0;
      for (let i = 0; i < w * h; i++) { const d = Math.abs(out[i * 3]! - orig[i * 3]!) + Math.abs(out[i * 3 + 1]! - orig[i * 3 + 1]!) + Math.abs(out[i * 3 + 2]! - orig[i * 3 + 2]!); if (m[i]) { inside += d; ni++; } else { outside += d; no++; } }
      console.log("  mean change inside mask", (inside / ni / 3).toFixed(1), "outside", (outside / no / 3).toFixed(1));
      writeFileSync(`out/probe-${variant}.png`, Buffer.from(b64, "base64"));
    }
  }
}
