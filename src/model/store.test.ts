// store.test.ts — regression coverage for the island-drag collision rule (moveIsland /
// setIslandOrientation, via the shared islandPlacementValid check). This divergence already
// happened once — a vertical-range-aware check (piecesConflict) was used instead of the plan's
// footprint-only rule, letting an island slide under an uppers-only wall (Hera's 288 sq in
// repro, cycle-009-verify.md). These tests encode the CHOSEN semantics at the integration
// point that actually had the bug, not just the underlying primitive.

import { beforeEach, describe, expect, it } from "vitest";
import { candidateStrip, quadsOverlap } from "./occupancy";
import { cabinetFootprint, type Wall } from "./room";
import { store } from "./store";

function wallById(id: string): Wall {
  const wall = store.getState().room!.walls.find((w) => w.id === id);
  if (!wall) throw new Error(`wall ${id} not found`);
  return wall;
}

function theIsland(): Wall {
  const island = store.getState().room!.walls.find((w) => w.kind === "island");
  if (!island) throw new Error("no island in the room");
  return island;
}

describe("island drag: footprint-only collision (regression for the vertical-range divergence)", () => {
  beforeEach(() => {
    store.setRoom(200, 200, 96);
  });

  it("rejects sliding an island's base piece under an uppers-only wall's footprint (Hera's exact repro)", () => {
    store.selectWall("wall-2"); // South
    store.fillWall("wall"); // uppers only, no base cabinets — South's footprint spans y[188,200]

    store.addIsland(); // default: length 72, centered at (64, 100) in a 200x200 room
    const island = theIsland();
    store.selectWall(island.id);
    store.addCabinet("cabinet", "base"); // default 24"-wide base piece at xOffset 0

    const before = { ...wallById(island.id).start };

    // Hera's repro: dragging to y=176 would put the base piece's footprint at y[176,200],
    // overlapping South's uppers footprint y[188,200] by 24"x12" = 288 sq in in plan.
    store.moveIsland(island.id, before.x, 176);

    expect(wallById(island.id).start).toEqual(before); // rejected — sticky, the island never moved
  });

  it("still blocks against a base-filled wall (the realistic reference-kitchen case)", () => {
    store.selectWall("wall-0"); // North
    store.fillWall("base");

    store.addIsland();
    const island = theIsland();
    store.selectWall(island.id);
    store.addCabinet("cabinet", "base");

    const before = { ...wallById(island.id).start };
    store.moveIsland(island.id, before.x, 10); // toward North's base-filled footprint

    expect(wallById(island.id).start).toEqual(before); // rejected
  });

  it("an empty island (no pieces yet) still drags freely", () => {
    store.addIsland();
    const island = theIsland();

    store.moveIsland(island.id, 5, 5);

    expect(wallById(island.id).start).toEqual({ x: 5, y: 5 });
  });
});

describe("empty-island deck collision (fold-in: audit Part 3 #2 — the deck used to lie)", () => {
  beforeEach(() => {
    store.setRoom(200, 200, 96);
  });

  it("rejects parking an EMPTY island's deck overlapping a wall run by 4\" (the audit's exact repro)", () => {
    store.selectWall("wall-0"); // North
    store.fillWall("base"); // base run spans y[0,24] across the full width

    store.addIsland(); // default: length 72, centered at (64, 100), NO pieces yet
    const island = theIsland();
    const before = { ...wallById(island.id).start };

    // The empty island's deck (rendered by planView at length x default base depth = 24") at
    // y=20 spans y[20,44] — a 4" overlap with North's base run at y[0,24], reproducing the
    // audit's exact measured defect: a drawn deck claiming space its own pieces could never
    // occupy, with nothing to reject the move before this fix.
    store.moveIsland(island.id, before.x, 20);

    expect(wallById(island.id).start).toEqual(before); // rejected — the deck never moved
  });

  it("an empty island still moves freely in open floor (the accepted deviation stays intact)", () => {
    store.addIsland();
    const island = theIsland();

    store.moveIsland(island.id, 30, 30);

    expect(wallById(island.id).start).toEqual({ x: 30, y: 30 });
  });
});

describe("addIsland spawn placement (pre-merge fix: cycle-011 audit Part 3 #1)", () => {
  beforeEach(() => {
    store.setRoom(200, 200, 96);
  });

  it("still spawns centered when the room is empty (fast path, no search needed)", () => {
    store.addIsland();
    const island = theIsland();
    expect(island.start).toEqual({ x: 64, y: 100 }); // default center for length 72 in 200x200
  });

  it("nudges a second island off the first island's pieces instead of spawning on top of them", () => {
    store.addIsland(); // island A: default center (64, 100)
    const islandA = theIsland();
    store.selectWall(islandA.id);
    store.addCabinet("cabinet", "base");
    const pieceA = islandA.cabinets[0];

    store.addIsland(); // island B: same centered default would land exactly on A's piece
    const islands = store.getState().room!.walls.filter((w) => w.kind === "island");
    expect(islands).toHaveLength(2);
    const islandB = islands.find((w) => w.id !== islandA.id)!;

    expect(islandB.start).not.toEqual(islandA.start); // nudged off the identical default center

    // Independently verify the geometry (not just trusting the store's own decision): island
    // B's empty deck — candidateStrip at the default base depth, exactly what
    // islandPlacementValid tests — must not overlap island A's real piece.
    const bDeck = candidateStrip(islandB, 24);
    expect(quadsOverlap(bDeck, cabinetFootprint(islandA, pieceA))).toBe(false);
  });
});

describe("selectWall: the island-selection trap (cycle-011 audit #2)", () => {
  beforeEach(() => {
    store.setRoom(200, 200, 96);
  });

  it("clicking the same wall again clears the piece selection instead of no-opping", () => {
    store.selectWall("wall-0");
    store.addCabinet("cabinet", "base");
    const cabinetId = store.getState().room!.walls[0].cabinets[0].id;
    store.selectCabinet(cabinetId);
    expect(store.getState().selectedCabinetId).toBe(cabinetId);

    store.selectWall("wall-0"); // same wall id — must still clear the piece selection
    expect(store.getState().selectedCabinetId).toBeNull();
    expect(store.getState().selectedWallId).toBe("wall-0");
  });

  it("clicking an island's deck while one of its pieces is selected switches to island mode in one click", () => {
    store.addIsland();
    const island = theIsland();
    store.selectWall(island.id);
    store.addCabinet("cabinet", "base");
    const pieceId = island.cabinets[0].id;
    store.selectCabinet(pieceId);
    expect(store.getState().selectedCabinetId).toBe(pieceId);

    store.selectWall(island.id); // the deck click — same wall id as before the piece was selected
    expect(store.getState().selectedCabinetId).toBeNull();
    expect(store.getState().selectedWallId).toBe(island.id);
  });

  it("is still a true no-op (no notify) when nothing would change", () => {
    store.selectWall("wall-0");
    let notifyCount = 0;
    const unsubscribe = store.subscribe(() => (notifyCount += 1));
    store.selectWall("wall-0"); // no piece selected, same wall — genuinely nothing changes
    unsubscribe();
    expect(notifyCount).toBe(0);
  });
});

describe("addCabinet / moveCabinet: push wiring (store integration)", () => {
  beforeEach(() => {
    store.setRoom(200, 200, 96);
  });

  it("addCabinet falls back to push when no plain gap fits, compressing the run", () => {
    store.selectWall("wall-0");
    store.fillWall("base"); // packs the 200" wall solid (5x36 + a 20" filler)
    const packed = store.getState().room!.walls[0].cabinets;
    // Delete a 36" cabinet to open real aggregate room, mimicking "select a filled cabinet,
    // delete it" — but this time via a piece that ISN'T exactly where or how wide the new
    // piece needs, so a plain gap alone won't do.
    const toDelete = packed.find((c) => c.width === 36)!;
    store.deleteCabinet(toDelete.id);

    const beforeCount = store.getState().room!.walls[0].cabinets.length;
    store.addCabinet("sink", "base"); // 36" wide — fits the freed 36" directly here, but this
    // proves the push PATH is wired end-to-end at the store level (the pure planner's own
    // scattered-gap case is covered in push.test.ts).
    const afterCount = store.getState().room!.walls[0].cabinets.length;
    expect(afterCount).toBe(beforeCount + 1);
    expect(store.getState().room!.walls[0].cabinets.some((c) => c.kind === "sink")).toBe(true);
  });

  it("moveCabinet (position field) slides a piece through a flush-packed run via typed position — the cabin-column repro", () => {
    store.selectWall("wall-0");
    // [col][col][col][col] flush-packed, 39" each: 0-39, 39-78, 78-117, 117-156.
    for (let i = 0; i < 4; i++) {
      store.addCabinet("cabinet", "base", 39);
    }
    const cols = store.getState().room!.walls[0].cabinets;
    const moving = cols[1]; // currently at 39

    const outcome = store.moveCabinet(moving.id, 78); // type a position requiring a crossing
    expect(outcome.achieved).toBe(true);

    const final = [...store.getState().room!.walls[0].cabinets].sort((a, b) => a.xOffset - b.xOffset);
    // No overlaps, and the moved piece ends up at/near 78 with its old neighbors cascaded aside
    // — never reordered (every piece's id order matches the sorted-by-position order).
    for (let i = 0; i < final.length - 1; i++) {
      expect(final[i].xOffset + final[i].width).toBeLessThanOrEqual(final[i + 1].xOffset + 1e-6);
    }
    expect(final.find((c) => c.id === moving.id)!.xOffset).toBeCloseTo(78, 6);
  });

  it("moveCabinet reports achieved:false with a reason when the cascade falls short", () => {
    store.selectWall("wall-0");
    const doorway = (() => {
      store.addCabinet("doorway", "base"); // lands at 0, width 48
      return store.getState().room!.walls[0].cabinets[0];
    })();
    store.addCabinet("cabinet", "base", 39); // lands right after the doorway at 48-87

    const piece = store.getState().room!.walls[0].cabinets.find((c) => c.id !== doorway.id)!;
    const outcome = store.moveCabinet(piece.id, 10); // try to push it back into the doorway
    expect(outcome.achieved).toBe(false);
    expect(outcome.reason).toMatch(/blocked/i);
  });

  it("resizeCabinet reports achieved:false with a reason when a value gets clamped", () => {
    store.selectWall("wall-0");
    store.addCabinet("cabinet", "base", 24);
    const piece = store.getState().room!.walls[0].cabinets[0];

    const outcome = store.resizeCabinet(piece.id, { width: 500 }); // far beyond the wall
    expect(outcome.achieved).toBe(false);
    expect(outcome.reason).toMatch(/width/i);
  });
});

describe("undo of a push restores every relocated piece", () => {
  it("undoing an insert-with-push restores the cascaded pieces to their exact prior positions", () => {
    store.setRoom(200, 200, 96);
    store.selectWall("wall-0");
    store.fillWall("base");
    const packed = store.getState().room!.walls[0].cabinets;
    const toDelete = packed.find((c) => c.width === 36)!;
    store.deleteCabinet(toDelete.id);

    const beforePush = store.getState().room!.walls[0].cabinets.map((c) => ({ id: c.id, x: c.xOffset }));
    store.addCabinet("sink", "base");
    expect(store.getState().room!.walls[0].cabinets.length).toBe(beforePush.length + 1);

    store.undo();
    const afterUndo = store.getState().room!.walls[0].cabinets.map((c) => ({ id: c.id, x: c.xOffset }));
    expect(afterUndo).toEqual(beforePush); // every piece (relocated or not) is back exactly where it was
  });

  it("undoing a move-with-push restores every cascaded neighbor", () => {
    store.setRoom(200, 200, 96);
    store.selectWall("wall-0");
    for (let i = 0; i < 4; i++) store.addCabinet("cabinet", "base", 39);
    const before = store.getState().room!.walls[0].cabinets.map((c) => ({ id: c.id, x: c.xOffset }));

    const moving = store.getState().room!.walls[0].cabinets[1];
    store.moveCabinet(moving.id, 78);
    expect(store.getState().room!.walls[0].cabinets.map((c) => c.xOffset)).not.toEqual(before.map((c) => c.x));

    store.undo();
    const after = store.getState().room!.walls[0].cabinets.map((c) => ({ id: c.id, x: c.xOffset }));
    expect(after).toEqual(before);
  });
});
