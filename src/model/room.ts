// room.ts — THE room + wall geometry. A room is an arbitrary polygon (cycle 017): its
// `footprint` is the source of truth, walls are derived one-per-edge, and `width`/`length` are
// DERIVED bounding-box fields kept only so the extent-only consumers (camera fit, wheel-zoom
// clamp, island axis clamping, etc.) never had to change. A rectangle is just the 4-vertex
// special case — createRectangularRoom is a thin wrapper over createPolygonRoom, byte-identical
// to the old dedicated implementation. Perimeter walls plus zero or more freestanding ISLAND
// walls make up room.walls. An island IS a Wall — same shape (id, length, start/dir/inward,
// cabinets) — so every existing wall-consumer (cabinetFootprint, occupancy's cross-wall
// blocking, the renderers) handles it with zero special-casing. What distinguishes an island is
// its `kind` and that its `start` is mutable (a perimeter wall's position is fixed by the room
// footprint; an island's is a placement the homeowner can drag).
// Views/model code that means "the room walls, not islands" must filter through
// perimeterWalls() — never destructure or index room.walls positionally.

import type { Cabinet } from "./cabinet";
import { DEFAULT_PRESET, roomStyleForPreset, type RoomStyle } from "./finishes";

export interface Vec2 {
  x: number;
  y: number;
}

export type WallKind = "perimeter" | "island";

export interface Wall {
  id: string;
  kind: WallKind;
  label: string;
  length: number;
  start: Vec2;
  dir: Vec2;
  inward: Vec2;
  cabinets: Cabinet[];
}

export interface Room {
  /** The room's true shape (cycle 017): clockwise, closed (implicit — edge N wraps to vertex 0),
   * every edge at least MIN_EDGE_LENGTH, non-self-intersecting. Always normalized to clockwise
   * winding by createPolygonRoom regardless of input order. */
  footprint: Vec2[];
  /** DERIVED bounding-box extent of `footprint` — kept only so extent-only consumers (camera
   * fit, wheel-zoom clamp, island axis clamping) never needed to change. Never the source of
   * truth; recomputed whenever the footprint is (re)built. */
  width: number;
  length: number;
  wallHeight: number;
  walls: Wall[];
  /** The room's curated look (cycle 014) — surfaces + the cabinet-finish/door-style defaults
   * every piece falls back to when it has no override of its own. See finishes.ts. */
  style: RoomStyle;
}

/** A cabinet/island footprint as its four true corners (cycle 017) — NOT flattened to an AABB,
 * so a piece on an angled wall keeps its real oriented shape for SAT collision + rotated
 * rendering. Corner order: at the wall-start edge of the piece, then along the wall, then
 * pushed inward by its depth, then back. */
export type FootprintQuad = [Vec2, Vec2, Vec2, Vec2];

export interface FootprintBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boundsOf(points: readonly Vec2[]): FootprintBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Flatten a quad to its axis-aligned bounding box — for the extent-only consumers (room-bounds
 * checks, camera fit) that never needed the true oriented shape. */
export function quadBounds(quad: FootprintQuad): FootprintBounds {
  return boundsOf(quad);
}

/** THE one filter for "the room's own walls, not islands." Every template/perimeter-only
 * consumer must go through this rather than indexing or destructuring room.walls directly —
 * an island in the array would otherwise silently become someone's "north wall" or "longest
 * wall" by position. */
export function perimeterWalls(room: Room): Wall[] {
  return room.walls.filter((wall) => wall.kind === "perimeter");
}

/** Smallest allowed length (inches) for any footprint edge — a shorter wall couldn't hold even
 * the smallest cabinet meaningfully, and risks degenerate near-zero-length walls downstream. */
export const MIN_EDGE_LENGTH = 12;

/** Signed polygon area via the shoelace formula, in this app's (x, y-down) plan coordinates. A
 * POSITIVE result means the vertex order is clockwise in that convention — verified against the
 * pre-cycle-017 rectangle (0,0)->(w,0)->(w,l)->(0,l) (top edge, right edge, bottom edge, left
 * edge — clockwise when drawn with y increasing downward), which yields +w*l here. */
function signedArea(points: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** Reverse to clockwise winding if the input came in counter-clockwise — so "inward = dir
 * rotated +90°" always actually points into the room, regardless of how a shape builder or
 * future footprint editor ordered its vertices. */
function normalizeWinding(points: readonly Vec2[]): Vec2[] {
  const pts = points.map((p) => ({ x: p.x, y: p.y }));
  return signedArea(pts) < 0 ? pts.reverse() : pts;
}

/** Do segments (a1,a2) and (b1,b2) properly cross? Collinear overlaps and shared endpoints
 * (adjacent polygon edges meeting at a vertex) are deliberately NOT reported — same
 * EPSILON-tolerant "touching isn't a conflict" posture used everywhere else in this app. */
export function segmentsIntersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
  const cross = (o: Vec2, p: Vec2, q: Vec2) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);
  return d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0 && d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0;
}

/** Ray-cast point-in-polygon (odd-number-of-crossings rule). Works for any simple polygon,
 * convex or concave (an L/U-shape's notch correctly reads as outside). */
export function pointInPolygon(point: Vec2, polygon: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    const crosses = pi.y > point.y !== pj.y > point.y;
    if (!crosses) continue;
    const xAtY = ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (point.x < xAtY) inside = !inside;
  }
  return inside;
}

/**
 * Does `quad` sit entirely inside `polygon`? Corner-containment alone isn't enough for a
 * non-convex room (a wide island whose two ends both land in separate arms of a U-shape would
 * pass a corners-only check while its middle cuts straight through the notch) — so this also
 * rejects any quad edge that crosses a polygon edge. The one containment primitive island
 * placement (replacing the old axis-aligned withinAxisBounds) needs; piece-vs-piece collision
 * stays SAT (occupancy.ts's quadsOverlap), unrelated to this.
 */
export function quadInsidePolygon(quad: FootprintQuad, polygon: readonly Vec2[]): boolean {
  for (const corner of quad) {
    if (!pointInPolygon(corner, polygon)) return false;
  }
  const quadEdges: Array<[Vec2, Vec2]> = [
    [quad[0], quad[1]],
    [quad[1], quad[2]],
    [quad[2], quad[3]],
    [quad[3], quad[0]],
  ];
  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    for (const [q1, q2] of quadEdges) {
      if (segmentsIntersect(q1, q2, p1, p2)) return false;
    }
  }
  return true;
}

function footprintSelfIntersects(points: readonly Vec2[]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a1 = points[i];
    const a2 = points[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      const b1 = points[j];
      const b2 = points[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/**
 * Whole-shape validity: a real, finite Vec2 list, at least 3 vertices, every implied edge (i to
 * i+1, wrapping) at least MIN_EDGE_LENGTH, and no two non-adjacent edges crossing. Winding is
 * NOT checked here — createPolygonRoom normalizes it unconditionally, so any winding is valid
 * input. Exported for persistence.ts's v5 validation (malformed-footprint rejection) and
 * roomShapes.ts's own builder tests — ONE validity predicate, not reimplemented per caller.
 */
export function isValidFootprint(points: unknown): points is Vec2[] {
  if (!Array.isArray(points) || points.length < 3) return false;
  for (const p of points) {
    if (typeof p !== "object" || p === null) return false;
    const { x, y } = p as Record<string, unknown>;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  }
  const pts = points as Vec2[];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (Math.hypot(b.x - a.x, b.y - a.y) < MIN_EDGE_LENGTH) return false;
  }
  return !footprintSelfIntersects(pts);
}

/**
 * Derive a room from an arbitrary polygon (cycle 017): one wall per edge, in footprint order,
 * winding normalized to clockwise first (see normalizeWinding) so "inward = dir rotated +90°"
 * always points into the room, same convention the rectangle case always used. `width`/`length`
 * are the footprint's own bounding-box extent — derived, not authoritative.
 */
export function createPolygonRoom(footprint: Vec2[], wallHeight: number): Room {
  const normalized = normalizeWinding(footprint);
  const n = normalized.length;

  const walls: Wall[] = normalized.map((start, i) => {
    const end = normalized[(i + 1) % n];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy);
    const dir: Vec2 = { x: dx / len, y: dy / len };
    // Inward normal for a clockwise perimeter: rotate direction +90° -> (-dy, dx).
    const inward: Vec2 = { x: -dir.y, y: dir.x };
    return {
      id: `wall-${i}`,
      kind: "perimeter",
      label: `Wall ${i + 1}`,
      length: len,
      start,
      dir,
      inward,
      cabinets: [],
    };
  });

  const bounds = boundsOf(normalized);
  return {
    footprint: normalized,
    width: bounds.maxX - bounds.minX,
    length: bounds.maxY - bounds.minY,
    wallHeight,
    walls,
    style: roomStyleForPreset(DEFAULT_PRESET),
  };
}

/** The rectangle case's own wall labels, preserved exactly (North/East/South/West) rather than
 * createPolygonRoom's generic "Wall N" — a rectangle room must behave (and read) byte-identically
 * to before cycle 017, including after a reload (persistence.ts's load() re-applies these too,
 * whenever the restored roomShape says "rectangle" — see applyRectangleLabelsIfNeeded). */
export const RECTANGLE_WALL_LABELS = ["North", "East", "South", "West"];

/** Re-apply the North/East/South/West labels to a freshly-built 4-wall room — the one thing
 * createRectangularRoom does beyond a plain createPolygonRoom call. Exported so persistence.ts's
 * load() can restore the SAME labels for a rectangle room built via createPolygonRoom directly
 * (load() always goes through the general path, since it works from an arbitrary saved
 * footprint) — without this, a reloaded rectangle would silently read "Wall 1..4" instead of its
 * usual North/East/South/West. A no-op (returns false) for anything other than exactly 4 walls. */
export function applyRectangleLabelsIfNeeded(room: Room): boolean {
  if (room.walls.length !== RECTANGLE_WALL_LABELS.length) return false;
  room.walls.forEach((wall, i) => {
    wall.label = RECTANGLE_WALL_LABELS[i];
  });
  return true;
}

/**
 * Build a rectangular room from typed dimensions — a thin 4-vertex wrapper over
 * createPolygonRoom (cycle 017). The room occupies the plan rectangle (0,0) -> (width, length),
 * walls laid out clockwise starting at the top-left, exactly as before.
 */
export function createRectangularRoom(width: number, length: number, wallHeight: number): Room {
  const footprint: Vec2[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: length },
    { x: 0, y: length },
  ];
  const room = createPolygonRoom(footprint, wallHeight);
  applyRectangleLabelsIfNeeded(room);
  return room;
}

export type IslandOrientation = "ew" | "ns";

let islandSequence = 0;
function nextIslandId(): string {
  islandSequence += 1;
  return `island-${islandSequence}`;
}

/** Which axis an island's dir vector runs along — derived, never stored separately, so it
 * can never drift out of sync with dir/inward. */
export function islandOrientation(wall: Wall): IslandOrientation {
  return Math.abs(wall.dir.x) >= Math.abs(wall.dir.y) ? "ew" : "ns";
}

/** Axis-aligned dir/inward for an island of the given orientation. A single, one-sided
 * convention (the counter run always faces the same side) — islands stay axis-aligned this
 * cycle (locked decision); two-sided/rotated islands are out of scope. */
function axesFor(orientation: IslandOrientation): { dir: Vec2; inward: Vec2 } {
  return orientation === "ew" ? { dir: { x: 1, y: 0 }, inward: { x: 0, y: 1 } } : { dir: { x: 0, y: 1 }, inward: { x: 1, y: 0 } };
}

/** Clamp a 1D position so [position, position + length] stays inside [0, roomExtent]. */
function clampAxisPosition(position: number, length: number, roomExtent: number): number {
  const max = Math.max(0, roomExtent - length);
  return Math.min(max, Math.max(0, position));
}

/**
 * Create a freestanding island wall, centered in the room's bounding box by default (clamped
 * inside it). Multiple islands are allowed; each gets a stable, session-scoped id from its own
 * counter (separate from cabinet ids, same "internal, never persisted" convention).
 */
export function createIsland(room: Room, length = 72, orientation: IslandOrientation = "ew"): Wall {
  const { dir, inward } = axesFor(orientation);
  const start: Vec2 =
    orientation === "ew"
      ? { x: clampAxisPosition(room.width / 2 - length / 2, length, room.width), y: room.length / 2 }
      : { x: room.width / 2, y: clampAxisPosition(room.length / 2 - length / 2, length, room.length) };

  return {
    id: nextIslandId(),
    kind: "island",
    label: "Island",
    length,
    start,
    dir,
    inward,
    cabinets: [],
  };
}

/**
 * Recompute an island's dir/inward/start for a new orientation, preserving its center point
 * and clamping back inside the room's bounding box. Callers apply this in place (islands are
 * mutable).
 */
export function reorientIsland(island: Wall, orientation: IslandOrientation, room: Room): void {
  const { dir, inward } = axesFor(orientation);
  const centerX = island.start.x + island.dir.x * (island.length / 2);
  const centerY = island.start.y + island.dir.y * (island.length / 2);
  island.dir = dir;
  island.inward = inward;
  island.start =
    orientation === "ew"
      ? { x: clampAxisPosition(centerX - island.length / 2, island.length, room.width), y: centerY }
      : { x: centerX, y: clampAxisPosition(centerY - island.length / 2, island.length, room.length) };
}

/**
 * Reposition an existing island for a NEW room size: same id, length, and orientation
 * (dir/inward unchanged — a resize never rotates an island), position clamped back inside the
 * new bounding box if it no longer fits where it was. Returns null if the island's length itself
 * can't fit the new room along its own axis at all (the caller drops it, pieces included, and
 * counts the loss) — the id is preserved (unlike cabinets, which always get a fresh id on
 * reattachment) so a selection pointing at this island survives the resize by construction.
 * Pieces are NOT carried here — the caller reattaches them via the same sequential
 * firstFittingGap discipline planFill/applyTemplate use.
 */
export function carryIslandInto(island: Wall, room: Room): Wall | null {
  const orientation = islandOrientation(island);
  const roomExtentAlongAxis = orientation === "ew" ? room.width : room.length;
  if (island.length > roomExtentAlongAxis) return null;

  const start: Vec2 =
    orientation === "ew"
      ? {
          x: clampAxisPosition(island.start.x, island.length, room.width),
          y: clampAxisPosition(island.start.y, 0, room.length),
        }
      : {
          x: clampAxisPosition(island.start.x, 0, room.width),
          y: clampAxisPosition(island.start.y, island.length, room.length),
        };

  return { ...island, start, cabinets: [] };
}

/**
 * Compute the plan-space footprint of a cabinet on a wall (perimeter or island) as its four true
 * oriented corners (cycle 017 — no AABB flattening): a width × depth rectangle sitting against
 * the wall, offset into the room by the wall's inward normal, at whatever angle the wall itself
 * runs. Wall-agnostic by construction (reads only start/dir/inward), so islands and angled walls
 * alike need zero special-casing. Takes only the three fields it actually reads (not the full
 * Cabinet) so callers can reuse it for a hypothetical/non-piece rectangle too — e.g. planView's
 * island "deck" outline (length × nominal depth), without a fake full Cabinet object.
 */
export function cabinetFootprint(wall: Wall, cabinet: Pick<Cabinet, "xOffset" | "width" | "depth">): FootprintQuad {
  const ax = wall.start.x + wall.dir.x * cabinet.xOffset;
  const ay = wall.start.y + wall.dir.y * cabinet.xOffset;
  return [
    { x: ax, y: ay },
    { x: ax + wall.dir.x * cabinet.width, y: ay + wall.dir.y * cabinet.width },
    {
      x: ax + wall.dir.x * cabinet.width + wall.inward.x * cabinet.depth,
      y: ay + wall.dir.y * cabinet.width + wall.inward.y * cabinet.depth,
    },
    { x: ax + wall.inward.x * cabinet.depth, y: ay + wall.inward.y * cabinet.depth },
  ];
}
