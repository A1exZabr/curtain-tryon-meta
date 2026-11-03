import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Curtain styles the designer step chooses from. Each one is a way of making drapes from the client's fabric; none
// adds a sheer that isn't on the window already, because a new sheer across the glass changes the window the
// client sees. `cut` goes into the image prompt, `suits` helps the designer choose.
export interface CurtainStyle {
  id: string;
  name: string;
  cut: string;
  suits: string;
}

export const STYLES: CurtainStyle[] = [
  {
    id: "straight",
    name: "Straight drapes",
    cut: "floor-length drapes hanging straight from the heading to the floor at both sides of the window, without tiebacks",
    suits: "modern and minimal rooms; works with any fabric",
  },
  {
    id: "tiebacks",
    name: "Drapes with tiebacks",
    cut: "floor-length drapes gathered to the sides at about a third of their height by tiebacks of the same fabric, falling in a soft curve below",
    suits: "classic and cosy rooms, when the window and the view should stay open",
  },
  {
    id: "holdbacks",
    name: "Drapes on metal holdbacks",
    cut: "floor-length drapes swept aside and held by small decorative metal holdbacks fixed to the wall at sill height",
    suits: "classic rooms and heavier fabrics such as velvet",
  },
  {
    id: "rings",
    name: "Rings on a round rod",
    cut: "drapes hung by rings from a round metal rod with finials just above the window, in soft regular folds to the floor",
    suits: "lofts, classic and eclectic rooms; linen and cotton",
  },
  {
    id: "eyelets",
    name: "Eyelet drapes",
    cut: "drapes with large metal eyelets threaded on a round rod, falling in deep, even waves to the floor",
    suits: "modern rooms; medium and heavy fabrics",
  },
  {
    id: "ceiling-track",
    name: "Pleats on a ceiling track",
    cut: "drapes in dense, even pinch pleats hanging from a slim white track fixed to the ceiling, the tops of the drapes meeting the track in one straight line, from the ceiling to the floor",
    suits: "modern rooms, wide or floor-to-ceiling windows and low ceilings, since it makes the room look taller",
  },
  {
    id: "wave",
    name: "Wave heading on a ceiling track",
    cut: "drapes forming soft, identical S-shaped waves, hanging from a slim white track fixed to the ceiling, from the ceiling to the floor",
    suits: "contemporary rooms and rows of windows; light and heavy fabrics alike",
  },
  {
    id: "one-side",
    name: "One drape to the side",
    cut: "a single floor-length drape on one side of each window, gathered back with a tieback, the other side left open",
    suits: "only a window that one of its sides presses against a wall or a corner, so a second drape has no room; furniture in front of a window is not a reason for it",
  },
  {
    id: "fold-over",
    name: "Fold-over top",
    cut: "drapes whose top edge folds over as a short flap above the heading, gathered with tiebacks at both sides",
    suits: "classic and traditional rooms",
  },
];

export function styleById(id: string): CurtainStyle | undefined {
  return STYLES.find((s) => s.id === id);
}

/**
 * Optional sample photos of a style, sewn by a salon: `<STYLE_DIR>/<id>.jpg`. They are private reference material,
 * not part of this repository and never shown on the page; without them the style is described in words only.
 */
export function styleSample(id: string): Buffer | undefined {
  const dir = process.env.STYLE_DIR ?? "styles";
  const file = join(dir, `${id}.jpg`);
  return existsSync(file) ? readFileSync(file) : undefined;
}
