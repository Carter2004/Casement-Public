// catalogDrag.ts — THE one cross-surface drag coordinator (cycle 013: catalog add-rows; cycle
// 019 generalized to also carry an EXISTING piece across walls/views). A pointer-based custom
// drag (not HTML5 drag-and-drop): whoever owns the pointerdown (catalog.ts for an add-row, a
// view's own piece pointerdown for a move, cycle 019 Part 3) starts/updates/ends it from a
// window-level pointer listener; each view (and the filmstrip, Part 4) subscribes to render its
// own ghost/highlight and registers a drop listener to attempt the actual placement — only the
// surface under the cursor knows which wall/xOffset a screen point maps to, so this module
// carries position + payload only, never any placement math.
//
// Payload is a union: `{mode:'add', spec}` (a fresh catalog piece, today's behavior, unchanged)
// or `{mode:'move', pieceId}` (an existing piece being re-anchored, cycle 019). Window-level
// pointer tracking, the movement threshold, ghost lifecycle, Escape-cancel, and drop dispatch
// are ALL shared between the two — only what a drop actually DOES (addCabinetAt vs
// movePieceToWall) differs, and that branch lives in each subscriber's own onDrop handler.

import type { CabinetType } from "../model/cabinet";
import type { PieceKind } from "../model/kinds";
import type { PieceOverrides } from "../model/store";

export interface DragSpec {
  kind: PieceKind;
  band: CabinetType;
  width: number;
  /** Optional variant preset (cycle 016 Part C1) — a tall/glass/open-shelf catalog row carries
   * its own height/doorStyle through the drag, applied at drop the same way a click-add applies
   * it; the drag ghost also reflects it (a tall ghost for the tall row). */
  overrides?: PieceOverrides;
}

/** A fresh piece from the catalog, or an EXISTING piece being carried to a new wall/island
 * (cycle 019) — the one thing a drop handler branches on; everything else about the drag
 * (tracking, threshold, ghost lifecycle, Escape, drop dispatch) is identical either way. */
export type DragPayload = { mode: "add"; spec: DragSpec } | { mode: "move"; pieceId: string };

export interface DragState {
  payload: DragPayload;
  clientX: number;
  clientY: number;
  /** Live Ctrl state as of the last start/move (cycle 019 Part 5) — a move-mode ghost/drop reads
   * this to skip snapping while held; an 'add' payload never consults it. Defaults false so every
   * existing call site (catalog.ts's own drag, which never passes it) is unaffected. */
  ctrlKey: boolean;
}

type Listener = (state: DragState | null) => void;
type DropListener = (state: DragState) => void;

class DragCoordinator {
  private state: DragState | null = null;
  private listeners = new Set<Listener>();
  private dropListeners = new Set<DropListener>();

  /** Fires on every start/move/cancel/drop — views re-render their ghost/highlight from this. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Registered once per view/thumb; fires on drop, BEFORE the drag state clears, with the
   * drag's final position — the listener decides for itself whether that position was over its
   * own target (each surface already knows how to test that against its own bounding rect). */
  onDrop(listener: DropListener): () => void {
    this.dropListeners.add(listener);
    return () => this.dropListeners.delete(listener);
  }

  current(): DragState | null {
    return this.state;
  }

  start(payload: DragPayload, clientX: number, clientY: number, ctrlKey = false): void {
    this.state = { payload, clientX, clientY, ctrlKey };
    document.body.classList.add("catalog-dragging");
    this.notify();
  }

  move(clientX: number, clientY: number, ctrlKey = false): void {
    if (!this.state) return;
    this.state = { ...this.state, clientX, clientY, ctrlKey };
    this.notify();
  }

  /** Attempt a drop at the drag's current position, then always end the drag. */
  drop(): void {
    const state = this.state;
    if (state) for (const listener of this.dropListeners) listener(state);
    this.end();
  }

  /** Cancel without attempting a drop (Escape, or a release with no drag ever started). */
  cancel(): void {
    this.end();
  }

  private end(): void {
    this.state = null;
    document.body.classList.remove("catalog-dragging");
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}

export const catalogDrag = new DragCoordinator();
