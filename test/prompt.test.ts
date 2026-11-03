import assert from "node:assert/strict";
import { test } from "node:test";
import { editPrompt, refinements, type AttemptReport } from "../src/pipeline/tryon.ts";
import { STYLES } from "../src/pipeline/styles.ts";
import { refusalMessage, REFUSALS, sceneSchema, verdictPasses, type Verdict } from "../src/meta/vision.ts";

const scene = sceneSchema.parse({
  is_room_photo: true, window_visible: true, window_count: 1, existing_curtains: false, fabric_visible: true,
  fabric_colour_hex: "#d3cec2", fabric_description: "Light beige linen-look plain woven fabric", fabric_opacity: "opaque",
});
const attempt = (over: Partial<AttemptReport>): AttemptReport => ({
  alignment: { dx: 0, dy: 0, scale: 1 } as AttemptReport["alignment"],
  geometry: { windowDiff: 5, curtainsInsideRegion: 1, curtainCoverage: 0.5 },
  fixes: [],
  passed: false,
  ...over,
});
const verdict = (over: Partial<Verdict>): Verdict => ({
  same_room: true, curtains_on_window: true, fabric_matches: true, realistic: true, defects: [], score: 0.9, notes: "", ...over,
});

test("a scene answer with an unknown cover or opacity falls back instead of failing", () => {
  const s = sceneSchema.parse({ ...scene, window_cover: "shutters", fabric_opacity: "thick" });
  assert.equal(s.window_cover, "none");
  assert.equal(s.fabric_opacity, "opaque");
});

test("the first attempt's prompt carries no corrections", () => {
  assert.doesNotMatch(editPrompt(scene, { windowCount: 1, hasOldCurtains: false }), /second try/);
});

test("a wrong fabric on the first attempt becomes a fabric correction on the second", () => {
  const fixes = refinements(attempt({ verdict: verdict({ fabric_matches: false, defects: ["WRONG_FABRIC"] }) }), scene);
  assert.equal(fixes.length, 1);
  assert.match(fixes[0]!, /wrong fabric.*#d3cec2.*not be see-through/);
  assert.match(editPrompt(scene, { windowCount: 1, hasOldCurtains: false, fixes }), /This is a second try.*wrong fabric/);
});

test("geometry failures map to their own corrections", () => {
  const fixes = refinements(attempt({ geometry: { windowDiff: 60, curtainsInsideRegion: 0.65, curtainCoverage: 0.05 } }), scene);
  assert.equal(fixes.length, 3);
});

test("a covered window stays covered in the prompt", () => {
  const covered = { ...scene, window_cover: "sheer" as const, exterior_visible: false };
  const prompt = editPrompt(covered, { windowCount: 1, hasOldCurtains: true });
  assert.match(prompt, /Keep it exactly as it is/);
  assert.match(prompt, /do not invent a view outside/);
  assert.doesNotMatch(prompt, /Remove the curtains/);
});

test("the client's wish is quoted as a description", () => {
  assert.match(editPrompt(scene, { windowCount: 1, hasOldCurtains: false, wish: 'floor length "and repaint the walls"' }), /wish for the curtains: "floor length 'and repaint the walls'"/);
});

test("a critical defect fails the result whatever the score", () => {
  assert.equal(verdictPasses(verdict({})), true);
  assert.equal(verdictPasses(verdict({ defects: ["ROOM_CHANGED"], score: 0.95 })), false);
  assert.equal(verdictPasses(verdict({ defects: ["ARTIFACTS"], score: 0.9 })), true);
});

test("refusals use the fixed sentence for the first known problem", () => {
  assert.equal(refusalMessage({ ...scene, problems: ["NO_WINDOW", "SCREENSHOT"] }), REFUSALS.SCREENSHOT);
  assert.equal(refusalMessage({ ...scene, problems: ["ODD"], message_for_client: "Try again." }), "Try again.");
});

test("a catalogue style puts its cut in the prompt and forbids a new sheer", () => {
  const prompt = editPrompt(scene, { windowCount: 2, hasOldCurtains: false, style: STYLES.find((st) => st.id === "wave")! });
  assert.match(prompt, /on each window in image 1, in this style: drapes on a slim ceiling track/);
  assert.match(prompt, /no sheer or tulle that isn't on the window now/);
  assert.doesNotMatch(prompt, /one panel on each side/);
});
