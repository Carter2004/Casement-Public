// push.ts — THE push-placement planner: "insert with push" (add when no plain gap fits) and
// "move with push" (typed position slides a piece through its neighbors instead of stopping
// flush against the first one). Built ON occupancy.ts's own primitives (Interval, EPSILON,
// mergeIntervals, gapsFromOccupied, verticalOverlap, crossWallBlocked) — no duplicated interval
// math, per the standing single-source rule.
//
// A wall is partitioned into push SEGMENTS for a given candidate vertical range: maximal
// along-wall stretches bounded by IMMOVABLE obstacles — opening pieces on this wall (windows/
// doors/doorways are architecture, never pushed — kinds.ts's `opening` flag) and cross-wall
// corner blocks (occupancy.ts's crossWallBlocked) that vertically overlap the candidate.
// Pushing never crosses a segment boundary. Only pieces whose vertical range overlaps the
// candidate's participate as the MOVABLE set within a segment (a base-band insert can never
// push a wall-band hood) — the same vertical-scoping rule occupancy.ts's own collision uses.
//
// Both planners are pure: no store, no DOM. store.ts applies the returned offsets in one batch.

import { clamp, type Cabinet } from "./cabinet";
import { kindDefinition } from "./kinds";
import {
  crossWallBlocked,
  EPSILON,
  gapsFromOccupied,
  mergeIntervals,
  verticalOverlap,
  type Interval,
  type VerticalRange,
} from "./occupancy";
import { cabinetVerticalPlacement } from "./kinds";
import type { Room, Wall } from "./room";

/** One push segment: an along-wall stretch with no immovable obstacle inside it, plus the
 * movable pieces (same-wall, vertically-overlapping, non-opening) currently inside it. */
export interface Segment {
  start: number;
  end: number;
  pieces: Cabinet[];
}

/** The result of a successful insert-with-push: where the new piece lands, and every OTHER
 * piece's new xOffset the insertion required (keyed by cabinet id) — empty if it fit in existing
 * free space with nothing to push. */
export interface PushInsertResult {
  xOffset: number;
  relocations: Map<string, number>;
}

/** The result of a move-with-push: the furthest offset actually achieved toward the requested
 * target (may equal the piece's current offset), and every OTHER piece's new xOffset the slide
 * required — empty if nothing needed to move out of the way. */
export interface PushMoveResult {
  achievedOffset: number;
  relocations: Map<string, number>;
}

function isOpening(cabinet: Cabinet): boolean {
  return kindDefinition(cabinet.kind, cabinet.type).opening === true;
}

/**
 * Partition `wall` into push segments for a candidate occupying `verticalRange` at `depth`.
 * Boundaries are opening pieces on this wall and cross-wall corner blocks, both restricted to
 * ones that vertically overlap the candidate (exactly occupancy.ts's own scoping rule) — a
 * window never bounds a base-band push since a base candidate's range doesn't overlap it.
 *
 * `excludeCabinetId` (cycle 019, the move authority) removes one piece from EVERY role it could
 * play here — an opening boundary, a same-wall movable piece, or (via crossWallBlocked) a
 * cross-wall corner block on another wall — so a piece being moved never has to contend with
 * its own old self. A partially-threaded exclude (e.g. only skipped in one of these three spots)
 * would silently reintroduce the piece as an obstacle in the other two, so all three are
 * updated together, in the one function that owns this partitioning.
 */
export function computeSegments(
  room: Room,
  wall: Wall,
  verticalRange: VerticalRange,
  depth: number,
  excludeCabinetId?: string,
): Segment[] {
  const openingIntervals: Interval[] = wall.cabinets
    .filter((c) => c.id !== excludeCabinetId && isOpening(c) && verticalOverlap(cabinetVerticalPlacement(c), verticalRange))
    .map((c) => ({ start: c.xOffset, end: c.xOffset + c.width }));
  const crossWall = crossWallBlocked(room, wall, verticalRange, depth, excludeCabinetId);
  const boundaries = mergeIntervals([...openingIntervals, ...crossWall].sort((a, b) => a.start - b.start));
  const segmentRanges = gapsFromOccupied(wall.length, boundaries);

  const movablePieces = wall.cabinets
    .filter((c) => c.id !== excludeCabinetId && !isOpening(c) && verticalOverlap(cabinetVerticalPlacement(c), verticalRange))
    .sort((a, b) => a.xOffset - b.xOffset);

  return segmentRanges.map((range) => ({
    start: range.start,
    end: range.end,
    pieces: movablePieces.filter((p) => p.xOffset >= range.start - EPSILON && p.xOffset + p.width <= range.end + EPSILON),
  }));
}

/**
 * Push every piece in `rightPieces` (sorted ascending by xOffset, all originally to the right of
 * where a piece/insertion now claims space up to `cursor`) just far enough right to clear it —
 * cascading only as far as each one's own gap to its successor allows, stopping as soon as a
 * piece is already clear (everything after it, in the original non-overlapping sorted order, is
 * clear too). Returns the relocations and the final right edge after the last piece touched.
 */
function cascadeRight(rightPieces: Cabinet[], cursor: number): { relocations: Map<string, number>; edge: number } {
  const relocations = new Map<string, number>();
  let edge = cursor;
  for (const piece of rightPieces) {
    if (piece.xOffset < edge - EPSILON) {
      relocations.set(piece.id, edge);
      edge += piece.width;
    } else {
      edge = piece.xOffset + piece.width;
      break;
    }
  }
  return { relocations, edge };
}

/** Mirror of cascadeRight: pushes `leftPieces` (sorted DESCENDING by xOffset) left just far
 * enough to clear a claim ending at `cursor`. Returns the final left edge after the last piece
 * touched. */
function cascadeLeft(leftPieces: Cabinet[], cursor: number): { relocations: Map<string, number>; edge: number } {
  const relocations = new Map<string, number>();
  let edge = cursor;
  for (const piece of leftPieces) {
    const pieceEnd = piece.xOffset + piece.width;
    if (pieceEnd > edge + EPSILON) {
      relocations.set(piece.id, edge - piece.width);
      edge -= piece.width;
    } else {
      edge = piece.xOffset;
      break;
    }
  }
  return { relocations, edge };
}

/**
 * Plan inserting a new piece of `width` (occupying `verticalRange` at `depth`) onto `wall`,
 * used when firstFittingGap finds no plain gap. Searches segments in wall order for one whose
 * AGGREGATE free space covers `width`.
 *
 * Default (no `targetOffset`): within that segment, grows the LARGEST existing gap (least total
 * displacement) and cascades every piece to its right rightward exactly as far as each one's own
 * slack allows. This path is byte-identical to the pre-targetOffset behavior.
 *
 * With `targetOffset`: if it falls within a segment that has enough aggregate space, that segment
 * is used (skipping the wall-order search) and the piece lands as close to the target as the
 * cascade allows — the existing gap NEAREST the target grows instead of the largest one, still
 * cascading only its right-adjacent pieces rightward. A target outside every fitting segment (or
 * omitted entirely) falls back to the default largest-gap rule, segment by segment, in wall order.
 *
 * Returns null if no segment has enough aggregate space — a cross-wall corner or an opening can
 * never be pushed through, so no amount of rearranging helps.
 */
export function planInsertWithPush(
  room: Room,
  wall: Wall,
  verticalRange: VerticalRange,
  depth: number,
  width: number,
  targetOffset?: number,
  excludeCabinetId?: string,
): PushInsertResult | null {
  const segments = computeSegments(room, wall, verticalRange, depth, excludeCabinetId);

  for (const segment of segments) {
    const capacity = segment.end - segment.start;
    const occupied = segment.pieces.reduce((sum, p) => sum + p.width, 0);
    if (capacity - occupied < width - EPSILON) continue; // aggregate space insufficient here

    const gaps = gapsFromOccupied(
      capacity,
      segment.pieces.map((p) => ({ start: p.xOffset - segment.start, end: p.xOffset + p.width - segment.start })),
    ).map((g) => ({ start: g.start + segment.start, end: g.end + segment.start }));

    if (targetOffset !== undefined && targetOffset >= segment.start - EPSILON && targetOffset <= segment.end + EPSILON) {
      return insertNearTarget(segment, gaps, width, targetOffset);
    }

    let largest = gaps[0];
    for (const gap of gaps) if (gap.end - gap.start > largest.end - largest.start) largest = gap;

    const insertOffset = largest.start;
    const rightPieces = segment.pieces.filter((p) => p.xOffset >= largest.end - EPSILON);
    const { relocations } = cascadeRight(rightPieces, insertOffset + width);
    return { xOffset: insertOffset, relocations };
  }
  return null;
}

/** How far `target` sits outside `gap` — 0 if it's already inside. Used to pick the gap nearest
 * the target rather than the largest one. */
function gapDistance(gap: Interval, target: number): number {
  if (target < gap.start) return gap.start - target;
  if (target > gap.end) return target - gap.end;
  return 0;
}

/** Target-aware insert within a segment already confirmed to have enough aggregate space: grow
 * whichever existing gap sits nearest `targetOffset` (ties favor the earlier gap), landing the
 * piece as close to the target as that gap allows, then cascade its right-adjacent pieces exactly
 * as the default path does. */
function insertNearTarget(segment: Segment, gaps: Interval[], width: number, targetOffset: number): PushInsertResult {
  const clampedTarget = clamp(targetOffset, segment.start, segment.end - width);

  let nearest = gaps[0];
  let nearestDist = gapDistance(nearest, clampedTarget);
  for (const gap of gaps) {
    const dist = gapDistance(gap, clampedTarget);
    if (dist < nearestDist) {
      nearest = gap;
      nearestDist = dist;
    }
  }

  const insertOffset = clamp(clampedTarget, nearest.start, Math.max(nearest.start, nearest.end - width));
  const rightPieces = segment.pieces.filter((p) => p.xOffset >= nearest.end - EPSILON);
  const { relocations } = cascadeRight(rightPieces, insertOffset + width);
  return { xOffset: insertOffset, relocations };
}

/**
 * Plan sliding `piece` (already on `wall`) toward `targetOffset`, pushing neighbors in the
 * travel direction as far as their own segment allows, stopping where the cascade would cross
 * the segment boundary. Always returns the furthest achievable offset toward the target (equal
 * to the current offset if nothing can move, e.g. flush against an opening already). Openings
 * and cross-wall corners bound the segment `piece` lives in — the cascade can never cross them,
 * matching decision 2 (openings never move).
 */
export function planMoveWithPush(room: Room, wall: Wall, piece: Cabinet, targetOffset: number): PushMoveResult {
  const verticalRange = cabinetVerticalPlacement(piece);
  const segments = computeSegments(room, wall, verticalRange, piece.depth);
  const segment = segments.find((s) => piece.xOffset >= s.start - EPSILON && piece.xOffset + piece.width <= s.end + EPSILON);
  // A piece already legitimately placed always sits inside exactly one segment of its own kind.
  if (!segment) return { achievedOffset: piece.xOffset, relocations: new Map() };

  const others = segment.pieces.filter((p) => p.id !== piece.id);
  const current = piece.xOffset;

  if (targetOffset > current) {
    const clampedTarget = Math.min(targetOffset, segment.end - piece.width);
    const rightPieces = others.filter((p) => p.xOffset >= current).sort((a, b) => a.xOffset - b.xOffset);
    const fits = (desired: number) => cascadeRight(rightPieces, desired + piece.width).edge <= segment.end + EPSILON;

    if (clampedTarget <= current || fits(clampedTarget)) {
      const achievedOffset = Math.max(current, clampedTarget);
      return { achievedOffset, relocations: cascadeRight(rightPieces, achievedOffset + piece.width).relocations };
    }
    let lo = current;
    let hi = clampedTarget;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    return { achievedOffset: lo, relocations: cascadeRight(rightPieces, lo + piece.width).relocations };
  }

  if (targetOffset < current) {
    const clampedTarget = Math.max(targetOffset, segment.start);
    const leftPieces = others.filter((p) => p.xOffset <= current).sort((a, b) => b.xOffset - a.xOffset);
    const fits = (desired: number) => cascadeLeft(leftPieces, desired).edge >= segment.start - EPSILON;

    if (clampedTarget >= current || fits(clampedTarget)) {
      const achievedOffset = Math.min(current, clampedTarget);
      return { achievedOffset, relocations: cascadeLeft(leftPieces, achievedOffset).relocations };
    }
    let lo = clampedTarget;
    let hi = current;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return { achievedOffset: hi, relocations: cascadeLeft(leftPieces, hi).relocations };
  }

  return { achievedOffset: current, relocations: new Map() };
}
