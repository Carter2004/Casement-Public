// backsplash.ts — pure span computation for the backsplash zone (cycle 014): given a perimeter
// wall, the along-wall [start, end) intervals that get a backsplash panel — wherever base-band
// pieces occupy the wall, merged into runs, minus any opening (window/door/doorway) whose own
// vertical range overlaps the gap band, which punches a real hole through rather than a
// partial-height notch. buildScene.ts is the only consumer; imports nothing from three,
// unit-testable without a renderer — same shape/rationale as wallPanels.ts's computeWallPanels.

import { STANDARD } from "../model/bands";
import { cabinetVerticalPlacement, kindDefinition } from "../model/kinds";
import { gapsFromOccupied, mergeIntervals, verticalOverlap, type Interval, type VerticalRange } from "../model/occupancy";
import type { Wall } from "../model/room";

/** The gap-band vertical range a backsplash occupies — counter height up to where wall cabinets
 * begin. An opening only punches through the backsplash if it overlaps THIS range. */
export const BACKSPLASH_BAND: VerticalRange = { bottom: STANDARD.COUNTER_HEIGHT, top: STANDARD.WALL_CABINET_BOTTOM };

/**
 * The along-wall [start, end) intervals a backsplash panel should cover on `wall`: wherever
 * base-band, non-opening pieces occupy the wall (merged into runs — real counters, real
 * backsplash), minus any opening's own along-wall extent where that opening's vertical range
 * overlaps the gap band (a window sitting in that zone punches a full hole through, not a
 * partial-height clip).
 */
export function computeBacksplashSpans(wall: Wall): Interval[] {
  const baseRunIntervals: Interval[] = wall.cabinets
    .filter((c) => c.type === "base" && !kindDefinition(c.kind, c.type).opening)
    .map((c) => ({ start: c.xOffset, end: c.xOffset + c.width }))
    .sort((a, b) => a.start - b.start);
  const baseRuns = mergeIntervals(baseRunIntervals);

  const openingIntervals: Interval[] = wall.cabinets
    .filter((c) => kindDefinition(c.kind, c.type).opening && verticalOverlap(cabinetVerticalPlacement(c), BACKSPLASH_BAND))
    .map((c) => ({ start: c.xOffset, end: c.xOffset + c.width }));

  const spans: Interval[] = [];
  for (const run of baseRuns) {
    // Re-express each opening relative to THIS run's own start so gapsFromOccupied (a
    // [0, length) primitive) can subtract them, then translate the resulting local spans back
    // to wall coordinates — reusing the exact same interval math occupancy.ts already owns,
    // rather than deriving a run-relative subtraction here.
    const localOpenings = openingIntervals
      .map((o) => ({ start: Math.max(o.start, run.start) - run.start, end: Math.min(o.end, run.end) - run.start }))
      .filter((o) => o.end > o.start);
    for (const local of gapsFromOccupied(run.end - run.start, localOpenings)) {
      spans.push({ start: local.start + run.start, end: local.end + run.start });
    }
  }
  return spans;
}
