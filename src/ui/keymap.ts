// keymap.ts — THE one command-key home (cycle 015 audit #5): a single window keydown listener +
// binding table for every command that ISN'T local to a specific gesture — undo/redo,
// Delete/Backspace, the Esc-deselect fallback, and arrow nudge. Gesture-local held-key handling
// stays exactly where it already lived: Space-pan in both views, catalog-drag's own
// Escape-cancel, the 3D overlay's own Escape-close. None of that moves here, and no other module
// may add a NEW window keydown listener after this one.
//
// initKeymap() must be called AFTER every view is constructed (app.ts does this) so each view's
// own gesture-local Escape-abort handling — an EXTENSION of its existing Space-pan keydown
// listener, not a new one — always gets first refusal at the SAME "keydown" event: a view calls
// event.stopImmediatePropagation() the moment it actually aborts a live drag, which (since
// listeners on one target fire in registration order) keeps this module's own Esc fallback from
// running for that keypress. If no gesture was open, no view calls it, and this module's Esc
// binding runs normally.
//
// Also exports THE one isEditableFocused check — both views import it for their Space-pan guard,
// replacing the two identical copies that used to live in elevationView.ts and planView.ts.

import { store } from "../model/store";
import type { Wall } from "../model/room";
import { GRID } from "../model/units";
import { setTransientHint } from "./statusbar";

/** ½" plain nudge, 3" with Shift — the interaction spec's two step sizes. */
const NUDGE_STEP = GRID;
const NUDGE_STEP_SHIFT = 3;
/** Safety close for a nudge burst if a keyup is ever missed (e.g. focus lost mid-hold) — well
 * past any real key-repeat gap, short enough nothing else feels delayed. */
const NUDGE_SAFETY_MS = 400;

const ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

/** True while an input/textarea/select has focus — every command below (and the views' own
 * Space-pan guard) must never fire while the user is typing into a field. THE one copy. */
export function isEditableFocused(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

// ---- Arrow nudge: coalesced per key-burst, same beginGesture/endGesture idiom as a drag -------
// First keydown of a burst opens the gesture; the matching keyup (or a timeout safety, in case a
// keyup is ever missed) closes it — so holding an arrow key (which fires many keydowns via OS key
// repeat) still collapses to ONE undo step, exactly like a pointer drag does.

let nudgeOpen = false;
let nudgeSafetyTimer: number | undefined;

function openNudgeGesture(): void {
  if (nudgeOpen) return;
  store.beginGesture();
  nudgeOpen = true;
}

function closeNudgeGesture(): void {
  if (!nudgeOpen) return;
  store.endGesture();
  nudgeOpen = false;
  if (nudgeSafetyTimer !== undefined) {
    window.clearTimeout(nudgeSafetyTimer);
    nudgeSafetyTimer = undefined;
  }
}

function armNudgeSafety(): void {
  if (nudgeSafetyTimer !== undefined) window.clearTimeout(nudgeSafetyTimer);
  nudgeSafetyTimer = window.setTimeout(closeNudgeGesture, NUDGE_SAFETY_MS);
}

function handleArrowNudge(event: KeyboardEvent): void {
  const cabinet = store.getSelectedCabinet();
  const wall = store.getSelectedWall();
  const island = !cabinet && wall && wall.kind === "island" ? wall : null;
  if (!cabinet && !island) return;

  event.preventDefault();
  const step = event.shiftKey ? NUDGE_STEP_SHIFT : NUDGE_STEP;
  openNudgeGesture();

  if (cabinet) {
    // A perimeter/island piece only travels along its own wall — up/down have nothing to do.
    if (event.key === "ArrowLeft") store.dragCabinet(cabinet.id, cabinet.xOffset - step);
    else if (event.key === "ArrowRight") store.dragCabinet(cabinet.id, cabinet.xOffset + step);
  } else if (island) {
    // An island is free-standing — all four arrows move it (moveIsland's existing sticky-reject
    // silently refuses whatever would collide, same as a pointer drag hitting a wall).
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    store.moveIsland(island.id, island.start.x + dx, island.start.y + dy);
  }

  armNudgeSafety();
}

// ---- Wall paging (cycle 016 Part B3) — room order is exactly room.walls's own order: perimeter
// walls are seeded first, islands are always pushed after, so no separate ordering concept is
// needed. The filmstrip, the elevation header's prev/next buttons, and ←/→ (when no piece is
// selected) all page through this SAME sequence via this ONE pair of functions. -----------------

/** The wall ←/→ (or a header arrow) would land on next, without selecting it — lets the header
 * buttons show "target wall name" as their tooltip without a side effect. */
export function wallAtOffset(direction: 1 | -1): Wall | null {
  const room = store.getState().room;
  if (!room || room.walls.length === 0) return null;
  const currentIndex = room.walls.findIndex((w) => w.id === store.getState().selectedWallId);
  const nextIndex =
    currentIndex === -1 ? (direction === 1 ? 0 : room.walls.length - 1) : (currentIndex + direction + room.walls.length) % room.walls.length;
  return room.walls[nextIndex];
}

/** Page to the next/previous wall in room order, cycling (wraps at either end). */
export function pageWall(direction: 1 | -1): void {
  const wall = wallAtOffset(direction);
  if (wall) store.selectWall(wall.id);
}

// ---- Delete / Backspace -------------------------------------------------------------------

function handleDelete(): void {
  const cabinet = store.getSelectedCabinet();
  if (cabinet) {
    store.deleteCabinet(cabinet.id);
    return;
  }
  // Identical behavior to the properties panel's own "Delete island" button — no confirm here
  // either (undo is the safety net, same posture as applyPreset).
  const wall = store.getSelectedWall();
  if (wall && wall.kind === "island") store.deleteIsland(wall.id);
}

// ---- Ctrl/Cmd+D duplicate (cycle 016 Part D) -------------------------------------------------

/** preventDefault fires whenever this binding is even reached (isEditableFocused already gated
 * it out above) — the browser's own bookmark dialog must never appear once Ctrl+D is a claimed
 * app shortcut, regardless of whether a piece happens to be selected right now. */
function handleDuplicate(event: KeyboardEvent): void {
  event.preventDefault();
  const cabinet = store.getSelectedCabinet();
  if (!cabinet) return;
  const outcome = store.duplicateCabinet(cabinet.id);
  if (!outcome.achieved) setTransientHint(outcome.reason ?? "Can't duplicate here");
}

// ---- Esc fallback (gesture-abort already handled locally by the views before this runs) ------

function handleEscapeFallback(): void {
  if (store.getSelectedCabinet()) {
    store.selectCabinet(null);
    return;
  }
  if (store.getSelectedWall()) store.deselectWall();
}

// ---- Undo/redo (moved here from app.ts's retired wireUndoRedoShortcuts) ----------------------
// Deliberately NOT gated on isEditableFocused — Ctrl+Z/Y is global, works regardless of focus,
// same as before this cycle.

function handleUndoRedo(event: KeyboardEvent): boolean {
  if (!event.ctrlKey) return false;
  const key = event.key.toLowerCase();
  if (key === "z" && !event.shiftKey) {
    event.preventDefault();
    store.undo();
    return true;
  }
  if ((key === "z" && event.shiftKey) || key === "y") {
    event.preventDefault();
    store.redo();
    return true;
  }
  return false;
}

function onKeydown(event: KeyboardEvent): void {
  if (handleUndoRedo(event)) return;
  if (isEditableFocused()) return; // every remaining binding is a typing-unsafe command

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
    handleDuplicate(event);
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    handleDelete();
    return;
  }
  if (event.key === "Escape") {
    handleEscapeFallback();
    return;
  }
  if (ARROW_KEYS.has(event.key)) {
    // Cycle 016 Part B3: ←/→ page walls whenever no PIECE is selected (a wall-only or island
    // selection pages too — up/down still nudge a selected island's y as before). A selected
    // piece keeps the existing arrow-nudge for every direction — nudge wins.
    if (!store.getSelectedCabinet() && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      pageWall(event.key === "ArrowLeft" ? -1 : 1);
      return;
    }
    handleArrowNudge(event);
  }
}

function onKeyup(event: KeyboardEvent): void {
  if (ARROW_KEYS.has(event.key)) closeNudgeGesture();
}

/** Wire THE one command-key listener. Call once, after every view is constructed — see the
 * module doc comment above for why that ordering matters. */
export function initKeymap(): void {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("keyup", onKeyup);
}
