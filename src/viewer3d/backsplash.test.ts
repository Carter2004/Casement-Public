// backsplash.test.ts — computeBacksplashSpans: no base pieces (no backsplash), a single base
// run, multiple runs with a gap between them, a window punching a hole through, an opening
// outside the gap band (no punch), and doors/appliances not counted as "base run."

import { describe, expect, it } from "vitest";
import { createCabinet } from "./../model/cabinet";
import { createRectangularRoom } from "../model/room";
import { computeBacksplashSpans } from "./backsplash";

describe("computeBacksplashSpans", () => {
  it("returns no spans when the wall has no base-band pieces", () => {
    const room = createRectangularRoom(120, 144, 96);
    expect(computeBacksplashSpans(room.walls[0])).toEqual([]);
  });

  it("a single base cabinet run yields one span matching its extent", () => {
    const room = createRectangularRoom(120, 144, 96);
    const wall = room.walls[0];
    wall.cabinets.push(createCabinet("cabinet", "base", 0)); // 0-24 (default width)
    expect(computeBacksplashSpans(wall)).toEqual([{ start: 0, end: 24 }]);
  });

  it("two separated base runs yield two separate spans, not one bridging them", () => {
    const room = createRectangularRoom(200, 144, 96);
    const wall = room.walls[0];
    const a = createCabinet("cabinet", "base", 0);
    a.width = 24; // 0-24
    const b = createCabinet("cabinet", "base", 60);
    b.width = 24; // 60-84 — an untouched 36" gap between the two runs
    wall.cabinets.push(a, b);
    expect(computeBacksplashSpans(wall)).toEqual([
      { start: 0, end: 24 },
      { start: 60, end: 84 },
    ]);
  });

  it("a window sitting in the gap band punches a real hole through the backsplash", () => {
    const room = createRectangularRoom(200, 144, 96);
    const wall = room.walls[0];
    const run = createCabinet("cabinet", "base", 0);
    run.width = 100; // 0-100, one long base run
    const window = createCabinet("window", "wall", 40); // 40-76 (default width 36), sill 42-78
    wall.cabinets.push(run, window);

    expect(computeBacksplashSpans(wall)).toEqual([
      { start: 0, end: 40 },
      { start: 76, end: 100 },
    ]);
  });

  it("an opening whose vertical range does NOT overlap the gap band leaves the backsplash whole", () => {
    const room = createRectangularRoom(200, 144, 96);
    const wall = room.walls[0];
    const run = createCabinet("cabinet", "base", 0);
    run.width = 100;
    // A door shrunk to 0-20" sits entirely BELOW the gap band (36-54") — it's still an opening
    // kind, but must not punch a hole it never vertically occupies.
    const door = createCabinet("door", "base", 40);
    door.height = 20;
    wall.cabinets.push(run, door);

    expect(computeBacksplashSpans(wall)).toEqual([{ start: 0, end: 100 }]);
  });

  it("a doorway punches through exactly like a window (any opening in the band, not just windows)", () => {
    const room = createRectangularRoom(200, 144, 96);
    const wall = room.walls[0];
    const run = createCabinet("cabinet", "base", 0);
    run.width = 100;
    const doorway = createCabinet("doorway", "base", 30); // 30-78, vertical 0-80 — overlaps the gap band
    wall.cabinets.push(run, doorway);

    expect(computeBacksplashSpans(wall)).toEqual([
      { start: 0, end: 30 },
      { start: 78, end: 100 },
    ]);
  });

  it("a wall-band cabinet (upper) does not itself count as a base run", () => {
    const room = createRectangularRoom(120, 144, 96);
    const wall = room.walls[0];
    wall.cabinets.push(createCabinet("cabinet", "wall", 0));
    expect(computeBacksplashSpans(wall)).toEqual([]);
  });
});
