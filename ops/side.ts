// Offline: lays images side by side on one sheet for a quick look. Usage: npx tsx ops/side.ts out.jpg a.jpg b.jpg ...
import sharp from "sharp";
const [out, ...inputs] = process.argv.slice(2) as [string, ...string[]];
const H = 600;
const parts = await Promise.all(inputs.map((p) => sharp(p).resize({ height: H }).toBuffer({ resolveWithObject: true })));
const width = parts.reduce((s, p) => s + p.info.width, 0);
let left = 0;
await sharp({ create: { width, height: H, channels: 3, background: "#fff" } })
  .composite(parts.map((p) => { const c = { input: p.data, left, top: 0 }; left += p.info.width; return c; }))
  .jpeg({ quality: 85 })
  .toFile(out);
