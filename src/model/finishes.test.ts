// finishes.test.ts — the resolution pair (override ?? room default; null for appliance/opening
// kinds; fillers follow the cabinet finish but never get a door style) plus the registry-shape
// invariant every preset bundle must hold (every key it names must actually exist).

import { describe, expect, it } from "vitest";
import { createCabinet } from "./cabinet";
import {
  BACKSPLASHES,
  CABINET_FINISHES,
  COUNTER_MATERIALS,
  DOOR_STYLES,
  FLOOR_MATERIALS,
  PRESETS,
  resolveDoorStyle,
  resolveFinish,
  roomStyleForPreset,
  WALL_PAINTS,
  type PresetKey,
} from "./finishes";
import { createRectangularRoom } from "./room";

describe("resolveFinish", () => {
  it("falls back to the room's default when the piece has no override", () => {
    const room = createRectangularRoom(120, 144, 96);
    room.style = { ...room.style, cabinetFinish: "sage" };
    const cabinet = createCabinet("cabinet", "base", 0);
    expect(resolveFinish(room, cabinet)).toBe("sage");
  });

  it("a piece override wins over the room default", () => {
    const room = createRectangularRoom(120, 144, 96);
    room.style = { ...room.style, cabinetFinish: "sage" };
    const cabinet = createCabinet("cabinet", "base", 0);
    cabinet.finish = "navy";
    expect(resolveFinish(room, cabinet)).toBe("navy");
  });

  it("a filler strip follows the cabinet finish cascade exactly like a real cabinet", () => {
    const room = createRectangularRoom(120, 144, 96);
    room.style = { ...room.style, cabinetFinish: "cream" };
    const filler = createCabinet("filler", "base", 0);
    expect(resolveFinish(room, filler)).toBe("cream");
    filler.finish = "walnut";
    expect(resolveFinish(room, filler)).toBe("walnut");
  });

  it("returns null for an appliance kind (keeps its own fixed kind color)", () => {
    const room = createRectangularRoom(120, 144, 96);
    const fridge = createCabinet("fridge", "base", 0);
    expect(resolveFinish(room, fridge)).toBeNull();
  });

  it("returns null for an opening kind (window/door/doorway have no material)", () => {
    const room = createRectangularRoom(120, 144, 96);
    expect(resolveFinish(room, createCabinet("window", "wall", 0))).toBeNull();
    expect(resolveFinish(room, createCabinet("door", "base", 0))).toBeNull();
    expect(resolveFinish(room, createCabinet("doorway", "base", 0))).toBeNull();
  });
});

describe("resolveDoorStyle", () => {
  it("falls back to the room's default when the piece has no override", () => {
    const room = createRectangularRoom(120, 144, 96);
    room.style = { ...room.style, doorStyle: "glass" };
    const cabinet = createCabinet("cabinet", "base", 0);
    expect(resolveDoorStyle(room, cabinet)).toBe("glass");
  });

  it("a piece override wins over the room default", () => {
    const room = createRectangularRoom(120, 144, 96);
    room.style = { ...room.style, doorStyle: "glass" };
    const cabinet = createCabinet("cabinet", "base", 0);
    cabinet.doorStyle = "flat";
    expect(resolveDoorStyle(room, cabinet)).toBe("flat");
  });

  it("returns null for a filler strip (it's a strip, not a door)", () => {
    const room = createRectangularRoom(120, 144, 96);
    const filler = createCabinet("filler", "base", 0);
    expect(resolveDoorStyle(room, filler)).toBeNull();
  });

  it("returns null for an appliance or opening kind", () => {
    const room = createRectangularRoom(120, 144, 96);
    expect(resolveDoorStyle(room, createCabinet("fridge", "base", 0))).toBeNull();
    expect(resolveDoorStyle(room, createCabinet("window", "wall", 0))).toBeNull();
  });
});

describe("roomStyleForPreset", () => {
  it("produces a RoomStyle whose fields exactly match the preset bundle", () => {
    const style = roomStyleForPreset("farmhouse");
    const bundle = PRESETS.farmhouse;
    expect(style).toEqual({
      preset: "farmhouse",
      cabinetFinish: bundle.cabinetFinish,
      doorStyle: bundle.doorStyle,
      counter: bundle.counter,
      floor: bundle.floor,
      walls: bundle.walls,
      backsplash: bundle.backsplash,
    });
  });
});

describe("registry integrity: every preset's keys exist in their own registry", () => {
  it("every one of the 6 presets references only real keys", () => {
    for (const key of Object.keys(PRESETS) as PresetKey[]) {
      const bundle = PRESETS[key];
      expect(bundle.cabinetFinish in CABINET_FINISHES).toBe(true);
      expect(bundle.doorStyle in DOOR_STYLES).toBe(true);
      expect(bundle.counter in COUNTER_MATERIALS).toBe(true);
      expect(bundle.floor in FLOOR_MATERIALS).toBe(true);
      expect(bundle.walls in WALL_PAINTS).toBe(true);
      expect(bundle.backsplash in BACKSPLASHES).toBe(true);
    }
  });

  it("there are exactly 6 presets (the locked count)", () => {
    expect(Object.keys(PRESETS)).toHaveLength(6);
  });
});
