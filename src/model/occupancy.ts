// occupancy.ts — THE one home of free-space math. Every "what's occupied / what's free on this
// wall" question in the app answers through these pure functions: run distribution (run.ts),
// resize reattachment (resizeRoom.ts), and collision (store.ts's move/resize/add) all read from
// here. No component re-derives interval math independently.
//
// Two pieces conflict iff their horizontal intervals overlap AND their vertical ranges
// overlap — physics, not band labels. A base cabinet and a wall cabinet never conflict because
// their vertical ranges (0–34.5" vs 54–84") don't overlap; a wall cabinet CANNOT be placed
// inside a 70"-tall fridge (0–70") because their vertical ranges DO overlap even though a
// fridge is band:'base' and the candidate is band:'wall'. Every function below takes the
// candidate's vertical range explicitly rather than a bare band/type, so this generalization
// lives in exactly one place.
//
// Cycle 017 (irregular rooms): a wall's own along-wall math (sameWallOccupied, freeIntervals,
// gapsFromOccupied, etc.) is already angle-agnostic — it works entirely in the wall's own 1D
// coordinate, never touched. The one thing that WAS axis-aligned-only was cross-wall collision
// (intersectBounds, an AABB test) — replaced below by quadsOverlap, a proper SAT test over each
// piece's true oriented footprint (see room.ts's cabinetFootprint/FootprintQuad).

import { clamp, MAX_DEPTH, MIN_DIMENSION, type Cabinet } from "./cabinet";
import { cabinetVerticalPlacement } from "./kinds";
import { cabinetFootprint, type FootprintQuad, type Room, type Vec2, type Wall } from "./room";

/** Ignore gaps/overlaps below this so floating-point noise never creates phantom blockage or
 * phantom free space. The one place this constant is defined. Applied on BOTH the horizontal
 * and vertical axes (and, since cycle 017, every SAT separating axis too). */
export const EPSILON = 0.25;

export interface Interval {
  start: number;
  end: number;
}

/** A piece's vertical extent, in inches off the floor: [bottom, top). Half-open — two ranges
 * that merely touch (one's top equals the other's bottom) do NOT count as overlapping. */
export interface VerticalRange {
  bottom: number;
  top: number;
}

/**
 * The free [start, end) intervals along `wall` for a candidate piece occupying `verticalRange`
 * at the given `depth`. Occupancy comes from two sources:
 *   1. Pieces on THIS wall whose vertical range overlaps the candidate's (merged 1D intervals),
 *      optionally excluding one piece — its own current spot, for drag/resize.
 *   2. Pieces on OTHER walls whose vertical range overlaps the candidate's AND whose exact
 *      footprint (via cabinetFootprint — the same source the plan view and 3D use) intersects
 *      the candidate strip: this wall's full length, extended `depth` inward. Each
 *      intersection projects onto this wall's axis as a blocked interval — in practice, near
 *      the wall's ends where it meets its neighbors. Deeper neighbors block more, exactly.
 */
export function freeIntervals(
  room: Room,
  wall: Wall,
  verticalRange: VerticalRange,
  depth: number,
  excludeCabinetId?: string,
): Interval[] {
  const sameWall = sameWallOccupied(wall, verticalRange, excludeCabinetId);
  // Cycle 019: exclude threads into cross-wall blocking too, not just same-wall — a MOVING
  // piece still physically sits on some OTHER wall at planning time, and that old footprint
  // must never corner-block its own destination (the exact case a cross-wall move needs: a
  // piece adjacent to a corner moving to the perpendicular spot its own old position blocked).
  const crossWall = crossWallBlocked(room, wall, verticalRange, depth, excludeCabinetId);
  return gapsFromOccupied(wall.length, [...sameWall, ...crossWall]);
}

/**
 * Clamp a desired horizontal offset so `cabinet` stays within the free gap it currently
 * occupies (that gap computed EXCLUDING the cabinet itself). This is the drag semantic: slide
 * until blocked, stop flush against the neighbor.
 */
export function clampIntoGap(room: Room, wall: Wall, cabinet: Cabinet, desiredXOffset: number): number {
  const gap = currentGapFor(room, wall, cabinet, cabinet.depth) ?? { start: 0, end: wall.length };
  const maxOffset = Math.max(gap.start, gap.end - cabinet.width);
  return clamp(desiredXOffset, gap.start, maxOffset);
}

/** Max width `cabinet` could grow to (its xOffset held fixed) before hitting whatever currently
 * bounds its gap — a same-wall neighbor, a cross-wall corner, or the wall's own end. */
export function maxWidthWithoutCollision(room: Room, wall: Wall, cabinet: Cabinet): number {
  const gap = currentGapFor(room, wall, cabinet, cabinet.depth) ??
    { start: cabinet.xOffset, end: cabinet.xOffset + cabinet.width };
  return Math.max(MIN_DIMENSION, gap.end - cabinet.xOffset);
}

/**
 * Max depth `cabinet` could grow to before its footprint would newly collide with a
 * vertically-overlapping piece on an adjacent wall (a corner). Same-wall neighbors never
 * depend on depth, so only cross-wall blocking can shrink this. A deeper candidate strip can
 * only intersect as much or more than a shallower one, so "does this depth still admit the
 * cabinet" is monotonic — binary search finds the boundary without deriving per-neighbor
 * threshold geometry.
 */
export function maxDepthWithoutCollision(room: Room, wall: Wall, cabinet: Cabinet): number {
  const admits = (depth: number) => currentGapFor(room, wall, cabinet, depth) !== null;
  if (admits(MAX_DEPTH)) return MAX_DEPTH;

  let lo = MIN_DIMENSION;
  let hi = MAX_DEPTH;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (admits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** The first free gap (in wall order) that fits at least `minWidth` for a candidate occupying
 * `verticalRange`, or null if none does — the "add piece" / "fill wall" placement rule. */
export function firstFittingGap(
  room: Room,
  wall: Wall,
  verticalRange: VerticalRange,
  depth: number,
  minWidth: number,
): Interval | null {
  const gaps = freeIntervals(room, wall, verticalRange, depth);
  return gaps.find((gap) => gap.end - gap.start >= minWidth - EPSILON) ?? null;
}

/**
 * Do two pieces' PLAN FOOTPRINTS overlap — independent of height? This is the island-drag rule
 * (moveIsland/setIslandOrientation in store.ts): an island may never overlap ANY wall piece's
 * footprint in plan — base or wall cabinet — regardless of vertical band. That's deliberately
 * NOT the same rule as fill/add blocking (freeIntervals), which IS vertical-range aware because
 * two pieces that don't share a band can legitimately coexist there (a counter under an upper).
 * Dragging an island is a different question — "does this footprint sit on top of anything
 * already there," full stop, matching the plan's original spec. Reuses the same quadsOverlap SAT
 * primitive as everything else here, so there is still only one 2D-intersection implementation.
 */
export function footprintsConflict(wallA: Wall, pieceA: Cabinet, wallB: Wall, pieceB: Cabinet): boolean {
  return quadsOverlap(cabinetFootprint(wallA, pieceA), cabinetFootprint(wallB, pieceB));
}

// ---- internals --------------------------------------------------------------

/** Half-open vertical overlap test, EPSILON-tolerant so ranges that merely touch (one's top
 * exactly equals the other's bottom) don't register as a conflict. Exported for push.ts, which
 * needs the same vertically-scoped "does this piece even matter to this candidate" test to
 * build its movable/immovable sets — same rule as everything else here, not a second one. */
export function verticalOverlap(a: VerticalRange, b: VerticalRange): boolean {
  return a.bottom < b.top - EPSILON && b.bottom < a.top - EPSILON;
}

/** Vertically-overlapping, same-wall occupied [start, end) intervals, sorted and merged. */
function sameWallOccupied(wall: Wall, verticalRange: VerticalRange, excludeId?: string): Interval[] {
  const intervals = wall.cabinets
    .filter((c) => c.id !== excludeId && verticalOverlap(cabinetVerticalPlacement(c), verticalRange))
    .map((c) => ({ start: c.xOffset, end: c.xOffset + c.width }))
    .sort((a, b) => a.start - b.start);
  return mergeIntervals(intervals);
}

/** Merge overlapping/touching (within EPSILON) sorted intervals into disjoint ones. Exported
 * for push.ts — same rationale as verticalOverlap above. */
export function mergeIntervals(sorted: Interval[]): Interval[] {
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end + EPSILON) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

/** The gaps between (and around) a set of (possibly unsorted/overlapping) occupied intervals,
 * across [0, wallLength). Exported for push.ts — computing a segment's own free space (and, at
 * the wall level, the segments themselves) is this exact "gaps between occupied intervals"
 * question, just applied to a different occupied set (immovable obstacles) or sub-range. */
export function gapsFromOccupied(wallLength: number, occupied: Interval[]): Interval[] {
  const merged = mergeIntervals([...occupied].sort((a, b) => a.start - b.start));
  const gaps: Interval[] = [];
  let cursor = 0;
  for (const interval of merged) {
    if (interval.start - cursor > EPSILON) gaps.push({ start: cursor, end: interval.start });
    cursor = Math.max(cursor, interval.end);
  }
  if (wallLength - cursor > EPSILON) gaps.push({ start: cursor, end: wallLength });
  return gaps;
}

/** The candidate strip for a piece of the given depth on this wall: the wall's full length,
 * extended `depth` inward — exactly the quad cabinetFootprint would build for a piece spanning
 * the whole wall at that depth (reused, not re-derived). Any vertically-overlapping neighbor on
 * another wall whose footprint enters this quad is a corner obstruction. Exported for store.ts's
 * empty-island deck check — an empty island has no piece to build a strip FROM, but its deck
 * (rendered by planView at this exact length x default-depth rectangle) needs the same
 * collision test any real piece would get, so store.ts reuses this rather than re-deriving the
 * geometry. */
export function candidateStrip(wall: Wall, depth: number): FootprintQuad {
  return cabinetFootprint(wall, { xOffset: 0, width: wall.length, depth });
}

/** Do two (possibly overlapping-only-at-an-edge) 1D intervals genuinely overlap, by more than
 * EPSILON? The one interval-overlap rule every SAT axis test below shares — flush-touching
 * intervals read as NOT overlapping, same tolerance intersectBounds always applied. */
function intervalsOverlap(a: Interval, b: Interval): boolean {
  return Math.min(a.end, b.end) - Math.max(a.start, b.start) > EPSILON;
}

/** Project every corner of `quad` onto `axis` (assumed unit length) and return the resulting
 * [min, max] interval — the SAT projection step. */
function projectQuad(quad: readonly Vec2[], axis: Vec2): Interval {
  const projections = quad.map((p) => p.x * axis.x + p.y * axis.y);
  return { start: Math.min(...projections), end: Math.max(...projections) };
}

/** The (up to) two unique outward edge-normal axes of a quad — for a rectangle (every footprint
 * this app builds), that's exactly its along-wall and depth directions; iterating all four edges
 * is simply belt-and-suspenders (opposite edges yield the same axis, harmless to test twice). */
function quadAxes(quad: FootprintQuad): Vec2[] {
  const axes: Vec2[] = [];
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const edge = { x: b.x - a.x, y: b.y - a.y };
    const len = Math.hypot(edge.x, edge.y);
    if (len < 1e-9) continue; // degenerate (zero-width/depth) edge — no axis to test
    axes.push({ x: -edge.y / len, y: edge.x / len });
  }
  return axes;
}

/**
 * Separating Axis Theorem overlap test for two convex quads (cycle 017) — replaces the old
 * AABB-only intersectBounds for piece-vs-piece collision now that a piece's footprint can sit at
 * any wall angle. Tests every edge-normal axis of both quads; if any axis shows no (more than
 * EPSILON) overlap, the quads don't overlap. EPSILON-tolerant on every axis, so flush-touching
 * neighbors still read as NOT overlapping — for two axis-aligned rectangles this reduces to
 * exactly the old X/Y-only check (byte-identical: quadAxes of an axis-aligned quad IS the X and Y
 * unit axes).
 */
export function quadsOverlap(a: FootprintQuad, b: FootprintQuad): boolean {
  const axes = [...quadAxes(a), ...quadAxes(b)];
  for (const axis of axes) {
    if (!intervalsOverlap(projectQuad(a, axis), projectQuad(b, axis))) return false;
  }
  return true;
}

/** Project a set of world-space points onto `wall`'s own along-wall axis via a plain dot
 * product — works at any wall angle (wall.dir is always a unit vector, axis-aligned or not). */
function projectOntoWallAxis(wall: Wall, points: readonly Vec2[]): Interval {
  const projections = points.map((p) => (p.x - wall.start.x) * wall.dir.x + (p.y - wall.start.y) * wall.dir.y);
  return { start: Math.min(...projections), end: Math.max(...projections) };
}

/** Vertically-overlapping pieces on OTHER walls whose footprint intersects this wall's
 * candidate strip, each projected onto this wall's axis as a blocked interval. Exported for
 * push.ts — a cross-wall corner block is exactly as immovable as an opening when computing push
 * segments, and this is the one place that geometry is derived.
 *
 * The blocked interval is the OTHER cabinet's own quad projected onto this wall's axis (not a
 * clipped intersection region) — safe because candidateStrip already spans this wall's FULL
 * length along its own axis, so nothing needs clipping in that dimension; the quadsOverlap gate
 * above already confirmed a genuine 2D conflict exists (including in the depth dimension)
 * before this projection ever runs. For axis-aligned neighbors this is exactly the old
 * intersect-then-project result (verified against the rectangle regression suite); for an
 * angled neighbor it may be very slightly more conservative (a few inches wider than the
 * mathematically minimal blocked span at extreme junction angles) — never under-blocks. */
export function crossWallBlocked(
  room: Room,
  wall: Wall,
  verticalRange: VerticalRange,
  depth: number,
  excludeCabinetId?: string,
): Interval[] {
  return crossWallBlockers(room, wall, verticalRange, depth, excludeCabinetId).map((b) => b.interval);
}

/** One cross-wall corner block, source-attributed: the blocked along-wall interval PLUS which
 * OTHER wall's piece produced it. */
export interface CrossWallBlocker {
  interval: Interval;
  wall: Wall;
}

/**
 * The same traversal crossWallBlocked runs, but keeping each blocked interval's source wall
 * (cycle 018 friction #2 — naming the blocker in a rejection reason needs to know WHICH wall to
 * name, not just that a span is blocked). crossWallBlocked is now a one-line map over this; the
 * plain fast path stays byte-identical since it's the exact same computation either way.
 */
export function crossWallBlockers(
  room: Room,
  wall: Wall,
  verticalRange: VerticalRange,
  depth: number,
  excludeCabinetId?: string,
): CrossWallBlocker[] {
  const strip = candidateStrip(wall, depth);
  const blockers: CrossWallBlocker[] = [];
  for (const other of room.walls) {
    if (other.id === wall.id) continue;
    for (const cabinet of other.cabinets) {
      // Cycle 019: a piece being MOVED still sits on its old wall (some "other" wall relative
      // to whichever target wall is being planned against) at planning time — exclude it here
      // too, not just from this wall's own same-wall occupancy.
      if (cabinet.id === excludeCabinetId) continue;
      if (!verticalOverlap(cabinetVerticalPlacement(cabinet), verticalRange)) continue;
      const otherQuad = cabinetFootprint(other, cabinet);
      if (!quadsOverlap(strip, otherQuad)) continue;
      blockers.push({ interval: projectOntoWallAxis(wall, otherQuad), wall: other });
    }
  }
  return blockers;
}

/** The free gap that currently contains `cabinet` at the given depth (computed excluding the
 * cabinet itself), or null if none does (shouldn't happen for a depth the cabinet already
 * satisfies, but hypothetical depths in maxDepthWithoutCollision's search may fail to admit it).
 * Exported for store.ts's resizeCabinetEdge — the left-edge handle clamps to this same gap's
 * start, the same primitive clampIntoGap/maxWidthWithoutCollision already use. */
export function currentGapFor(room: Room, wall: Wall, cabinet: Cabinet, depth: number): Interval | null {
  const verticalRange = cabinetVerticalPlacement(cabinet);
  const gaps = freeIntervals(room, wall, verticalRange, depth, cabinet.id);
  return gaps.find((g) => cabinet.xOffset >= g.start - EPSILON && cabinet.xOffset + cabinet.width <= g.end + EPSILON) ?? null;
}
