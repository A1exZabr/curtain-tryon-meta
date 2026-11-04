import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { crc32 } from "node:zlib";
import sharp from "sharp";

// The spend file and cap are read when config.ts loads, so they are set before the imports below.
process.env.SPEND_FILE = join(mkdtempSync(join(tmpdir(), "spend-")), "spend.json");
process.env.SPEND_CAP_USD_PER_DAY = "1";
const { BudgetExceeded, CostLog, reserve } = await import("../src/budget.ts");
const { wavSeconds } = await import("../src/meta/transcribe.ts");
const { isPhoto } = await import("../src/pipeline/images.ts");

function wav(seconds: number, opts: { rate?: number; channels?: number; byteRate?: number } = {}): Buffer {
  const rate = opts.rate ?? 16000;
  const channels = opts.channels ?? 1;
  const data = Math.round(seconds * rate) * 2 * channels;
  const b = Buffer.alloc(44 + data);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + data, 4);
  b.write("WAVE", 8, "ascii");
  b.write("fmt ", 12, "ascii");
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(opts.byteRate ?? rate * 2 * channels, 28);
  b.writeUInt16LE(2 * channels, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36, "ascii");
  b.writeUInt32LE(data, 40);
  return b;
}

test("a voice note is priced by the bytes sent, not by the header's byte rate", () => {
  assert.equal(wavSeconds(wav(3)), 3);
  assert.equal(wavSeconds(wav(3, { byteRate: 0xffffffff })), 3);
});

test("only the page's own audio format is taken", () => {
  assert.throws(() => wavSeconds(wav(1, { rate: 8000 })));
  assert.throws(() => wavSeconds(wav(1, { channels: 2 })));
  assert.throws(() => wavSeconds(Buffer.from("RIFFxxxx")));
});

test("calls in flight count against the cap until they settle", () => {
  const releases = [reserve(0.4), reserve(0.4)];
  assert.throws(() => reserve(0.4), BudgetExceeded);
  releases[0]!();
  releases[0]!(); // freeing twice frees once
  const third = reserve(0.4);
  assert.throws(() => reserve(0.4), BudgetExceeded);
  new CostLog().add("paid call", 0.3, 1);
  third();
  releases[1]!();
  // 0.3 spent and nothing in flight: 0.6 more fits, 0.8 doesn't.
  reserve(0.6)();
  assert.throws(() => reserve(0.8), BudgetExceeded);
});

test("a photo header that declares a huge picture is refused before decoding", async () => {
  const small = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#888" } }).jpeg().toBuffer();
  assert.equal(await isPhoto(small), true);
  // A tiny PNG whose header claims 20000 x 20000 pixels: what a decompression bomb looks like to the server.
  const bomb = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } }).png().toBuffer();
  bomb.writeUInt32BE(20000, 16);
  bomb.writeUInt32BE(20000, 20);
  bomb.writeUInt32BE(crc32(bomb.subarray(12, 29)), 29);
  assert.equal((await sharp(bomb, { limitInputPixels: false }).metadata()).width, 20000);
  assert.equal(await isPhoto(bomb), false);
  const tiff = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#888" } }).tiff().toBuffer();
  assert.equal(await isPhoto(tiff), false);
  assert.equal(await isPhoto(Buffer.from("not an image")), false);
});
