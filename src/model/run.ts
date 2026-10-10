// run.ts — THE one home of cabinet-run DISTRIBUTION logic (greedy widest-first + fillers).
// "Fill this wall" is a ONE-SHOT operation: planFill computes ordinary cabinets (plus at most
// one filler per empty stretch) and the caller adds them as plain pieces. There is no
// persistent Run entity and no auto-redistribution — once placed, generated pieces are
// indistinguishable from any other cabinet. Fills only ever generate kind:'cabinet' and
// kind:'filler' pieces for the given band — appliances are never fill-generated, only
// individually added. A future templates cycle should call planFill rather than reinvent
// distribution.
//
// Free-space computation (what's occupied/free on a wall, including corner-aware cross-wall
// blocking and the vertical-overlap collision rule) lives in occupancy.ts — this module calls
// it rather than deriving intervals itself.

import { createCabinet, type Cabinet, type CabinetType } from "./cabinet";
import { anchorBottomFor, kindDefinition } from "./kinds";
import { EPSILON, freeIntervals, type Interval } from "./occupancy";
import type { Room, Wall } from "./room";

/** Standard cabinet-industry widths (inches), widest first. The single source for widths —
 * standard HEIGHTS remain solely in bands.ts / the kind catalog. */
export const STANDARD_WIDTHS = [36, 33, 30, 27, 24, 21, 18, 15, 12, 9] as const;

const SMALLEST_STANDARD_WIDTH = STANDARD_WIDTHS[STANDARD_WIDTHS.length - 1];

/**
 * Pure function: given the room, a wall, and a band, return the new cabinets (and any filler
 * strips) needed to flush-fill every FREE stretch of that band. Free space is corner-aware —
 * occupancy.ts accounts for vertically-overlapping neighbors on adjacent walls too, so filling
 * two adjacent walls meets cleanly at the corner instead of interpenetrating, and a fill stops
 * short of any appliance that reaches into this band. Existing pieces (on any wall) are never
 * modified; only fresh Cabinet objects are returned.
 */
export function planFill(room: Room, wall: Wall, type: CabinetType): Cabinet[] {
  const { defaultSize } = kindDefinition("cabinet", type);
  const bottom = anchorBottomFor({ kind: "cabinet", type });
  const verticalRange = { bottom, top: bottom + defaultSize.height };

  const stretches = freeIntervals(room, wall, verticalRange, defaultSize.depth);
  const generated: Cabinet[] = [];

  for (const stretch of stretches) {
    generated.push(...fillStretch(type, stretch));
  }

  return generated;
}

/** Greedily fill one stretch widest-first; absorb any remainder into a single filler. */
function fillStretch(band: CabinetType, stretch: Interval): Cabinet[] {
  const pieces: Cabinet[] = [];
  let cursor = stretch.start;
  let remaining = stretch.end - stretch.start;

  for (const width of STANDARD_WIDTHS) {
    while (remaining >= width - EPSILON) {
      pieces.push(placeCabinet(band, cursor, width));
      cursor += width;
      remaining -= width;
    }
  }

  if (remaining >= EPSILON && remaining < SMALLEST_STANDARD_WIDTH) {
    pieces.push(placeCabinet(band, cursor, remaining, /* filler */ true));
  }

  return pieces;
}

function placeCabinet(band: CabinetType, xOffset: number, width: number, filler = false): Cabinet {
  const cabinet = createCabinet(filler ? "filler" : "cabinet", band, xOffset);
  cabinet.width = width; // override the fill-computed width; height/depth stay at the band default
  return cabinet;
}
