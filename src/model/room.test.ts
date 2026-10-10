// room.test.ts — geometry-core tests for cycle 017 (irregular rooms): winding normalization,
// createPolygonRoom's wall derivation for non-rectangular shapes, point-in-polygon, and
// quad-in-polygon containment (the point-in-polygon-alone-isn't-enough case: a wide shape whose
// corners are inside but whose edge cuts through a notch).

import { describe, expect, it } from "vitest";
import {
  applyRectangleLabelsIfNeeded,
  cabinetFootprint,
  createPolygonRoom,
  createRectangularRoom,
  isValidFootprint,
  perimeterWalls,
  pointInPolygon,
  quadBounds,
  quadInsidePolygon,
  type Vec2,
} from "./room";

describe("createRectangularRoom: byte-identical wrapper (cycle 017 regression bridge)", () => {
  it("produces the exact same 4 walls (ids, labels, geometry) as the pre-017 dedicated implementation", () => {
    const room = createRectangularRoom(120, 144, 96);
    expect(room.walls).toHaveLength(4);
    expect(room.walls.map((w) => w.id)).toEqual(["wall-0", "wall-1", "wall-2", "wall-3"]);
    expect(room.walls.map((w) => w.label)).toEqual(["North", "East", "South", "West"]);

    // `|| 0` normalizes -0 -> 0 (rotate-by-90° math legitimately produces -0 for some walls;
    // it's numerically identical to 0 everywhere it's used, just not Object.is-equal for toEqual).
    const summarize = (w: (typeof room.walls)[number]) => ({
      start: w.start,
      dir: { x: Math.round(w.dir.x) || 0, y: Math.round(w.dir.y) || 0 },
      inward: { x: Math.round(w.inward.x) || 0, y: Math.round(w.inward.y) || 0 },
      length: w.length,
    });
    expect(summarize(room.walls[0])).toEqual({ start: { x: 0, y: 0 }, dir: { x: 1, y: 0 }, inward: { x: 0, y: 1 }, length: 120 });
    expect(summarize(room.walls[1])).toEqual({ start: { x: 120, y: 0 }, dir: { x: 0, y: 1 }, inward: { x: -1, y: 0 }, length: 144 });
    expect(summarize(room.walls[2])).toEqual({ start: { x: 120, y: 144 }, dir: { x: -1, y: 0 }, inward: { x: 0, y: -1 }, length: 120 });
    expect(summarize(room.walls[3])).toEqual({ start: { x: 0, y: 144 }, dir: { x: 0, y: -1 }, inward: { x: 1, y: 0 }, length: 144 });
  });

  it("derives width/length as the footprint's own bounding box", () => {
    const room = createRectangularRoom(120, 144, 96);
    expect(room.width).toBe(120);
    expect(room.length).toBe(144);
    expect(room.footprint).toEqual([
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 144 },
      { x: 0, y: 144 },
    ]);
  });
});

describe("applyRectangleLabelsIfNeeded", () => {
  it("relabels a 4-wall room built via the general createPolygonRoom path to North/East/South/West", () => {
    const footprint: Vec2[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ];
    const room = createPolygonRoom(footprint, 96); // NOT createRectangularRoom — the general path
    expect(room.walls.map((w) => w.label)).toEqual(["Wall 1", "Wall 2", "Wall 3", "Wall 4"]);

    expect(applyRectangleLabelsIfNeeded(room)).toBe(true);
    expect(room.walls.map((w) => w.label)).toEqual(["North", "East", "South", "West"]);
  });

  it("is a no-op (returns false) for a non-4-wall room", () => {
    const footprint: Vec2[] = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
    ];
    const room = createPolygonRoom(footprint, 96);
    const before = room.walls.map((w) => w.label);
    expect(applyRectangleLabelsIfNeeded(room)).toBe(false);
    expect(room.walls.map((w) => w.label)).toEqual(before);
  });
});

describe("createPolygonRoom: winding normalization", () => {
  it("normalizes a counter-clockwise input footprint to clockwise, producing the same walls as the clockwise equivalent", () => {
    const clockwise: Vec2[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ];
    const counterClockwise: Vec2[] = [...clockwise].reverse();

    const roomA = createPolygonRoom(clockwise, 96);
    const roomB = createPolygonRoom(counterClockwise, 96);

    expect(roomB.footprint).toEqual(roomA.footprint);
    expect(roomB.walls.map((w) => ({ start: w.start, dir: w.dir, inward: w.inward }))).toEqual(
      roomA.walls.map((w) => ({ start: w.start, dir: w.dir, inward: w.inward })),
    );
    // Every wall's inward normal actually points INTO the room regardless of input winding.
    for (const wall of roomB.walls) {
      const midpoint = { x: wall.start.x + wall.dir.x * (wall.length / 2), y: wall.start.y + wall.dir.y * (wall.length / 2) };
      const probe = { x: midpoint.x + wall.inward.x * 1, y: midpoint.y + wall.inward.y * 1 };
      expect(pointInPolygon(probe, roomB.footprint)).toBe(true);
    }
  });
});

describe("createPolygonRoom: L-shape wall derivation (6 walls)", () => {
  const L_SHAPE: Vec2[] = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 100 },
    { x: 100, y: 100 },
    { x: 100, y: 200 },
    { x: 0, y: 200 },
  ];

  it("derives exactly one wall per edge, in order, each with a correct unit dir and inward-pointing normal", () => {
    const room = createPolygonRoom(L_SHAPE, 96);
    expect(room.walls).toHaveLength(6);
    expect(room.walls.map((w) => w.id)).toEqual(["wall-0", "wall-1", "wall-2", "wall-3", "wall-4", "wall-5"]);

    for (const wall of room.walls) {
      expect(Math.hypot(wall.dir.x, wall.dir.y)).toBeCloseTo(1, 6);
      const midpoint = { x: wall.start.x + wall.dir.x * (wall.length / 2), y: wall.start.y + wall.dir.y * (wall.length / 2) };
      const probe = { x: midpoint.x + wall.inward.x * 1, y: midpoint.y + wall.inward.y * 1 };
      expect(pointInPolygon(probe, room.footprint)).toBe(true);
    }

    // The reflex (notch) vertex's two walls: wall-2 (200,100)->(100,100) and wall-3
    // (100,100)->(100,200) — lengths 100 each, perpendicular directions.
    expect(room.walls[2]).toMatchObject({ start: { x: 200, y: 100 }, dir: { x: -1, y: 0 }, length: 100 });
    expect(room.walls[3]).toMatchObject({ start: { x: 100, y: 100 }, dir: { x: 0, y: 1 }, length: 100 });
  });

  it("width/length derive as the L-shape's own bounding box (the full 200x200 extent, notch included)", () => {
    const room = createPolygonRoom(L_SHAPE, 96);
    expect(room.width).toBe(200);
    expect(room.length).toBe(200);
  });
});

describe("pointInPolygon", () => {
  const L_SHAPE: Vec2[] = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 100 },
    { x: 100, y: 100 },
    { x: 100, y: 200 },
    { x: 0, y: 200 },
  ];

  it("reads a point inside either arm of an L-shape as inside", () => {
    expect(pointInPolygon({ x: 150, y: 50 }, L_SHAPE)).toBe(true); // top bar
    expect(pointInPolygon({ x: 50, y: 150 }, L_SHAPE)).toBe(true); // left bar
  });

  it("reads a point inside the notch (removed corner) as OUTSIDE, even though it's inside the bounding box", () => {
    expect(pointInPolygon({ x: 150, y: 150 }, L_SHAPE)).toBe(false);
  });

  it("reads a point outside the bounding box entirely as outside", () => {
    expect(pointInPolygon({ x: 300, y: 300 }, L_SHAPE)).toBe(false);
  });
});

describe("quadInsidePolygon: the corners-only-isn't-enough case", () => {
  // A wide island quad whose two ends land in the top bar and (mirrored) an equally-wide bottom
  // bar of a U-shape, with its middle cutting straight through the U's notch — every corner
  // inside the U, but the shape itself is not.
  const U_SHAPE: Vec2[] = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 100 },
    { x: 130, y: 100 },
    { x: 130, y: 10 },
    { x: 70, y: 10 },
    { x: 70, y: 100 },
    { x: 0, y: 100 },
  ];

  it("rejects a quad whose corners are inside the polygon but whose edge crosses through the notch", () => {
    // A thin quad spanning x:[10,190] at y:[95,99] — both ends sit inside the U's two legs
    // (x<70 and x>130 at that y), corners all technically inside, but the middle (x in [70,130])
    // at y in [95,99] is inside the notch (removed above y=10 only near x in [70,130]... use a
    // quad that instead straddles the FULL open mouth of the U to guarantee a real edge-crossing).
    const quad: import("./room").FootprintQuad = [
      { x: 10, y: 5 },
      { x: 190, y: 5 },
      { x: 190, y: 9 },
      { x: 10, y: 9 },
    ];
    // At y in [5,9], the U is solid everywhere EXCEPT nothing (the notch only starts at y=10) —
    // so this particular quad is actually fully inside; assert that positive case first as a
    // sanity check, then the real negative case below.
    expect(quadInsidePolygon(quad, U_SHAPE)).toBe(true);

    const crossing: import("./room").FootprintQuad = [
      { x: 10, y: 50 },
      { x: 190, y: 50 },
      { x: 190, y: 54 },
      { x: 10, y: 54 },
    ];
    // At y in [50,54] the U's notch (x in [70,130]) is open (outside the polygon) — a quad
    // spanning the full width has its corners at x=10/190 (inside the two legs) but its middle
    // passes straight through the open notch.
    expect(quadInsidePolygon(crossing, U_SHAPE)).toBe(false);
  });

  it("accepts a quad entirely within one leg of the U", () => {
    const quad: import("./room").FootprintQuad = [
      { x: 10, y: 20 },
      { x: 60, y: 20 },
      { x: 60, y: 90 },
      { x: 10, y: 90 },
    ];
    expect(quadInsidePolygon(quad, U_SHAPE)).toBe(true);
  });
});

describe("isValidFootprint", () => {
  it("accepts a plain rectangle", () => {
    expect(isValidFootprint([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }])).toBe(true);
  });

  it("rejects fewer than 3 vertices", () => {
    expect(isValidFootprint([{ x: 0, y: 0 }, { x: 100, y: 0 }])).toBe(false);
  });

  it("rejects a non-finite or malformed vertex", () => {
    expect(isValidFootprint([{ x: 0, y: 0 }, { x: NaN, y: 0 }, { x: 100, y: 80 }])).toBe(false);
    expect(isValidFootprint([{ x: 0, y: 0 }, "not a point", { x: 100, y: 80 }])).toBe(false);
    expect(isValidFootprint(null)).toBe(false);
    expect(isValidFootprint("not an array")).toBe(false);
  });

  it("rejects an edge shorter than MIN_EDGE_LENGTH", () => {
    expect(isValidFootprint([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 80 }, { x: 0, y: 80 }])).toBe(false);
  });

  it("rejects a self-intersecting polygon (a bowtie)", () => {
    expect(
      isValidFootprint([
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ]),
    ).toBe(false);
  });

  it("accepts a valid L-shape", () => {
    expect(
      isValidFootprint([
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 100 },
        { x: 100, y: 100 },
        { x: 100, y: 200 },
        { x: 0, y: 200 },
      ]),
    ).toBe(true);
  });
});

describe("cabinetFootprint + quadBounds: axis-aligned regression (unchanged pixel/geometry result)", () => {
  it("still produces the same 4 corners (and the same flattened bounds) for an axis-aligned wall", () => {
    const room = createRectangularRoom(120, 144, 96);
    const wall = perimeterWalls(room)[0];
    const quad = cabinetFootprint(wall, { xOffset: 10, width: 24, depth: 24 });
    expect(quad).toEqual([
      { x: 10, y: 0 },
      { x: 34, y: 0 },
      { x: 34, y: 24 },
      { x: 10, y: 24 },
    ]);
    expect(quadBounds(quad)).toEqual({ minX: 10, minY: 0, maxX: 34, maxY: 24 });
  });
});
