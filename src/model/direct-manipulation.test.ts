// direct-manipulation.test.ts — cycle 013's model-level test net: addCabinetAt (direct clamp,
// push fallback, honest failure, canPlaceOn), resizeCabinetEdge (all three edges' clamps), island
// end-resize (both handles, orphan + placement rules), and dragCabinet's push flag routing
// through the same cascade moveCabinet already uses. Exercises the STORE's own methods (not
// push.ts/occupancy.ts directly — those have their own test files), so selection/checkpoint side
// effects are covered too, not just the underlying math. Every scenario builds its own precise
// geometry by pushing Cabinet objects straight onto the store's live room (the same setup style
// push.test.ts uses for raw Room objects), since the store's own add/fill methods don't offer the
// exact placements these clamp tests need.

import { beforeEach, describe, expect, it } from "vitest";
import { createCabinet, MIN_DIMENSION } from "./cabinet";
import { EPSILON } from "./occupancy";
import { createIsland } from "./room";
import { store } from "./store";

describe("addCabinetAt: direct placement", () => {
  beforeEach(() => {
    store.setRoom(200, 200, 96);
  });

  it("clamps into the nearest free gap containing the drop point", () => {
    const room = store.getState().room!;
    const wall = room.walls[0]; // length 200
    const a = createCabinet("cabinet", "base", 0);
    a.width = 20; // 0-20
    const b = createCabinet("cabinet", "base", 60);
    b.width = 20; // 60-80
    wall.cabinets.push(a, b);
    // Free gaps: [20,60)=40, [80,200)=120.

    const outcome = store.addCabinetAt("cabinet", "base", 24, wall.id, 30); // aimed inside [20,60)
    expect(outcome.achieved).toBe(true);
    const placed = wall.cabinets.find((c) => c.id !== a.id && c.id !== b.id)!;
    expect(placed.xOffset).toBeCloseTo(30, 6); // fits at the aimed point, no clamping needed
  });

  it("clamps to the gap's own bounds when the drop point leaves no slack", () => {
    const room = store.getState().room!;
    const wall = room.walls[0];
    const a = createCabinet("cabinet", "base", 0);
    a.width = 20; // 0-20
    const b = createCabinet("cabinet", "base", 44);
    b.width = 20; // 44-64, leaving [20,44)=24 free — exactly a 24"-wide piece, no slack
    wall.cabinets.push(a, b);

    const outcome = store.addCabinetAt("cabinet", "base", 24, wall.id, 40); // aimed near the gap's right edge
    expect(outcome.achieved).toBe(true);
    const placed = wall.cabinets.find((c) => c.id !== a.id && c.id !== b.id)!;
    expect(placed.xOffset).toBeCloseTo(20, 6); // only one position fits the 24" gap exactly
  });

  it("selects the newly dropped piece", () => {
    const room = store.getState().room!;
    const wall = room.walls[0];
    store.addCabinetAt("cabinet", "base", 24, wall.id, 10);
    const selectedId = store.getState().selectedCabinetId;
    expect(selectedId).not.toBeNull();
    expect(wall.cabinets.some((c) => c.id === selectedId)).toBe(true);
  });
});

describe("addCabinetAt: push fallback", () => {
  beforeEach(() => {
    store.setRoom(200, 200, 96);
  });

  it("falls back to a targeted push when no plain gap anywhere on the wall fits", () => {
    const room = store.getState().room!;
    const wall = room.walls[0]; // length 200
    const a = createCabinet("cabinet", "base", 0);
    a.width = 40; // 0-40
    const b = createCabinet("cabinet", "base", 50);
    b.width = 40; // 50-90 — leaves [40,50)=10 free
    const c = createCabinet("cabinet", "base", 100);
    c.width = 40; // 100-140 — leaves [90,100)=10 free
    const d = createCabinet("cabinet", "base", 140);
    d.width = 60; // 140-200 — no trailing free space either
    wall.cabinets.push(a, b, c, d);
    // Only fragmented 10"+10" free space exists — no single plain gap fits a 20" piece anywhere.

    const outcome = store.addCabinetAt("cabinet", "base", 20, wall.id, 45); // aimed at the first 10" gap
    expect(outcome.achieved).toBe(true);
    const placed = wall.cabinets.find((cab) => cab.id !== a.id && cab.id !== b.id && cab.id !== c.id && cab.id !== d.id)!;
    expect(placed.xOffset).toBeCloseTo(40, 6); // lands at the target's gap, not the far tail
    expect(b.xOffset).toBeGreaterThan(50 - EPSILON); // b cascaded right to make room
  });
});

describe("addCabinetAt: honest failure", () => {
  beforeEach(() => {
    store.setRoom(60, 200, 96);
  });

  it("lands nothing and reports a reason when neither a plain gap nor a push works", () => {
    const room = store.getState().room!;
    const wall = room.walls[0]; // length 60
    const a = createCabinet("cabinet", "base", 0);
    a.width = 50; // leaves only 10" free — nowhere for a 24" piece even with push
    wall.cabinets.push(a);

    const before = wall.cabinets.length;
    const outcome = store.addCabinetAt("cabinet", "base", 24, wall.id, 55);
    expect(outcome.achieved).toBe(false);
    expect(outcome.reason).toBeTruthy();
    expect(wall.cabinets.length).toBe(before); // nothing landed
  });
});

describe("addCabinetAt: canPlaceOn guard", () => {
  beforeEach(() => {
    store.setRoom(200, 200, 96);
  });

  it("refuses to drop a wall cabinet onto an island", () => {
    const room = store.getState().room!;
    const island = createIsland(room, 72, "ew");
    room.walls.push(island);

    const outcome = store.addCabinetAt("cabinet", "wall", 24, island.id, 10);
    expect(outcome.achieved).toBe(false);
    expect(island.cabinets.length).toBe(0);
  });

  it("still allows a base cabinet onto an island", () => {
    const room = store.getState().room!;
    const island = createIsland(room, 72, "ew");
    room.walls.push(island);

    const outcome = store.addCabinetAt("cabinet", "base", 24, island.id, 10);
    expect(outcome.achieved).toBe(true);
    expect(island.cabinets.length).toBe(1);
  });
});

describe("resizeCabinetEdge", () => {
  beforeEach(() => {
    store.setRoom(200, 200, 96);
  });

  it("right edge: grows/shrinks width, clamped flush against a neighbor", () => {
    const room = store.getState().room!;
    const wall = room.walls[0];
    const a = createCabinet("cabinet", "base", 0);
    a.width = 24;
    const b = createCabinet("cabinet", "base", 60);
    b.width = 20;
    wall.cabinets.push(a, b);

    const grown = store.resizeCabinetEdge(a.id, "right", 40); // right edge to x=40 -> width 40
    expect(grown.achieved).toBe(true);
    expect(a.width).toBeCloseTo(40, 6);
    expect(a.xOffset).toBeCloseTo(0, 6); // xOffset untouched

    const overshoot = store.resizeCabinetEdge(a.id, "right", 90); // would overlap b at 60
    expect(overshoot.achieved).toBe(false);
    expect(a.width).toBeCloseTo(60, 6); // clamped flush against b
  });

  it("left edge: xOffset and width change together, right edge pinned", () => {
    const room = store.getState().room!;
    const wall = room.walls[0];
    const a = createCabinet("cabinet", "base", 40);
    a.width = 24; // 40-64
    const b = createCabinet("cabinet", "base", 10);
    b.width = 10; // 10-20 — bounds the left drag
    wall.cabinets.push(a, b);

    const rightEdgeBefore = a.xOffset + a.width;
    const outcome = store.resizeCabinetEdge(a.id, "left", 30); // drag left edge to x=30
    expect(outcome.achieved).toBe(true);
    expect(a.xOffset).toBeCloseTo(30, 6);
    expect(a.xOffset + a.width).toBeCloseTo(rightEdgeBefore, 6); // right edge stayed put

    const overshoot = store.resizeCabinetEdge(a.id, "left", 5); // past b's right edge (20)
    expect(overshoot.achieved).toBe(false);
    expect(a.xOffset).toBeCloseTo(20, 6); // clamped to the gap's start
    expect(a.xOffset + a.width).toBeCloseTo(rightEdgeBefore, 6); // right edge still pinned
  });

  it("left edge: never shrinks the width below MIN_DIMENSION", () => {
    const room = store.getState().room!;
    const wall = room.walls[0];
    const a = createCabinet("cabinet", "base", 40);
    a.width = 24; // 40-64
    wall.cabinets.push(a);

    const outcome = store.resizeCabinetEdge(a.id, "left", 62); // almost at the right edge
    expect(outcome.achieved).toBe(false);
    expect(a.width).toBeCloseTo(MIN_DIMENSION, 6);
  });

  it("top edge: grows/shrinks height, clamped to the ceiling", () => {
    const room = store.getState().room!;
    const wall = room.walls[0];
    const a = createCabinet("cabinet", "base", 0);
    wall.cabinets.push(a);

    const grown = store.resizeCabinetEdge(a.id, "top", 50);
    expect(grown.achieved).toBe(true);
    expect(a.height).toBeCloseTo(50, 6);

    const overshoot = store.resizeCabinetEdge(a.id, "top", 500); // past the 96" ceiling
    expect(overshoot.achieved).toBe(false);
    expect(a.height).toBeCloseTo(96, 6); // anchored at the floor, so height maxes at wallHeight
  });
});

describe("island end-resize (resizeIslandEnd)", () => {
  beforeEach(() => {
    store.setRoom(200, 200, 96);
  });

  it("the 'end' handle behaves exactly like setIslandLength (start unchanged)", () => {
    const room = store.getState().room!;
    const island = createIsland(room, 72, "ew");
    room.walls.push(island);
    const startBefore = { ...island.start };

    store.resizeIslandEnd(island.id, "end", island.start.x + 90);
    expect(island.length).toBeCloseTo(90, 6);
    expect(island.start).toEqual(startBefore);
  });

  it("the 'end' handle refuses to orphan a piece", () => {
    const room = store.getState().room!;
    const island = createIsland(room, 72, "ew");
    room.walls.push(island);
    const piece = createCabinet("cabinet", "base", 50);
    piece.width = 20; // occupies 50-70, near the far end
    island.cabinets.push(piece);
    const lengthBefore = island.length;

    store.resizeIslandEnd(island.id, "end", island.start.x + 60); // would cut off the piece at 70
    expect(island.length).toBeCloseTo(lengthBefore, 6); // rejected, unchanged
  });

  it("the 'start' handle shifts start + length while keeping existing pieces physically in place", () => {
    const room = store.getState().room!;
    const island = createIsland(room, 72, "ew");
    room.walls.push(island);
    const piece = createCabinet("cabinet", "base", 50);
    piece.width = 10; // occupies 50-60, well clear of the near end
    island.cabinets.push(piece);

    const originalAbsolute = island.start.x + piece.xOffset;
    const newStart = island.start.x + 20; // shrink the near end by 20"

    store.resizeIslandEnd(island.id, "start", newStart);

    expect(island.start.x).toBeCloseTo(newStart, 6);
    expect(island.length).toBeCloseTo(72 - 20, 6);
    // The piece's absolute plan position is unchanged — only its offset relative to the moved
    // start changed to compensate.
    expect(island.start.x + piece.xOffset).toBeCloseTo(originalAbsolute, 6);
  });

  it("the 'start' handle refuses to orphan a piece off the near edge", () => {
    const room = store.getState().room!;
    const island = createIsland(room, 72, "ew");
    room.walls.push(island);
    const piece = createCabinet("cabinet", "base", 10);
    piece.width = 10; // occupies 10-20, near the near end
    island.cabinets.push(piece);
    const startBefore = { ...island.start };

    // Shifting the start past the piece's own position would orphan it off the front.
    store.resizeIslandEnd(island.id, "start", island.start.x + 30);
    expect(island.start).toEqual(startBefore); // rejected, unchanged
  });

  it("the 'start' handle refuses when the shifted deck would collide with another wall's pieces", () => {
    const room = store.getState().room!;
    const north = room.walls[0]; // (0,0)->(200,0), inward (0,1)
    const northPiece = createCabinet("cabinet", "base", 0);
    northPiece.width = 200; // spans the full North wall, footprint y[0,24] (default base depth)
    north.cabinets.push(northPiece);

    const island = createIsland(room, 72, "ns"); // north-south orientation: axis is y
    island.start = { x: 100, y: 50 }; // parked well clear of the North wall, no pieces yet
    room.walls.push(island);
    const startBefore = { ...island.start };

    // Dragging the near (north-facing) end up toward y=10 would push the empty deck's footprint
    // (x[100,124], y[10,122] at the default 24" depth) into the North wall's run (y[0,24]).
    store.resizeIslandEnd(island.id, "start", 10);
    expect(island.start).toEqual(startBefore); // rejected — the deck never moved
  });
});

describe("dragCabinet(push)", () => {
  beforeEach(() => {
    store.setRoom(240, 200, 96);
  });

  it("push: true routes through the cascade instead of stopping flush at the first neighbor", () => {
    const room = store.getState().room!;
    const wall = room.walls[0];
    const a = createCabinet("cabinet", "base", 0);
    a.width = 39;
    const b = createCabinet("cabinet", "base", 39);
    b.width = 39;
    const c = createCabinet("cabinet", "base", 78);
    c.width = 39;
    wall.cabinets.push(a, b, c);

    store.dragCabinet(a.id, 70, true); // would overlap b/c without push
    expect(a.xOffset).toBeCloseTo(70, 6); // advanced all the way — nothing blocked it
    expect(b.xOffset).toBeGreaterThan(39 + EPSILON); // b cascaded out of the way
  });

  it("plain drag (push omitted) still stops flush at the first neighbor", () => {
    const room = store.getState().room!;
    const wall = room.walls[0];
    const a = createCabinet("cabinet", "base", 0);
    a.width = 39;
    const b = createCabinet("cabinet", "base", 39);
    b.width = 39;
    wall.cabinets.push(a, b);

    store.dragCabinet(a.id, 70); // no push argument at all
    expect(a.xOffset).toBeCloseTo(0, 6); // blocked flush against b — its own gap has no slack
    expect(b.xOffset).toBeCloseTo(39, 6); // b never moves
  });
});
