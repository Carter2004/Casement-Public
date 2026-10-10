// occupancy.test.ts — the minimum test net for the app's most intricate geometry: vertical-
// range collision (base vs wall never conflict; a tall appliance blocks the band above it),
// same-wall interval blocking, cross-wall corner blocking (including islands, which need zero
// special-casing by construction), and the EPSILON discipline that lets flush neighbors touch
// without a phantom gap or a phantom collision.

import { describe, expect, it } from "vitest";
import { createCabinet } from "./cabinet";
import { cabinetVerticalPlacement } from "./kinds";
import { clampIntoGap, EPSILON, firstFittingGap, footprintsConflict, freeIntervals, quadsOverlap } from "./occupancy";
import { cabinetFootprint, createIsland, createPolygonRoom, createRectangularRoom, type FootprintQuad, type Vec2 } from "./room";
import { planFill } from "./run";

describe("vertical-range overlap", () => {
  it("a base cabinet does not block a wall cabinet at the same horizontal span", () => {
    const room = createRectangularRoom(120, 144, 96);
    const wall = room.walls[0];
    wall.cabinets.push(createCabinet("cabinet", "base", 0)); // 0-24, vertical 0-34.5

    const wallCabinetRange = cabinetVerticalPlacement(createCabinet("cabinet", "wall", 0)); // vertical 54-84
    const gaps = freeIntervals(room, wall, wallCabinetRange, 12);

    expect(gaps).toEqual([{ start: 0, end: wall.length }]);
  });

  it("a wall cabinet cannot be placed inside a 70\"-tall fridge's vertical span", () => {
    const room = createRectangularRoom(120, 144, 96);
    const wall = room.walls[0];
    wall.cabinets.push(createCabinet("fridge", "base", 0)); // catalog default: 36x70x30, vertical 0-70

    const wallCabinetRange = cabinetVerticalPlacement(createCabinet("cabinet", "wall", 0)); // vertical 54-84
    const gaps = freeIntervals(room, wall, wallCabinetRange, 12);

    // 54 < 70, so the fridge's vertical range DOES overlap the wall band — its 36" horizontal
    // footprint must be excluded from the free gaps.
    expect(gaps).toEqual([{ start: 36, end: wall.length }]);
  });

  it("vertical ranges that only touch (one's top equals the other's bottom) do not conflict", () => {
    const room = createRectangularRoom(120, 144, 96);
    const wall = room.walls[0];
    wall.cabinets.push(createCabinet("cabinet", "base", 0)); // vertical 0-34.5

    const touchingRange = { bottom: 34.5, top: 40 }; // starts exactly where the base cabinet ends
    const gaps = freeIntervals(room, wall, touchingRange, 12);

    expect(gaps).toEqual([{ start: 0, end: wall.length }]);
  });
});

describe("same-wall interval blocking", () => {
  it("produces the gaps between and around occupied pieces", () => {
    const room = createRectangularRoom(120, 144, 96);
    const wall = room.walls[0];
    const a = createCabinet("cabinet", "base", 0);
    a.width = 24; // 0-24
    const b = createCabinet("cabinet", "base", 48);
    b.width = 24; // 48-72
    wall.cabinets.push(a, b);

    const range = cabinetVerticalPlacement(createCabinet("cabinet", "base", 0));
    const gaps = freeIntervals(room, wall, range, 24);

    expect(gaps).toEqual([
      { start: 24, end: 48 },
      { start: 72, end: 120 },
    ]);
  });

  it("flush-touching pieces merge into one occupied run with no phantom gap between them", () => {
    const room = createRectangularRoom(120, 144, 96);
    const wall = room.walls[0];
    const a = createCabinet("cabinet", "base", 0);
    a.width = 24; // 0-24
    const b = createCabinet("cabinet", "base", 24);
    b.width = 24; // 24-48, flush with a
    wall.cabinets.push(a, b);

    const range = cabinetVerticalPlacement(createCabinet("cabinet", "base", 0));
    const gaps = freeIntervals(room, wall, range, 24);

    expect(gaps).toEqual([{ start: 48, end: 120 }]);
  });

  it("clampIntoGap stops a dragged cabinet flush at its neighbor, never past it", () => {
    const room = createRectangularRoom(120, 144, 96);
    const wall = room.walls[0];
    const a = createCabinet("cabinet", "base", 0);
    a.width = 24; // 0-24
    const b = createCabinet("cabinet", "base", 24);
    b.width = 24; // 24-48
    wall.cabinets.push(a, b);

    const clamped = clampIntoGap(room, wall, b, 5); // try to drag b left, through a
    expect(clamped).toBe(24); // zero slack — b was already flush against a
  });
});

describe("cross-wall corner blocking", () => {
  it("a deeper neighbor at the shared corner blocks more of the adjacent wall", () => {
    const room = createRectangularRoom(120, 144, 96);
    const north = room.walls[0]; // wall-0: (0,0)->(120,0)
    const east = room.walls[1]; // wall-1: (120,0)->(120,144) — shares the corner at North's far end

    const range = cabinetVerticalPlacement(createCabinet("cabinet", "base", 0));

    const shallow = createCabinet("cabinet", "base", 0);
    shallow.width = 36;
    shallow.depth = 12;
    east.cabinets = [shallow];
    expect(freeIntervals(room, north, range, 24)).toEqual([{ start: 0, end: 108 }]);

    const deep = createCabinet("cabinet", "base", 0);
    deep.width = 36;
    deep.depth = 24;
    east.cabinets = [deep];
    expect(freeIntervals(room, north, range, 24)).toEqual([{ start: 0, end: 96 }]);
  });

  it("an island's piece cross-blocks a perimeter wall's piece — zero special-casing needed", () => {
    const room = createRectangularRoom(120, 144, 96);
    const north = room.walls[0];
    const island = createIsland(room, 72, "ew");
    island.start = { x: 24, y: 0 }; // flush against the North wall line, for an exact expectation
    room.walls.push(island);

    const islandCabinet = createCabinet("cabinet", "base", 0);
    islandCabinet.width = 36;
    islandCabinet.depth = 24;
    island.cabinets.push(islandCabinet);

    const range = cabinetVerticalPlacement(createCabinet("cabinet", "base", 0));
    const gaps = freeIntervals(room, north, range, 24);

    expect(gaps).toEqual([
      { start: 0, end: 24 },
      { start: 60, end: 120 },
    ]);
  });
});

describe("excludeCabinetId threading (cycle 019 — the move authority)", () => {
  it("freeIntervals: excluding the SAME-WALL piece frees its own occupied span (unchanged behavior, sanity check)", () => {
    const room = createRectangularRoom(120, 144, 96);
    const wall = room.walls[0];
    const a = createCabinet("cabinet", "base", 0);
    a.width = 24;
    wall.cabinets.push(a);
    const range = cabinetVerticalPlacement(createCabinet("cabinet", "base", 0));

    expect(freeIntervals(room, wall, range, 24)).toEqual([{ start: 24, end: 120 }]);
    expect(freeIntervals(room, wall, range, 24, a.id)).toEqual([{ start: 0, end: 120 }]);
  });

  it("freeIntervals: excluding a CROSS-WALL piece frees the corner it was blocking (the move-authority case)", () => {
    const room = createRectangularRoom(120, 144, 96);
    const north = room.walls[0]; // (0,0)->(120,0)
    const east = room.walls[1]; // (120,0)->(120,144) — shares the corner at North's far end

    const corner = createCabinet("cabinet", "base", 0);
    corner.width = 24;
    corner.depth = 24;
    east.cabinets = [corner];

    const range = cabinetVerticalPlacement(createCabinet("cabinet", "base", 0));
    // Without exclude: the established corner-blocking result (24" of North's far end blocked).
    expect(freeIntervals(room, north, range, 24)).toEqual([{ start: 0, end: 96 }]);
    // With exclude: `corner`'s own footprint no longer counts against North at all — the exact
    // premise a move of `corner` itself onto North needs (it must never corner-block its own
    // destination).
    expect(freeIntervals(room, north, range, 24, corner.id)).toEqual([{ start: 0, end: 120 }]);
  });

  it("no-exclude path stays byte-identical (undefined never matches a real cabinet id)", () => {
    const room = createRectangularRoom(120, 144, 96);
    const north = room.walls[0];
    const east = room.walls[1];
    const corner = createCabinet("cabinet", "base", 0);
    corner.width = 24;
    corner.depth = 24;
    east.cabinets = [corner];
    const range = cabinetVerticalPlacement(createCabinet("cabinet", "base", 0));

    expect(freeIntervals(room, north, range, 24)).toEqual(freeIntervals(room, north, range, 24, undefined));
  });
});

describe("footprintsConflict", () => {
  // footprintsConflict is deliberately height-blind — it's the island-drag rule (Part 2 of the
  // plan specified footprint-only intersection for moveIsland), NOT the vertical-range-aware
  // rule freeIntervals/fill/add use. An island sliding under a wall's uppers with no BASE
  // cabinets below (a real 2D plan overlap, just no vertical-band overlap) must still be
  // rejected — see store.test.ts for the exact regression this guards against.
  it("is true whenever plan footprints overlap, even if vertical ranges don't", () => {
    const room = createRectangularRoom(120, 144, 96);
    const wall = room.walls[0];
    const base = createCabinet("cabinet", "base", 0);
    base.width = 36; // vertical 0-34.5
    const wallCabinet = createCabinet("cabinet", "wall", 0);
    wallCabinet.width = 36; // vertical 54-84 — no vertical overlap with base, same horizontal span

    expect(footprintsConflict(wall, base, wall, wallCabinet)).toBe(true);
  });

  it("is false when horizontal footprints don't overlap at all", () => {
    const room = createRectangularRoom(120, 144, 96);
    const wall = room.walls[0];
    const a = createCabinet("cabinet", "base", 0);
    a.width = 24; // 0-24
    const b = createCabinet("cabinet", "base", 48);
    b.width = 24; // 48-72 — no horizontal overlap

    expect(footprintsConflict(wall, a, wall, b)).toBe(false);
  });

  it("is true when footprints overlap", () => {
    const room = createRectangularRoom(120, 144, 96);
    const wall = room.walls[0];
    const a = createCabinet("cabinet", "base", 0);
    a.width = 36;
    const b = createCabinet("cabinet", "base", 12); // overlaps a's [0,36) span
    b.width = 36;

    expect(footprintsConflict(wall, a, wall, b)).toBe(true);
  });
});

describe("firstFittingGap", () => {
  it("finds the first gap (in wall order) that fits the requested width", () => {
    const room = createRectangularRoom(120, 144, 96);
    const wall = room.walls[0];
    const a = createCabinet("cabinet", "base", 0);
    a.width = 24; // 0-24
    wall.cabinets.push(a);

    const range = cabinetVerticalPlacement(createCabinet("cabinet", "base", 0));
    const gap = firstFittingGap(room, wall, range, 24, 18);
    expect(gap).toEqual({ start: 24, end: 120 });
  });

  it("returns null when nothing fits", () => {
    const room = createRectangularRoom(30, 144, 96);
    const wall = room.walls[0]; // length 30
    const a = createCabinet("cabinet", "base", 0);
    a.width = 24;
    wall.cabinets.push(a); // leaves only a 6" gap

    const range = cabinetVerticalPlacement(createCabinet("cabinet", "base", 0));
    const gap = firstFittingGap(room, wall, range, 24, 18);
    expect(gap).toBeNull();
  });
});

describe("openings", () => {
  it("a window blocks the wall band but admits a base cabinet beneath it (sink-under-window)", () => {
    const room = createRectangularRoom(120, 144, 96);
    const wall = room.walls[0];
    const window = createCabinet("window", "wall", 24); // 24-60, vertical 42-78
    wall.cabinets.push(window);

    const baseRange = cabinetVerticalPlacement(createCabinet("cabinet", "base", 0)); // 0-34.5
    expect(freeIntervals(room, wall, baseRange, 24)).toEqual([{ start: 0, end: 120 }]);

    const wallRange = cabinetVerticalPlacement(createCabinet("cabinet", "wall", 0)); // 54-84
    expect(freeIntervals(room, wall, wallRange, 12)).toEqual([
      { start: 0, end: 24 },
      { start: 60, end: 120 },
    ]);
  });

  it("a door blocks both the base and wall bands (floor to head)", () => {
    const room = createRectangularRoom(120, 144, 96);
    const wall = room.walls[0];
    const door = createCabinet("door", "base", 24); // 24-60, vertical 0-80
    wall.cabinets.push(door);

    const baseRange = cabinetVerticalPlacement(createCabinet("cabinet", "base", 0)); // 0-34.5
    expect(freeIntervals(room, wall, baseRange, 24)).toEqual([
      { start: 0, end: 24 },
      { start: 60, end: 120 },
    ]);

    const wallRange = cabinetVerticalPlacement(createCabinet("cabinet", "wall", 0)); // 54-84
    expect(freeIntervals(room, wall, wallRange, 12)).toEqual([
      { start: 0, end: 24 },
      { start: 60, end: 120 },
    ]);
  });

  it("fill wall: base routes around a doorway and never re-fills it (the audit's refill repro)", () => {
    const room = createRectangularRoom(120, 144, 96);
    const wall = room.walls[0];
    const doorway = createCabinet("doorway", "base", 36); // 36-84, vertical 0-80
    wall.cabinets.push(doorway);

    const generated = planFill(room, wall, "base");
    for (const piece of generated) {
      const pieceEnd = piece.xOffset + piece.width;
      // Every fill-generated piece must sit entirely outside the doorway's [36, 84) span.
      const clearOfDoorway = pieceEnd <= doorway.xOffset || piece.xOffset >= doorway.xOffset + doorway.width;
      expect(clearOfDoorway).toBe(true);
    }
    // And re-running fill again (as if the owner clicked "Fill wall: base" a second time)
    // generates nothing new — the doorway stays permanently protected, not just on first fill.
    wall.cabinets.push(...generated);
    expect(planFill(room, wall, "base")).toEqual([]);
  });
});

// ---- cycle 017: SAT (quadsOverlap) — the rectangle regression bridge + angled cases ----------

function axisAlignedQuad(x0: number, y0: number, x1: number, y1: number): FootprintQuad {
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

/** A width x depth rectangle at any angle: origin is its near-near corner, `dir` its along-axis
 * unit vector — the exact same construction cabinetFootprint uses, so these tests exercise the
 * same shape family real pieces produce. */
function orientedRect(origin: Vec2, dir: Vec2, along: number, depth: number): FootprintQuad {
  const perp = { x: -dir.y, y: dir.x };
  const c0 = origin;
  const c1 = { x: c0.x + dir.x * along, y: c0.y + dir.y * along };
  const c2 = { x: c1.x + perp.x * depth, y: c1.y + perp.y * depth };
  const c3 = { x: c0.x + perp.x * depth, y: c0.y + perp.y * depth };
  return [c0, c1, c2, c3];
}

describe("quadsOverlap: axis-aligned regression bridge (byte-identical to the old intersectBounds)", () => {
  it("reports true for two genuinely overlapping axis-aligned rectangles", () => {
    expect(quadsOverlap(axisAlignedQuad(0, 0, 20, 20), axisAlignedQuad(10, 10, 30, 30))).toBe(true);
  });

  it("reports false for two disjoint axis-aligned rectangles", () => {
    expect(quadsOverlap(axisAlignedQuad(0, 0, 10, 10), axisAlignedQuad(50, 50, 60, 60))).toBe(false);
  });

  it("reports false for two rectangles flush-touching along a shared edge (EPSILON-tolerant, same as intersectBounds)", () => {
    expect(quadsOverlap(axisAlignedQuad(0, 0, 10, 10), axisAlignedQuad(10, 0, 20, 10))).toBe(false);
  });

  it("reports false for two rectangles overlapping by less than EPSILON (floating-point noise tolerance)", () => {
    expect(quadsOverlap(axisAlignedQuad(0, 0, 10, 10), axisAlignedQuad(10 - EPSILON / 2, 0, 20, 10))).toBe(false);
  });

  it("reports true when one rectangle sits fully inside another", () => {
    expect(quadsOverlap(axisAlignedQuad(0, 0, 100, 100), axisAlignedQuad(20, 20, 40, 40))).toBe(true);
  });
});

describe("quadsOverlap: angled cases (cycle 017)", () => {
  it("angled-vs-axis-aligned: a 45°-rotated quad genuinely overlapping an axis-aligned rectangle reads as true", () => {
    const diamond: FootprintQuad = [{ x: 20, y: 0 }, { x: 40, y: 20 }, { x: 20, y: 40 }, { x: 0, y: 20 }];
    expect(quadsOverlap(diamond, axisAlignedQuad(15, 15, 25, 25))).toBe(true);
  });

  it("angled-vs-axis-aligned: the same diamond, moved clear away, reads as false", () => {
    const diamond: FootprintQuad = [{ x: 20, y: 0 }, { x: 40, y: 20 }, { x: 20, y: 40 }, { x: 0, y: 20 }];
    expect(quadsOverlap(diamond, axisAlignedQuad(100, 100, 110, 110))).toBe(false);
  });

  it("angled-vs-angled: two 45°-rotated diamonds that genuinely overlap read as true", () => {
    const a: FootprintQuad = [{ x: 20, y: 0 }, { x: 40, y: 20 }, { x: 20, y: 40 }, { x: 0, y: 20 }];
    const b: FootprintQuad = [{ x: 30, y: 10 }, { x: 50, y: 30 }, { x: 30, y: 50 }, { x: 10, y: 30 }];
    expect(quadsOverlap(a, b)).toBe(true);
  });

  it("angled-vs-angled: two 45°-rotated diamonds placed clear apart read as false", () => {
    const a: FootprintQuad = [{ x: 20, y: 0 }, { x: 40, y: 20 }, { x: 20, y: 40 }, { x: 0, y: 20 }];
    const b: FootprintQuad = [{ x: 200, y: 0 }, { x: 220, y: 20 }, { x: 200, y: 40 }, { x: 180, y: 20 }];
    expect(quadsOverlap(a, b)).toBe(false);
  });

  it("parallel near-miss: two same-orientation rotated rectangles — flush (false), a real gap (false), and a real overlap (true)", () => {
    const angle = Math.PI / 6; // 30°
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const perp = { x: -dir.y, y: dir.x };
    const a = orientedRect({ x: 0, y: 0 }, dir, 40, 20);

    const flush = orientedRect({ x: perp.x * 20, y: perp.y * 20 }, dir, 40, 20);
    expect(quadsOverlap(a, flush)).toBe(false);

    const gapped = orientedRect({ x: perp.x * 22, y: perp.y * 22 }, dir, 40, 20); // 2" real gap
    expect(quadsOverlap(a, gapped)).toBe(false);

    const overlapping = orientedRect({ x: perp.x * 10, y: perp.y * 10 }, dir, 40, 20); // 10" of overlap
    expect(quadsOverlap(a, overlapping)).toBe(true);
  });

  it("EPSILON corner-touching: two axis-aligned quads sharing only a single corner point don't overlap", () => {
    expect(quadsOverlap(axisAlignedQuad(0, 0, 10, 10), axisAlignedQuad(10, 10, 20, 20))).toBe(false);
  });
});

describe("crossWallBlocked: a concave (reflex) corner in an L-shaped room", () => {
  // The notch's reflex vertex sits at (100,100): wall-2 (200,100)->(100,100, its OWN far end at
  // the reflex vertex) and wall-3 (100,100)->(100,200, its OWN near end at the same vertex).
  const L_SHAPE = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 100 },
    { x: 100, y: 100 },
    { x: 100, y: 200 },
    { x: 0, y: 200 },
  ];

  it("a normal CONVEX corner at the notch's own outer edge (200,100) blocks the adjacent wall exactly like any other corner", () => {
    const room = createPolygonRoom(L_SHAPE, 96);
    const wallEast = room.walls[1]; // (200,0)->(200,100)
    const wallNotchTop = room.walls[2]; // (200,100)->(100,100)

    const deep = createCabinet("cabinet", "base", wallEast.length - 36); // flush against the far end (the corner)
    deep.width = 36;
    deep.depth = 24;
    wallEast.cabinets = [deep];

    const range = cabinetVerticalPlacement(createCabinet("cabinet", "base", 0));
    const gaps = freeIntervals(room, wallNotchTop, range, 24);
    // Blocked near wallNotchTop's OWN start (0), which is the shared corner (200,100) — same
    // physics as occupancy.test.ts's plain-rectangle corner-blocking test, just at a notch.
    expect(gaps[0].start).toBeGreaterThan(EPSILON);
  });

  it("the notch's own reflex vertex does NOT falsely cross-block its two adjacent walls (depth on one moves AWAY from the other, not toward it)", () => {
    const room = createPolygonRoom(L_SHAPE, 96);
    const wallNotchTop = room.walls[2]; // (200,100)->(100,100)
    const wallNotchSide = room.walls[3]; // (100,100)->(100,200)

    // A deep piece on wallNotchSide, flush at ITS OWN start — the reflex vertex (100,100) —
    // extends into the room's LEFT arm (x<100), never toward wallNotchTop's own zone (x>=100).
    const deep = createCabinet("cabinet", "base", 0);
    deep.width = 36;
    deep.depth = 36; // MAX_DEPTH — as deep as this app ever allows a base cabinet to get
    wallNotchSide.cabinets = [deep];

    const range = cabinetVerticalPlacement(createCabinet("cabinet", "base", 0));
    const gaps = freeIntervals(room, wallNotchTop, range, 24);
    // wallNotchTop stays entirely free — the reflex corner does not manufacture a false block.
    expect(gaps).toEqual([{ start: 0, end: wallNotchTop.length }]);
  });
});

describe("crossWallBlocked: a 45°-junction wall (a clipped-corner-style room)", () => {
  // A 200x200 rectangle with its top-right corner clipped by a 40" diagonal wall.
  const CLIPPED_CORNER = [
    { x: 0, y: 0 },
    { x: 160, y: 0 },
    { x: 200, y: 40 },
    { x: 200, y: 200 },
    { x: 0, y: 200 },
  ];

  it("a piece flush against the 45° junction blocks the adjacent angled wall's own near end", () => {
    const room = createPolygonRoom(CLIPPED_CORNER, 96);
    const wallTop = room.walls[0]; // (0,0)->(160,0)
    const wallDiagonal = room.walls[1]; // (160,0)->(200,40)

    const piece = createCabinet("cabinet", "base", wallTop.length - 36); // flush at the junction
    piece.width = 36;
    piece.depth = 24;
    wallTop.cabinets = [piece];

    const range = cabinetVerticalPlacement(createCabinet("cabinet", "base", 0));
    const gaps = freeIntervals(room, wallDiagonal, range, 24);
    // Blocked near wallDiagonal's own start (the shared 45° junction) — the same cross-wall
    // physics as a 90° corner, generalized to any wall angle via SAT.
    expect(gaps[0]?.start ?? 0).toBeGreaterThan(EPSILON);
  });

  it("a piece on the diagonal wall itself renders/collides via its own true (rotated) footprint, not an inflated AABB", () => {
    const room = createPolygonRoom(CLIPPED_CORNER, 96);
    const wallDiagonal = room.walls[1];
    const quad = cabinetFootprint(wallDiagonal, { xOffset: 0, width: 20, depth: 24 });
    // The piece's own footprint edges must be exactly `width` and `depth` long — not the AABB's
    // (larger, axis-aligned) bounding dimensions.
    const edge = (a: Vec2, b: Vec2) => Math.hypot(b.x - a.x, b.y - a.y);
    expect(edge(quad[0], quad[1])).toBeCloseTo(20, 6);
    expect(edge(quad[1], quad[2])).toBeCloseTo(24, 6);
  });
});
