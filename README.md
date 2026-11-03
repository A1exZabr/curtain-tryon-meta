# Curtain try-on engine on Meta models

A curtain salon's client picks a fabric from a swatch and has to imagine it at home. This engine takes a photo of
their room and a photo of the fabric and returns the same room with curtains of that fabric on the window. Only the
curtains change. Every other pixel of the photo is the client's own.

Live demo: **https://tryon.zabsoft.com** (built for the Meta Global AI Developer Hackathon, Startup track).

## What existed before and what was built here

[CurtainBot](https://curtain-bot.online) is an existing product of ZabSoft LLC: a Telegram bot and web app where
salon clients order try-ons, with accounts, payments and an operator panel. It ran on a general image-editing
model and failed often. **Everything in this repository was written during the hackathon (October 27 to November
4, 2026)**: a new try-on engine on Meta's models, its demo page and its evaluation. No CurtainBot code is in here.
The only things the demo page takes from before are ZabSoft's brand assets: the ZabSoft wordmark and the ZabSoft
Display heading font (a modified Mona Sans under the SIL Open Font License, see `web/public/fonts/OFL.txt`).

## Why a pipeline and not one prompt

Image generators are good at curtains and bad at leaving everything else alone. Asked to change one thing, they
redraw the whole frame. On our evaluation set, the raw Muse Image output changed a visible share of the room
outside the curtains: 21% of it on average (see [Results](#results)). Furniture shifted, the view outside changed,
colours drifted. A salon can't sell a try-on of a room that isn't the client's room.

So the generator never gets the last word:

```
room photo ─┬─► Muse Spark Open ─► is it a room? is there a window? the fabric's true colour
fabric ─────┘        (scene check, refuses bad photos before any generation)
room photo ───► SAM 3.1 "window", "curtains" ─► window mask, old curtains, allowed area
room + fabric (+ style photo, + voice wish via Muse Voice Transcribe) ─► Muse Image edit
generated ───► align on the window, match the photo's tone
          ───► SAM 3.1 "curtains", "curtain rod" on the result
          ───► window still in place? curtains inside the allowed area?
          ───► pull the curtains' colour back to the fabric (Lab shift, folds kept)
          ───► paste only curtains + rod into the original photo (everything else: original pixels)
          ───► Muse Spark Open: right fabric, right window, realistic? ─► accept, or generate again
```

How each Meta model is used:

| Model | Where | What it does here |
|-|-|-|
| SAM 3.1 (Meta Model API) | before and after generation | Finds the window, existing curtains, the new curtains and the rod by text prompt. The masks decide what may change. Falls back to "large window" and "glass door" for floor-to-ceiling glass. |
| Muse Image (Meta Model API) | generation | Edits the room photo with the fabric (and optionally a tailoring photo) as reference images. It supplies the curtains only. |
| Muse Spark Open (open weights, served by Baseten) | before and after generation | Reads the scene and the fabric as JSON before generation, so a photo with no window or no fabric is refused for about one cent with a message telling the client what to send. Judges the composite against the fabric afterwards. |
| Muse Spark 1.3 (Meta Model API) | optional | Same checks, switchable with `CHECKER=spark`. |
| Muse Voice Transcribe (Meta Model API) | demo page | The client says what they want ("floor length, a bit lighter than the swatch"); the browser records, converts to 16 kHz WAV, and the text goes into the prompt. |

The parts that are plain code, not models, are where most of the reliability comes from:

- **Alignment on the window** (`src/pipeline/align.ts`). Muse Image returns its own resolution and sometimes shifts
  or zooms slightly. The result is scaled to the photo and searched for the scale and shift that best lay the
  window and its frame over the original.
- **Tone match**. A per-channel linear fit over the part of the room that must not change brings the generated
  pixels back to the photo's exposure, so pasted curtains don't sit in a different light.
- **Window check**. The 40th percentile of the grey difference inside the original window mask after alignment. New
  curtains cover part of the glass, but if the rest matches, the window didn't move.
- **Colour lock** (`src/pipeline/colour.ts`). Generators drift the fabric darker and more saturated. The curtains'
  mean colour is moved to the swatch's in Lab space, hue fully and lightness halfway (curtains against a bright
  window really are darker), with the same offset for every pixel so folds and shadows stay.
- **Compositing** (`src/pipeline/composite.ts`). Only pixels inside the new curtains, the rod and the old curtains,
  clipped to the allowed area, come from the generator, with a soft edge of a few pixels. Outside it the output is
  byte-for-byte the input.
- **Spend cap** (`src/budget.ts`). Each paid call reserves its worst-case cost first, and the day's total is kept on
  disk, so the public demo stops itself instead of running up the bill.

## Results

On a fixed set of 11 real interiors (one, two and floor-to-ceiling windows, with and without old curtains, day
and dusk) plus one photo that is not a room, on the final code:

| | |
|-|-|
| Try-ons that passed every check | 6 of 11 (55%), 5 on the first attempt |
| Pixels of the room outside the curtains changed by the engine | 0, by construction (and covered by a test) |
| Share of the room outside the curtains the raw Muse Image output changed | 21% on average |
| Photo with no room in it | refused before generation, $0.015 |
| Cost per accepted try-on (all calls of all runs, failed ones included) | $0.080 |
| Median time of an accepted try-on | 78 s |

Generation is random, so the count moves by about one between runs: the run before the last fix to the paste mask
passed 7 of 11. A failed try-on is never shown to the client: it is generated again, and after two attempts the
client is asked for another photo. Most rejections come from the final check (a curtain's edge, a wrong fabric
pattern, a remnant of the old sheer), which is the point of having it.

The full table, with every run, is in [eval/RESULTS.md](eval/RESULTS.md). The photos are real interiors from
Unsplash, Pexels and Wikimedia Commons under their free licences; `eval/photos.json` lists each one with its author
and link. They are fetched at run time and not stored in this repository.

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

`out/run` gets `result.jpg`, `before.jpg`, the debug overlays (`segmentation.jpg`, `paste-1.jpg`) and
`report.json` with every model call, its time and its cost.

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

- The allowed area is built from the window's box. Curtains on a bay window or around a corner are cut at its edge.
- Floor-to-ceiling glass walls are sometimes not found by SAM at all; those photos are refused rather than guessed.
- The colour lock moves the mean colour; a strongly patterned fabric keeps the generator's pattern, which can differ
  from the swatch's.
- A try-on takes about a minute, most of it in Muse Image.

## License

MIT, see [LICENSE](LICENSE). The evaluation photos keep their own licences. The ZabSoft wordmark is ZabSoft LLC's
trademark and is not covered by the MIT license; the ZabSoft Display font is under the SIL Open Font License 1.1.

Made by ZabSoft LLC, Batumi, Georgia.
