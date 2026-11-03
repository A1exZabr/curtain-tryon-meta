# Curtain try-on engine on Meta models

A curtain salon's client picks a fabric from a swatch and has to imagine it at home. This engine takes a photo of
their room and a photo of the fabric and returns the same room with curtains of that fabric on the window. The
window, the view, the furniture and the framing stay as they were, and a picture where they didn't is never shown.

Live demo: **https://tryon.zabsoft.com** (built for the Meta Global AI Developer Hackathon, Startup track).

## What existed before and what was built here

[CurtainBot](https://curtain-bot.online) is an existing product of ZabSoft LLC: a Telegram bot and web app where
salon clients order try-ons, with accounts, payments and an operator panel. It ran on a general image-editing
model and failed often. **Everything in this repository was written during the hackathon (October 27 to November
4, 2026)**: a new try-on engine on Meta's models, its demo page and its evaluation. No CurtainBot code is in here.
The only things the demo page takes from before are ZabSoft's brand assets: the ZabSoft wordmark and the ZabSoft
Display heading font (a modified Mona Sans under the SIL Open Font License, see `web/public/fonts/OFL.txt`).

## Why a pipeline and not one prompt

Image generators are good at curtains and bad at leaving everything else alone. Asked to change one thing, Muse
Image redraws the whole frame, and sometimes it zooms in, moves a chair, takes down the client's tulle or redraws the
window. In an ablation on our 20 evaluation rooms its raw output changed a median 25% of the pixels outside the
curtains. A salon can't sell a try-on of a room that isn't the client's room.

The first version of this engine cut the curtains out of the generated picture and pasted them into the original
photo, so not one pixel outside them could change. On real rooms that showed: a curtain drawn for the generator's
slightly different room sat skewed in the photo, with a cut hem or a halo. So the engine now shows the generator's
own picture, curtains, light and shadows drawn together, and the work moved from repairing that picture to
measuring it. A picture that fails a measurement is thrown away and made again with a note on what was wrong.

```
room photo ─┬─► Muse Spark Open: is it a room? a window? the fabric's colour and sheerness,
fabric ─────┘   the tulle on the window, the room's large objects, the openings' size
room photo ───► SAM 3.1: windows, old curtains, tulle, lamps ─► where curtains may hang
room + fabric (+ style, + voice wish via Muse Voice Transcribe) ─► Muse Image edit
generated ───► align on the room outside the curtain area, cut both pictures to what was drawn
          ───► SAM 3.1 on the result: new curtains, rod, tulle
          ───► window frame in place? curtains in their area? tulle still there?
               the photo's edges still there and the rest of the room the same?
          ───► pull the curtains' colour to the swatch (Lab shift, folds kept)
          ───► Muse Spark Open, 3 votes: right fabric, room unchanged, realistic? ─► show, or make again
```

How each Meta model is used:

| Model | Where | What it does here |
|-|-|-|
| SAM 3.1 (Meta Model API) | before and after generation | Finds the windows, existing curtains, tulle and lamps by text prompt, and on the result the new curtains, the rod and the tulle. Falls back to "large window" and "glass door" for floor-to-ceiling glass. |
| Muse Image (Meta Model API) | generation | Edits the room photo with the fabric (and optionally the client's tailoring photo) as reference images. The prompt is built from the scene check: the objects that must stay, whether the window is covered, the fabric's sheerness, the chosen style. |
| Muse Spark Open (open weights, served by Baseten) | before and after generation | Reads the scene and the fabric as JSON before generation, so a photo with no window or no fabric is refused for about three cents with a message telling the client what to send. Measures the openings for a fabric estimate. Afterwards three votes judge the result point by point, with close-ups of the changed area; the majority decides. |
| Muse Spark 1.3 (Meta Model API) | optional | Same checks, switchable with `CHECKER=spark`. |
| Muse Voice Transcribe (Meta Model API) | demo page | The client says what they want ("floor length, a bit lighter than the swatch"); the browser records, converts to 16 kHz WAV, and the text goes into the prompt. |

The parts that are plain code, not models, are where most of the reliability comes from:

- **Alignment** (`src/pipeline/align.ts`). Muse Image returns its own resolution and often zooms or shifts a few
  percent. The result is searched for the scale and shift that lay the room outside the curtain area over the photo.
  Aligning on the window frame, as the paste version did, found false zooms of 5-7%: the new curtains cover the
  frame. Where the generator zoomed in, both pictures are cut to the part it really drew instead of smearing its edge.
- **Room check**. After alignment the photo's edges outside the curtains and windows must still be in the result
  (85% of them, 75% when the rest of the room differs from the photo by at most 8 of 255), and the room's grey
  difference must stay under 18 of 255. This is what catches a missing lamp, a moved chair or a reframed picture.
- **Window and tulle checks**. The window's outline must match after alignment, and a tulle the client has must
  still hang where it hung.
- **Colour lock** (`src/pipeline/colour.ts`). Generators drift the fabric darker and more saturated. The curtains'
  mean colour is moved to the swatch's in Lab space, hue fully and lightness halfway (curtains against a bright
  window really are darker), with the same offset for every pixel so folds and shadows stay.
- **Retries with a reason**. A rejected picture's measurements and the judge's defects become sentences in the next
  prompt ("the generator changed the room: keep every object, the camera and the framing").
- **Spend cap** (`src/budget.ts`). Each paid call reserves its worst-case cost first, and the day's total is kept on
  disk, so the public demo stops itself instead of running up the bill.

Some things were tried and taken out because they made results worse, measured on the same rooms. Sending Muse
Image a light map of the room as an extra picture: the runs that sent it changed a median 41% of the room in the raw
output against 25% without it, and the pictures came out washed out. Fitting the generated picture's tone to the
photo pixel by pixel: on a picture laid a few pixels off it flattened the contrast into a milky room. A local light
correction: in a dark room it greyed out a bright window. The client now sees the generator's own light and colour;
tone is matched only to measure.

## Results

On a fixed set of 20 real interiors (one, two, bay and corner windows, attic roof windows, with and without old
curtains and tulle, day and dusk, dim and backlit) plus one photo that is not a room, on the final code:

| | |
|-|-|
| Try-ons that passed every check | 17 of 20 (85%), 14 on the first attempt |
| Photo's edges kept outside the curtains, accepted results | median 99% |
| Rest of the room's grey difference from the photo, accepted results | median 4 of 255 |
| Generations thrown away because the generator changed the room | 6 of 30 |
| Photo with no room in it | refused before generation, $0.029 |
| Cost per accepted try-on (all calls of all runs, failed ones included) | $0.110 |
| Median time of an accepted try-on | 120 s with ten rooms running at once on 3 CPU cores |

Generation is random, so the count moves by a room or two between runs. The three that failed: in two, every
picture changed the room a little too much (difference 13 to 20 of 255 with 81-82% of the edges kept, or 19 to 20 of
255), and in one Muse Image took down the lace valance on all three tries and the judge caught it each time. A failed
try-on is never shown to the client.

The full table, with every run, is in [eval/RESULTS.md](eval/RESULTS.md). The photos are real interiors from
Unsplash, Pexels and Wikimedia Commons under their free licences; `eval/photos.json` lists each one with its author
and link. They are fetched at run time and not stored in this repository. `npm run eval -- --variant pasted` runs the
earlier paste version on the same set.

## Run it

Needs Node 22 or newer, a Meta Model API key and a Baseten API key (or `CHECKER=spark` to use Muse Spark 1.3 on
the Meta Model API instead).

```bash
npm install
export META_MODEL_API_KEY=...   # dev.meta.ai
export BASETEN_API_KEY=...      # for Muse Spark Open
npm run tryon -- --room room.jpg --fabric fabric.jpg --wish "floor length" --out out/run
npm run serve                   # demo page on http://localhost:8080
npm run eval                    # the evaluation set, writes eval/RESULTS.md
```

`out/run` gets `result.jpg`, `before.jpg`, the debug pictures (`segmentation.jpg`, the generator's raw output
`raw-1.jpg` and its aligned version `generated-1.jpg` for each attempt) and `report.json` with every model call,
its time and its cost.

Settings are environment variables: `SPEND_CAP_USD_PER_DAY` (default 5), `CHECKER` (`spark-open` or `spark`),
`WORK_LONG_SIDE` (default 1536), and for the demo `PORT`, `TRIES_PER_HOUR`, `MAX_RUNNING`. The demo refuses service
in the territories listed in Meta's Model API geographic use policy (`BLOCKED_COUNTRIES`).

## Layout

```
src/meta/       API clients: sam.ts, image.ts, vision.ts (Muse Spark / Muse Spark Open), transcribe.ts
src/pipeline/   tryon.ts (the pipeline), region.ts, align.ts, colour.ts, composite.ts, images.ts
src/budget.ts   prices and the daily spend cap
web/            demo server (job queue, limits) and the page
eval/           photos.json, run.ts, RESULTS.md
ops/            probes used while building (live API smoke test, diff maps, calibration)
```

## Limits we know about

- The judge doesn't check the style. A try-on asked for eyelets or a wave heading can come back as plain drapes.
- The judge once passed a panel hung on an open casement. Its close-ups look for cut edges and smears, not for
  curtains in odd places.
- The room check compares edges and tone, not objects one by one. A small object can disappear and still pass.
- Floor-to-ceiling glass walls are sometimes not found by SAM at all; those photos are refused rather than guessed.
- The colour lock moves the mean colour; a strongly patterned fabric keeps the generator's pattern, which can differ
  from the swatch's.
- A try-on takes one to two minutes, most of it in Muse Image and the retries.

## License

MIT, see [LICENSE](LICENSE). The evaluation photos keep their own licences. The ZabSoft wordmark is ZabSoft LLC's
trademark and is not covered by the MIT license; the ZabSoft Display font is under the SIL Open Font License 1.1.

Made by ZabSoft LLC, Batumi, Georgia.
