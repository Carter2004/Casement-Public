// filmstrip.test.ts — thumbXToWallOffset (cycle 019 Part 4): the pure mapping both the
// hover-highlight probe and the actual drop dispatch share, from a thumb-local x (already in the
// THUMB_WIDTH-unit coordinate space) to a wall offset. The Filmstrip class itself is DOM wiring
// (this project's vitest setup has no jsdom, per keymap.test.ts/statusbar.test.ts) — verified
// live in the browser instead; this pure helper is what's unit-testable.

import { describe, expect, it } from "vitest";
import { createRectangularRoom } from "../model/room";
import { thumbXToWallOffset } from "./filmstrip";

describe("thumbXToWallOffset", () => {
  it("maps the thumb's own left/right fit-transform edges to the wall's own start/end", () => {
    const room = createRectangularRoom(120, 144, 96);
    const wall = room.walls[0]; // North, length 120

    // Same fit transform thumbXToWallOffset itself computes internally (THUMB_WIDTH=96,
    // THUMB_HEIGHT=64, THUMB_PADDING=4) — derive the expected local-x bounds independently via
    // the same shared computeElevationFitTransform the thumb was drawn with, so this test can't
    // just be an unfalsifiable mirror of the implementation's own internal call.
    const scale = Math.min((96 - 4 * 2) / wall.length, (64 - 4 * 2) / room.wallHeight);
    const originX = (96 - wall.length * scale) / 2;

    expect(thumbXToWallOffset(wall, room.wallHeight, originX)).toBeCloseTo(0, 6);
    expect(thumbXToWallOffset(wall, room.wallHeight, originX + wall.length * scale)).toBeCloseTo(wall.length, 6);
    expect(thumbXToWallOffset(wall, room.wallHeight, originX + (wall.length * scale) / 2)).toBeCloseTo(
      wall.length / 2,
      6,
    );
  });

  it("clamps outside the thumb's own drawn wall span to [0, wall.length]", () => {
    const room = createRectangularRoom(120, 144, 96);
    const wall = room.walls[0];

    expect(thumbXToWallOffset(wall, room.wallHeight, -1000)).toBe(0);
    expect(thumbXToWallOffset(wall, room.wallHeight, 1000)).toBe(wall.length);
  });

  it("a longer wall gets a smaller fit scale, and still round-trips its own midpoint", () => {
    const room = createRectangularRoom(300, 144, 96);
    const wall = room.walls[0]; // North, length 300 — wider than the short-wall case above

    const scale = Math.min((96 - 4 * 2) / wall.length, (64 - 4 * 2) / room.wallHeight);
    const originX = (96 - wall.length * scale) / 2;
    expect(thumbXToWallOffset(wall, room.wallHeight, originX + (wall.length * scale) / 2)).toBeCloseTo(
      wall.length / 2,
      6,
    );
  });
});
