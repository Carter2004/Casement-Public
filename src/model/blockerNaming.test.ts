// blockerNaming.test.ts — cycle 018 friction #2 (Eris audit): a placement rejected by a
// cross-wall corner block now NAMES the blocking wall in its reason, instead of the opaque
// "No space for a 48" piece here" a first-timer can't act on. A same-wall-full failure (nothing
// cross-wall involved) keeps the short, unextended reason.

import { beforeEach, describe, expect, it } from "vitest";
import { createCabinet } from "./cabinet";
import { createPolygonRoom } from "./room";
import { store } from "./store";
import type { Vec2 } from "./room";

const L_SHAPE: Vec2[] = [
  { x: 0, y: 0 },
  { x: 180, y: 0 },
  { x: 180, y: 100 },
  { x: 100, y: 100 },
  { x: 100, y: 180 },
  { x: 0, y: 180 },
];

describe("noSpaceReason: names the blocking wall (the audit's notch-wall repro)", () => {
  it("a cross-wall-blocked drop on the visibly-empty notch wall names the adjacent wall", () => {
    const room = createPolygonRoom(L_SHAPE, 96);
    store.hydrate(room, { key: "l-shape", params: { width: 180, length: 180, notchWidth: 80, notchLength: 80 } });

    const wallRange = room.walls[1]; // (180,0)->(180,100) — the "range wall" of the audit's kitchen
    const wallNotch = room.walls[2]; // (180,100)->(100,100) — the empty notch wall, length 80

    // A deep (MAX_DEPTH) corner piece flush at wallRange's far end — the shared corner with
    // wallNotch — blocks 36" of wallNotch's own start, leaving only 44" free (< 48").
    const corner = createCabinet("cabinet", "base", wallRange.length - 36);
    corner.width = 36;
    corner.depth = 36;
    wallRange.cabinets = [corner];

    store.selectWall(wallNotch.id);
    const outcome = store.addCabinetAt("doorway", "base", 48, wallNotch.id, 0);

    expect(outcome.achieved).toBe(false);
    expect(outcome.reason).toMatch(/No space for a 48" piece here/);
    expect(outcome.reason).toContain("blocked by pieces around the corner");
    expect(outcome.reason).toContain(wallRange.label); // "Wall 2" — names the actual blocker
  });

  it("duplicateCabinet's failure reason names the blocker too, with the 'duplicate' noun", () => {
    const room = createPolygonRoom(L_SHAPE, 96);
    store.hydrate(room, { key: "l-shape", params: { width: 180, length: 180, notchWidth: 80, notchLength: 80 } });

    const wallRange = room.walls[1];
    const wallNotch = room.walls[2];

    const corner = createCabinet("cabinet", "base", wallRange.length - 36);
    corner.width = 36;
    corner.depth = 36;
    wallRange.cabinets = [corner];

    // A piece already on the notch wall, flush at its far end (away from the block), so
    // duplicating it (landing after/before at the SAME width) walks straight into the blocked
    // region near the corner with no room either side.
    const original = createCabinet("cabinet", "base", wallNotch.length - 40);
    original.width = 40; // occupies [40,80) on the 80"-long wall
    wallNotch.cabinets = [original];

    const outcome = store.duplicateCabinet(original.id);
    expect(outcome.achieved).toBe(false);
    expect(outcome.reason).toMatch(/No space for a 40" duplicate here/);
    expect(outcome.reason).toContain("blocked by pieces around the corner");
    expect(outcome.reason).toContain(wallRange.label);
  });
});

describe("noSpaceReason: a same-wall-full failure keeps the short reason", () => {
  beforeEach(() => {
    store.setRoom(60, 200, 96); // a wall too short for a second copy anywhere
  });

  it("addCabinetAt on a completely full wall reports the plain reason, no blocker named", () => {
    const wall = store.getState().room!.walls[0];
    store.selectWall(wall.id);
    const filler = createCabinet("cabinet", "base", 0);
    filler.width = 60; // the entire wall
    wall.cabinets = [filler];

    const outcome = store.addCabinetAt("cabinet", "base", 24, wall.id, 10);
    expect(outcome.achieved).toBe(false);
    expect(outcome.reason).toBe('No space for a 24" piece here');
    expect(outcome.reason).not.toContain("blocked by pieces around the corner");
  });

  it("duplicateCabinet on a wall filled by the original alone reports the plain reason", () => {
    const wall = store.getState().room!.walls[0];
    store.selectWall(wall.id);
    const original = createCabinet("cabinet", "base", 0);
    original.width = 50; // fills nearly the whole 60" wall — no room before or after even with push
    wall.cabinets.push(original);

    const outcome = store.duplicateCabinet(original.id);
    expect(outcome.achieved).toBe(false);
    expect(outcome.reason).toBe('No space for a 50" duplicate here');
    expect(outcome.reason).not.toContain("blocked by pieces around the corner");
  });
});
