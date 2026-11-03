// One-off probe of the live APIs on a single room: what SAM finds, and whether Muse Image keeps the frame.
// Usage: ops/with-env.sh npx tsx ops/smoke.ts <room.jpg> <fabric.jpg> <outDir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { CostLog } from "../src/budget.ts";
import { segment } from "../src/meta/sam.ts";
import { editImage, sizeFor } from "../src/meta/image.ts";
import { loadPhoto, toSize } from "../src/pipeline/images.ts";

const [roomPath, fabricPath, outDir = "out/smoke"] = process.argv.slice(2);
if (!roomPath || !fabricPath) throw new Error("usage: smoke.ts room fabric outDir");
mkdirSync(outDir, { recursive: true });

const costs = new CostLog();
const room = await loadPhoto(readFileSync(roomPath));
const fabric = await loadPhoto(readFileSync(fabricPath), 1024);
console.log(`room ${room.width}x${room.height}`);

async function saveMask(mask: Uint8Array, name: string) {
  const grey = Buffer.alloc(room.width * room.height);
  for (let i = 0; i < mask.length; i++) grey[i] = mask[i] ? 255 : 0;
  await sharp(grey, { raw: { width: room.width, height: room.height, channels: 1 } }).png().toFile(`${outDir}/${name}.png`);
}

for (const phrase of ["window", "curtains", "curtain rod"]) {
  const segments = await segment(room, phrase, costs);
  console.log(
    `SAM "${phrase}": ${segments.length}`,
    segments.map((s) => ({ box: s.box, c: s.confidence, areaPct: +((100 * s.area) / (room.width * room.height)).toFixed(1) })),
  );
  const union = new Uint8Array(room.width * room.height);
  for (const s of segments) for (let i = 0; i < union.length; i++) if (s.mask[i]) union[i] = 1;
  await saveMask(union, `mask-${phrase.replace(/ /g, "-")}`);
}

const prompt =
  "Image 1 is a photo of a room. Image 2 is a photo of a curtain fabric. Hang new floor-length curtains sewn from the " +
  "fabric in image 2 on the window in image 1, one panel on each side, on a simple rod just above the window frame. " +
  "Match the fabric's colour, pattern and texture exactly. Keep the camera angle, framing, the window, the view " +
  "outside, the walls, floor, furniture and lighting exactly as in image 1. Change only the curtains. Photorealistic.";
const edited = await editImage([room.dataUrl, fabric.dataUrl], prompt, sizeFor(room.width, room.height), costs);
writeFileSync(`${outDir}/edited-raw.png`, edited);
const meta = await sharp(edited).metadata();
console.log(`Muse Image returned ${meta.width}x${meta.height} for a ${room.width}x${room.height} input`);

// How far did the generator move the room? Mean absolute grey difference on a 192 px thumbnail, whole frame.
const W = 192;
const H = Math.round((192 * room.height) / room.width);
const a = await sharp(room.rgb, { raw: { width: room.width, height: room.height, channels: 3 } }).resize(W, H).greyscale().raw().toBuffer();
const resized = await toSize(edited, room.width, room.height);
const b = await sharp(resized, { raw: { width: room.width, height: room.height, channels: 3 } }).resize(W, H).greyscale().raw().toBuffer();
let diff = 0;
for (let i = 0; i < a.length; i++) diff += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
console.log(`mean |diff| over the whole frame after resizing: ${(diff / a.length).toFixed(1)} of 255`);
await sharp(resized, { raw: { width: room.width, height: room.height, channels: 3 } }).jpeg().toFile(`${outDir}/edited-resized.jpg`);
console.log(costs.items, `total $${costs.totalUsd.toFixed(4)}`);
