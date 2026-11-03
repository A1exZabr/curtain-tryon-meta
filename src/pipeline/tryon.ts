import { DEFAULT_CHECKER, type CheckerKind } from "../config.ts";
import { CostLog } from "../budget.ts";
import { segment, type Segment } from "../meta/sam.ts";
import { editImage, sizeFor } from "../meta/image.ts";
import {
  askJson,
  sceneSchema,
  scenePrompt,
  verdictPasses,
  verdictPrompt,
  verdictSchema,
  type SceneFacts,
  type Verdict,
} from "../meta/vision.ts";
import { applyAlignment, findAlignment, matchTone, type Alignment } from "./align.ts";
import { composite, overlay } from "./composite.ts";
import { fabricLab, lockFabricColour, type ColourLock } from "./colour.ts";
import { jpegDataUrl, loadPhoto, rgbToJpeg, toSize, type Photo } from "./images.ts";
import { allowedRegion, and, area, dilate, mainWindows, union, type Mask } from "./region.ts";

export interface TryOnRequest {
  room: Buffer;
  fabric: Buffer;
  style?: Buffer;
  /** The client's own words, e.g. from a voice note: "floor length, lighter than the swatch". */
  wish?: string;
  checker?: CheckerKind;
  maxAttempts?: number;
  /** Development only: reuse a generated image instead of paying for a new one. */
  reuseGenerated?: Buffer;
}

export interface AttemptReport {
  alignment: Alignment;
  geometry: { windowKept: number; curtainsInsideRegion: number; curtainCoverage: number };
  colour?: ColourLock;
  verdict?: Verdict;
  passed: boolean;
  why?: string;
}

export interface TryOnReport {
  status: "accepted" | "rejected_input" | "failed";
  reason?: string;
  clientMessage?: string;
  scene?: SceneFacts;
  attempts: AttemptReport[];
  /** Final picture (JPEG) when accepted, or the best failed one for the debug view. */
  image?: Buffer;
  debug: Record<string, Buffer>;
  costs: { what: string; usd: number; ms: number }[];
  totalUsd: number;
  ms: number;
  checker: CheckerKind;
}

/** Thresholds, kept together so the report can print them. */
export const LIMITS = {
  minWindowKept: 0.85, // share of the window found on the result that sits where the original window was
  minInside: 0.85, // share of the new curtains that must lie inside the allowed region
  minCoverage: 0.12, // new curtain area relative to the window area; below it the curtains are missing
};

export async function tryOn(req: TryOnRequest): Promise<TryOnReport> {
  const started = Date.now();
  const costs = new CostLog();
  const checker = req.checker ?? DEFAULT_CHECKER;
  const report: TryOnReport = { status: "failed", attempts: [], debug: {}, costs: costs.items, totalUsd: 0, ms: 0, checker };
  const finish = (): TryOnReport => {
    report.totalUsd = costs.totalUsd;
    report.ms = Date.now() - started;
    return report;
  };

  const room = await loadPhoto(req.room);
  const fabric = await loadPhoto(req.fabric, 1024);
  const style = req.style ? await loadPhoto(req.style, 1024) : undefined;
  const size = room.width * room.height;

  // Read the scene and segment the room at the same time: none of these depend on each other.
  const [scene, windowsAll, oldCurtains] = await Promise.all([
    askJson(
      checker,
      "scene check",
      scenePrompt(),
      [
        { caption: "Room photo:", dataUrl: room.dataUrl },
        { caption: "Fabric photo:", dataUrl: fabric.dataUrl },
      ],
      sceneSchema,
      costs,
    ),
    segment(room, "window", costs),
    segment(room, "curtains", costs),
  ]);
  report.scene = scene;

  if (!scene.is_room_photo || !scene.fabric_visible || !scene.window_visible) {
    report.status = "rejected_input";
    report.reason = scene.problems.join(", ") || "scene check failed";
    report.clientMessage = scene.message_for_client;
    return finish();
  }
  const windows = mainWindows(windowsAll, room.width, room.height);
  if (windows.length === 0) {
    report.status = "rejected_input";
    report.reason = "NO_WINDOW (segmentation)";
    report.clientMessage = "We couldn't find the window on this photo. Please take it so the whole window is in the frame.";
    return finish();
  }

  const windowMask = union(windows.map((w) => w.mask), size);
  const oldMask = union(oldCurtains.map((c) => c.mask), size);
  const region = allowedRegion(windows, oldCurtains, room.width, room.height);
  // The window with its frame: what alignment compares, and where the window must still be on the result.
  const windowFrame = dilate(windowMask, room.width, room.height, Math.round(room.width * 0.03));
  const windowNear = dilate(windowMask, room.width, room.height, Math.round(room.width * 0.015));
  report.debug.segmentation = await overlay(room.rgb, room.width, room.height, [
    { mask: region, colour: [255, 200, 0], alpha: 0.18 },
    { mask: windowMask, colour: [0, 140, 255], alpha: 0.45 },
    { mask: oldMask, colour: [255, 60, 60], alpha: 0.45 },
  ]);

  const fabricColour = fabricLab(fabric.rgb, fabric.width, fabric.height);
  const prompt = editPrompt(scene, windows.length, oldCurtains.length > 0, Boolean(style), req.wish);
  const references = [room.dataUrl, fabric.dataUrl, ...(style ? [style.dataUrl] : [])];
  const maxAttempts = req.maxAttempts ?? 2;

  for (let n = 1; n <= maxAttempts; n++) {
    const generated =
      n === 1 && req.reuseGenerated
        ? req.reuseGenerated
        : await editImage(references, prompt, sizeFor(room.width, room.height), costs);
    const resized = matchTone(room.rgb, await toSize(generated, room.width, room.height), region);
    const alignment = await findAlignment(room.rgb, resized, room.width, room.height, windowFrame);
    const aligned = matchTone(room.rgb, await applyAlignment(resized, room.width, room.height, alignment), region);
    const alignedJpeg = await rgbToJpeg(aligned, room.width, room.height);
    report.debug[`generated-${n}`] = alignedJpeg;
    const attempt: AttemptReport = {
      alignment,
      geometry: { windowKept: 0, curtainsInsideRegion: 0, curtainCoverage: 0 },
      passed: false,
    };
    report.attempts.push(attempt);

    const alignedPhoto = { dataUrl: jpegDataUrl(alignedJpeg), width: room.width, height: room.height };
    const [newWindows, newCurtains, rods] = await Promise.all([
      segment(alignedPhoto, "window", costs),
      segment(alignedPhoto, "curtains", costs),
      segment(alignedPhoto, "curtain rod", costs),
    ]);
    const newWindowMask = union(newWindows.map((w) => w.mask), size);
    const newMask = union(newCurtains.map((c) => c.mask), size);
    const rodMask = union(rods.map((r) => r.mask), size);
    const newArea = area(newMask);
    attempt.geometry = {
      windowKept: area(and(newWindowMask, windowNear)) / Math.max(1, area(newWindowMask)),
      curtainsInsideRegion: newArea ? area(and(newMask, region)) / newArea : 0,
      curtainCoverage: newArea / Math.max(1, area(windowMask)),
    };
    if (attempt.geometry.windowKept < LIMITS.minWindowKept) {
      attempt.why = `the window moved or changed shape (${(attempt.geometry.windowKept * 100).toFixed(0)}% in place)`;
      continue;
    }

    // Pull the curtains' colour back to the fabric's, then paste the new curtains and rod, and wherever the old
    // curtains were (the generator removed them there).
    attempt.colour = lockFabricColour(aligned, newMask, fabricColour);
    const grow = Math.round(room.width * 0.006);
    const paste = and(dilate(union([newMask, rodMask, oldMask], size), room.width, room.height, grow), region);
    const final = await composite(room.rgb, aligned, paste, room.width, room.height, grow);
    const finalJpeg = await rgbToJpeg(final, room.width, room.height);
    report.debug[`paste-${n}`] = await overlay(aligned, room.width, room.height, [
      { mask: paste, colour: [0, 220, 120], alpha: 0.4 },
    ]);
    report.image = finalJpeg;

    if (attempt.geometry.curtainCoverage < LIMITS.minCoverage) {
      attempt.why = "no new curtains found on the result";
      continue;
    }
    if (attempt.geometry.curtainsInsideRegion < LIMITS.minInside) {
      attempt.why = `curtains spill outside the window area (${(attempt.geometry.curtainsInsideRegion * 100).toFixed(0)}% inside)`;
      continue;
    }

    attempt.verdict = await askJson(
      checker,
      "result check",
      verdictPrompt(scene.fabric_description),
      [
        { caption: "Original room:", dataUrl: room.dataUrl },
        { caption: "Result:", dataUrl: jpegDataUrl(finalJpeg) },
        { caption: "Fabric:", dataUrl: fabric.dataUrl },
      ],
      verdictSchema,
      costs,
    );
    attempt.passed = verdictPasses(attempt.verdict);
    if (attempt.passed) {
      report.status = "accepted";
      return finish();
    }
    attempt.why = `result check: ${attempt.verdict.defects.join(", ") || "low score"} (${attempt.verdict.notes})`;
  }

  report.reason = report.attempts.at(-1)?.why ?? "no attempt passed";
  return finish();
}

export function editPrompt(
  scene: SceneFacts,
  windowCount: number,
  hasOldCurtains: boolean,
  hasStyle: boolean,
  wish?: string,
): string {
  const windowWord = windowCount > 1 ? "each window" : "the window";
  const parts = [
    "Image 1 is a photo of a room. Image 2 is a photo of a curtain fabric" +
      (scene.fabric_description ? ` (${scene.fabric_description}${scene.fabric_colour_hex ? `, about ${scene.fabric_colour_hex}` : ""}).` : "."),
    hasStyle ? "Image 3 shows how the curtains should be sewn; use it only as a reference for the tailoring, it is not the room." : "",
    `Hang new floor-length curtains made from the fabric in image 2 on ${windowWord} in image 1` +
      (hasStyle ? ", sewn in the style of image 3" : "") +
      ", on a simple rod just above the window frame, one panel on each side.",
    hasOldCurtains ? `Remove the curtains that hang there now and replace them with the new ones.` : "",
    "Match the fabric's colour, pattern and texture exactly; keep its lightness and do not make it darker or more saturated.",
    "Keep the camera position, framing, the window, the view outside, the walls, floor, furniture and lighting exactly as in image 1. Change only the curtains.",
    "Photorealistic, like a photo of the same room.",
    wish ? `The client also asked: "${wish.replace(/"/g, "'")}".` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

export type { Photo, Segment, Mask };
