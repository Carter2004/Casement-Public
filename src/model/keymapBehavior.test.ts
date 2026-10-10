// keymapBehavior.test.ts — the STORE-level contracts src/ui/keymap.ts's bindings depend on.
// keymap.ts itself is thin DOM glue (window keydown/keyup, document.activeElement) that this
// project's vitest setup can't exercise directly (no jsdom, and the plan calls for no new deps) —
// its actual dispatch wiring is verified live in the browser instead. What IS unit-testable, and
// what actually matters for correctness, is the store machinery every binding delegates to:
// deselectWall (the Esc chain's final fallback) and the beginGesture/dragCabinet-or-moveIsland/
// endGesture coalescing pattern the arrow-nudge binding opens on first keydown and closes on
// keyup — exactly the "one undo step per key-burst" requirement.

import { beforeEach, describe, expect, it } from "vitest";
import { GRID } from "./units";
import { store } from "./store";

function firstWallId(): string {
  return store.getState().room!.walls[0].id;
}

describe("deselectWall (the Esc chain's final fallback)", () => {
  beforeEach(() => {
    store.setRoom(120, 144, 96);
  });

  it("clears the wall selection", () => {
    store.selectWall(firstWallId());
    expect(store.getState().selectedWallId).not.toBeNull();

    store.deselectWall();
    expect(store.getState().selectedWallId).toBeNull();
  });

  it("also clears any piece selection", () => {
    store.selectWall(firstWallId());
    store.addCabinet("cabinet", "base");
    expect(store.getState().selectedCabinetId).not.toBeNull();

    store.deselectWall();
    expect(store.getState().selectedCabinetId).toBeNull();
  });

  it("is a true no-op (no notify) when nothing is selected", () => {
    let notifyCount = 0;
    const unsubscribe = store.subscribe(() => (notifyCount += 1));
    store.deselectWall();
    unsubscribe();
    expect(notifyCount).toBe(0);
  });
});

describe("arrow-nudge burst coalescing (the pattern keymap.ts's openNudgeGesture/closeNudgeGesture uses)", () => {
  beforeEach(() => {
    store.setRoom(120, 144, 96);
  });

  it("a piece nudge burst (beginGesture once, several dragCabinet steps, one endGesture) is ONE undo step", () => {
    store.selectWall(firstWallId());
    store.addCabinet("cabinet", "base");
    const cabinetId = store.getState().selectedCabinetId!;
    const startOffset = store.getState().room!.walls[0].cabinets[0].xOffset;

    // Simulates OS key-repeat firing many keydowns while an arrow key is held: keymap.ts opens
    // the gesture on the FIRST keydown only, then nudges once per keydown.
    store.beginGesture();
    store.dragCabinet(cabinetId, startOffset + GRID);
    store.dragCabinet(cabinetId, startOffset + GRID * 2);
    store.dragCabinet(cabinetId, startOffset + GRID * 3);
    store.endGesture(); // the matching keyup

    expect(store.getState().room!.walls[0].cabinets[0].xOffset).toBe(startOffset + GRID * 3);

    store.undo();
    expect(store.getState().room!.walls[0].cabinets[0].xOffset).toBe(startOffset); // one step, not three
  });

  it("an island nudge burst is likewise ONE undo step", () => {
    store.addIsland();
    const islandId = store.getState().room!.walls.find((w) => w.kind === "island")!.id;
    const island = store.getState().room!.walls.find((w) => w.id === islandId)!;
    const startX = island.start.x;

    store.beginGesture();
    store.moveIsland(islandId, startX + GRID, island.start.y);
    store.moveIsland(islandId, startX + GRID * 2, island.start.y);
    store.endGesture();

    expect(store.getState().room!.walls.find((w) => w.id === islandId)!.start.x).toBe(startX + GRID * 2);

    store.undo();
    expect(store.getState().room!.walls.find((w) => w.id === islandId)!.start.x).toBe(startX);
  });

  it("Shift's 3\" step nudges in one burst still collapse to one undo step", () => {
    store.selectWall(firstWallId());
    store.addCabinet("cabinet", "base");
    const cabinetId = store.getState().selectedCabinetId!;
    const startOffset = store.getState().room!.walls[0].cabinets[0].xOffset;

    store.beginGesture();
    store.dragCabinet(cabinetId, startOffset + 3);
    store.dragCabinet(cabinetId, startOffset + 6);
    store.endGesture();

    expect(store.getState().room!.walls[0].cabinets[0].xOffset).toBe(startOffset + 6);
    store.undo();
    expect(store.getState().room!.walls[0].cabinets[0].xOffset).toBe(startOffset);
  });
});
