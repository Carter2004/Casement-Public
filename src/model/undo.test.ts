// undo.test.ts — Part 0's test list: round-trip, gesture coalescing (a whole drag or field
// session is ONE undo step, not one per pointermove/keystroke), the stack cap, redo cleared by
// a new edit, and undo restoring a template apply / a Start over. The push-cascade undo case
// lives in store.test.ts ("undo of a push restores every relocated piece") since it needs the
// Part 1 push planner wired into the store, which didn't exist yet when Part 0 landed.

import { beforeEach, describe, expect, it } from "vitest";
import { store } from "./store";

function firstWallId(): string {
  return store.getState().room!.walls[0].id;
}

describe("undo/redo round-trip", () => {
  beforeEach(() => {
    store.setRoom(120, 144, 96);
  });

  it("undoes and redoes a single addCabinet", () => {
    store.selectWall(firstWallId());
    expect(store.getState().room!.walls[0].cabinets).toHaveLength(0);

    store.addCabinet("cabinet", "base");
    expect(store.getState().room!.walls[0].cabinets).toHaveLength(1);

    store.undo();
    expect(store.getState().room!.walls[0].cabinets).toHaveLength(0);

    store.redo();
    expect(store.getState().room!.walls[0].cabinets).toHaveLength(1);
  });

  it("canUndo/canRedo reflect the stacks", () => {
    // The store is a shared singleton across this file's tests, so history from an earlier
    // test may still be on the stack here — assert the RELATIVE transitions an edit/undo must
    // always produce, not an assumed-pristine starting point.
    store.selectWall(firstWallId());
    store.addCabinet("cabinet", "base");
    expect(store.canUndo()).toBe(true); // an edit was just checkpointed
    expect(store.canRedo()).toBe(false); // any new edit clears redo

    store.undo();
    expect(store.canRedo()).toBe(true); // the just-undone edit is now redoable
  });

  it("undo is a no-op once its stack is fully drained", () => {
    // undo()/redo() only ever shuffle entries BETWEEN the two stacks (redo grows exactly as
    // much as undo shrinks) — they never empty both at once except at true app start, so
    // draining undoStack via the real API is the honest way to reach "nothing left to undo".
    while (store.canUndo()) store.undo();

    const before = store.getState().room;
    store.undo();
    expect(store.getState().room).toBe(before); // untouched — same object, not just deep-equal
  });

  it("redo is a no-op right after a fresh edit (which always clears it)", () => {
    store.selectWall(firstWallId());
    store.addCabinet("cabinet", "base"); // any new edit unconditionally clears redoStack
    expect(store.canRedo()).toBe(false);

    const before = store.getState().room;
    store.redo();
    expect(store.getState().room).toBe(before);
  });
});

describe("gesture coalescing", () => {
  beforeEach(() => {
    store.setRoom(120, 144, 96);
    store.selectWall(firstWallId());
    store.addCabinet("cabinet", "base");
  });

  it("a multi-step drag collapses to ONE undo step", () => {
    const cabinetId = store.getState().room!.walls[0].cabinets[0].id;
    const startOffset = store.getState().room!.walls[0].cabinets[0].xOffset;

    store.beginGesture();
    store.dragCabinet(cabinetId, startOffset + 5);
    store.dragCabinet(cabinetId, startOffset + 10);
    store.dragCabinet(cabinetId, startOffset + 15);
    store.endGesture();

    const midDrag = store.getState().room!.walls[0].cabinets[0].xOffset;
    expect(midDrag).toBe(startOffset + 15);

    store.undo();
    const afterOneUndo = store.getState().room!.walls[0].cabinets[0].xOffset;
    expect(afterOneUndo).toBe(startOffset); // back to BEFORE the whole drag, not an intermediate step
  });

  it("a keystroke-by-keystroke field session collapses to ONE undo step", () => {
    const cabinetId = store.getState().room!.walls[0].cabinets[0].id;
    const startWidth = store.getState().room!.walls[0].cabinets[0].width;

    store.beginGesture();
    store.resizeCabinet(cabinetId, { width: startWidth + 1 });
    store.resizeCabinet(cabinetId, { width: startWidth + 12 });
    store.resizeCabinet(cabinetId, { width: startWidth + 18 });
    store.endGesture();

    expect(store.getState().room!.walls[0].cabinets[0].width).toBe(startWidth + 18);

    store.undo();
    expect(store.getState().room!.walls[0].cabinets[0].width).toBe(startWidth); // one step back
  });

  it("a gesture-open edit still counts as ONE step relative to edits before and after it", () => {
    const cabinetId = store.getState().room!.walls[0].cabinets[0].id;
    const startOffset = store.getState().room!.walls[0].cabinets[0].xOffset;

    store.beginGesture();
    store.dragCabinet(cabinetId, startOffset + 5);
    store.dragCabinet(cabinetId, startOffset + 20);
    store.endGesture();

    // A second, separate (non-gesture) edit afterward.
    store.deleteCabinet(cabinetId);
    expect(store.getState().room!.walls[0].cabinets).toHaveLength(0);

    store.undo(); // undoes the delete
    expect(store.getState().room!.walls[0].cabinets).toHaveLength(1);
    expect(store.getState().room!.walls[0].cabinets[0].xOffset).toBe(startOffset + 20);

    store.undo(); // undoes the WHOLE drag in one step
    expect(store.getState().room!.walls[0].cabinets[0].xOffset).toBe(startOffset);
  });
});

describe("undo stack cap", () => {
  it("evicts the oldest entry once the cap is exceeded (FIFO)", () => {
    store.setRoom(200, 200, 96);
    store.selectWall(firstWallId());

    // 55 independent (non-gesture) edits — each auto-checkpoints once.
    for (let i = 0; i < 55; i++) {
      store.addIsland();
    }
    const islandCountAfterAdds = store.getState().room!.walls.filter((w) => w.kind === "island").length;
    expect(islandCountAfterAdds).toBe(55);

    let undone = 0;
    while (store.canUndo()) {
      store.undo();
      undone += 1;
    }

    // Capped at 50: only the last 50 edits are reachable, so 5 islands can never be undone away.
    expect(undone).toBe(50);
    const remainingIslands = store.getState().room!.walls.filter((w) => w.kind === "island").length;
    expect(remainingIslands).toBe(5);
  });
});

describe("redo cleared by a new edit", () => {
  it("a fresh edit after an undo clears whatever was undone", () => {
    store.setRoom(120, 144, 96);
    store.selectWall(firstWallId());
    store.addCabinet("cabinet", "base");

    store.undo();
    expect(store.canRedo()).toBe(true);

    store.addCabinet("cabinet", "wall"); // a new edit, not a redo
    expect(store.canRedo()).toBe(false);
  });
});

describe("undo restores whole-layout operations", () => {
  it("undo restores a template apply", () => {
    store.setRoom(120, 144, 96);
    const before = JSON.stringify(store.getState().room);

    store.applyTemplate("single-wall");
    expect(JSON.stringify(store.getState().room)).not.toBe(before);

    store.undo();
    expect(JSON.stringify(store.getState().room)).toBe(before);
  });

  it("undo restores a room from before a Start over", () => {
    store.setRoom(120, 144, 96);
    store.selectWall(firstWallId());
    store.addCabinet("cabinet", "base");
    const beforeStartOver = JSON.stringify(store.getState().room);

    store.setRoom(200, 200, 96); // "Start over" with a different room
    expect(JSON.stringify(store.getState().room)).not.toBe(beforeStartOver);

    store.undo();
    expect(JSON.stringify(store.getState().room)).toBe(beforeStartOver);
  });
});
