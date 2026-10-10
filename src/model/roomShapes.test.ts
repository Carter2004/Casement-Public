// roomShapes.test.ts — the shape catalog's own test net: every builder produces the documented
// vertex count, already-clockwise winding (createPolygonRoom never needs to reverse it), a
// footprint createPolygonRoom accepts (closure — one wall per edge, wrapping back to vertex 0),
// and a VALID footprint no matter how extreme the typed params are (clamping never lets a notch
// swallow the room or a cut exceed an edge).

import { describe, expect, it } from "vitest";
import { createPolygonRoom, isValidFootprint } from "./room";
import { defaultParamsFor, ROOM_SHAPES, type RoomShapeKey } from "./roomShapes";

const SHAPE_KEYS = Object.keys(ROOM_SHAPES) as RoomShapeKey[];
const EXPECTED_VERTEX_COUNT: Record<RoomShapeKey, number> = {
  rectangle: 4,
  "l-shape": 6,
  "u-shape": 8,
  "clipped-corner": 5,
};

describe("ROOM_SHAPES: vertex count, winding, and closure", () => {
  for (const key of SHAPE_KEYS) {
    it(`${key}: builds exactly ${EXPECTED_VERTEX_COUNT[key]} vertices, already clockwise, closed`, () => {
      const params = defaultParamsFor(key);
      const footprint = ROOM_SHAPES[key].build(params);
      expect(footprint).toHaveLength(EXPECTED_VERTEX_COUNT[key]);
      expect(isValidFootprint(footprint)).toBe(true);

      const room = createPolygonRoom(footprint, 96);
      // createPolygonRoom's winding normalization is a no-op on an already-clockwise input —
      // if this builder had the wrong winding, room.footprint would come back REVERSED here.
      expect(room.footprint).toEqual(footprint);
      // One wall per edge, closed (the last wall's end is the first vertex).
      expect(room.walls).toHaveLength(footprint.length);
      const lastWall = room.walls[room.walls.length - 1];
      const lastWallEnd = {
        x: lastWall.start.x + lastWall.dir.x * lastWall.length,
        y: lastWall.start.y + lastWall.dir.y * lastWall.length,
      };
      expect(lastWallEnd.x).toBeCloseTo(footprint[0].x, 6);
      expect(lastWallEnd.y).toBeCloseTo(footprint[0].y, 6);
    });
  }
});

describe("ROOM_SHAPES: param clamping never produces an invalid footprint", () => {
  it("l-shape: a notch far larger than the room clamps to a still-valid footprint", () => {
    const footprint = ROOM_SHAPES["l-shape"].build({ width: 100, length: 100, notchWidth: 10000, notchLength: 10000 });
    expect(isValidFootprint(footprint)).toBe(true);
  });

  it("l-shape: a zero/negative notch clamps up to at least MIN_EDGE_LENGTH", () => {
    const footprint = ROOM_SHAPES["l-shape"].build({ width: 100, length: 100, notchWidth: -50, notchLength: 0 });
    expect(isValidFootprint(footprint)).toBe(true);
  });

  it("u-shape: a notch wider than the room clamps so both remaining legs survive", () => {
    const footprint = ROOM_SHAPES["u-shape"].build({ width: 100, length: 100, notchWidth: 5000, notchLength: 5000 });
    expect(isValidFootprint(footprint)).toBe(true);
  });

  it("clipped-corner: a cut far larger than either edge clamps to a still-valid footprint", () => {
    const footprint = ROOM_SHAPES["clipped-corner"].build({ width: 60, length: 200, cut: 9999 });
    expect(isValidFootprint(footprint)).toBe(true);
  });

  it("clipped-corner: NaN/non-finite params fall back to sane defaults rather than producing garbage", () => {
    const footprint = ROOM_SHAPES["clipped-corner"].build({ width: NaN, length: NaN, cut: NaN });
    expect(isValidFootprint(footprint)).toBe(true);
  });

  it("rectangle: a tiny/negative width clamps up to MIN_ROOM_EXTENT", () => {
    const footprint = ROOM_SHAPES.rectangle.build({ width: -10, length: 0 });
    expect(isValidFootprint(footprint)).toBe(true);
  });
});

describe("defaultParamsFor", () => {
  it("returns every shape's own field defaults, keyed by field name", () => {
    expect(defaultParamsFor("rectangle")).toEqual({ width: 120, length: 144 });
    expect(defaultParamsFor("clipped-corner")).toEqual({ width: 140, length: 140, cut: 40 });
  });
});
