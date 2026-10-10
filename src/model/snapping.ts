// snapping.ts — THE one source of alignment candidates for a piece drag (cycle 019 Part 5):
// wall-center + edge-alignment against every OTHER piece on the wall, cross-band included (a
// wall cabinet's edge snapping to the base cabinet beneath it is the whole payoff — vertical band
// never gates a candidate here). Applied at the drag layer (elevation's own slide, plan-view's
// slide, plan-view's carry ghost) BEFORE the offset ever reaches the store, and skipped entirely
// while Ctrl is held; never applied to a typed/nudged value, which must stay exact.
//
// Cycle 020 Part 2: the snap ZONE is pixel-constant, not model-inches — SNAP_THRESHOLD_PX is a
// screen-space constant; converting it to model inches (dividing by the view's own live,
// zoom-inclusive scale) is the CALLER's job, because only the caller knows its own current
// scale. resolveSnap's threshold parameter is therefore REQUIRED (no inches-flavored default to
// silently fall back to) — the compiler polices every call site's px→inches conversion.

import type { Wall } from "./room";

/** How close (screen pixels) a desired offset must land to a candidate before it snaps, held
 * constant across zoom — a snap zone that shrinks to unhittable at fit scale and balloons to
 * grabby at 8x is the cycle 020 regression this constant exists to prevent. Callers divide by
 * their own live composed transform scale (zoom included) to get the model-inches threshold
 * resolveSnap actually wants. */
export const SNAP_THRESHOLD_PX = 8;

/**
 * One candidate alignment: `offset` is the piece's OWN xOffset that would satisfy it; `guideAt`
 * is the along-wall position the guide line should be drawn at — the aligned edge/center itself,
 * which is the piece's own left edge for a left-edge candidate but the NEIGHBOR's (or wall's)
 * position for every other kind, so the guide always marks the thing being aligned TO, not
 * incidentally wherever the dragged piece's own left edge happens to sit.
 */
export interface SnapCandidate {
  offset: number;
  guideAt: number;
}

/**
 * Every alignment candidate for a piece of `width` on `wall`: centered on the wall, and — for
 * every OTHER cabinet on the wall regardless of band (`excludeId` skips the piece being dragged
 * itself, same idiom as planCabinetDrop's own exclude) — the four ways two edges can align
 * (left-to-left, left-to-right, right-to-left, right-to-right). Pure; no occupancy/collision
 * check here (resolveSnap only ever adjusts WHERE a piece is aimed — the existing
 * dragCabinet/planCabinetDrop collision math downstream still decides whether it can actually
 * land there, same as an unsnapped drag already does).
 */
export function snapCandidates(wall: Wall, width: number, excludeId?: string): SnapCandidate[] {
  const candidates: SnapCandidate[] = [{ offset: (wall.length - width) / 2, guideAt: wall.length / 2 }];

  for (const other of wall.cabinets) {
    if (other.id === excludeId) continue;
    const otherLeft = other.xOffset;
    const otherRight = other.xOffset + other.width;

    candidates.push({ offset: otherLeft, guideAt: otherLeft }); // left -> neighbor's left
    candidates.push({ offset: otherRight, guideAt: otherRight }); // left -> neighbor's right (flush-after)
    candidates.push({ offset: otherLeft - width, guideAt: otherLeft }); // right -> neighbor's left (flush-before)
    candidates.push({ offset: otherRight - width, guideAt: otherRight }); // right -> neighbor's right
  }

  return candidates;
}

/**
 * The nearest candidate to `desired`, if any lands within `threshold` — else null (no snap; the
 * caller uses `desired` as-is). Ties break toward whichever candidate comes first in `candidates`
 * (snapCandidates' own order: wall-center first, then each neighbor's four edges in wall order) —
 * deterministic, and in practice ties this exact are vanishingly rare.
 *
 * `threshold` is REQUIRED (cycle 020 Part 2) — in MODEL INCHES, already converted from
 * SNAP_THRESHOLD_PX by the caller's own live scale. No default: a silently-surviving
 * inches-flavored default is exactly the zoom-variant regression this cycle fixes.
 */
export function resolveSnap(desired: number, candidates: SnapCandidate[], threshold: number): SnapCandidate | null {
  let best: SnapCandidate | null = null;
  let bestDist = Infinity;
  for (const candidate of candidates) {
    const dist = Math.abs(candidate.offset - desired);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best && bestDist <= threshold ? best : null;
}
