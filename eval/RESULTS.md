# Evaluation results

Run on 2026-11-03 22:21 UTC with `npm run eval -- --variant full`, checker: spark-open.
Photos come from Unsplash, Pexels and Wikimedia Commons under their free licences; see `eval/photos.json` for authors and links.

- Accepted try-ons: **17 of 20** (85%), 14 on the first attempt.
- A photo with no room in it was refused before generation: yes.
- The client sees Muse Image's own picture, aligned on the window. It is shown only if the rest of the room differs from the photo by at most 18 of 255 and at least 85% of the photo's edges outside the curtains and windows are still there (75% when the difference is 8 or less); otherwise it is made again.
- In the accepted pictures: median **99%** of the photo's edges kept, median room difference **4** of 255.
- Generations thrown away because the generator changed the room: **6 of 30**.
- Cost per accepted try-on: **$0.110** (all calls of all runs, failures included, divided by accepted ones).
- Median time of an accepted try-on: **120 s**.

| Run | Room | Fabric | Result | Attempts | Window difference (0–255) | Curtains in their area | Colour drift fixed (ΔE) | Photo's edges kept | Checker score | Cost | Time |
|-|-|-|-|-|-|-|-|-|-|-|-|
| 01 | room-01 | fabric-01 | accepted | 1 | 8 | 100% | 7.2 | 92% | 0.96 | $0.073 | 120 s |
| 02 | room-02 | fabric-02 | failed: the generator changed the room (82% of the photo's edges kept, difference 20) | 3 | 9 | 100% | – | 82% | – | $0.080 | 188 s |
| 03 | room-03 | fabric-03 | accepted | 1 | 7 | 85% | 12.5 | 98% | 0.96 | $0.074 | 124 s |
| 04 | room-04 | fabric-04 + style-01 | accepted | 1 | 3 | 100% | 9.1 | 100% | 0.96 | $0.077 | 125 s |
| 05 | room-05 | fabric-05 | accepted | 1 | 3 | 100% | 10.2 | 99% | 0.95 | $0.083 | 124 s |
| 06 | room-06 | fabric-01 | accepted | 1 | 9 | 100% | 53.0 | 100% | 0.92 | $0.077 | 124 s |
| 07 | room-07 | fabric-02 | accepted | 1 | 2 | 100% | 5.3 | 100% | 0.96 | $0.076 | 124 s |
| 08 | room-08 | fabric-03 | accepted | 1 | 2 | 100% | 21.1 | 99% | 0.96 | $0.079 | 125 s |
| 09 | room-09 | fabric-04 | accepted | 2 | 5 | 100% | 14.5 | 99% | 0.96 | $0.101 | 211 s |
| 11 | room-11 | fabric-05 + style-01 | accepted | 3 | 0 | 100% | 18.7 | 91% | 0.92 | $0.198 | 256 s |
| 12 | room-12 | fabric-01 | failed: result check: TULLE_REMOVED (New light beige opaque drapes match fabric and hang realistically, but the original sheer valance/tulle across the window was removed.) | 3 | 14 | 100% | 37.7 | 96% | 0.88 | $0.192 | 160 s |
| 13 | room-13 | fabric-02 | accepted | 1 | 5 | 100% | 6.9 | 99% | 0.96 | $0.079 | 89 s |
| 13-no-room | fabric-02 | fabric-04 | rejected_input: NOT_A_ROOM, NO_WINDOW | 0 | – | – | – | – | – | $0.029 | 10 s |
| 14 | room-14 | fabric-01 | accepted | 1 | 5 | 100% | 15.2 | 99% | 0.96 | $0.079 | 98 s |
| 15 | room-15 | fabric-03 | failed: the generator changed the room (91% of the photo's edges kept, difference 20) | 3 | 0 | 60% | – | 91% | – | $0.091 | 132 s |
| 16 | room-16 | fabric-05 | accepted | 2 | 12 | 94% | 5.7 | 86% | 0.96 | $0.095 | 102 s |
| 17 | room-17 | fabric-04 | accepted | 1 | 6 | 100% | 39.8 | 100% | 0.96 | $0.074 | 88 s |
| 18 | room-18 | fabric-02 | accepted | 1 | 3 | 100% | 9.4 | 100% | 0.96 | $0.078 | 89 s |
| 19 | room-19 | fabric-01 | accepted | 1 | 16 | 100% | 4.3 | 100% | 0.96 | $0.084 | 61 s |
| 20 | room-20 | fabric-03 | accepted | 1 | 5 | 100% | 12.7 | 98% | 0.96 | $0.078 | 56 s |
| 21 | room-21 | fabric-04 | accepted | 1 | 7 | 100% | 35.1 | 93% | 0.96 | $0.077 | 55 s |
