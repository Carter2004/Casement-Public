// undoFloor.test.ts — cycle 015 audit #4: fresh-page Ctrl+Z used to pop the very checkpoint
// hydrate()/setRoom() took at boot, blanking the workspace (room: null) on the single most
// reflexive editor keystroke. clearHistory() (called once by app.ts right after boot) wipes both
// stacks so that never happens again — this file tests clearHistory() directly, the same call
// app.ts's mountApp makes after its own hydrate/setRoom.

import { describe, expect, it } from "vitest";
import { store } from "./store";

describe("undo floor (clearHistory)", () => {
  it("undo() is a no-op immediately after the floor is established", () => {
    store.setRoom(120, 144, 96);
    store.clearHistory();
    expect(store.canUndo()).toBe(false);

    store.undo();
    expect(store.getState().room).not.toBeNull();
  });

  it("also wipes any redo history accumulated before boot finished", () => {
    store.setRoom(120, 144, 96);
    store.selectWall(store.getState().room!.walls[0].id);
    store.addCabinet("cabinet", "base");
    store.undo();
    expect(store.canRedo()).toBe(true);

    store.clearHistory();
    expect(store.canRedo()).toBe(false);
  });

  it("no undo sequence after the floor ever yields a null room, however many times it fires", () => {
    store.setRoom(120, 144, 96);
    store.clearHistory();
    for (let i = 0; i < 10; i++) store.undo();
    expect(store.getState().room).not.toBeNull();
  });

  it("edits made after the floor are still fully undoable down to the floor, never past it", () => {
    store.setRoom(120, 144, 96);
    store.clearHistory();
    store.selectWall(store.getState().room!.walls[0].id);
    store.addCabinet("cabinet", "base");
    expect(store.getState().room!.walls[0].cabinets).toHaveLength(1);

    store.undo();
    expect(store.getState().room!.walls[0].cabinets).toHaveLength(0);
    expect(store.getState().room).not.toBeNull();

    store.undo(); // past the floor — a no-op, not a room:null
    expect(store.getState().room).not.toBeNull();
    expect(store.canUndo()).toBe(false);
  });
});
