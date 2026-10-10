// customPreset.test.ts — cycle 015 audit #3: the "custom" sentinel round-trip. setRoomSurface /
// setPieceFinish / setPieceDoorStyle must all unmark whatever preset was last applied (so the
// catalog stops claiming a bundle the room no longer wears); applyPreset is the only mutation
// that ever restores a REAL PresetKey. Persistence must accept the sentinel as a valid saved
// value — a value-vocabulary change only, no schema version bump (SCHEMA_VERSION stays 4).

import { beforeEach, describe, expect, it } from "vitest";
import { CUSTOM_PRESET } from "./finishes";
import { isValidPayload, load, save } from "./persistence";
import { createRectangularRoom } from "./room";
import { store } from "./store";

function firstWallId(): string {
  return store.getState().room!.walls[0].id;
}

describe("style.preset diverges to the custom sentinel", () => {
  beforeEach(() => {
    store.setRoom(200, 200, 96);
  });

  it("setRoomSurface unmarks the active preset", () => {
    expect(store.getState().room!.style.preset).toBe("classic-white");
    store.setRoomSurface("floor", "dark-walnut");
    expect(store.getState().room!.style.preset).toBe(CUSTOM_PRESET);
  });

  it("setPieceFinish unmarks the active preset", () => {
    store.selectWall(firstWallId());
    store.addCabinet("cabinet", "base", 24);
    const id = store.getState().selectedCabinetId!;
    store.setPieceFinish(id, "walnut");
    expect(store.getState().room!.style.preset).toBe(CUSTOM_PRESET);
  });

  it("setPieceDoorStyle unmarks the active preset", () => {
    store.selectWall(firstWallId());
    store.addCabinet("cabinet", "base", 24);
    const id = store.getState().selectedCabinetId!;
    store.setPieceDoorStyle(id, "glass");
    expect(store.getState().room!.style.preset).toBe(CUSTOM_PRESET);
  });

  it("applyPreset restores a real preset key, clearing the custom sentinel", () => {
    store.setRoomSurface("floor", "dark-walnut");
    expect(store.getState().room!.style.preset).toBe(CUSTOM_PRESET);
    store.applyPreset("farmhouse");
    expect(store.getState().room!.style.preset).toBe("farmhouse");
  });

  it("undoing a divergence restores the prior (real) preset value", () => {
    expect(store.getState().room!.style.preset).toBe("classic-white");
    store.setRoomSurface("floor", "dark-walnut");
    store.undo();
    expect(store.getState().room!.style.preset).toBe("classic-white");
  });
});

describe("persistence accepts the custom sentinel (value vocabulary only, no schema bump)", () => {
  it("isValidPayload accepts a saved room.style.preset of \"custom\"", () => {
    const room = createRectangularRoom(120, 144, 96);
    room.style = { ...room.style, preset: CUSTOM_PRESET, floor: "dark-walnut" };
    const payload = {
      version: 5,
      room: { footprint: room.footprint, wallHeight: room.wallHeight, style: room.style },
      cabinetsByWall: { "wall-0": [], "wall-1": [], "wall-2": [], "wall-3": [] },
      islands: [],
    };
    expect(isValidPayload(payload)).toBe(true);
  });

  describe("save/load round-trip", () => {
    let backing: Record<string, string>;

    beforeEach(() => {
      backing = {};
      (globalThis as any).localStorage = {
        getItem: (key: string) => backing[key] ?? null,
        setItem: (key: string, value: string) => {
          backing[key] = value;
        },
        removeItem: (key: string) => {
          delete backing[key];
        },
      };
    });

    it("round-trips a room whose style has diverged to custom", () => {
      const room = createRectangularRoom(120, 144, 96);
      room.style = { ...room.style, preset: CUSTOM_PRESET, floor: "dark-walnut" };

      save(room);
      const restored = load();

      expect(restored).not.toBeNull();
      expect(restored!.room.style.preset).toBe(CUSTOM_PRESET);
      expect(restored!.room.style.floor).toBe("dark-walnut");
    });
  });
});
