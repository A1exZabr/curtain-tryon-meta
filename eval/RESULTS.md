# Evaluation results

Run on 2026-11-03 10:47 UTC with `npm run eval`, checker: spark-open.
Photos come from Unsplash, Pexels and Wikimedia Commons under their free licences; see `eval/photos.json` for authors and links.

- Accepted try-ons: **6 of 11** (55%), 5 on the first attempt.
- A photo with no room in it was refused before generation: yes.
- Pixels of the room outside the curtains changed by the engine: **0** (by construction: they are copied from the original).
- The same, if the raw Muse Image output were shown instead: **21%** of the room on average.
- Cost per accepted try-on: **$0.080** (all calls of all runs, failures included, divided by accepted ones).
- Median time of an accepted try-on: **78 s**.

| Run | Room | Fabric | Result | Attempts | Window difference (0–255) | Curtains in their area | Colour drift fixed (ΔE) | Raw output changed | Checker score | Cost | Time |
|-|-|-|-|-|-|-|-|-|-|-|-|
| 01 | room-01 | fabric-01 | accepted | 1 | 8 | 96% | 7.9 | 30% | 0.95 | $0.033 | 77 s |
| 02 | room-02 | fabric-02 | failed: result check: ARTIFACTS, CUT_EDGE (Curtains correctly placed and fabric matches sage velvet but edges show smearing and ghosting artifacts.) | 2 | 21 | 100% | 17.2 | 21% | 0.72 | $0.055 | 139 s |
| 03 | room-03 | fabric-03 | accepted | 1 | 20 | 88% | 14.2 | 29% | 0.95 | $0.032 | 79 s |
| 04 | room-04 | fabric-04 + style-01 | accepted | 1 | 2 | 100% | 18.3 | 18% | 0.95 | $0.032 | 78 s |
| 05 | room-05 | fabric-05 | accepted | 1 | 8 | 100% | 11.6 | 39% | 0.92 | $0.034 | 63 s |
| 06 | room-06 | fabric-01 | failed: result check: WRONG_FABRIC, CUT_EDGE (Curtains are sheer white not opaque beige linen, with rough jagged edges on right side.) | 2 | 2 | 100% | 65.7 | 11% | 0.45 | $0.056 | 92 s |
| 07 | room-07 | fabric-02 | failed: result check: ARTIFACTS (Curtains match sage velvet hue and sheen but left window shows dark ghosting artifact from original sheer.) | 2 | 25 | 100% | 27.7 | 19% | 0.68 | $0.056 | 114 s |
| 08 | room-08 | fabric-03 | rejected_input: NO_WINDOW (segmentation) | 0 | – | – | – | – | – | $0.016 | 9 s |
| 09 | room-09 | fabric-04 | failed: result check: WRONG_FABRIC, ARTIFACTS, CUT_EDGE (Curtains are teal not beige-orange herringbone and left curtain has light-bleed artifact with hard cut edge.) | 2 | 7 | 99% | 46.6 | 26% | 0.35 | $0.056 | 112 s |
| 11 | room-11 | fabric-05 + style-01 | accepted | 2 | 4 | 100% | 19.4 | 12% | 0.92 | $0.058 | 111 s |
| 12 | room-12 | fabric-01 | accepted | 1 | 1 | 100% | 56.1 | 13% | 0.90 | $0.033 | 51 s |
| 13-no-room | fabric-02 | fabric-04 | rejected_input: NOT_A_ROOM, NO_WINDOW | 0 | – | – | – | – | – | $0.015 | 15 s |
