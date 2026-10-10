// dropAndDuplicate.test.ts — cycle 016 Part A1/A2 (quantize + select the drop wall) and Part D
// (Ctrl+D duplicate semantics: adjacent landing, push fallback, honest failure, attribute copy).

import { beforeEach, describe, expect, it } from "vitest";
import { createCabinet } from "./cabinet";
import { GRID } from "./units";
import { store } from "./store";

function firstWallId(): string {
  return store.getState().room!.walls[0].id;
}

describe("addCabinetAt quantizes its drop target (cycle 016 audit #2)", () => {
  beforeEach(() => {
    store.setRoom(200, 200, 96);
  });

  it("a direct-placement drop lands on the ½\" grid, not the raw offset", () => {
    const wall = store.getState().room!.walls[0];
    const outcome = store.addCabinetAt("cabinet", "base", 24, wall.id, 60.68);
    expect(outcome.achieved).toBe(true);
    const placed = store.getState().room!.walls[0].cabinets[0];
    expect(placed.xOffset % GRID).toBeCloseTo(0, 6);
    expect(placed.xOffset).not.toBe(60.68);
  });

  it("a targeted-push drop also lands on the ½\" grid", () => {
    const wall = store.getState().room!.walls[0];
    const a = createCabinet("cabinet", "base", 0);
    a.width = 40;
    const b = createCabinet("cabinet", "base", 50);
    b.width = 40; // leaves [40,50)=10 free
    const c = createCabinet("cabinet", "base", 100);
    c.width = 40; // leaves [90,100)=10 free
    const d = createCabinet("cabinet", "base", 140);
    d.width = 60;
    wall.cabinets.push(a, b, c, d);
    // Only fragmented 10"+10" free space exists — a 20" piece needs push, aimed off-grid.
    const outcome = store.addCabinetAt("cabinet", "base", 20, wall.id, 45.27);
    expect(outcome.achieved).toBe(true);
    const placed = wall.cabinets.find((cab) => cab.id !== a.id && cab.id !== b.id && cab.id !== c.id && cab.id !== d.id)!;
    expect(placed.xOffset % GRID).toBeCloseTo(0, 6);
  });
});

describe("addCabinetAt selects the drop wall (cycle 016 audit #1)", () => {
  beforeEach(() => {
    store.setRoom(200, 200, 96);
  });

  it("selects both the piece AND its wall on a fresh drop with nothing selected", () => {
    expect(store.getState().selectedWallId).toBeNull();
    const wall = store.getState().room!.walls[1]; // not walls[0] — an arbitrary unselected wall
    const outcome = store.addCabinetAt("cabinet", "base", 24, wall.id, 10);
    expect(outcome.achieved).toBe(true);
    expect(store.getState().selectedWallId).toBe(wall.id);
    expect(store.getState().selectedCabinetId).not.toBeNull();
  });
});

describe("duplicateCabinet", () => {
  beforeEach(() => {
    store.setRoom(200, 200, 96);
  });

  it("lands flush AFTER the original when there's room", () => {
    store.selectWall(firstWallId());
    store.addCabinet("cabinet", "base", 24);
    const originalId = store.getState().selectedCabinetId!;
    const original = store.getSelectedCabinet()!;

    const outcome = store.duplicateCabinet(originalId);
    expect(outcome.achieved).toBe(true);

    const cabinets = store.getState().room!.walls[0].cabinets;
    expect(cabinets).toHaveLength(2);
    const copy = cabinets.find((c) => c.id !== originalId)!;
    expect(copy.xOffset).toBeCloseTo(original.xOffset + original.width, 6);
    expect(store.getState().selectedCabinetId).toBe(copy.id); // the COPY is selected, not the original
  });

  it("falls back to landing BEFORE the original when after is blocked", () => {
    const wall = store.getState().room!.walls[0];
    store.selectWall(wall.id);
    const original = createCabinet("cabinet", "base", 40);
    original.width = 24; // 40-64
    const blocker = createCabinet("cabinet", "base", 64);
    blocker.width = 100; // 64-164, blocks the "after" side flush against 64
    wall.cabinets.push(original, blocker);

    const outcome = store.duplicateCabinet(original.id);
    expect(outcome.achieved).toBe(true);
    const copy = wall.cabinets.find((c) => c.id !== original.id && c.id !== blocker.id)!;
    expect(copy.xOffset).toBeCloseTo(original.xOffset - original.width, 6); // landed before, not after
  });

  it("pushes neighbors when the wall is tight but push can still make room", () => {
    // A wall sized so the ONLY free space is two 4" gaps (summing to exactly the duplicate's
    // own 8" width) — no single gap fits it, so the "after" target can only land via push.
    store.setRoom(56, 200, 96);
    const wall = store.getState().room!.walls[0]; // length 56
    store.selectWall(wall.id);
    const original = createCabinet("cabinet", "base", 0);
    original.width = 8; // 0-8
    const b = createCabinet("cabinet", "base", 12);
    b.width = 20; // 12-32, leaving [8,12)=4 free right after original
    const c = createCabinet("cabinet", "base", 36);
    c.width = 20; // 36-56, leaving [32,36)=4 free — no trailing space
    wall.cabinets.push(original, b, c);

    const outcome = store.duplicateCabinet(original.id);
    expect(outcome.achieved).toBe(true);
    expect(b.xOffset).toBeGreaterThan(12); // cascaded right to make room
  });

  it("fails honestly (no landing, a reason) when neither side works even with push", () => {
    store.setRoom(60, 200, 96); // a wall too short for a second copy anywhere
    const wall = store.getState().room!.walls[0];
    store.selectWall(wall.id);
    const original = createCabinet("cabinet", "base", 0);
    original.width = 50; // fills nearly the whole 60" wall — no room before or after even with push
    wall.cabinets.push(original);

    const before = wall.cabinets.length;
    const outcome = store.duplicateCabinet(original.id);
    expect(outcome.achieved).toBe(false);
    expect(outcome.reason).toBeTruthy();
    expect(wall.cabinets.length).toBe(before); // nothing landed
  });

  it("copies finish and door-style overrides onto the copy", () => {
    store.selectWall(firstWallId());
    store.addCabinet("cabinet", "base", 24);
    const originalId = store.getState().selectedCabinetId!;
    store.setPieceFinish(originalId, "walnut");
    store.setPieceDoorStyle(originalId, "glass");

    store.duplicateCabinet(originalId);
    const copy = store.getSelectedCabinet()!;
    expect(copy.id).not.toBe(originalId);
    expect(copy.finish).toBe("walnut");
    expect(copy.doorStyle).toBe("glass");
  });

  it("is one undo step", () => {
    store.selectWall(firstWallId());
    store.addCabinet("cabinet", "base", 24);
    const originalId = store.getState().selectedCabinetId!;
    const beforeCount = store.getState().room!.walls[0].cabinets.length;

    store.duplicateCabinet(originalId);
    expect(store.getState().room!.walls[0].cabinets.length).toBe(beforeCount + 1);

    store.undo();
    expect(store.getState().room!.walls[0].cabinets.length).toBe(beforeCount);
  });

  it("duplicates an opening (a wall feature is still a piece)", () => {
    store.selectWall(firstWallId());
    store.addCabinet("doorway", "base");
    const originalId = store.getState().selectedCabinetId!;

    const outcome = store.duplicateCabinet(originalId);
    expect(outcome.achieved).toBe(true);
    const copy = store.getSelectedCabinet()!;
    expect(copy.kind).toBe("doorway");
  });
});
