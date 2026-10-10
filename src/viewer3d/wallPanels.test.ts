// wallPanels.test.ts — the required cases from the cycle 010 plan: no openings, a door
// (2 sides + header), a window (4 panels), multiple openings, edge-touching, and the area
// invariant (total panel area = wall area minus every opening's area).

import { describe, expect, it } from "vitest";
import { computeWallPanels, type WallPanel } from "./wallPanels";

function area(panels: WallPanel[]): number {
  return panels.reduce((sum, p) => sum + (p.x1 - p.x0) * (p.y1 - p.y0), 0);
}

describe("computeWallPanels", () => {
  it("returns one full panel when there are no openings", () => {
    const panels = computeWallPanels(120, 96, []);
    expect(panels).toEqual([{ x0: 0, y0: 0, x1: 120, y1: 96 }]);
  });

  it("a door (floor to head, not touching either wall end) yields 2 side panels + a header", () => {
    // door: 36-72 along the wall, vertical 0-80, wall 120x96
    const panels = computeWallPanels(120, 96, [{ start: 36, end: 72, bottom: 0, top: 80 }]);
    expect(panels).toHaveLength(3);
    expect(panels).toContainEqual({ x0: 0, y0: 0, x1: 36, y1: 96 }); // left, full height
    expect(panels).toContainEqual({ x0: 72, y0: 0, x1: 120, y1: 96 }); // right, full height
    expect(panels).toContainEqual({ x0: 36, y0: 80, x1: 72, y1: 96 }); // header above the door
    expect(area(panels)).toBeCloseTo(120 * 96 - 36 * 80, 6);
  });

  it("a window (sill to head, not touching floor/ceiling/either end) yields 4 panels", () => {
    // window: 40-76 along the wall, vertical 42-78, wall 120x96
    const panels = computeWallPanels(120, 96, [{ start: 40, end: 76, bottom: 42, top: 78 }]);
    expect(panels).toHaveLength(4);
    expect(panels).toContainEqual({ x0: 0, y0: 0, x1: 40, y1: 96 }); // left
    expect(panels).toContainEqual({ x0: 76, y0: 0, x1: 120, y1: 96 }); // right
    expect(panels).toContainEqual({ x0: 40, y0: 0, x1: 76, y1: 42 }); // below the sill
    expect(panels).toContainEqual({ x0: 40, y0: 78, x1: 76, y1: 96 }); // above the head
    expect(area(panels)).toBeCloseTo(120 * 96 - 36 * 36, 6);
  });

  it("multiple non-overlapping openings on one wall compose correctly", () => {
    const door = { start: 10, end: 40, bottom: 0, top: 80 };
    const window = { start: 70, end: 100, bottom: 42, top: 78 };
    const panels = computeWallPanels(150, 96, [door, window]);
    const totalOpeningArea = (40 - 10) * (80 - 0) + (100 - 70) * (78 - 42);
    expect(area(panels)).toBeCloseTo(150 * 96 - totalOpeningArea, 6);
    // no panel should overlap another — spot check a couple of expected pieces exist
    expect(panels).toContainEqual({ x0: 40, y0: 0, x1: 70, y1: 96 }); // between door and window
    expect(panels).toContainEqual({ x0: 10, y0: 80, x1: 40, y1: 96 }); // door's header
  });

  it("an opening flush with the wall's start has no left panel", () => {
    const panels = computeWallPanels(100, 96, [{ start: 0, end: 36, bottom: 0, top: 80 }]);
    expect(panels).toHaveLength(2); // right + header only, no left sliver
    expect(panels).toContainEqual({ x0: 36, y0: 0, x1: 100, y1: 96 });
    expect(panels).toContainEqual({ x0: 0, y0: 80, x1: 36, y1: 96 });
  });

  it("an opening whose head reaches the ceiling has no header panel", () => {
    const panels = computeWallPanels(100, 96, [{ start: 20, end: 56, bottom: 0, top: 96 }]);
    expect(panels).toHaveLength(2); // left + right only, no header sliver
    expect(panels).toContainEqual({ x0: 0, y0: 0, x1: 20, y1: 96 });
    expect(panels).toContainEqual({ x0: 56, y0: 0, x1: 100, y1: 96 });
  });

  it("total panel area always equals wall area minus opening area (door + window combined case)", () => {
    const door = { start: 0, end: 36, bottom: 0, top: 80 };
    const window = { start: 60, end: 96, bottom: 42, top: 78 };
    const panels = computeWallPanels(120, 96, [door, window]);
    const openingArea = 36 * 80 + 36 * 36;
    expect(area(panels)).toBeCloseTo(120 * 96 - openingArea, 6);
  });
});
