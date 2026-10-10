// snapping.test.ts — snapCandidates + resolveSnap (cycle 019 Part 5): wall-center, cross-band
// edge-alignment, the exclude-self idiom, and resolveSnap's threshold/nearest-wins contract.

import { describe, expect, it } from "vitest";
import { createCabinet } from "./cabinet";
import { createRectangularRoom } from "./room";
import { resolveSnap, SNAP_THRESHOLD_PX, snapCandidates } from "./snapping";

// resolveSnap's threshold is now REQUIRED (cycle 020 Part 2) — model inches, already converted
// from SNAP_THRESHOLD_PX by a caller's own live scale. These pre-existing assertions keep the
// SAME semantic threshold (1.5") the old inches-flavored default used, just passed explicitly.
const THRESHOLD_IN = 1.5;

describe("snapCandidates", () => {
  it("offers the wall-centering candidate even with no other pieces on the wall", () => {
    const room = createRectangularRoom(120, 144, 96);
    const wall = room.walls[0]; // length 120
    const candidates = snapCandidates(wall, 24);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].offset).toBeCloseTo((120 - 24) / 2, 6);
    expect(candidates[0].guideAt).toBeCloseTo(60, 6);
  });

  it("offers all four edge alignments against a neighbor, cross-band (a wall cabinet against a base)", () => {
    const room = createRectangularRoom(200, 200, 96);
    const wall = room.walls[0];
    const base = createCabinet("cabinet", "base", 40);
    base.width = 30; // occupies [40, 70)
    wall.cabinets.push(base);

    // A WALL-band piece (different band entirely) still gets candidates against it — band never
    // gates a candidate, per the plan's own "cross-band included" decision.
    const candidates = snapCandidates(wall, 24);
    const offsets = candidates.map((c) => c.offset);
    expect(offsets).toContainEqual(40); // left -> neighbor's left
    expect(offsets).toContainEqual(70); // left -> neighbor's right (flush-after)
    expect(offsets).toContainEqual(40 - 24); // right -> neighbor's left (flush-before)
    expect(offsets).toContainEqual(70 - 24); // right -> neighbor's right
  });

  it("excludes the piece being dragged itself from its own candidate set", () => {
    const room = createRectangularRoom(200, 200, 96);
    const wall = room.walls[0];
    const dragged = createCabinet("cabinet", "base", 40);
    dragged.width = 24;
    wall.cabinets.push(dragged);

    const candidates = snapCandidates(wall, 24, dragged.id);
    // Only the wall-center candidate remains — the dragged piece contributed no edges to itself.
    expect(candidates).toHaveLength(1);
  });
});

describe("resolveSnap", () => {
  const candidates = [
    { offset: 40, guideAt: 40 },
    { offset: 100, guideAt: 100 },
  ];

  it("snaps to the nearest candidate within threshold", () => {
    const result = resolveSnap(41, candidates, THRESHOLD_IN);
    expect(result?.offset).toBe(40);
  });

  it("returns null when nothing is within threshold", () => {
    const result = resolveSnap(70, candidates, THRESHOLD_IN);
    expect(result).toBeNull();
  });

  it("respects the exact threshold boundary", () => {
    expect(resolveSnap(40 + THRESHOLD_IN, candidates, THRESHOLD_IN)?.offset).toBe(40);
    expect(resolveSnap(40 + THRESHOLD_IN + 0.01, candidates, THRESHOLD_IN)).toBeNull();
  });

  it("returns null given an empty candidate list", () => {
    expect(resolveSnap(50, [], THRESHOLD_IN)).toBeNull();
  });
});

describe("resolveSnap — pixel-constant threshold (cycle 020 Part 2)", () => {
  const candidates = [{ offset: 40, guideAt: 40 }];

  it("at 2px/in (fit-zoom-ish scale), an 8px threshold snaps within 4\" but not beyond", () => {
    const scale = 2;
    const threshold = SNAP_THRESHOLD_PX / scale; // 4"
    expect(resolveSnap(44, candidates, threshold)?.offset).toBe(40);
    expect(resolveSnap(44.01, candidates, threshold)).toBeNull();
  });

  it("at 16px/in (zoomed-in scale), the SAME 8px threshold is a tighter 0.5\" in model space", () => {
    const scale = 16;
    const threshold = SNAP_THRESHOLD_PX / scale; // 0.5"
    expect(resolveSnap(40.5, candidates, threshold)?.offset).toBe(40);
    expect(resolveSnap(40.51, candidates, threshold)).toBeNull();
  });
});
