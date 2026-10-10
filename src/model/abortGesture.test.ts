// abortGesture.test.ts — cycle 015 audit #5's Esc-abort: mid-drag Escape used to do nothing for
// piece/handle drags (only a catalog drag could cancel). abortGesture() restores the snapshot
// beginGesture took and swallows the gesture entirely — no undo entry, no redo entry, as if the
// drag never happened.

import { beforeEach, describe, expect, it } from "vitest";
import { store } from "./store";

function firstCabinetId(): string {
  return store.getState().room!.walls[0].cabinets[0].id;
}

describe("abortGesture", () => {
  beforeEach(() => {
    store.setRoom(120, 144, 96);
    store.selectWall(store.getState().room!.walls[0].id);
    store.addCabinet("cabinet", "base");
    store.clearHistory(); // isolate this gesture's own effect on the stacks from setup noise
  });

  it("restores the pre-gesture state", () => {
    const startOffset = store.getState().room!.walls[0].cabinets[0].xOffset;
    const cabinetId = firstCabinetId();

    store.beginGesture();
    store.dragCabinet(cabinetId, startOffset + 20);
    expect(store.getState().room!.walls[0].cabinets[0].xOffset).not.toBe(startOffset);

    store.abortGesture();
    expect(store.getState().room!.walls[0].cabinets[0].xOffset).toBe(startOffset);
  });

  it("leaves no undo entry for the aborted gesture", () => {
    const canUndoBefore = store.canUndo(); // false — the floor was just cleared in beforeEach
    const cabinetId = firstCabinetId();
    const startOffset = store.getState().room!.walls[0].cabinets[0].xOffset;

    store.beginGesture();
    store.dragCabinet(cabinetId, startOffset + 20);
    store.abortGesture();

    expect(store.canUndo()).toBe(canUndoBefore);
  });

  it("does not create a redo entry either — Redo can't replay an aborted gesture", () => {
    const cabinetId = firstCabinetId();
    const startOffset = store.getState().room!.walls[0].cabinets[0].xOffset;

    store.beginGesture();
    store.dragCabinet(cabinetId, startOffset + 20);
    store.abortGesture();

    expect(store.canRedo()).toBe(false);
  });

  it("a real edit made AFTER an abort is still its own normal undo step", () => {
    const cabinetId = firstCabinetId();
    const startOffset = store.getState().room!.walls[0].cabinets[0].xOffset;

    store.beginGesture();
    store.dragCabinet(cabinetId, startOffset + 20);
    store.abortGesture();

    store.beginGesture();
    store.dragCabinet(cabinetId, startOffset + 40);
    store.endGesture();
    expect(store.getState().room!.walls[0].cabinets[0].xOffset).toBe(startOffset + 40);

    store.undo();
    expect(store.getState().room!.walls[0].cabinets[0].xOffset).toBe(startOffset);
  });

  it("is a no-op when no gesture is open", () => {
    const before = store.getState().room;
    store.abortGesture();
    expect(store.getState().room).toBe(before);
  });
});
