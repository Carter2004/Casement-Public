// movePieceToWall.test.ts — the drag-first re-anchor authority (cycle 019 Part 1):
// cursor-aimed drop, push fallback, honest failure (nothing moves), attribute/id continuity,
// island<->wall legality per canPlaceOn, same-wall carries, and the exclude-threading premise
// (a move whose own old footprint corner-blocked the target must still succeed).

import { beforeEach, describe, expect, it } from "vitest";
import { createCabinet } from "./cabinet";
import { createIsland } from "./room";
import { store } from "./store";

describe("movePieceToWall", () => {
  beforeEach(() => {
    store.setRoom(120, 144, 96);
  });

  it("lands the piece at the cursor-aimed offset on the target wall", () => {
    const room = store.getState().room!;
    const northWall = room.walls[0];
    store.selectWall(northWall.id);
    store.addCabinet("cabinet", "base", 24);
    const piece = store.getState().room!.walls[0].cabinets[0];
    const eastWall = room.walls[1];

    const outcome = store.movePieceToWall(piece.id, eastWall.id, 30);
    expect(outcome.achieved).toBe(true);
    const moved = store.getState().room!.walls[1].cabinets[0];
    expect(moved.xOffset).toBeCloseTo(30, 6);
    expect(store.getState().room!.walls[0].cabinets).toHaveLength(0);
  });

  it("falls back to push when the target has no plain gap but enough aggregate room", () => {
    const room = store.getState().room!;
    const northWall = room.walls[0];
    store.selectWall(northWall.id);
    store.addCabinet("cabinet", "base", 24);
    const piece = store.getState().room!.walls[0].cabinets[0];

    const eastWall = room.walls[1]; // length 144, piece.width is 24 (the default)
    const left = createCabinet("cabinet", "base", 0);
    left.width = 50; // 0-50
    const right = createCabinet("cabinet", "base", 66);
    right.width = 60; // 66-126, leaving [50,66)=16" (too small alone) and [126,144)=18" trailing —
    // neither gap alone fits a 24"-wide piece, but the aggregate (16+18=34) does, so this can only
    // land via push: growing the [50,66) gap (nearest the target) and cascading `right` rightward.
    eastWall.cabinets.push(left, right);

    const outcome = store.movePieceToWall(piece.id, eastWall.id, 55);
    expect(outcome.achieved).toBe(true);
    const moved = store.getState().room!.walls[1].cabinets.find((c) => c.id === piece.id)!;
    expect(moved.xOffset).toBeCloseTo(50, 6); // the grown gap starts flush after `left`
    const rightAfter = store.getState().room!.walls[1].cabinets.find((c) => c.id === right.id)!;
    expect(rightAfter.xOffset).toBeGreaterThan(66); // cascaded right to make room
  });

  it("fails honestly (nothing moves, a reason) when the target truly has no room anywhere", () => {
    const room = store.getState().room!;
    const northWall = room.walls[0];
    store.selectWall(northWall.id);
    store.addCabinet("cabinet", "base", 24);
    const piece = store.getState().room!.walls[0].cabinets[0];

    const eastWall = room.walls[1];
    const filler = createCabinet("cabinet", "base", 0);
    filler.width = eastWall.length; // fills the entire target wall
    eastWall.cabinets.push(filler);

    const outcome = store.movePieceToWall(piece.id, eastWall.id, 10);
    expect(outcome.achieved).toBe(false);
    expect(outcome.reason).toBeTruthy();
    // Nothing moved: the piece is still on its original wall, at its original offset.
    expect(store.getState().room!.walls[0].cabinets).toHaveLength(1);
    expect(store.getState().room!.walls[1].cabinets).toHaveLength(1); // just the filler
  });

  it("finish and door-style overrides travel with the piece (same object, not a copy)", () => {
    const room = store.getState().room!;
    const northWall = room.walls[0];
    store.selectWall(northWall.id);
    store.addCabinet("cabinet", "base", 24);
    const piece = store.getState().room!.walls[0].cabinets[0];
    store.setPieceFinish(piece.id, "walnut");
    store.setPieceDoorStyle(piece.id, "glass");

    const eastWall = room.walls[1];
    const outcome = store.movePieceToWall(piece.id, eastWall.id, 10);
    expect(outcome.achieved).toBe(true);
    const moved = store.getState().room!.walls[1].cabinets[0];
    expect(moved.id).toBe(piece.id); // id continuity — the SAME cabinet, not a recreation
    expect(moved.finish).toBe("walnut");
    expect(moved.doorStyle).toBe("glass");
  });

  it("selectedWallId follows the piece to its new home", () => {
    const room = store.getState().room!;
    const northWall = room.walls[0];
    store.selectWall(northWall.id);
    store.addCabinet("cabinet", "base", 24);
    const piece = store.getState().room!.walls[0].cabinets[0];
    const eastWall = room.walls[1];

    store.movePieceToWall(piece.id, eastWall.id, 10);
    expect(store.getState().selectedWallId).toBe(eastWall.id);
    expect(store.getState().selectedCabinetId).toBe(piece.id);
  });

  it("a floor-anchored piece can move from a wall onto an island", () => {
    const room = store.getState().room!;
    const northWall = room.walls[0];
    store.selectWall(northWall.id);
    store.addCabinet("cabinet", "base", 24);
    const piece = store.getState().room!.walls[0].cabinets[0];

    const island = createIsland(room, 72, "ew");
    room.walls.push(island);

    const outcome = store.movePieceToWall(piece.id, island.id, 10);
    expect(outcome.achieved).toBe(true);
    expect(store.getState().room!.walls.find((w) => w.id === island.id)!.cabinets).toHaveLength(1);
  });

  it("a floor-anchored piece can move from an island back onto a perimeter wall", () => {
    const room = store.getState().room!;
    const island = createIsland(room, 72, "ew");
    room.walls.push(island);
    store.selectWall(island.id);
    store.addCabinet("cabinet", "base", 10);
    const piece = store.getState().room!.walls.find((w) => w.kind === "island")!.cabinets[0];

    const northWall = room.walls[0];
    const outcome = store.movePieceToWall(piece.id, northWall.id, 20);
    expect(outcome.achieved).toBe(true);
    expect(store.getState().room!.walls[0].cabinets).toHaveLength(1);
  });

  it("rejects a wall-band cabinet moving onto an island (canPlaceOn) with an honest reason", () => {
    const room = store.getState().room!;
    const northWall = room.walls[0];
    store.selectWall(northWall.id);
    store.addCabinet("cabinet", "wall", 24);
    const piece = store.getState().room!.walls[0].cabinets[0];

    const island = createIsland(room, 72, "ew");
    room.walls.push(island);

    const outcome = store.movePieceToWall(piece.id, island.id, 10);
    expect(outcome.achieved).toBe(false);
    expect(outcome.reason).toBeTruthy();
    expect(store.getState().room!.walls[0].cabinets).toHaveLength(1); // never moved
  });

  it("rejects an opening moving onto an island with an honest reason", () => {
    const room = store.getState().room!;
    const northWall = room.walls[0];
    store.selectWall(northWall.id);
    store.addCabinet("window", "wall", 36);
    const piece = store.getState().room!.walls[0].cabinets[0];

    const island = createIsland(room, 72, "ew");
    room.walls.push(island);

    const outcome = store.movePieceToWall(piece.id, island.id, 10);
    expect(outcome.achieved).toBe(false);
    expect(store.getState().room!.walls[0].cabinets).toHaveLength(1);
  });

  it("a same-wall carry over a neighbor works (jumping to a different segment on the same wall)", () => {
    const room = store.getState().room!;
    const wall = room.walls[0];
    store.selectWall(wall.id);
    const a = createCabinet("cabinet", "base", 0);
    a.width = 24;
    const b = createCabinet("cabinet", "base", 40);
    b.width = 24;
    wall.cabinets.push(a, b);

    const outcome = store.movePieceToWall(a.id, wall.id, 70); // jump past b to the far side
    expect(outcome.achieved).toBe(true);
    const moved = store.getState().room!.walls[0].cabinets.find((c) => c.id === a.id)!;
    expect(moved.xOffset).toBeCloseTo(70, 6);
    expect(store.getState().room!.walls[0].cabinets).toHaveLength(2); // still just the two pieces
  });

  it("EXCLUDE PREMISE: a piece whose own old footprint corner-blocked the target wall can move into that exact spot", () => {
    const room = store.getState().room!;
    const north = room.walls[0]; // (0,0)->(120,0)
    const east = room.walls[1]; // (120,0)->(120,144) — shares the corner at North's far end

    // Place the piece on East, flush at its own start (the shared corner), deep enough to
    // corner-block North's own last 24" — [96,120).
    store.selectWall(east.id);
    store.addCabinet("cabinet", "base", 24);
    const piece = store.getState().room!.walls[1].cabinets[0];
    store.resizeCabinet(piece.id, { depth: 24 });

    // Sanity: without exclude, North's [96,120) really is blocked (confirmed at the occupancy
    // level in occupancy.test.ts) — a plain add there would fail. The move itself must still
    // succeed, since movePieceToWall always excludes the piece being moved from its own old
    // footprint's contribution.
    const outcome = store.movePieceToWall(piece.id, north.id, 96);
    expect(outcome.achieved).toBe(true);
    const moved = store.getState().room!.walls[0].cabinets.find((c) => c.id === piece.id)!;
    expect(moved.xOffset).toBeCloseTo(96, 6);
    expect(store.getState().room!.walls[1].cabinets).toHaveLength(0); // gone from its old wall
  });

  it("returns an honest 'Piece not found' / 'Wall not found' for bad ids, mutating nothing", () => {
    const badPiece = store.movePieceToWall("nope", store.getState().room!.walls[0].id, 0);
    expect(badPiece.achieved).toBe(false);

    store.selectWall(store.getState().room!.walls[0].id);
    store.addCabinet("cabinet", "base", 24);
    const piece = store.getState().room!.walls[0].cabinets[0];
    const badWall = store.movePieceToWall(piece.id, "nope", 0);
    expect(badWall.achieved).toBe(false);
    expect(store.getState().room!.walls[0].cabinets).toHaveLength(1);
  });

  it("is a single undo step", () => {
    const room = store.getState().room!;
    const northWall = room.walls[0];
    store.selectWall(northWall.id);
    store.addCabinet("cabinet", "base", 24);
    const piece = store.getState().room!.walls[0].cabinets[0];
    const eastWall = room.walls[1];

    store.movePieceToWall(piece.id, eastWall.id, 10);
    expect(store.getState().room!.walls[1].cabinets).toHaveLength(1);

    store.undo();
    expect(store.getState().room!.walls[1].cabinets).toHaveLength(0);
    expect(store.getState().room!.walls[0].cabinets).toHaveLength(1);
    expect(store.getState().room!.walls[0].cabinets[0].id).toBe(piece.id);
  });

  it("inside an open gesture, a move collapses into the gesture's single checkpoint (no extra undo step)", () => {
    const room = store.getState().room!;
    const northWall = room.walls[0];
    store.selectWall(northWall.id);
    store.addCabinet("cabinet", "base", 24);
    const piece = store.getState().room!.walls[0].cabinets[0];
    const eastWall = room.walls[1];
    const before = store.getState().room!.walls[0].cabinets.map((c) => c.xOffset);

    store.beginGesture();
    store.dragCabinet(piece.id, 30); // slide (same-wall) — part of the SAME gesture
    store.movePieceToWall(piece.id, eastWall.id, 10); // then carry — still the same gesture
    store.endGesture();

    expect(store.getState().room!.walls[1].cabinets).toHaveLength(1);
    store.undo(); // ONE undo should unwind the WHOLE gesture (slide + carry)
    expect(store.getState().room!.walls[1].cabinets).toHaveLength(0);
    expect(store.getState().room!.walls[0].cabinets.map((c) => c.xOffset)).toEqual(before);
  });
});
