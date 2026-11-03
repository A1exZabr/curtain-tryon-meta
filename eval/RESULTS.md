# Evaluation results

Run on 2026-11-03 10:34 UTC with `npm run eval`, checker: spark-open.
Photos come from Unsplash, Pexels and Wikimedia Commons under their free licences; see `eval/photos.json` for authors and links.

- Accepted try-ons: **5 of 11** (45%), 4 on the first attempt.
- A photo with no room in it was refused before generation: yes.
- Pixels of the room outside the curtains changed by the engine: **0** (by construction: they are copied from the original).
- The same, if the raw Muse Image output were shown instead: **30%** of the room on average.
- Cost per accepted try-on: **$0.083** (all calls of all runs, failures included, divided by accepted ones).
- Median time of an accepted try-on: **56 s**.

| Run | Room | Fabric | Result | Attempts | Window in place | Curtains in their area | Colour drift fixed (ΔE) | Raw output changed | Checker score | Cost | Time |
|-|-|-|-|-|-|-|-|-|-|-|-|
| 01 | room-01 | fabric-01 | failed: curtains spill outside the window area (82% inside) | 2 | 100% | 82% | 9.6 | 40% | – | $0.045 | 73 s |
| 02 | room-02 | fabric-02 | accepted | 1 | 100% | 100% | 16.3 | 29% | 0.95 | $0.035 | 56 s |
| 03 | room-03 | fabric-03 | accepted | 1 | 99% | 86% | 11.1 | 24% | 0.95 | $0.035 | 58 s |
| 04 | room-04 | fabric-04 + style-01 | accepted | 1 | 86% | 89% | 13.4 | 29% | 0.95 | $0.035 | 52 s |
| 05 | room-05 | fabric-05 | accepted | 2 | 90% | 100% | 11.1 | 37% | 0.92 | $0.061 | 105 s |
| 06 | room-06 | fabric-01 | failed: the window moved or changed shape (35% in place) | 2 | 35% | 100% | – | – | – | $0.045 | 85 s |
| 07 | room-07 | fabric-02 | failed: the window moved or changed shape (46% in place) | 2 | 46% | 93% | – | – | – | $0.045 | 90 s |
| 08 | room-08 | fabric-03 | rejected_input: NO_WINDOW (segmentation) | 0 | – | – | – | – | – | $0.010 | 12 s |
| 09 | room-09 | fabric-04 | failed: the window moved or changed shape (79% in place) | 2 | 79% | 76% | – | – | – | $0.045 | 100 s |
| 11 | room-11 | fabric-05 + style-01 | rejected_input: NO_WINDOW (segmentation) | 0 | – | – | – | – | – | $0.010 | 8 s |
| 12 | room-12 | fabric-01 | accepted | 1 | 94% | 100% | 63.5 | 10% | 0.92 | $0.035 | 55 s |
| 13-no-room | fabric-02 | fabric-04 | rejected_input: NOT_A_ROOM, NO_WINDOW | 0 | – | – | – | – | – | $0.010 | 10 s |
