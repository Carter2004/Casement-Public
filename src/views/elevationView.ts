// elevationView.ts — THE head-on renderer for the selected wall. Draws the labeled band
// zones (from bands.ts) and each cabinet as a width×height face locked into its band: a base
// cabinet sits on the floor, a wall cabinet snaps to the 54" band bottom, and the counter->
// uppers gap therefore forms on its own. Cabinets drag horizontally; every edit goes through
// the store, so the plan view updates in lockstep. No view-to-view sync code exists.

import { store, planCabinetDrop } from "../model/store";
import { clamp, MIN_DIMENSION, type Cabinet } from "../model/cabinet";
import { anchorBottomFor, cabinetVerticalPlacement, canPlaceOn, kindDefinition } from "../model/kinds";
import { EPSILON } from "../model/occupancy";
import type { Room, Wall } from "../model/room";
import { resolveSnap, SNAP_THRESHOLD_PX, snapCandidates } from "../model/snapping";
import { catalogDrag, type DragState as CatalogDragState } from "../ui/catalogDrag";
import { isEditableFocused } from "../ui/keymap";
import { setCanvasHover, setTransientHint } from "../ui/statusbar";
import { drawCabinetRect, type PxRect } from "./drawCabinetRect";
import { computeElevationFitTransform, drawElevation, type ElevationTransform } from "./drawElevation";

const HOLD_ALT_HINT = "Hold Alt to push neighbors";
/** Shown once per gesture, the first time a drag snaps (cycle 019 Part 5) — teaches the Ctrl
 * escape hatch without nagging on every subsequent snapped move of the SAME gesture. */
const SNAP_HINT = "Snapped — hold Ctrl for free movement";

const SVG_NS = "http://www.w3.org/2000/svg";
const PADDING_PX = 36;
const HANDLE_THICKNESS_PX = 8;
/** Wheel zoom is clamped to this range of the auto-fit scale (cycle 013 Part 5). */
const ZOOM_MIN_FACTOR = 0.25;
const ZOOM_MAX_FACTOR = 8;
/** Multiplicative zoom per wheel tick — matches the feel planView uses. */
const ZOOM_STEP = 1.1;

type Transform = ElevationTransform;

interface DragState {
  cabinetId: string;
  pointerId: number;
  startClientX: number;
  startOffset: number;
  /** Cycle 019 Part 5: has this gesture already announced its first snap? Set once, so the
   * "Snapped — hold Ctrl for free movement" hint teaches rather than flickers on every move. */
  snapHintShown: boolean;
}

type HandleEdge = "left" | "right" | "top";

interface ResizeDragState {
  cabinetId: string;
  edge: HandleEdge;
  pointerId: number;
}

interface PanDragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startOriginX: number;
  startOriginY: number;
}

export class ElevationView {
  private readonly svg: SVGSVGElement;
  private transform: Transform | null = null;
  /** The auto-fit scale as of the last reset — wheel-zoom clamps relative to THIS, not to 1. */
  private fitScale = 1;
  private lastRoomRef: Room | null = null;
  private lastWallId: string | null = null;
  private drag: DragState | null = null;
  private resizeDrag: ResizeDragState | null = null;
  private panDrag: PanDragState | null = null;
  private spacePressed = false;
  /** Along-wall position of the currently-active snap alignment (cycle 019 Part 5) — null when
   * not snapped. Drawn as a vertical guide line in render(); cleared on every un-snapped move and
   * on gesture end, so it never outlives what it's marking. */
  private snapGuideX: number | null = null;
  /** The SAME idea as snapGuideX, but for a plan-view carry's ghost hovering this canvas (Part 5
   * rework — snap parity with everywhere else). A SEPARATE field because this one has no owned
   * gesture lifecycle to clear it on: renderCatalogGhost (a purely reactive render, not a pointer
   * handler) resets it to null at the top of EVERY call and only sets it when the move-mode
   * branch actually finds a snap, so it can never outlive a carry moving off this canvas. */
  private carryGuideX: number | null = null;

  constructor(private readonly host: HTMLElement) {
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.classList.add("view", "view--elevation");
    this.host.appendChild(this.svg);

    // Pointer handlers live on the persistent root, so re-renders mid-drag don't drop capture.
    this.svg.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    this.svg.addEventListener("pointermove", (e) => this.onPointerMove(e));
    this.svg.addEventListener("pointerup", (e) => this.onPointerUp(e));
    this.svg.addEventListener("pointercancel", (e) => this.onPointerUp(e));
    this.svg.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    this.svg.addEventListener("dblclick", (e) => this.onDoubleClick(e));
    // Camera-hint discoverability (cycle 016 audit #A3) — the statusbar's own hint ladder
    // shows "Scroll to zoom · Space to pan · Double-click to fit" while either canvas is
    // hovered; this view just signals presence, the ladder owns priority/arbitration.
    this.svg.addEventListener("pointerenter", () => setCanvasHover(true));
    this.svg.addEventListener("pointerleave", () => setCanvasHover(false));
    window.addEventListener("keydown", (e) => this.onWindowKeydown(e));
    window.addEventListener("keyup", (e) => this.onWindowKeyup(e));

    store.subscribe(() => this.render());
    window.addEventListener("resize", () => this.render());
    // A catalog drag's ghost lives entirely in render() (same draw path, no second one) — every
    // position update just re-renders like any other store change would.
    catalogDrag.subscribe(() => this.render());
    catalogDrag.onDrop((state) => this.handleCatalogDrop(state));
    this.render();
  }

  private onWindowKeydown(event: KeyboardEvent): void {
    // Gesture-local Escape-abort (cycle 015 audit #5) — stays exactly here, an extension of this
    // view's own existing keydown listener rather than a new one. Checked FIRST and, when it
    // actually aborts a live drag, stops the event from reaching keymap.ts's own Esc fallback
    // (deselect piece/wall) — a gesture in progress always gets first refusal.
    if (event.key === "Escape") {
      if (this.resizeDrag) {
        this.abortResizeDrag(event);
      } else if (this.drag) {
        this.abortPieceDrag(event);
      }
      return;
    }
    if (event.code !== "Space" || isEditableFocused()) return;
    this.spacePressed = true;
    this.svg.classList.add("view--space-pan");
  }

  /** Abort a mid-drag piece move: restore the pre-gesture snapshot (store.abortGesture — no
   * undo entry created) and release the pointer, exactly as if the drag had never started. */
  private abortPieceDrag(event: KeyboardEvent): void {
    if (!this.drag) return;
    if (this.svg.hasPointerCapture(this.drag.pointerId)) this.svg.releasePointerCapture(this.drag.pointerId);
    this.drag = null;
    this.snapGuideX = null;
    store.abortGesture();
    setTransientHint(null);
    event.stopImmediatePropagation();
    event.preventDefault();
  }

  /** Abort a mid-drag handle resize — same contract as abortPieceDrag above. */
  private abortResizeDrag(event: KeyboardEvent): void {
    if (!this.resizeDrag) return;
    if (this.svg.hasPointerCapture(this.resizeDrag.pointerId)) this.svg.releasePointerCapture(this.resizeDrag.pointerId);
    this.resizeDrag = null;
    store.abortGesture();
    event.stopImmediatePropagation();
    event.preventDefault();
  }

  private onWindowKeyup(event: KeyboardEvent): void {
    if (event.code !== "Space") return;
    this.spacePressed = false;
    this.svg.classList.remove("view--space-pan");
  }

  /** Cursor-centered zoom: the world point under the cursor stays under the cursor. Clamped to
   * [0.25x, 8x] of the auto-fit scale, not of the current scale — so repeated zooming can't drift
   * past the intended range. */
  private onWheel(event: WheelEvent): void {
    if (!this.transform) return;
    event.preventDefault();
    const t = this.transform;
    const svgRect = this.svg.getBoundingClientRect();
    const cursorX = event.clientX - svgRect.left;
    const cursorY = event.clientY - svgRect.top;

    const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    const newScale = clamp(t.scale * factor, this.fitScale * ZOOM_MIN_FACTOR, this.fitScale * ZOOM_MAX_FACTOR);
    // Both axes read as generic (cursor - origin) / scale — pxY's ceiling-flip is baked into
    // origin/scale the same way pxX's is, so the same formula works for both.
    const worldX = (cursorX - t.originX) / t.scale;
    const worldY = (cursorY - t.originY) / t.scale;
    this.transform = {
      ...t,
      scale: newScale,
      originX: cursorX - worldX * newScale,
      originY: cursorY - worldY * newScale,
    };
    this.render();
  }

  /** Double-click on EMPTY canvas (not a piece/handle) resets to the auto-fit view. */
  private onDoubleClick(event: MouseEvent): void {
    const target = event.target as Element | null;
    if (target?.closest("[data-cabinet-id], [data-handle-edge]")) return;
    const room = store.getState().room;
    const wall = store.getSelectedWall();
    if (!room || !wall) return;
    this.transform = this.computeFitTransform(wall, room.wallHeight);
    this.fitScale = this.transform.scale;
    this.render();
  }

  /** Is this screen point over THIS view's own canvas? Every ghost/drop decision starts here —
   * catalogDrag carries only a raw screen position, so each view tests it against its own
   * bounding rect rather than assuming the point is meant for it. */
  private containsPoint(clientX: number, clientY: number): boolean {
    const rect = this.svg.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  /**
   * ONE drop dispatch for BOTH coordinator payload modes (cycle 019 Part 2) — always onto
   * whichever wall the elevation is currently showing (its own long-standing rule for a
   * catalog-add drop; a carried piece dropped here re-anchors onto the wall on screen, the same
   * "drop at cursor" grammar as everywhere else). `mode:'add'` is cycle 013's original behavior,
   * byte-identical; `mode:'move'` (cycle 019) routes to movePieceToWall instead of addCabinetAt.
   */
  private handleCatalogDrop(state: CatalogDragState): void {
    if (!this.containsPoint(state.clientX, state.clientY) || !this.transform) return;
    const wall = store.getSelectedWall();
    if (!wall) return;
    const svgRect = this.svg.getBoundingClientRect();
    const t = this.transform;
    const xOffset = (state.clientX - svgRect.left - t.originX) / t.scale;

    const outcome =
      state.payload.mode === "add"
        ? store.addCabinetAt(
            state.payload.spec.kind,
            state.payload.spec.band,
            state.payload.spec.width,
            wall.id,
            xOffset,
            state.payload.spec.overrides,
          )
        : store.movePieceToWall(
            state.payload.pieceId,
            wall.id,
            this.snappedMoveTarget(wall, state.payload.pieceId, xOffset, state.ctrlKey, t.scale),
          );
    setTransientHint(outcome.achieved ? null : (outcome.reason ?? "Can't drop here"));
  }

  /** The SAME snap adjustment renderCatalogGhost's move-branch applies to its preview (Part 5
   * rework — snap parity) — kept in one place so a carry-drop on this canvas always lands
   * exactly where its ghost just showed. */
  private snappedMoveTarget(wall: Wall, pieceId: string, along: number, ctrlKey: boolean, scale: number): number {
    const room = store.getState().room;
    const cabinet = room ? this.locatePiece(room, pieceId)?.cabinet : undefined;
    if (!cabinet) return along;
    return this.applySnap(wall, cabinet.width, cabinet.id, along, ctrlKey, scale);
  }

  private onPointerDown(event: PointerEvent): void {
    // Pan (middle-button, or space+drag) wins over everything — a middle-click or a space-held
    // drag is never meant to select/move a piece.
    if (this.transform && (event.button === 1 || this.spacePressed)) {
      this.panDrag = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startOriginX: this.transform.originX,
        startOriginY: this.transform.originY,
      };
      event.preventDefault();
      try {
        this.svg.setPointerCapture(event.pointerId);
      } catch {
        /* pointer capture is a best-effort affordance */
      }
      return;
    }

    const target = event.target as Element | null;

    // A handle grab wins over a plain piece drag — checked first since a handle sits on top of
    // (overlapping) its own cabinet's face.
    const handleEl = target?.closest<SVGElement>("[data-handle-edge]");
    const handleCabinetId = handleEl?.dataset.handleCabinetId;
    const handleEdge = handleEl?.dataset.handleEdge as HandleEdge | undefined;
    if (handleCabinetId && handleEdge) {
      this.resizeDrag = { cabinetId: handleCabinetId, edge: handleEdge, pointerId: event.pointerId };
      // One undo step per handle drag, not one per pointermove — see store.beginGesture.
      store.beginGesture();
      try {
        this.svg.setPointerCapture(event.pointerId);
      } catch {
        /* pointer capture is a best-effort affordance */
      }
      return;
    }

    const cabinetEl = target?.closest<SVGElement>("[data-cabinet-id]");
    const id = cabinetEl?.dataset.cabinetId;
    if (!id) return;
    store.selectCabinet(id);
    const cabinet = store.getSelectedCabinet();
    if (!cabinet) return;
    this.drag = {
      cabinetId: id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startOffset: cabinet.xOffset,
      snapHintShown: false,
    };
    // One undo step per drag, not one per pointermove — see store.beginGesture.
    store.beginGesture();
    // Capturing keeps the drag alive if the pointer leaves the rect; harmless if unsupported.
    try {
      this.svg.setPointerCapture(event.pointerId);
    } catch {
      /* pointer capture is a best-effort affordance */
    }
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.panDrag && this.panDrag.pointerId === event.pointerId && this.transform) {
      const dx = event.clientX - this.panDrag.startClientX;
      const dy = event.clientY - this.panDrag.startClientY;
      this.transform = {
        ...this.transform,
        originX: this.panDrag.startOriginX + dx,
        originY: this.panDrag.startOriginY + dy,
      };
      this.render();
      return;
    }
    if (this.resizeDrag && this.resizeDrag.pointerId === event.pointerId && this.transform) {
      const t = this.transform;
      // clientX/Y are viewport-relative; the transform's origin is relative to the SVG's own
      // top-left — convert through the SVG's own screen rect first (the existing drag code
      // sidesteps this by using deltas, which cancel the SVG's screen offset out; an ABSOLUTE
      // position, as every handle needs, can't take that shortcut).
      const svgRect = this.svg.getBoundingClientRect();
      const value =
        this.resizeDrag.edge === "top"
          ? t.wallHeight - (event.clientY - svgRect.top - t.originY) / t.scale
          : (event.clientX - svgRect.left - t.originX) / t.scale;
      store.resizeCabinetEdge(this.resizeDrag.cabinetId, this.resizeDrag.edge, value);
      return;
    }
    if (!this.drag || this.drag.pointerId !== event.pointerId || !this.transform) return;
    const wall = store.getSelectedWall();
    const deltaInches = (event.clientX - this.drag.startClientX) / this.transform.scale;
    const rawDesired = this.drag.startOffset + deltaInches;

    // Snapping (cycle 019 Part 5) — wall-center + edge-alignment against every other piece on
    // the wall, skipped entirely while Ctrl is held; never applied to a nudge/typed value (this
    // is the live pointer-drag path only).
    let desired = rawDesired;
    this.snapGuideX = null;
    if (wall && !event.ctrlKey) {
      const candidates = snapCandidates(wall, wall.cabinets.find((c) => c.id === this.drag!.cabinetId)?.width ?? 0, this.drag.cabinetId);
      const snap = resolveSnap(rawDesired, candidates, SNAP_THRESHOLD_PX / this.transform.scale);
      if (snap) {
        desired = snap.offset;
        this.snapGuideX = snap.guideAt;
      }
    }

    // Alt held = route through the push cascade (decision 2); plain = today's stop-at-neighbor.
    // Live — pressing/releasing Alt mid-drag switches mode on the very next pointermove.
    store.dragCabinet(this.drag.cabinetId, desired, event.altKey);

    if (event.altKey) {
      setTransientHint(null);
    } else {
      const current = store.getSelectedCabinet();
      const blocked = current !== null && Math.abs(current.xOffset - desired) > EPSILON;
      if (blocked) {
        setTransientHint(HOLD_ALT_HINT);
      } else if (this.snapGuideX !== null && !this.drag.snapHintShown) {
        // First snap of this gesture (cycle 019 Part 5) — a one-time teaching moment, not a live
        // status: shown once, then left alone (not re-cleared every move) until the gesture ends.
        setTransientHint(SNAP_HINT);
        this.drag.snapHintShown = true;
      } else if (!this.drag.snapHintShown) {
        setTransientHint(null);
      }
    }
  }

  private onPointerUp(event: PointerEvent): void {
    if (this.panDrag && this.panDrag.pointerId === event.pointerId) {
      if (this.svg.hasPointerCapture(event.pointerId)) this.svg.releasePointerCapture(event.pointerId);
      this.panDrag = null;
      return;
    }
    if (this.resizeDrag && this.resizeDrag.pointerId === event.pointerId) {
      if (this.svg.hasPointerCapture(event.pointerId)) this.svg.releasePointerCapture(event.pointerId);
      this.resizeDrag = null;
      store.endGesture();
      return;
    }
    if (!this.drag || this.drag.pointerId !== event.pointerId) return;
    if (this.svg.hasPointerCapture(event.pointerId)) this.svg.releasePointerCapture(event.pointerId);
    this.drag = null;
    this.snapGuideX = null;
    store.endGesture();
    // The transient hint is display-only for the gesture in progress — never outlives it.
    setTransientHint(null);
    // endGesture() only decrements the gesture depth — it does NOT notify() — so a plain
    // slide-release would otherwise leave the last-drawn .guide line orphaned in the DOM until
    // some later store-triggered repaint (snapGuideX is already cleared above; this just makes
    // the clear visible NOW, same rule planView's own onPointerUp follows).
    this.render();
  }

  private computeFitTransform(wall: Wall, wallHeight: number): Transform {
    const rect = this.svg.getBoundingClientRect();
    const w = rect.width || this.host.clientWidth || 600;
    const h = rect.height || this.host.clientHeight || 400;
    return computeElevationFitTransform(wall, wallHeight, w, h, PADDING_PX);
  }

  private render(): void {
    const { room, selectedCabinetId } = store.getState();
    const wall = store.getSelectedWall();
    this.svg.replaceChildren();

    if (!room || !wall) {
      this.transform = null;
      this.lastRoomRef = room;
      this.lastWallId = wall?.id ?? null;
      const hint = document.createElementNS(SVG_NS, "text");
      hint.classList.add("view__hint");
      hint.setAttribute("x", "50%");
      hint.setAttribute("y", "50%");
      hint.textContent = "Select a wall in the plan to stand it up here.";
      this.svg.appendChild(hint);
      return;
    }

    // Reset to the auto-fit view whenever the room is replaced (setRoom/hydrate/resizeRoom all
    // install a fresh room object) or the selected wall switches — any other store notify (an
    // edit within the SAME room/wall) keeps the user's current zoom/pan exactly as it was.
    const shouldResetFit = room !== this.lastRoomRef || wall.id !== this.lastWallId || !this.transform;
    this.lastRoomRef = room;
    this.lastWallId = wall.id;
    if (shouldResetFit) {
      this.transform = this.computeFitTransform(wall, room.wallHeight);
      this.fitScale = this.transform.scale;
    }
    const t = this.transform;
    if (!t) return; // unreachable (shouldResetFit above guarantees a transform), narrows for TS

    // THE shared drawing core (cycle 016 Part B1) — band zones, floor line, every piece face.
    // Selection handles and the catalog-drag ghost are layered on top below (view-local: they
    // need live gesture state a thumbnail never has).
    drawElevation(this.svg, room, wall, t, { selectedCabinetId });

    const pxX = (xIn: number) => t.originX + xIn * t.scale;
    const pxY = (heightIn: number) => t.originY + (t.wallHeight - heightIn) * t.scale;

    const selectedCabinet = selectedCabinetId ? wall.cabinets.find((c) => c.id === selectedCabinetId) : undefined;
    if (selectedCabinet) {
      const placement = cabinetVerticalPlacement(selectedCabinet);
      const pxRect: PxRect = {
        x: pxX(selectedCabinet.xOffset),
        y: pxY(placement.top),
        width: selectedCabinet.width * t.scale,
        height: selectedCabinet.height * t.scale,
      };
      this.renderHandles(selectedCabinet, pxRect);
    }

    this.renderCatalogGhost(wall, t, pxX, pxY);
    if (this.snapGuideX !== null) this.renderSnapGuide(this.snapGuideX, t, pxX);
    if (this.carryGuideX !== null) this.renderSnapGuide(this.carryGuideX, t, pxX);
  }

  /** A vertical guide line through the active snap alignment (cycle 019 Part 5) — first
   * definition of the .guide class family, dashed + token-colored, cleared the instant the drag
   * un-snaps or the gesture ends (drawn only while snapGuideX is non-null). */
  private renderSnapGuide(guideX: number, t: Transform, pxX: (xIn: number) => number): void {
    const line = document.createElementNS(SVG_NS, "line");
    line.classList.add("guide");
    const x = pxX(guideX);
    line.setAttribute("x1", String(x));
    line.setAttribute("x2", String(x));
    line.setAttribute("y1", String(t.originY));
    line.setAttribute("y2", String(t.originY + t.wallHeight * t.scale));
    this.svg.appendChild(line);
  }

  /**
   * Catalog drag-ghost preview (cycle 013; cycle 019 generalized to both payload modes) — the
   * SAME drawCabinetRect renderer, two modifiers. Valid/invalid and landing position come from
   * planCabinetDrop (with excludeCabinetId for a move, cycle 019), the exact function
   * addCabinetAt/movePieceToWall call at drop time, so the ghost never promises a placement the
   * drop can't keep.
   */
  private renderCatalogGhost(
    wall: Wall,
    t: Transform,
    pxX: (xIn: number) => number,
    pxY: (heightIn: number) => number,
  ): void {
    // Reset FIRST, unconditionally — carryGuideX has no owned gesture to clear it otherwise (a
    // carry drifting off this canvas, or ending, must not leave a stale line behind); the move
    // branch below re-sets it only if this exact call finds a live snap.
    this.carryGuideX = null;
    const drag = catalogDrag.current();
    if (!drag || !this.containsPoint(drag.clientX, drag.clientY)) return;
    const room = store.getState().room;
    if (!room) return;

    const svgRect = this.svg.getBoundingClientRect();
    const targetXOffset = (drag.clientX - svgRect.left - t.originX) / t.scale;

    if (drag.payload.mode === "add") {
      const { kind, band } = drag.payload.spec;
      const def = kindDefinition(kind, band);
      const bottom = anchorBottomFor({ kind, type: def.band });
      // Cycle 016 Part C1: a variant preset's height reflects in the ghost too (a tall ghost for
      // the tall row) — the SAME height addCabinetAt will apply at drop, via applyPieceOverrides.
      const ghostHeight = drag.payload.spec.overrides?.height ?? def.defaultSize.height;
      const canPlace = canPlaceOn(wall.kind, kind, band);
      const plan = canPlace
        ? planCabinetDrop(room, wall, kind, band, drag.payload.spec.width, targetXOffset)
        : {
            xOffset: Math.max(
              0,
              Math.min(targetXOffset, wall.length - Math.max(MIN_DIMENSION, drag.payload.spec.width)),
            ),
            width: Math.max(MIN_DIMENSION, drag.payload.spec.width),
            valid: false,
          };

      const ghostCabinet: Cabinet = {
        id: "ghost",
        kind,
        type: def.band,
        xOffset: plan.xOffset,
        width: plan.width,
        height: ghostHeight,
        depth: def.defaultSize.depth,
      };
      this.drawGhostAt(ghostCabinet, plan.valid, bottom + ghostHeight, pxX, pxY, t);
      return;
    }

    // mode === "move" (cycle 019): ghost the REAL carried piece (its own kind/dims/finish),
    // excluding it from the target's own occupancy so it never corner-blocks itself. Rework
    // (Carter's ruling): snapping applies here exactly like everywhere else — the SAME
    // applySnap helper handleCatalogDrop below calls, so the ghost and the drop always agree.
    const located = this.locatePiece(room, drag.payload.pieceId);
    if (!located) return;
    const { cabinet } = located;
    const bottom = anchorBottomFor(cabinet);
    const target = this.applySnap(wall, cabinet.width, cabinet.id, targetXOffset, drag.ctrlKey, t.scale);
    if (target !== targetXOffset) this.carryGuideX = target;
    const canPlace = canPlaceOn(wall.kind, cabinet.kind, cabinet.type);
    const plan = canPlace
      ? planCabinetDrop(room, wall, cabinet.kind, cabinet.type, cabinet.width, target, cabinet.id)
      : {
          xOffset: Math.max(0, Math.min(target, wall.length - Math.max(MIN_DIMENSION, cabinet.width))),
          width: Math.max(MIN_DIMENSION, cabinet.width),
          valid: false,
        };

    const ghostCabinet: Cabinet = { ...cabinet, id: "ghost", xOffset: plan.xOffset, width: plan.width };
    this.drawGhostAt(ghostCabinet, plan.valid, bottom + cabinet.height, pxX, pxY, t);
  }

  /** Snap `along` against `wall`'s own candidates (cycle 019 Part 5 rework — snap parity with
   * planView's own applySnap), unless Ctrl is held — pure, used by both the move-mode ghost
   * preview above and the drop dispatch below so they always agree on where a carry lands.
   * `scale` is the caller's own live composed transform scale (cycle 020 Part 2's
   * pixel-constant snap zone — see planView's own copy of this comment). */
  private applySnap(wall: Wall, width: number, excludeId: string, along: number, ctrlKey: boolean, scale: number): number {
    if (ctrlKey) return along;
    const snap = resolveSnap(along, snapCandidates(wall, width, excludeId), SNAP_THRESHOLD_PX / scale);
    return snap ? snap.offset : along;
  }

  private drawGhostAt(
    ghostCabinet: Cabinet,
    valid: boolean,
    topFromFloor: number,
    pxX: (xIn: number) => number,
    pxY: (heightIn: number) => number,
    t: Transform,
  ): void {
    const g = drawCabinetRect(
      ghostCabinet,
      {
        x: pxX(ghostCabinet.xOffset),
        y: pxY(topFromFloor),
        width: ghostCabinet.width * t.scale,
        height: ghostCabinet.height * t.scale,
      },
      { ghost: true, ghostInvalid: !valid },
    );
    this.svg.appendChild(g);
  }

  /** Finds a piece by id across every wall in the room (cycle 019) — used by the move-mode ghost
   * to look up the carried piece's real shape/finish, and will double as Part 3's home-wall
   * lookup for the plan-view slide-vs-carry decision. */
  private locatePiece(room: Room, id: string): { wall: Wall; cabinet: Cabinet } | null {
    for (const w of room.walls) {
      const cabinet = w.cabinets.find((c) => c.id === id);
      if (cabinet) return { wall: w, cabinet };
    }
    return null;
  }

  /** Three drag handles on the selected piece: left/right (width) and top (height) — one
   * .handle class family (+ cursor modifiers), same pointer-capture idiom as every other drag. */
  private renderHandles(cabinet: Cabinet, rect: PxRect): void {
    const left = document.createElementNS(SVG_NS, "rect");
    left.classList.add("handle", "handle--left", "handle--ew-resize");
    left.dataset.handleCabinetId = cabinet.id;
    left.dataset.handleEdge = "left";
    left.setAttribute("x", String(rect.x - HANDLE_THICKNESS_PX / 2));
    left.setAttribute("y", String(rect.y));
    left.setAttribute("width", String(HANDLE_THICKNESS_PX));
    left.setAttribute("height", String(Math.max(0, rect.height)));
    this.svg.appendChild(left);

    const right = document.createElementNS(SVG_NS, "rect");
    right.classList.add("handle", "handle--right", "handle--ew-resize");
    right.dataset.handleCabinetId = cabinet.id;
    right.dataset.handleEdge = "right";
    right.setAttribute("x", String(rect.x + rect.width - HANDLE_THICKNESS_PX / 2));
    right.setAttribute("y", String(rect.y));
    right.setAttribute("width", String(HANDLE_THICKNESS_PX));
    right.setAttribute("height", String(Math.max(0, rect.height)));
    this.svg.appendChild(right);

    const top = document.createElementNS(SVG_NS, "rect");
    top.classList.add("handle", "handle--top", "handle--ns-resize");
    top.dataset.handleCabinetId = cabinet.id;
    top.dataset.handleEdge = "top";
    top.setAttribute("x", String(rect.x));
    top.setAttribute("y", String(rect.y - HANDLE_THICKNESS_PX / 2));
    top.setAttribute("width", String(Math.max(0, rect.width)));
    top.setAttribute("height", String(HANDLE_THICKNESS_PX));
    this.svg.appendChild(top);
  }
}
