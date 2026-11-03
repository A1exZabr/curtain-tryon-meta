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
  /** Fabric width per width of rod: how full the gathers are. */
  fullness: number;
  /** Hangs from the ceiling rather than from a rod just above the frame. */
  ceiling?: boolean;
  /** A few words for the client choosing it. */
  hint: string;
}

export const STYLES: CurtainStyle[] = [
  {
    id: "straight",
    name: "Straight drapes",
    cut: "floor-length drapes hanging straight from the heading to the floor at both sides of the window, without tiebacks",
    suits: "modern and minimal rooms; works with any fabric",
    fullness: 2,
    hint: "Hang straight to the floor",
  },
  {
    id: "tiebacks",
    name: "Drapes with tiebacks",
    cut: "floor-length drapes gathered to the sides at about a third of their height by tiebacks of the same fabric, falling in a soft curve below",
    suits: "classic and cosy rooms, when the window and the view should stay open",
    fullness: 2,
    hint: "Gathered to the sides with fabric ties",
  },
  {
    id: "holdbacks",
    name: "Drapes on metal holdbacks",
    cut: "floor-length drapes swept aside and held by small decorative metal holdbacks fixed to the wall at sill height",
    suits: "classic rooms and heavier fabrics such as velvet",
    fullness: 2,
    hint: "Swept aside on metal holdbacks",
  },
  {
    id: "rings",
    name: "Rings on a round rod",
    cut: "drapes hung by rings from a round metal rod with finials just above the window, in soft regular folds to the floor",
    suits: "lofts, classic and eclectic rooms; linen and cotton",
    fullness: 2,
    hint: "Rings on a round rod",
  },
  {
    id: "eyelets",
    name: "Eyelet drapes",
    cut: "drapes with large metal eyelets threaded on a round rod, falling in deep, even waves to the floor",
    suits: "modern rooms; medium and heavy fabrics",
    fullness: 2,
    hint: "Metal eyelets, deep even waves",
  },
  {
    id: "ceiling-track",
    name: "Pleats on a ceiling track",
    cut: "drapes in dense, even pinch pleats hanging from a slim white track fixed to the ceiling, the tops of the drapes meeting the track in one straight line, from the ceiling to the floor",
    suits: "modern rooms, wide or floor-to-ceiling windows and low ceilings, since it makes the room look taller",
    fullness: 2.5,
    ceiling: true,
    hint: "Pinch pleats from a ceiling track",
  },
  {
    id: "wave",
    name: "Wave heading on a ceiling track",
    cut: "drapes forming soft, identical S-shaped waves, hanging from a slim white track fixed to the ceiling, from the ceiling to the floor",
    suits: "contemporary rooms and rows of windows; light and heavy fabrics alike",
    fullness: 2.2,
    ceiling: true,
    hint: "Soft waves from a ceiling track",
  },
  {
    id: "one-side",
    name: "One drape to the side",
    cut: "a single floor-length drape on one side of each window, gathered back with a tieback, the other side left open",
    suits: "only a window that one of its sides presses against a wall or a corner, so a second drape has no room; furniture in front of a window is not a reason for it",
    fullness: 1.2,
    hint: "A single drape to one side",
  },
  {
    id: "fold-over",
    name: "Fold-over top",
    cut: "drapes whose top edge folds over as a short flap above the heading, gathered with tiebacks at both sides",
    suits: "classic and traditional rooms",
    fullness: 2,
    hint: "Fold-over top, tied back",
  },
];

export interface FabricEstimate {
  /** Running metres of fabric, rounded up to half a metre. */
  metres: number;
  rodCm: number;
  dropCm: number;
  fullness: number;
  openings: number;
}

/**
 * A salon's first estimate of the fabric: the rod runs 20 cm past each side of an opening (30 cm for a ceiling
 * track), the fabric is that long times the style's fullness, and the drop is from the rod to the floor. Curtain
 * fabric comes in rolls about 280 to 300 cm high, so a drop up to that is covered by the roll's height.
 */
export function estimateFabric(style: CurtainStyle, openings: { width_cm: number; height_cm: number }[], ceilingCm?: number): FabricEstimate | undefined {
  const sane = openings.filter((o) => o.width_cm >= 40 && o.width_cm <= 1200 && o.height_cm >= 60 && o.height_cm <= 450);
  if (!sane.length) return undefined;
  const margin = style.ceiling ? 30 : 20;
  const rodCm = Math.round(sane.reduce((s, o) => s + o.width_cm + 2 * margin, 0));
  const ceiling = ceilingCm && ceilingCm >= 220 && ceilingCm <= 450 ? ceilingCm : undefined;
  const tallest = Math.max(...sane.map((o) => o.height_cm));
  const dropCm = Math.round(style.ceiling ? (ceiling ?? tallest + 40) - 2 : Math.min(ceiling ?? Infinity, tallest + 60) - 5);
  const metres = Math.ceil(((rodCm * style.fullness) / 100) * 2) / 2;
  return { metres, rodCm, dropCm, fullness: style.fullness, openings: sane.length };
}

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
