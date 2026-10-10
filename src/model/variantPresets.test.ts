// variantPresets.test.ts — cycle 016 Part C: the one variant-preset mechanism (PieceOverrides)
// carried through BOTH add paths (addCabinet, addCabinetAt), plus the new 'open' door style's
// registry acceptance and persistence round-trip.

import { beforeEach, describe, expect, it } from "vitest";
import { DOOR_STYLES } from "./finishes";
import { isValidPayload } from "./persistence";
import { createRectangularRoom } from "./room";
import { store } from "./store";

function firstWallId(): string {
  return store.getState().room!.walls[0].id;
}

describe("variant presets via addCabinet (click path)", () => {
  beforeEach(() => {
    store.setRoom(200, 200, 96);
    store.selectWall(firstWallId());
  });

  it("applies a height override (Tall cabinet)", () => {
    store.addCabinet("cabinet", "base", 24, { height: 90 });
    const cabinet = store.getSelectedCabinet()!;
    expect(cabinet.height).toBe(90);
  });

  it("clamps the height override to the ceiling, same as a manual resize would", () => {
    store.setRoom(200, 200, 40); // a short room — 90" would poke through a 40" ceiling
    store.selectWall(firstWallId());
    store.addCabinet("cabinet", "base", 24, { height: 90 });
    const cabinet = store.getSelectedCabinet()!;
    expect(cabinet.height).toBeLessThanOrEqual(40);
  });

  it("applies a doorStyle override (Glass upper)", () => {
    store.addCabinet("cabinet", "wall", 24, { doorStyle: "glass" });
    const cabinet = store.getSelectedCabinet()!;
    expect(cabinet.doorStyle).toBe("glass");
  });

  it("applies a doorStyle override (Open shelf)", () => {
    store.addCabinet("cabinet", "wall", 24, { doorStyle: "open" });
    const cabinet = store.getSelectedCabinet()!;
    expect(cabinet.doorStyle).toBe("open");
  });

  it("a plain add with no overrides is unaffected (no accidental defaults)", () => {
    store.addCabinet("cabinet", "base", 24);
    const cabinet = store.getSelectedCabinet()!;
    expect(cabinet.doorStyle).toBeUndefined();
  });
});

describe("variant presets via addCabinetAt (drag/drop path)", () => {
  beforeEach(() => {
    store.setRoom(200, 200, 96);
  });

  it("applies a height override on a direct-placement drop", () => {
    const wall = store.getState().room!.walls[0];
    const outcome = store.addCabinetAt("cabinet", "base", 24, wall.id, 10, { height: 90 });
    expect(outcome.achieved).toBe(true);
    expect(wall.cabinets[0].height).toBe(90);
  });

  it("applies a doorStyle override on a direct-placement drop", () => {
    const wall = store.getState().room!.walls[0];
    const outcome = store.addCabinetAt("cabinet", "wall", 24, wall.id, 10, { doorStyle: "open" });
    expect(outcome.achieved).toBe(true);
    expect(wall.cabinets[0].doorStyle).toBe("open");
  });
});

describe("'open' door style — registry + persistence acceptance (cycle 016 Part C2, no schema bump)", () => {
  it("is a member of the DOOR_STYLES registry", () => {
    expect("open" in DOOR_STYLES).toBe(true);
  });

  it("isValidPayload accepts 'open' as a per-cabinet doorStyle override", () => {
    const room = createRectangularRoom(120, 144, 96);
    const payload = {
      version: 5,
      room: { footprint: room.footprint, wallHeight: room.wallHeight, style: room.style },
      cabinetsByWall: {
        "wall-0": [{ kind: "cabinet", type: "wall", xOffset: 0, width: 24, height: 30, depth: 12, doorStyle: "open" }],
        "wall-1": [],
        "wall-2": [],
        "wall-3": [],
      },
      islands: [],
    };
    expect(isValidPayload(payload)).toBe(true);
  });

  it("isValidPayload accepts 'open' as the room's own default doorStyle", () => {
    const room = createRectangularRoom(120, 144, 96);
    const payload = {
      version: 5,
      room: { footprint: room.footprint, wallHeight: room.wallHeight, style: { ...room.style, doorStyle: "open" } },
      cabinetsByWall: { "wall-0": [], "wall-1": [], "wall-2": [], "wall-3": [] },
      islands: [],
    };
    expect(isValidPayload(payload)).toBe(true);
  });
});
