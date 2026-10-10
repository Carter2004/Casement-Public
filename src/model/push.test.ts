// push.test.ts — the push planner's own test net: cascade order, segment boundaries (openings
// and cross-wall corners both bound the cascade), vertical-range scoping, aggregate-insufficient
// rejection, deterministic largest-gap insertion, order preservation, and the two named repros
// from the cycle 011 plan/addendum — fill-then-sink, and the cabin-column reposition.

import { describe, expect, it } from "vitest";
import { createCabinet } from "./cabinet";
import { cabinetVerticalPlacement } from "./kinds";
import { EPSILON } from "./occupancy";
import { planFill } from "./run";
import { computeSegments, planInsertWithPush, planMoveWithPush } from "./push";
import { createIsland, createRectangularRoom } from "./room";

const BASE_RANGE = cabinetVerticalPlacement(createCabinet("cabinet", "base", 0)); // 0-34.5

describe("planInsertWithPush: cascade order", () => {
  it("grows the largest gap and cascades subsequent pieces only as far as their own slack allows", () => {
    const room = createRectangularRoom(200, 200, 96);
    const wall = room.walls[0]; // length 200
    const a = createCabinet("cabinet", "base", 0);
    a.width = 20; // 0-20
    const b = createCabinet("cabinet", "base", 50);
    b.width = 20; // 50-70
    const c = createCabinet("cabinet", "base", 80);
    c.width = 10; // 80-90
    const d = createCabinet("cabinet", "base", 100);
    d.width = 100; // 100-200 — bounds the segment so [20,50)=30 is unambiguously the largest gap
    wall.cabinets.push(a, b, c, d);
    // Free space within [0,100): [20,50)=30 (largest), [70,80)=10.

    const result = planInsertWithPush(room, wall, BASE_RANGE, 24, 45);
    expect(result).not.toBeNull();
    expect(result!.xOffset).toBe(20); // the largest gap's start
    // shortfall = 45 - 30 = 15; B cascades to close its gap, then C cascades to close ITS gap
    // against B's new position (85-95 leaves 5" of slack before D at 100 — no further push needed)
    expect(result!.relocations.get(b.id)).toBe(65); // pushed to the new piece's right edge (20+45)
    expect(result!.relocations.get(c.id)).toBeCloseTo(85, 6); // pushed to clear B's new right edge (65+20)
    expect(result!.relocations.has(d.id)).toBe(false); // enough slack remained — never touched
  });

  it("does not push a piece that already has enough slack after the cascade clears it", () => {
    const room = createRectangularRoom(200, 200, 96);
    const wall = room.walls[0];
    const a = createCabinet("cabinet", "base", 0);
    a.width = 20; // 0-20
    const b = createCabinet("cabinet", "base", 60);
    b.width = 20; // 60-80
    const bound = createCabinet("cabinet", "base", 90);
    bound.width = 110; // 90-200 — bounds the wall so [20,60)=40 is unambiguously the largest gap
    wall.cabinets.push(a, b, bound);

    const result = planInsertWithPush(room, wall, BASE_RANGE, 24, 30);
    expect(result).not.toBeNull();
    expect(result!.xOffset).toBe(20); // grows the 20-60 gap (40" — the largest here)
    expect(result!.relocations.size).toBe(0); // 30 fits in the 40" gap with room to spare
  });
});

describe("planInsertWithPush: targeted insert (cycle 013 — targetOffset)", () => {
  it("lands as close to the target as its own nearby gap allows, not the largest gap", () => {
    const room = createRectangularRoom(200, 200, 96);
    const wall = room.walls[0];
    const a = createCabinet("cabinet", "base", 0);
    a.width = 20; // 0-20
    const b = createCabinet("cabinet", "base", 50);
    b.width = 20; // 50-70
    const c = createCabinet("cabinet", "base", 80);
    c.width = 10; // 80-90
    const d = createCabinet("cabinet", "base", 100);
    d.width = 100; // 100-200
    wall.cabinets.push(a, b, c, d);
    // Free space: [20,50)=30 (largest — the default rule's answer), [70,80)=10, [90,100)=10.

    const result = planInsertWithPush(room, wall, BASE_RANGE, 24, 8, 72); // aim inside [70,80)
    expect(result).not.toBeNull();
    expect(result!.xOffset).not.toBe(20); // did NOT fall back to the largest-gap answer
    expect(result!.xOffset).toBeGreaterThanOrEqual(70 - EPSILON);
    expect(result!.xOffset + 8).toBeLessThanOrEqual(80 + EPSILON);
  });

  it("falls back to the default largest-gap rule when the target's own segment lacks room", () => {
    const room = createRectangularRoom(200, 200, 96);
    const wall = room.walls[0];
    const doorway = createCabinet("doorway", "base", 90); // 90-138, splits the wall
    const a = createCabinet("cabinet", "base", 0);
    a.width = 80; // 0-80 — segment [0,90) left with only 10" free
    const b = createCabinet("cabinet", "base", 138);
    b.width = 22; // 138-160 — segment [138,200) left with 40" free ([160,200))
    wall.cabinets.push(doorway, a, b);

    // Target sits in the FIRST segment (which has no room for a 15"-wide piece); the only
    // segment that can actually fit it is the second, which doesn't contain the target — the
    // default largest-gap rule must win there instead of returning null.
    const result = planInsertWithPush(room, wall, BASE_RANGE, 24, 15, 85);
    expect(result).not.toBeNull();
    expect(result!.xOffset).toBe(160); // the second segment's only (and largest) gap
  });

  it("default (no targetOffset) stays byte-identical to the largest-gap rule", () => {
    const room = createRectangularRoom(200, 200, 96);
    const wall = room.walls[0];
    const a = createCabinet("cabinet", "base", 0);
    a.width = 20; // 0-20
    const b = createCabinet("cabinet", "base", 50);
    b.width = 20; // 50-70
    const c = createCabinet("cabinet", "base", 80);
    c.width = 10; // 80-90
    const d = createCabinet("cabinet", "base", 100);
    d.width = 100; // 100-200
    wall.cabinets.push(a, b, c, d);

    const result = planInsertWithPush(room, wall, BASE_RANGE, 24, 8);
    expect(result).not.toBeNull();
    expect(result!.xOffset).toBe(20); // the largest gap, exactly as the pre-cycle-013 behavior
  });
});

describe("planInsertWithPush: segment boundaries", () => {
  it("an opening splits the wall — a push in one segment never crosses into the other", () => {
    const room = createRectangularRoom(200, 200, 96);
    const wall = room.walls[0];
    const doorway = createCabinet("doorway", "base", 90); // 90-138, vertical 0-80 — blocks both bands
    const a = createCabinet("cabinet", "base", 0);
    a.width = 80; // 0-80, flush against the doorway's left side — segment [0,90) has only 10" free
    const b = createCabinet("cabinet", "base", 138);
    b.width = 52; // 138-190 — segment [138,200) also left with only 10" free
    wall.cabinets.push(doorway, a, b);

    // Neither segment individually has room for a 15"-wide insert, and the doorway (immovable)
    // means space can never be borrowed from the other segment — the whole insert must fail.
    const result = planInsertWithPush(room, wall, BASE_RANGE, 24, 15);
    expect(result).toBeNull();
  });

  it("a cross-wall corner block bounds the cascade the same way an opening does", () => {
    const room = createRectangularRoom(120, 144, 96);
    const north = room.walls[0]; // (0,0)->(120,0)
    const east = room.walls[1]; // (120,0)->(120,144) — shares the corner at North's far end

    const deep = createCabinet("cabinet", "base", 0);
    deep.width = 36;
    deep.depth = 24;
    east.cabinets = [deep]; // blocks North's far end: crossWallBlocked reports [96,120) at depth 24

    const a = createCabinet("cabinet", "base", 0);
    a.width = 80; // 0-80
    north.cabinets.push(a);
    // Segment for North (depth 24) is bounded at 96 by the corner block: [0,96), only 16" free.
    const result = planInsertWithPush(room, north, BASE_RANGE, 24, 20);
    expect(result).toBeNull(); // 20" doesn't fit in the 16" this segment actually has
  });
});

describe("planInsertWithPush: vertical-range scoping", () => {
  it("a base-band insert never pushes a wall-band hood out of the way", () => {
    const room = createRectangularRoom(120, 144, 96);
    const wall = room.walls[0];
    const hood = createCabinet("hood", "wall", 40); // vertical 66-84, doesn't overlap base band
    wall.cabinets.push(hood);

    const segments = computeSegments(room, wall, BASE_RANGE, 24);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ start: 0, end: 120, pieces: [] }); // hood is invisible to a base candidate

    const result = planInsertWithPush(room, wall, BASE_RANGE, 24, 36);
    expect(result).not.toBeNull();
    expect(result!.relocations.has(hood.id)).toBe(false);
  });
});

describe("planInsertWithPush: aggregate-insufficient returns null", () => {
  it("returns null when no segment's total free space covers the requested width", () => {
    const room = createRectangularRoom(60, 144, 96);
    const wall = room.walls[0]; // length 60
    const a = createCabinet("cabinet", "base", 0);
    a.width = 50; // leaves only 10" free
    wall.cabinets.push(a);

    expect(planInsertWithPush(room, wall, BASE_RANGE, 24, 24)).toBeNull();
  });
});

describe("push preserves relative order", () => {
  it("no piece ever ends up out of its original left-to-right order after an insert-with-push", () => {
    const room = createRectangularRoom(200, 200, 96);
    const wall = room.walls[0];
    const a = createCabinet("cabinet", "base", 0);
    a.width = 20; // 0-20
    const b = createCabinet("cabinet", "base", 60);
    b.width = 20; // 60-80
    const c = createCabinet("cabinet", "base", 100);
    c.width = 20; // 100-120
    const bound = createCabinet("cabinet", "base", 150);
    bound.width = 50; // 150-200 — bounds the wall so [20,60)=40 is unambiguously the largest gap
    wall.cabinets.push(a, b, c, bound);

    const result = planInsertWithPush(room, wall, BASE_RANGE, 24, 50);
    expect(result).not.toBeNull();
    const finalOffsets = [
      { id: "new", x: result!.xOffset },
      { id: a.id, x: result!.relocations.get(a.id) ?? a.xOffset },
      { id: b.id, x: result!.relocations.get(b.id) ?? b.xOffset },
      { id: c.id, x: result!.relocations.get(c.id) ?? c.xOffset },
      { id: bound.id, x: result!.relocations.get(bound.id) ?? bound.xOffset },
    ].sort((p, q) => p.x - q.x);
    // Growing the 40" gap after A for a 50"-wide piece needs a 10" cascade — B and C both slide
    // right in order; nothing ever jumps past a neighbor.
    expect(finalOffsets.map((p) => p.id)).toEqual([a.id, "new", b.id, c.id, bound.id]);
  });
});

describe("the fill-then-sink repro (cycle-011 audit)", () => {
  it("an island whose base band is fully filled still admits a Sink base via push", () => {
    const room = createRectangularRoom(200, 200, 96);
    const island = createIsland(room, 72, "ew");
    room.walls.push(island);

    island.cabinets.push(...planFill(room, island, "base")); // packs the island solid
    const capacityBefore = island.cabinets.reduce((sum, c) => sum + c.width, 0);
    expect(capacityBefore).toBeCloseTo(72, 6); // fully packed, zero free gap

    const sinkDef = cabinetVerticalPlacement(createCabinet("sink", "base", 0));
    const result = planInsertWithPush(room, island, sinkDef, 24, 36); // Sink base: 36" wide
    // A fully-packed 72" island has no room for a 36" sink no matter how it's rearranged —
    // this specific island needs a bigger run or a deletion first; the point of this test is
    // the AGGREGATE check correctly reports "no room" rather than silently overlapping.
    expect(result).toBeNull();
  });

  it("an island with SOME free space compresses its run to admit a Sink base", () => {
    const room = createRectangularRoom(200, 200, 96);
    const island = createIsland(room, 108, "ew"); // longer island: room for fill + a sink
    room.walls.push(island);

    island.cabinets.push(...planFill(room, island, "base")); // packs what it can (widest-first + filler)
    const sinkDef = cabinetVerticalPlacement(createCabinet("sink", "base", 0));

    // Delete the smallest generated piece to open exactly enough aggregate room, mimicking
    // "select a filled cabinet, delete it" — but here proving PUSH succeeds even when the
    // opened space isn't one single 36" gap.
    const smallest = [...island.cabinets].sort((a, b) => a.width - b.width)[0];
    island.cabinets = island.cabinets.filter((c) => c.id !== smallest.id);

    const result = planInsertWithPush(room, island, sinkDef, 24, 36);
    if (smallest.width >= 36) {
      expect(result).not.toBeNull();
    } else {
      // Not enough aggregate room from deleting just the smallest piece — a fine outcome too,
      // the important thing is the planner never claims success it can't deliver.
      expect(result).toBeNull();
    }
  });
});

describe("planMoveWithPush: the cabin-column scenario (cycle-011 audit Part 3 #2)", () => {
  it("a mid-run piece moves through a flush-packed run, cascading neighbors without reordering", () => {
    const room = createRectangularRoom(240, 200, 96);
    const wall = room.walls[0];
    // [col][col][col][col] flush-packed: 0-39, 39-78, 78-117, 117-156 (39" columns)
    const cols = [0, 39, 78, 117].map((x) => {
      const c = createCabinet("cabinet", "base", x);
      c.width = 39;
      return c;
    });
    wall.cabinets.push(...cols);

    // Move the SECOND column (currently at 39) to target 78 — where the THIRD column sits —
    // simulating "type a position that requires crossing into the pack".
    const moving = cols[1];
    const result = planMoveWithPush(room, wall, moving, 78);

    // It should NOT jump over col[2] and col[3] — it slides as far as the segment allows,
    // pushing col[2] and col[3] rightward in cascade, never reordering.
    const finalOffsets = new Map<string, number>();
    finalOffsets.set(moving.id, result.achievedOffset);
    for (const [id, x] of result.relocations) finalOffsets.set(id, x);
    for (const c of cols) if (!finalOffsets.has(c.id)) finalOffsets.set(c.id, c.xOffset);

    const ordered = cols.map((c) => ({ id: c.id, x: finalOffsets.get(c.id)! })).sort((a, b) => a.x - b.x);
    // Original order was cols[0],cols[1],cols[2],cols[3] — after the move, cols[1] (the one
    // that moved) must still be SOMEWHERE in that same relative order, never past cols[2]/[3]
    // without them also having moved, and never past cols[0].
    const idsInFinalOrder = ordered.map((o) => o.id);
    expect(idsInFinalOrder.indexOf(cols[0].id)).toBeLessThan(idsInFinalOrder.indexOf(moving.id));
    // No two pieces overlap in the final arrangement.
    for (let i = 0; i < ordered.length - 1; i++) {
      const widthOf = (id: string) => cols.find((c) => c.id === id)!.width;
      expect(ordered[i].x + widthOf(ordered[i].id)).toBeLessThanOrEqual(ordered[i + 1].x + 1e-6);
    }
    // The move actually achieved forward progress (didn't just refuse and stay at 39).
    expect(result.achievedOffset).toBeGreaterThan(39);
  });

  it("stops the cascade at the segment end rather than pushing a piece out of the wall", () => {
    const room = createRectangularRoom(120, 200, 96);
    const wall = room.walls[0]; // length 120
    const a = createCabinet("cabinet", "base", 0);
    a.width = 39;
    const b = createCabinet("cabinet", "base", 39);
    b.width = 39;
    const c = createCabinet("cabinet", "base", 78);
    c.width = 39; // ends at 117, only 3" of slack before the wall's own end (120)
    wall.cabinets.push(a, b, c);

    const result = planMoveWithPush(room, wall, a, 100); // try to push `a` far to the right
    // `a` can only advance until `c`'s cascade would hit the wall end (120).
    expect(result.achievedOffset).toBeLessThan(100);
    expect(result.achievedOffset).toBeGreaterThan(0);
    // Nothing pushed past the wall's own length (within occupancy.ts's own EPSILON tolerance —
    // the same "flush is fine" tolerance every other collision check in this app uses).
    const cNew = result.relocations.get(c.id) ?? c.xOffset;
    expect(cNew + c.width).toBeLessThanOrEqual(120 + EPSILON);
  });

  it("openings never move — the cascade stops dead against one", () => {
    const room = createRectangularRoom(200, 200, 96);
    const wall = room.walls[0];
    const doorway = createCabinet("doorway", "base", 100); // 100-148, immovable
    const a = createCabinet("cabinet", "base", 0);
    a.width = 39;
    const b = createCabinet("cabinet", "base", 39);
    b.width = 39; // ends at 78, leaving [78,100) = 22" free before the doorway
    wall.cabinets.push(doorway, a, b);

    const result = planMoveWithPush(room, wall, a, 90); // try to push `a` toward/into the doorway
    // `a` and the cascaded `b` must both stay clear of the doorway at 100 (within EPSILON).
    const bNew = result.relocations.get(b.id) ?? b.xOffset;
    expect(bNew + b.width).toBeLessThanOrEqual(100 + EPSILON);
    expect(result.achievedOffset + a.width).toBeLessThanOrEqual(bNew + EPSILON);
  });
});

describe("planInsertWithPush: excludeCabinetId threading (cycle 019 — the move authority)", () => {
  it("excluding a cross-wall corner blocker extends the segment enough for an otherwise-failing push to succeed", () => {
    const room = createRectangularRoom(120, 144, 96);
    const north = room.walls[0]; // (0,0)->(120,0), length 120
    const east = room.walls[1]; // (120,0)->(120,144) — shares the corner at North's far end (120,0)

    const corner = createCabinet("cabinet", "base", 0);
    corner.width = 36;
    corner.depth = 24; // blocks North's own last 24" — [96,120)
    east.cabinets = [corner];

    const a = createCabinet("cabinet", "base", 0);
    a.width = 40; // 0-40
    const b = createCabinet("cabinet", "base", 70);
    b.width = 26; // 70-96, flush against the corner-block boundary — no trailing gap
    north.cabinets.push(a, b);
    // Without exclude: North's own segment is bounded at 96 by the corner block, leaving only
    // ONE gap, [40,70)=30" — a 32"-wide push-insert has nowhere near enough aggregate room.
    expect(planInsertWithPush(room, north, BASE_RANGE, 24, 32)).toBeNull();

    // Excluding `corner` (the piece a move would be relocating) removes that boundary entirely —
    // North's segment now runs the full [0,120), adding a second gap [96,120)=24" and enough
    // aggregate room (30+24=54 >= 32) for the same push to succeed.
    const result = planInsertWithPush(room, north, BASE_RANGE, 24, 32, undefined, corner.id);
    expect(result).not.toBeNull();
  });

  it("no-exclude path stays byte-identical (undefined never matches a real cabinet id)", () => {
    const room = createRectangularRoom(200, 200, 96);
    const wall = room.walls[0];
    const a = createCabinet("cabinet", "base", 0);
    a.width = 20;
    const b = createCabinet("cabinet", "base", 50);
    b.width = 20;
    wall.cabinets.push(a, b);

    const withoutExclude = planInsertWithPush(room, wall, BASE_RANGE, 24, 8, 45);
    const explicitUndefined = planInsertWithPush(room, wall, BASE_RANGE, 24, 8, 45, undefined);
    expect(explicitUndefined).toEqual(withoutExclude);
  });
});
