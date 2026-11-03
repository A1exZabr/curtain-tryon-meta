import assert from "node:assert/strict";
import { test } from "node:test";
import { close, dilate, dropSmall, erode, mainWindows } from "../src/pipeline/region.ts";
import { changedOutside } from "../src/pipeline/tryon.ts";
import { composite } from "../src/pipeline/composite.ts";

const W = 20, H = 10;
const mask = (cells: [number, number][]) => { const m = new Uint8Array(W * H); for (const [x, y] of cells) m[y * W + x] = 1; return m; };
const count = (m: Uint8Array) => m.reduce((s, v) => s + v, 0);

test("dilate grows a pixel into a square", () => {
  assert.equal(count(dilate(mask([[5, 5]]), W, H, 1)), 9);
});

test("erode undoes dilate on a solid block", () => {
  const block = dilate(mask([[10, 5]]), W, H, 2);
  assert.equal(count(erode(dilate(block, W, H, 1), W, H, 1)), count(block));
});

test("close fills a one-pixel gap between two pieces", () => {
  const two = mask([[4, 5], [5, 5], [7, 5], [8, 5]]);
  assert.equal(close(two, W, H, 1)[6 + 5 * W], 1);
});

test("dropSmall removes crumbs and keeps large pieces", () => {
  const big = dilate(mask([[10, 5]]), W, H, 2); // 25 pixels
  big[0] = 1; // a one-pixel crumb in the corner
  const out = dropSmall(big, W, H, 5);
  assert.equal(out[0], 0);
  assert.equal(count(out), 25);
});

test("mainWindows keeps the far windows of a row and drops specks", () => {
  // Shares of a 1000x1000 frame as SAM found them on a room with a row of windows seen in perspective.
  const window = (share: number) => ({ box: { x1: 0, y1: 0, x2: 1, y2: 1 }, mask: new Uint8Array(0), area: share * 1e6 });
  const near = window(0.104), mid = window(0.023), far = window(0.006), speck = window(0.002);
  assert.deepEqual(mainWindows([near, mid, far, speck], 1000, 1000), [near, mid, far]);
});

test("composite keeps every pixel outside the paste mask byte-for-byte", async () => {
  const original = Buffer.alloc(W * H * 3, 100);
  const generated = Buffer.alloc(W * H * 3, 200);
  const paste = dilate(mask([[10, 5]]), W, H, 1);
  const out = await composite(original, generated, paste, W, H, 0);
  for (let i = 0; i < W * H; i++) if (!paste[i]) assert.equal(out[i * 3], 100);
  assert.equal(out[(5 * W + 10) * 3], 200);
  assert.equal(changedOutside(original, out, paste), 0);
});

test("a feathered composite still leaves everything outside the mask untouched", async () => {
  const original = Buffer.alloc(W * H * 3, 100);
  const generated = Buffer.alloc(W * H * 3, 200);
  const paste = dilate(mask([[10, 5]]), W, H, 2);
  const out = await composite(original, generated, paste, W, H, 3);
  assert.equal(changedOutside(original, out, paste), 0);
  for (let i = 0; i < W * H; i++) if (!paste[i]) assert.equal(out[i * 3], 100);
});

test("the soft edge starts near the original at the border and is opaque deep inside", async () => {
  const w = 60, h = 60;
  const original = Buffer.alloc(w * h * 3, 100);
  const generated = Buffer.alloc(w * h * 3, 200);
  const paste = new Uint8Array(w * h);
  for (let y = 10; y < 50; y++) for (let x = 10; x < 50; x++) paste[y * w + x] = 1;
  const out = await composite(original, generated, paste, w, h, 6);
  assert.ok(out[(30 * w + 10) * 3]! < 125, "border pixel stays close to the original");
  assert.equal(out[(30 * w + 30) * 3], 200);
  assert.equal(out[(30 * w + 9) * 3], 100);
});
