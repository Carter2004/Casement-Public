// style.test.ts — store-level coverage for cycle 014's style mutations: applyPreset (clears
// every piece override — perimeter AND island — in one checkpoint, so one undo restores the
// whole prior look), setRoomSurface (per-category, unknown keys rejected), and
// setPieceFinish/setPieceDoorStyle (kind guards: appliances/openings/fillers-with-no-door).

import { beforeEach, describe, expect, it } from "vitest";
import { store } from "./store";

function firstWallId(): string {
  return store.getState().room!.walls[0].id;
}

describe("applyPreset", () => {
  beforeEach(() => {
    store.setRoom(200, 200, 96);
  });

  it("replaces the room's whole style and clears every piece override, in ONE undo step", () => {
    const wallId = firstWallId();
    store.selectWall(wallId);
    store.addCabinet("cabinet", "base", 24);
    const cabinetId = store.getState().selectedCabinetId!;
    store.setPieceFinish(cabinetId, "navy");
    store.setPieceDoorStyle(cabinetId, "glass");

    store.addIsland();
    const islandId = store.getState().room!.walls.find((w) => w.kind === "island")!.id;
    store.selectWall(islandId);
    store.addCabinet("cabinet", "base", 24);
    const islandCabinetId = store.getState().selectedCabinetId!;
    store.setPieceFinish(islandCabinetId, "sage");

    const beforeStyle = { ...store.getState().room!.style };
    store.applyPreset("farmhouse");

    const room = store.getState().room!;
    expect(room.style.preset).toBe("farmhouse");
    expect(room.style.cabinetFinish).toBe("sage"); // farmhouse's own bundle value
    const perimeterCabinet = room.walls.find((w) => w.id === wallId)!.cabinets[0];
    const islandCabinet = room.walls.find((w) => w.id === islandId)!.cabinets[0];
    expect(perimeterCabinet.finish).toBeUndefined();
    expect(perimeterCabinet.doorStyle).toBeUndefined();
    expect(islandCabinet.finish).toBeUndefined();

    // ONE undo step restores everything — the room style AND both overrides.
    store.undo();
    const restored = store.getState().room!;
    expect(restored.style).toEqual(beforeStyle);
    const restoredPerimeterCabinet = restored.walls.find((w) => w.id === wallId)!.cabinets[0];
    const restoredIslandCabinet = restored.walls.find((w) => w.id === islandId)!.cabinets[0];
    expect(restoredPerimeterCabinet.finish).toBe("navy");
    expect(restoredPerimeterCabinet.doorStyle).toBe("glass");
    expect(restoredIslandCabinet.finish).toBe("sage");
  });

  it("ignores an unknown preset key (no-op, no undo step wasted)", () => {
    const before = { ...store.getState().room!.style };
    const canUndoBefore = store.canUndo();
    store.applyPreset("espresso-kitchen" as any);
    expect(store.getState().room!.style).toEqual(before);
    expect(store.canUndo()).toBe(canUndoBefore);
  });
});

describe("setRoomSurface", () => {
  beforeEach(() => {
    store.setRoom(200, 200, 96);
  });

  it("sets each surface category independently", () => {
    store.setRoomSurface("floor", "dark-walnut");
    store.setRoomSurface("walls", "sage-green");
    store.setRoomSurface("counter", "black-granite");
    store.setRoomSurface("backsplash", "navy");

    const style = store.getState().room!.style;
    expect(style.floor).toBe("dark-walnut");
    expect(style.walls).toBe("sage-green");
    expect(style.counter).toBe("black-granite");
    expect(style.backsplash).toBe("navy");
  });

  it("ignores an unknown key for any category (no-op)", () => {
    const before = { ...store.getState().room!.style };
    store.setRoomSurface("floor", "lava");
    store.setRoomSurface("counter", "gold");
    expect(store.getState().room!.style).toEqual(before);
  });

  it("is one undo step per call", () => {
    store.setRoomSurface("floor", "dark-walnut");
    store.undo();
    expect(store.getState().room!.style.floor).toBe("light-oak"); // Classic White default
  });
});

describe("setPieceFinish / setPieceDoorStyle", () => {
  beforeEach(() => {
    store.setRoom(200, 200, 96);
    store.selectWall(firstWallId());
  });

  it("sets a finish override on a plain cabinet", () => {
    store.addCabinet("cabinet", "base", 24);
    const id = store.getState().selectedCabinetId!;
    store.setPieceFinish(id, "walnut");
    expect(store.getSelectedCabinet()!.finish).toBe("walnut");
  });

  it("sets a finish override on a filler strip", () => {
    store.fillWall("base"); // 200" wall / 24" cabinets leaves an 8" leftover filler
    const filler = store.getState().room!.walls[0].cabinets.find((c) => c.kind === "filler");
    expect(filler).toBeDefined();
    store.setPieceFinish(filler!.id, "cream");
    expect(store.getState().room!.walls[0].cabinets.find((c) => c.id === filler!.id)!.finish).toBe("cream");
  });

  it("refuses a finish override on an appliance (kind guard)", () => {
    store.addCabinet("fridge", "base");
    const id = store.getState().selectedCabinetId!;
    store.setPieceFinish(id, "navy");
    expect(store.getSelectedCabinet()!.finish).toBeUndefined();
  });

  it("refuses an unknown finish key", () => {
    store.addCabinet("cabinet", "base", 24);
    const id = store.getState().selectedCabinetId!;
    store.setPieceFinish(id, "hot-pink" as any);
    expect(store.getSelectedCabinet()!.finish).toBeUndefined();
  });

  it("sets a door-style override on a real cabinet", () => {
    store.addCabinet("cabinet", "base", 24);
    const id = store.getState().selectedCabinetId!;
    store.setPieceDoorStyle(id, "glass");
    expect(store.getSelectedCabinet()!.doorStyle).toBe("glass");
  });

  it("refuses a door-style override on an appliance", () => {
    store.addCabinet("range", "base");
    const id = store.getState().selectedCabinetId!;
    store.setPieceDoorStyle(id, "shaker");
    expect(store.getSelectedCabinet()!.doorStyle).toBeUndefined();
  });

  it("is one undo step per call", () => {
    store.addCabinet("cabinet", "base", 24);
    const id = store.getState().selectedCabinetId!;
    store.setPieceFinish(id, "walnut");
    store.undo();
    expect(store.getSelectedCabinet()!.finish).toBeUndefined();
  });
});
