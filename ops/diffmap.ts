// Offline: where does the generated image differ from the room? Writes a heat map, no API calls.
// Usage: npx tsx ops/diffmap.ts room.jpg generated.png out.jpg
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { loadPhoto, toSize } from "../src/pipeline/images.ts";
import { matchTone } from "../src/pipeline/align.ts";
const [roomPath, genPath, outPath] = process.argv.slice(2) as [string, string, string];
const room = await loadPhoto(readFileSync(roomPath));
const none = new Uint8Array(room.width * room.height);
const gen = matchTone(room.rgb, await toSize(readFileSync(genPath), room.width, room.height), none);
const W = 384, H = Math.round((384 * room.height) / room.width);
const g = async (b: Buffer) => sharp(b, { raw: { width: room.width, height: room.height, channels: 3 } }).resize(W, H).greyscale().blur(1).raw().toBuffer();
const a = await g(room.rgb), b = await g(gen);
const heat = Buffer.alloc(W * H);
const rows: string[] = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) heat[y * W + x] = Math.min(255, Math.abs(a[y * W + x]! - b[y * W + x]!) * 4);
for (let by = 0; by < 8; by++) { let row = ""; for (let bx = 0; bx < 12; bx++) { let s = 0, n = 0; for (let y = Math.floor(by * H / 8); y < Math.floor((by + 1) * H / 8); y++) for (let x = Math.floor(bx * W / 12); x < Math.floor((bx + 1) * W / 12); x++) { s += Math.abs(a[y * W + x]! - b[y * W + x]!); n++; } row += String(Math.round(s / n)).padStart(4); } rows.push(row); }
console.log("mean |diff| per cell (8 rows x 12 cols):\n" + rows.join("\n"));
await sharp(heat, { raw: { width: W, height: H, channels: 1 } }).jpeg().toFile(outPath);
