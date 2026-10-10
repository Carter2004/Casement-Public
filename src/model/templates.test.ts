// templates.test.ts — the galley template's wall-selection helper (cycle 017 replaced the
// rectangle-only longerOppositePair with a general parallel-facing-pair search): a regression
// bridge proving the new helper reproduces today's exact rectangle answer in every case the old
// one handled, plus coverage on the L/U/clipped-corner shapes the old one couldn't even run on.

import { describe, expect, it } from "vitest";
import { createPolygonRoom, createRectangularRoom, perimeterWalls } from "./room";
import { templateWalls } from "./templates";
import { ROOM_SHAPES } from "./roomShapes";

describe("galley template: rectangle regression bridge", () => {
  it("a wider-than-long room picks North+South (the longer pair) — same as the old width>=length rule", () => {
    const room = createRectangularRoom(200, 100, 96);
    const [a, b] = templateWalls(room, "galley");
    expect([a.id, b.id].sort()).toEqual(["wall-0", "wall-2"]); // North, South
  });

  it("a taller-than-wide room picks East+West (the longer pair) — same as the old width<length branch", () => {
    const room = createRectangularRoom(100, 200, 96);
    const [a, b] = templateWalls(room, "galley");
    expect([a.id, b.id].sort()).toEqual(["wall-1", "wall-3"]); // East, West
  });

  it("a square room ties, resolving to North+South — same as the old >= tie-break", () => {
    const room = createRectangularRoom(150, 150, 96);
    const [a, b] = templateWalls(room, "galley");
    expect([a.id, b.id].sort()).toEqual(["wall-0", "wall-2"]);
  });
});

describe("galley template: irregular shapes (cycle 017)", () => {
  it("L-shape: picks a real anti-parallel, overlapping-span pair (the full top wall + the shortened bottom-left wall)", () => {
    const footprint = ROOM_SHAPES["l-shape"].build({ width: 180, length: 180, notchWidth: 80, notchLength: 80 });
    const room = createPolygonRoom(footprint, 96);
    const [a, b] = templateWalls(room, "galley");
    expect([a.id, b.id].sort()).toEqual(["wall-0", "wall-4"]);
    assertFacingPair(a, b);
  });

  it("U-shape: picks the two long facing outer side runs, not the short notch legs", () => {
    const footprint = ROOM_SHAPES["u-shape"].build({ width: 220, length: 180, notchWidth: 80, notchLength: 90 });
    const room = createPolygonRoom(footprint, 96);
    const [a, b] = templateWalls(room, "galley");
    expect([a.id, b.id].sort()).toEqual(["wall-5", "wall-7"]);
    expect(a.length).toBeCloseTo(180, 6);
    expect(b.length).toBeCloseTo(180, 6);
    assertFacingPair(a, b);
  });

  it("clipped-corner: picks a real anti-parallel, overlapping-span pair", () => {
    const footprint = ROOM_SHAPES["clipped-corner"].build({ width: 140, length: 140, cut: 40 });
    const room = createPolygonRoom(footprint, 96);
    const [a, b] = templateWalls(room, "galley");
    expect(a.id).not.toBe(b.id);
    assertFacingPair(a, b);
  });

  it("every galley pick is always drawn from the perimeter (never an island)", () => {
    const footprint = ROOM_SHAPES["u-shape"].build({ width: 220, length: 180, notchWidth: 80, notchLength: 90 });
    const room = createPolygonRoom(footprint, 96);
    const perimeterIds = new Set(perimeterWalls(room).map((w) => w.id));
    for (const wall of templateWalls(room, "galley")) {
      expect(perimeterIds.has(wall.id)).toBe(true);
    }
  });
});

function assertFacingPair(a: { dir: { x: number; y: number } }, b: { dir: { x: number; y: number } }): void {
  const dot = a.dir.x * b.dir.x + a.dir.y * b.dir.y;
  expect(dot).toBeCloseTo(-1, 6);
}
