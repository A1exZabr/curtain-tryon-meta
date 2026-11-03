# Evaluation results

Run on 2026-11-03 17:44 UTC with `npm run eval -- --variant full`, checker: spark-open.
Photos come from Unsplash, Pexels and Wikimedia Commons under their free licences; see `eval/photos.json` for authors and links.

- Accepted try-ons: **13 of 20** (65%), 6 on the first attempt.
- A photo with no room in it was refused before generation: yes.
- The client sees Muse Image's own picture, aligned on the window. It is shown only if at least 85% of the photo's edges outside the curtains and windows are still there and the rest of the room differs by at most 18 of 255; otherwise it is made again.
- In the accepted pictures: median **98%** of the photo's edges kept, median room difference **3** of 255.
- Generations thrown away because the generator changed the room: **14 of 44**.
- Cost per accepted try-on: **$0.150** (all calls of all runs, failures included, divided by accepted ones).
- Median time of an accepted try-on: **94 s**.

| Run | Room | Fabric | Result | Attempts | Window difference (0–255) | Curtains in their area | Colour drift fixed (ΔE) | Photo's edges kept | Checker score | Cost | Time |
|-|-|-|-|-|-|-|-|-|-|-|-|
| 01 | room-01 | fabric-01 | failed: the generator changed the room (12% of the photo's edges kept, difference 24) | 3 | 19 | 100% | – | 12% | – | $0.080 | 143 s |
| 02 | room-02 | fabric-02 | failed: the generator changed the room (44% of the photo's edges kept, difference 52) | 3 | 32 | 100% | – | 44% | – | $0.082 | 143 s |
| 03 | room-03 | fabric-03 | accepted | 1 | 4 | 85% | 3.6 | 96% | 0.96 | $0.073 | 90 s |
| 04 | room-04 | fabric-04 + style-01 | accepted | 1 | 3 | 100% | 10.4 | 100% | 0.96 | $0.077 | 93 s |
| 05 | room-05 | fabric-05 | accepted | 2 | 4 | 100% | 13.2 | 94% | 0.96 | $0.100 | 131 s |
| 06 | room-06 | fabric-01 | accepted | 3 | 6 | 100% | 39.1 | 100% | 0.96 | $0.143 | 174 s |
| 07 | room-07 | fabric-02 | accepted | 1 | 4 | 100% | 2.7 | 100% | 0.96 | $0.076 | 90 s |
| 08 | room-08 | fabric-03 | accepted | 2 | 1 | 100% | 23.3 | 98% | 0.96 | $0.101 | 97 s |
| 09 | room-09 | fabric-04 | failed: the window moved or was redrawn (difference 55 of 255) | 3 | 55 | 97% | – | – | – | $0.123 | 177 s |
| 11 | room-11 | fabric-05 + style-01 | failed: the generator changed the room (35% of the photo's edges kept, difference 16) | 3 | 0 | 100% | – | 35% | – | $0.119 | 141 s |
| 12 | room-12 | fabric-01 | accepted | 2 | 10 | 100% | 43.8 | 96% | 0.96 | $0.134 | 108 s |
| 13 | room-13 | fabric-02 | accepted | 2 | 5 | 100% | 6.1 | 87% | 0.96 | $0.096 | 94 s |
| 13-no-room | fabric-02 | fabric-04 | rejected_input: NOT_A_ROOM, NO_WINDOW | 0 | – | – | – | – | – | $0.030 | 18 s |
| 14 | room-14 | fabric-01 | accepted | 1 | 3 | 100% | 5.7 | 99% | 0.96 | $0.080 | 48 s |
| 15 | room-15 | fabric-03 | failed: curtains spill outside the window area (58% inside) | 3 | 0 | 58% | – | – | – | $0.091 | 119 s |
| 16 | room-16 | fabric-05 | failed: curtains spill outside the window area (75% inside) | 3 | 6 | 75% | – | – | – | $0.081 | 121 s |
| 17 | room-17 | fabric-04 | accepted | 3 | 5 | 100% | 40.2 | 98% | 0.96 | $0.108 | 125 s |
| 18 | room-18 | fabric-02 | accepted | 1 | 5 | 100% | 8.8 | 99% | 0.96 | $0.078 | 50 s |
| 19 | room-19 | fabric-01 | failed: the tulle on the window was taken down (0% left) | 3 | 18 | 100% | – | – | – | $0.090 | 87 s |
| 20 | room-20 | fabric-03 | accepted | 3 | 2 | 100% | 10.6 | 93% | 0.96 | $0.112 | 120 s |
| 21 | room-21 | fabric-04 | accepted | 1 | 7 | 100% | 32.1 | 93% | 0.96 | $0.078 | 56 s |
