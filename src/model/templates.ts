// templates.ts — THE one home of layout-template definitions. Pure wall SELECTION only — no
// distribution or interval math lives here (that's planFill's job, via occupancy.ts). Every
// wall this module points at gets filled by store.applyTemplate calling planFill sequentially,
// which is what keeps corners honest — see the sequencing constraint on applyTemplate itself.
//
// Every selection helper operates on perimeterWalls(room), never room.walls directly — an
// island in that array would otherwise silently become someone's "north wall" (positional
// destructuring) or "longest wall" (a long island winning the reduce), turning a template into
// a tour of the wrong walls the moment an island exists.

import { perimeterWalls, type Room, type Wall } from "./room";

export type TemplateKey = "single-wall" | "galley" | "l-shape" | "u-shape";

export const TEMPLATES: Record<TemplateKey, { label: string }> = {
  "single-wall": { label: "Single wall" },
  galley: { label: "Galley" },
  "l-shape": { label: "L-shape" },
  "u-shape": { label: "U-shape" },
};

/**
 * Deterministic wall selection for each template, longest-wall-anchored so the corner-aware
 * sequential fill in applyTemplate gives the primary run priority at corners. The band fill
 * itself (base + wall cabinets) is planFill's job — this function only picks walls, and only
 * ever from the four perimeter walls.
 */
export function templateWalls(room: Room, key: TemplateKey): Wall[] {
  const perimeter = perimeterWalls(room);
  switch (key) {
    case "single-wall":
      return [longestWall(perimeter)];
    case "galley":
      return longestParallelFacingPair(perimeter);
    case "l-shape": {
      const main = longestWall(perimeter);
      const a = nextWall(perimeter, main);
      const b = prevWall(perimeter, main);
      return [main, a.length >= b.length ? a : b];
    }
    case "u-shape": {
      const main = longestWall(perimeter);
      return [main, nextWall(perimeter, main), prevWall(perimeter, main)];
    }
  }
}

/** The longest wall; ties resolve to whichever comes first in the given list (North first). */
function longestWall(walls: Wall[]): Wall {
  return walls.reduce((longest, wall) => (wall.length > longest.length ? wall : longest));
}

/** The wall following `wall` clockwise, walking only the given (perimeter) list. */
function nextWall(walls: Wall[], wall: Wall): Wall {
  const i = walls.indexOf(wall);
  return walls[(i + 1) % walls.length];
}

/** The wall preceding `wall` clockwise — its other neighbor, within the given list. */
function prevWall(walls: Wall[], wall: Wall): Wall {
  const i = walls.indexOf(wall);
  return walls[(i + walls.length - 1) % walls.length];
}

/** Near enough to exactly anti-parallel (dot ≈ -1) to count, given floating-point noise from
 * hypot-normalized directions — real anti-parallel pairs in this app's shapes land exactly on
 * -1; this tolerance only absorbs float noise, not genuine near-misses. */
const ANTI_PARALLEL_TOLERANCE = 1e-6;

/**
 * Two walls are a candidate FACING pair (cycle 017 — generalizes the old rectangle-only
 * longerOppositePair to any polygon) if their directions are anti-parallel (dir·dir ≈ -1 — which
 * algebraically also makes their inward normals anti-parallel, i.e. pointing at each other,
 * since inward is always dir rotated the same fixed +90°) AND their along-each-other spans
 * actually overlap — b's own endpoints, projected onto a's direction axis, must overlap a's own
 * [0, a.length] span. Anti-parallel alone isn't enough: two edges can point opposite directions
 * while sitting far apart with no shared "shadow" (not a realistic galley run).
 */
function isFacingPair(a: Wall, b: Wall): boolean {
  const dot = a.dir.x * b.dir.x + a.dir.y * b.dir.y;
  if (Math.abs(dot + 1) > ANTI_PARALLEL_TOLERANCE) return false;

  const bStart = (b.start.x - a.start.x) * a.dir.x + (b.start.y - a.start.y) * a.dir.y;
  const bEnd = bStart - b.length; // b.dir · a.dir === -1, so walking b's own length moves BACKWARD along a's axis
  const projStart = Math.min(bStart, bEnd);
  const projEnd = Math.max(bStart, bEnd);
  return Math.min(a.length, projEnd) - Math.max(0, projStart) > 0;
}

/**
 * Among every pair of perimeter walls that face each other (isFacingPair), the pair whose
 * shorter member is longest — the run that actually bounds how much facing cabinetry fits.
 * Regression-tested to reproduce today's exact rectangle answer (North+South, or East+West on
 * a wider-than-long room, ties favoring North+South) via the SAME first-pair-wins-a-tie
 * convention longestWall uses; tested on L/U/clipped-corner shapes too. Every perimeter shape
 * this app's ROOM_SHAPES catalog produces has at least one facing pair by construction (each is
 * built from an underlying rectangle), so this never returns empty for a real room — but a
 * hypothetical shape with none would fall back to the single longest wall rather than an empty
 * template.
 */
function longestParallelFacingPair(perimeter: Wall[]): Wall[] {
  let best: Wall[] | null = null;
  let bestMetric = -Infinity;
  for (let i = 0; i < perimeter.length; i++) {
    for (let j = i + 1; j < perimeter.length; j++) {
      const a = perimeter[i];
      const b = perimeter[j];
      if (!isFacingPair(a, b)) continue;
      const metric = Math.min(a.length, b.length);
      if (metric > bestMetric) {
        bestMetric = metric;
        best = [a, b];
      }
    }
  }
  return best ?? [longestWall(perimeter)];
}
