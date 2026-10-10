// planView.ts — THE top-down renderer. Draws the four perimeter walls as thin segments and
// any islands as a footprint "deck" outline, each cabinet as a width×depth footprint against
// its wall (perimeter or island — cabinetFootprint is wall-agnostic). Clicking a wall or an
// island selects it for the elevation view; clicking a footprint selects that cabinet;
// dragging an island moves it. The view holds no geometry of its own: it reads the store and
// mutates only through it, so every elevation/properties edit shows up here automatically.

import { store, planCabinetDrop } from "../model/store";
import { clamp, type Cabinet } from "../model/cabinet";
import { resolveFinish } from "../model/finishes";
import { canPlaceOn, kindDefinition } from "../model/kinds";
import { EPSILON } from "../model/occupancy";
import { cabinetFootprint, islandOrientation, quadBounds, type Room, type Wall } from "../model/room";
import { resolveSnap, SNAP_THRESHOLD_PX, snapCandidates } from "../model/snapping";
import { catalogDrag, type DragState } from "../ui/catalogDrag";
import { isEditableFocused } from "../ui/keymap";
import { setCanvasHover, setTransientHint } from "../ui/statusbar";
import { drawCabinetRect } from "./drawCabinetRect";

const SVG_NS = "http://www.w3.org/2000/svg";
const PADDING_PX = 28;
const WALL_THICKNESS_PX = 8;
const HANDLE_THICKNESS_PX = 8;
/** Wheel zoom is clamped to this range of the auto-fit scale (cycle 013 Part 5). */
const ZOOM_MIN_FACTOR = 0.25;
const ZOOM_MAX_FACTOR = 8;
const ZOOM_STEP = 1.1;
const HOLD_ALT_HINT = "Hold Alt to push neighbors";
/** Shown once per gesture, the first time a slide or carry snaps (cycle 019 Part 5) — same
 * wording/one-shot idiom as elevationView's own copy. */
const SNAP_HINT = "Snapped — hold Ctrl for free movement";
/** Same idiom as catalog.ts's own DRAG_THRESHOLD_PX (cycle 013): a plain click on a footprint
 * must still just select it (the existing `click` listener) — a piece drag/carry only engages
 * once the pointer has actually moved, so hand jitter on a click never starts one. */
const PIECE_DRAG_THRESHOLD_PX = 4;
/** How far into the room a plan-view snap guide is drawn (cycle 019 Part 5) — spans a typical
 * cabinet's depth so the line visibly crosses whatever's aligning, without needing the ACTUAL
 * piece's own depth (a guide marks an along-wall alignment, not a footprint). */
const GUIDE_DEPTH_IN = 30;

/**
 * Anchors a plan-view slide to WHERE the piece was grabbed, not to the piece's own left edge
 * (cycle 020 Part 1 — elevation parity). `offsetAtGrab + (projectedNow - projectedAtGrab)` is
 * exactly elevation's own `startOffset + deltaInches`, just expressed in along-wall PROJECTION
 * units instead of a raw screen-pixel delta — plan's cursor doesn't move in a straight screen
 * line along an angled wall, so the "delta" has to be computed in the same along-wall space the
 * projection already lives in, not in raw pixels.
 *
 * Exported and unit-tested in isolation (planView.test.ts, the keymap.test.ts precedent for
 * ui-layer pure logic): a grab dead-center holds the grab point for the whole slide (zero jump
 * on the first move, since `projectedNow === projectedAtGrab` there); a grab exactly at the
 * piece's own left edge (`projectedAtGrab === offsetAtGrab`) reproduces the OLD bare-projection
 * behavior byte-for-byte, since the formula then reduces to `projectedNow`.
 */
export function grabAnchoredOffset(projectedNow: number, projectedAtGrab: number, offsetAtGrab: number): number {
  return offsetAtGrab + (projectedNow - projectedAtGrab);
}

interface Transform {
  scale: number;
  originX: number;
  originY: number;
}

interface IslandDragState {
  islandId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
}

type IslandHandleEnd = "start" | "end";

interface IslandResizeDragState {
  islandId: string;
  end: IslandHandleEnd;
  pointerId: number;
}

interface PanDragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startOriginX: number;
  startOriginY: number;
}

/**
 * Plan-view piece drag (cycle 019 Part 3): slide-at-home / carry-when-away. `started` gates the
 * click threshold (see PIECE_DRAG_THRESHOLD_PX) — false until real movement is seen, so a plain
 * click never engages beginGesture/dragCabinet at all. `startOffset` is the piece's xOffset at
 * gesture start (BEFORE any of this gesture's own edits) — what a carry snaps back to, since
 * "it honestly hasn't moved" home while a ghost previews the target elsewhere. `carrying` is
 * true exactly while the coordinator (catalogDrag, mode:'move') owns the ghost for this piece;
 * false while sliding live on its own home wall (the real cabinet follows the cursor directly).
 */
interface PieceDragState {
  cabinetId: string;
  pointerId: number;
  homeWallId: string;
  startClientX: number;
  startClientY: number;
  startOffset: number;
  /** The home wall's along-wall projection of the cursor AT GRAB TIME (cycle 020 Part 1) — the
   * anchor grabAnchoredOffset holds for the whole gesture, so the piece keeps whatever point it
   * was grabbed at instead of teleporting its left edge to the cursor on the first move. */
  grabProjected: number;
  started: boolean;
  carrying: boolean;
  /** Cycle 019 Part 5: has this gesture already announced its first snap? Set once, so
   * SNAP_HINT teaches rather than flickers on every subsequent snapped move. */
  snapHintShown: boolean;
}

export class PlanView {
  private readonly svg: SVGSVGElement;
  private transform: Transform | null = null;
  /** The auto-fit scale as of the last reset — wheel-zoom clamps relative to THIS, not to 1. */
  private fitScale = 1;
  private lastRoomRef: Room | null = null;
  private islandDrag: IslandDragState | null = null;
  private islandResizeDrag: IslandResizeDragState | null = null;
  private pieceDrag: PieceDragState | null = null;
  private panDrag: PanDragState | null = null;
  private spacePressed = false;
  /** The active snap alignment (cycle 019 Part 5), if any — the wall it's on plus the along-wall
   * position to draw the guide at. Drawn as a line across that wall's depth strip in render();
   * cleared the instant a move un-snaps or the gesture ends. */
  private snapGuide: { wallId: string; along: number } | null = null;

  constructor(private readonly host: HTMLElement) {
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.classList.add("view", "view--plan");
    this.host.appendChild(this.svg);

    // Event delegation on the persistent root: a footprint click wins over a wall click.
    this.svg.addEventListener("click", (event) => this.onClick(event));

    // Pointer handlers live on the persistent root, so re-renders mid-drag don't drop capture
    // — the same pattern elevationView uses for cabinet dragging. Only islands drag here;
    // perimeter walls are fixed, selectable via click only.
    this.svg.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    this.svg.addEventListener("pointermove", (e) => this.onPointerMove(e));
    this.svg.addEventListener("pointerup", (e) => this.onPointerUp(e));
    this.svg.addEventListener("pointercancel", (e) => this.onPointerUp(e));
    this.svg.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    this.svg.addEventListener("dblclick", (e) => this.onDoubleClick(e));
    // Camera-hint discoverability (cycle 016 audit #A3) — see elevationView.ts's own copy of
    // this comment; the statusbar's hint ladder owns priority/arbitration.
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
    // Gesture-local Escape-abort (cycle 015 audit #5) — see elevationView.ts's own copy of this
    // comment for why it lives here (an extension of this existing listener) and what stopping
    // propagation accomplishes.
    if (event.key === "Escape") {
      if (this.islandResizeDrag) {
        this.abortIslandResizeDrag(event);
      } else if (this.islandDrag) {
        this.abortIslandDrag(event);
      } else if (this.pieceDrag) {
        this.abortPieceDrag(event);
      }
      return;
    }
    if (event.code !== "Space" || isEditableFocused()) return;
    this.spacePressed = true;
    this.svg.classList.add("view--space-pan");
  }

  /** Abort a mid-drag island move: restore the pre-gesture snapshot (store.abortGesture — no
   * undo entry created) and release the pointer, exactly as if the drag had never started. */
  private abortIslandDrag(event: KeyboardEvent): void {
    if (!this.islandDrag) return;
    if (this.svg.hasPointerCapture(this.islandDrag.pointerId)) this.svg.releasePointerCapture(this.islandDrag.pointerId);
    this.islandDrag = null;
    store.abortGesture();
    event.stopImmediatePropagation();
    event.preventDefault();
  }

  /** Abort a mid-drag island end-handle resize — same contract as abortIslandDrag above. */
  private abortIslandResizeDrag(event: KeyboardEvent): void {
    if (!this.islandResizeDrag) return;
    if (this.svg.hasPointerCapture(this.islandResizeDrag.pointerId)) {
      this.svg.releasePointerCapture(this.islandResizeDrag.pointerId);
    }
    this.islandResizeDrag = null;
    store.abortGesture();
    event.stopImmediatePropagation();
    event.preventDefault();
  }

  /** Abort a mid-drag piece slide/carry (cycle 019 Part 3) — same contract as abortIslandDrag,
   * plus cancelling the coordinator (no drop) if a carry ghost was live. A no-op abort (never
   * crossed the click threshold) never called beginGesture, so abortGesture() itself is a no-op
   * there too — safe either way. */
  private abortPieceDrag(event: KeyboardEvent): void {
    if (!this.pieceDrag) return;
    if (this.svg.hasPointerCapture(this.pieceDrag.pointerId)) this.svg.releasePointerCapture(this.pieceDrag.pointerId);
    if (this.pieceDrag.carrying) catalogDrag.cancel();
    const wasStarted = this.pieceDrag.started;
    this.pieceDrag = null;
    this.snapGuide = null;
    if (wasStarted) store.abortGesture();
    setTransientHint(null);
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
    const worldX = (cursorX - t.originX) / t.scale;
    const worldY = (cursorY - t.originY) / t.scale;
    this.transform = {
      scale: newScale,
      originX: cursorX - worldX * newScale,
      originY: cursorY - worldY * newScale,
    };
    this.render();
  }

  /** Double-click on EMPTY canvas (not a piece/wall/handle) resets to the auto-fit view. */
  private onDoubleClick(event: MouseEvent): void {
    const target = event.target as Element | null;
    if (target?.closest("[data-cabinet-id], [data-wall-id], [data-island-handle-end]")) return;
    const room = store.getState().room;
    if (!room) return;
    this.transform = this.computeFitTransform(room);
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

  /** Project a room-space point onto `wall`'s own along-wall axis, clamped to [0, wall.length] —
   * the existing Wall.start/dir fields, no new geometry. */
  private projectOntoWall(wall: Wall, xIn: number, yIn: number): number {
    const along = (xIn - wall.start.x) * wall.dir.x + (yIn - wall.start.y) * wall.dir.y;
    return clamp(along, 0, wall.length);
  }

  /** The wall (perimeter or island) whose line segment sits closest to a room-space point —
   * "drop against the nearest wall/island under the cursor" (Part 3). */
  private nearestWall(room: Room, xIn: number, yIn: number): Wall | null {
    let best: Wall | null = null;
    let bestDist = Infinity;
    for (const wall of room.walls) {
      const along = this.projectOntoWall(wall, xIn, yIn);
      const projX = wall.start.x + wall.dir.x * along;
      const projY = wall.start.y + wall.dir.y * along;
      const dist = Math.hypot(xIn - projX, yIn - projY);
      if (dist < bestDist) {
        bestDist = dist;
        best = wall;
      }
    }
    return best;
  }

  /**
   * ONE drop dispatch for BOTH coordinator payload modes (cycle 019 Part 2) — the same
   * nearest-wall + along-wall projection either way; only which store method gets called
   * differs. `mode:'add'` is cycle 013's original behavior, byte-identical; `mode:'move'`
   * (cycle 019 Part 3) routes to movePieceToWall instead of addCabinetAt.
   */
  private handleCatalogDrop(state: DragState): void {
    if (!this.containsPoint(state.clientX, state.clientY) || !this.transform) return;
    const room = store.getState().room;
    if (!room) return;
    const svgRect = this.svg.getBoundingClientRect();
    const t = this.transform;
    const xIn = (state.clientX - svgRect.left - t.originX) / t.scale;
    const yIn = (state.clientY - svgRect.top - t.originY) / t.scale;
    const wall = this.nearestWall(room, xIn, yIn);
    if (!wall) return;
    const along = this.projectOntoWall(wall, xIn, yIn);

    const outcome =
      state.payload.mode === "add"
        ? store.addCabinetAt(
            state.payload.spec.kind,
            state.payload.spec.band,
            state.payload.spec.width,
            wall.id,
            along,
            state.payload.spec.overrides,
          )
        : store.movePieceToWall(
            state.payload.pieceId,
            wall.id,
            this.snappedMoveTarget(room, wall, state.payload.pieceId, along, state.ctrlKey, t.scale),
          );
    setTransientHint(outcome.achieved ? null : (outcome.reason ?? "Can't drop here"));
  }

  /** The SAME snap adjustment renderCatalogGhost's move-branch applies to its preview (Part 5) —
   * kept in one place so a carry-drop always lands exactly where its ghost just showed. */
  private snappedMoveTarget(room: Room, wall: Wall, pieceId: string, along: number, ctrlKey: boolean, scale: number): number {
    const cabinet = this.locatePiece(room, pieceId)?.cabinet;
    if (!cabinet) return along;
    return this.applySnap(wall, cabinet.width, cabinet.id, along, ctrlKey, scale);
  }

  private onClick(event: MouseEvent): void {
    const target = event.target as Element | null;
    const cabinetEl = target?.closest<SVGElement>("[data-cabinet-id]");
    if (cabinetEl?.dataset.cabinetId) {
      store.selectCabinet(cabinetEl.dataset.cabinetId);
      return;
    }
    const wallEl = target?.closest<SVGElement>("[data-wall-id]");
    if (wallEl?.dataset.wallId) {
      store.selectWall(wallEl.dataset.wallId);
    }
  }

  private findWall(id: string): Wall | null {
    return store.getState().room?.walls.find((w) => w.id === id) ?? null;
  }

  private onPointerDown(event: PointerEvent): void {
    // Pan (middle-button, or space+drag) wins over everything — a middle-click or a space-held
    // drag is never meant to select/move an island.
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

    // A handle grab wins over an island drag — checked first since a handle sits on the edge of
    // (overlapping) its own deck.
    const handleEl = target?.closest<SVGElement>("[data-island-handle-end]");
    const handleIslandId = handleEl?.dataset.islandHandleId;
    const handleEnd = handleEl?.dataset.islandHandleEnd as IslandHandleEnd | undefined;
    if (handleIslandId && handleEnd) {
      this.islandResizeDrag = { islandId: handleIslandId, end: handleEnd, pointerId: event.pointerId };
      // One undo step per handle drag, not one per pointermove — see store.beginGesture.
      store.beginGesture();
      try {
        this.svg.setPointerCapture(event.pointerId);
      } catch {
        /* pointer capture is a best-effort affordance */
      }
      return;
    }

    // A footprint grab wins over the wall/island body drag below (cycle 019 Part 3) — a piece
    // moves independently of whatever wall/island it's currently sitting on.
    const cabinetEl = target?.closest<SVGElement>("[data-cabinet-id]");
    const cabinetId = cabinetEl?.dataset.cabinetId;
    if (cabinetId) {
      const room = store.getState().room;
      const located = room ? this.locatePiece(room, cabinetId) : null;
      if (located) {
        store.selectCabinet(cabinetId);
        // Grab-offset anchoring (cycle 020 Part 1): the along-wall projection of the cursor AT
        // THIS EXACT MOMENT is the anchor grabAnchoredOffset holds for the whole gesture. Falls
        // back to the piece's own xOffset (a no-op anchor, reproducing the old bare-projection
        // behavior) on the practically-unreachable case of no transform yet.
        const grabProjected = this.transform
          ? this.projectOntoWall(
              located.wall,
              (event.clientX - this.svg.getBoundingClientRect().left - this.transform.originX) / this.transform.scale,
              (event.clientY - this.svg.getBoundingClientRect().top - this.transform.originY) / this.transform.scale,
            )
          : located.cabinet.xOffset;
        this.pieceDrag = {
          cabinetId,
          pointerId: event.pointerId,
          homeWallId: located.wall.id,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startOffset: located.cabinet.xOffset,
          grabProjected,
          started: false,
          carrying: false,
          snapHintShown: false,
        };
        try {
          this.svg.setPointerCapture(event.pointerId);
        } catch {
          /* pointer capture is a best-effort affordance */
        }
        return;
      }
    }

    const wallEl = target?.closest<SVGElement>("[data-wall-id]");
    const wallId = wallEl?.dataset.wallId;
    if (!wallId) return;
    const wall = this.findWall(wallId);
    if (!wall || wall.kind !== "island") return;

    store.selectWall(wallId);
    this.islandDrag = {
      islandId: wallId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: wall.start.x,
      startY: wall.start.y,
    };
    // One undo step per drag, not one per pointermove — see store.beginGesture.
    store.beginGesture();
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
    if (this.islandResizeDrag && this.islandResizeDrag.pointerId === event.pointerId && this.transform) {
      const wall = this.findWall(this.islandResizeDrag.islandId);
      if (wall) {
        const t = this.transform;
        // clientX/Y are viewport-relative; the transform's origin is relative to the SVG's own
        // top-left — convert through the SVG's own screen rect first, same fix as
        // elevationView's resize handles (delta-based drags elsewhere cancel this out for free).
        const svgRect = this.svg.getBoundingClientRect();
        const value =
          islandOrientation(wall) === "ew"
            ? (event.clientX - svgRect.left - t.originX) / t.scale
            : (event.clientY - svgRect.top - t.originY) / t.scale;
        store.resizeIslandEnd(this.islandResizeDrag.islandId, this.islandResizeDrag.end, value);
      }
      return;
    }
    if (this.pieceDrag && this.pieceDrag.pointerId === event.pointerId && this.transform) {
      this.updatePieceDrag(event);
      return;
    }
    if (!this.islandDrag || this.islandDrag.pointerId !== event.pointerId || !this.transform) return;
    const dxInches = (event.clientX - this.islandDrag.startClientX) / this.transform.scale;
    const dyInches = (event.clientY - this.islandDrag.startClientY) / this.transform.scale;
    store.moveIsland(this.islandDrag.islandId, this.islandDrag.startX + dxInches, this.islandDrag.startY + dyInches);
  }

  /**
   * Live slide-at-home/carry-when-away update for an in-progress piece drag (cycle 019 Part 3).
   * Below PIECE_DRAG_THRESHOLD_PX this is a no-op (the click threshold — a plain click never
   * engages beginGesture/dragCabinet). Above it: nearest wall under the cursor === home wall ->
   * SLIDE, the exact elevation semantics (dragCabinet stop/push, quantize, Alt hint) applied to
   * the cursor's own along-wall projection instead of a delta; nearest wall elsewhere -> CARRY,
   * handing the ghost to the coordinator (mode:'move') while the real piece sits back at its
   * gesture-start offset — "it honestly hasn't moved" home while the ghost previews the target.
   */
  private updatePieceDrag(event: PointerEvent): void {
    const drag = this.pieceDrag;
    if (!drag || !this.transform) return;

    if (!drag.started) {
      const dx = event.clientX - drag.startClientX;
      const dy = event.clientY - drag.startClientY;
      if (Math.hypot(dx, dy) < PIECE_DRAG_THRESHOLD_PX) return;
      drag.started = true;
      store.beginGesture();
    }

    const room = store.getState().room;
    const homeWall = room ? this.findWall(drag.homeWallId) : null;
    if (!room || !homeWall) return;

    // Off this view's own canvas entirely (the filmstrip, elevation, the catalog panel) — a
    // room-space wall projection is meaningless out there, so this is unconditionally a CARRY;
    // whichever OTHER surface the cursor is actually over decides its own ghost/highlight from
    // the SAME clientX/clientY (the coordinator's only contract). Checked BEFORE any nearestWall
    // math, which would otherwise silently misread off-canvas coordinates as some in-room point.
    if (!this.containsPoint(event.clientX, event.clientY)) {
      this.snapGuide = null;
      if (!drag.carrying) {
        store.dragCabinet(drag.cabinetId, drag.startOffset, false);
        catalogDrag.start({ mode: "move", pieceId: drag.cabinetId }, event.clientX, event.clientY, event.ctrlKey);
        drag.carrying = true;
      } else {
        catalogDrag.move(event.clientX, event.clientY, event.ctrlKey);
      }
      return;
    }

    const svgRect = this.svg.getBoundingClientRect();
    const t = this.transform;
    const xIn = (event.clientX - svgRect.left - t.originX) / t.scale;
    const yIn = (event.clientY - svgRect.top - t.originY) / t.scale;
    const nearest = this.nearestWall(room, xIn, yIn);

    if (!nearest || nearest.id === homeWall.id) {
      // Back home (or never left) — SLIDE. If we were carrying, hand the ghost back with no drop.
      if (drag.carrying) {
        catalogDrag.cancel();
        drag.carrying = false;
      }
      // Grab-offset anchoring (cycle 020 Part 1): anchor to WHERE the piece was grabbed, not to
      // its own left edge — elevation parity. drag.startOffset is "offsetAtGrab" (immutable for
      // the whole gesture, same reference point elevation's own startOffset already is).
      const projectedNow = this.projectOntoWall(homeWall, xIn, yIn);
      const rawAlong = grabAnchoredOffset(projectedNow, drag.grabProjected, drag.startOffset);

      // Snapping (cycle 019 Part 5) — wall-center + edge-alignment against every other piece on
      // the wall, skipped while Ctrl is held; never applied to a nudge/typed value (this is the
      // live pointer-drag path only).
      let along = rawAlong;
      this.snapGuide = null;
      if (!event.ctrlKey) {
        const candidates = snapCandidates(homeWall, this.locatePiece(room, drag.cabinetId)?.cabinet.width ?? 0, drag.cabinetId);
        const snap = resolveSnap(rawAlong, candidates, SNAP_THRESHOLD_PX / this.transform.scale);
        if (snap) {
          along = snap.offset;
          this.snapGuide = { wallId: homeWall.id, along: snap.guideAt };
        }
      }

      store.dragCabinet(drag.cabinetId, along, event.altKey);
      if (event.altKey) {
        setTransientHint(null);
      } else {
        const current = this.locatePiece(room, drag.cabinetId)?.cabinet ?? null;
        const blocked = current !== null && Math.abs(current.xOffset - along) > EPSILON;
        if (blocked) {
          setTransientHint(HOLD_ALT_HINT);
        } else if (this.snapGuide !== null && !drag.snapHintShown) {
          // First snap of this gesture — a one-time teaching moment, not a live status: shown
          // once, then left alone until the gesture ends (matches elevationView's own copy).
          setTransientHint(SNAP_HINT);
          drag.snapHintShown = true;
        } else if (!drag.snapHintShown) {
          setTransientHint(null);
        }
      }
      return;
    }

    // Away from home — CARRY. First entry snaps the real piece back to its gesture-start offset
    // (a no-op if it never moved) and hands the ghost to the coordinator; subsequent moves just
    // update the coordinator's tracked position — renderCatalogGhost (Part 2) does the rest, and
    // ALSO applies the same snapping this branch previews the guide/hint for (Part 5) — the SAME
    // pure snapCandidates/resolveSnap call on the SAME wall/cabinet/ctrlKey, so the ghost and the
    // eventual drop (handleCatalogDrop, same inputs) always agree with what's shown here.
    const cabinet = this.locatePiece(room, drag.cabinetId)?.cabinet ?? null;
    this.snapGuide = null;
    if (cabinet && !event.ctrlKey) {
      const along = this.projectOntoWall(nearest, xIn, yIn);
      const snap = resolveSnap(along, snapCandidates(nearest, cabinet.width, drag.cabinetId), SNAP_THRESHOLD_PX / this.transform.scale);
      if (snap) {
        this.snapGuide = { wallId: nearest.id, along: snap.guideAt };
        if (!drag.snapHintShown) {
          setTransientHint(SNAP_HINT);
          drag.snapHintShown = true;
        }
      }
    }
    if (!drag.carrying) {
      store.dragCabinet(drag.cabinetId, drag.startOffset, false);
      catalogDrag.start({ mode: "move", pieceId: drag.cabinetId }, event.clientX, event.clientY, event.ctrlKey);
      drag.carrying = true;
    } else {
      catalogDrag.move(event.clientX, event.clientY, event.ctrlKey);
    }
  }

  private onPointerUp(event: PointerEvent): void {
    if (this.panDrag && this.panDrag.pointerId === event.pointerId) {
      if (this.svg.hasPointerCapture(event.pointerId)) this.svg.releasePointerCapture(event.pointerId);
      this.panDrag = null;
      return;
    }
    if (this.islandResizeDrag && this.islandResizeDrag.pointerId === event.pointerId) {
      if (this.svg.hasPointerCapture(event.pointerId)) this.svg.releasePointerCapture(event.pointerId);
      this.islandResizeDrag = null;
      store.endGesture();
      return;
    }
    if (this.pieceDrag && this.pieceDrag.pointerId === event.pointerId) {
      if (this.svg.hasPointerCapture(event.pointerId)) this.svg.releasePointerCapture(event.pointerId);
      const drag = this.pieceDrag;
      this.pieceDrag = null;
      this.snapGuide = null;
      if (drag.started) {
        if (drag.carrying) {
          // A carry drop reuses the SAME dispatch a catalog-add drop uses (Part 2's
          // handleCatalogDrop/filmstrip's handleDrop, already registered via catalogDrag.onDrop)
          // — no second drop path. That dispatch sets its OWN outcome hint (achieved -> clear,
          // failed -> the reason) — never stomped here.
          catalogDrag.drop();
        } else {
          // A pure slide never engaged the coordinator; only its own live Alt-push hint could be
          // showing, and it must not outlive the gesture (same rule elevationView's own slide
          // already follows).
          setTransientHint(null);
        }
        store.endGesture();
        // endGesture() only decrements the gesture depth — it does NOT notify() — so a plain
        // slide-release leaves the last-drawn .guide line orphaned in the DOM (snapGuide is
        // already cleared above; a carry's own drop() call already re-renders via its own
        // notify, so this is only load-bearing for the slide path, but forcing it
        // unconditionally here keeps one rule — "a gesture just closed" — instead of two.
        this.render();
      }
      return;
    }
    if (!this.islandDrag || this.islandDrag.pointerId !== event.pointerId) return;
    if (this.svg.hasPointerCapture(event.pointerId)) this.svg.releasePointerCapture(event.pointerId);
    this.islandDrag = null;
    store.endGesture();
  }

  private computeFitTransform(room: Room): Transform {
    const rect = this.svg.getBoundingClientRect();
    const w = rect.width || this.host.clientWidth || 600;
    const h = rect.height || this.host.clientHeight || 400;
    const scale = Math.min(
      (w - PADDING_PX * 2) / room.width,
      (h - PADDING_PX * 2) / room.length,
    );
    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    return {
      scale: safeScale,
      originX: (w - room.width * safeScale) / 2,
      originY: (h - room.length * safeScale) / 2,
    };
  }

  /** An island's deck depth for rendering when it has no pieces yet to imply one: the deepest
   * current piece, or a base cabinet's default depth. */
  private islandDeckDepth(island: Wall): number {
    const maxPieceDepth = island.cabinets.reduce((max, c) => Math.max(max, c.depth), 0);
    return maxPieceDepth > 0 ? maxPieceDepth : kindDefinition("cabinet", "base").defaultSize.depth;
  }

  /** A wall's angle in DEGREES, in the same (x, y-down) convention plan-space and pixel-space
   * both already share (px() is a pure scale+translate, no flip) — 0 for the old default
   * west-to-east wall, and the one number that drives every rotated draw below (walls, cabinet
   * footprints, the catalog ghost). Islands stay axis-aligned this cycle (locked decision), so
   * this is always an exact multiple of 90° wherever an island calls it. */
  private wallRotationDeg(wall: Wall): number {
    return (Math.atan2(wall.dir.y, wall.dir.x) * 180) / Math.PI;
  }

  private render(): void {
    const { room, selectedWallId, selectedCabinetId } = store.getState();
    this.svg.replaceChildren();
    if (!room) {
      this.transform = null;
      this.lastRoomRef = null;
      return;
    }

    // Reset to the auto-fit view only when the room is REPLACED (setRoom/hydrate/resizeRoom all
    // install a fresh room object) — any other store notify (an edit within the same room) keeps
    // the user's current zoom/pan exactly as it was.
    const shouldResetFit = room !== this.lastRoomRef || !this.transform;
    this.lastRoomRef = room;
    if (shouldResetFit) {
      this.transform = this.computeFitTransform(room);
      this.fitScale = this.transform.scale;
    }
    const t = this.transform;
    if (!t) return; // unreachable (shouldResetFit above guarantees a transform), narrows for TS
    const px = (xIn: number, yIn: number) => ({
      x: t.originX + xIn * t.scale,
      y: t.originY + yIn * t.scale,
    });

    // Walls (and island decks) first so footprints render on top of them. Label positions are
    // collected here but drawn in their own pass AFTER the cabinet footprints (below), so a
    // label is never buried under a filled wall's cabinets — styles.css also gives
    // .wall__label a halo so it stays legible over a cabinet fill.
    const labelPositions: Array<{ x: number; y: number; text: string }> = [];
    for (const wall of room.walls) {
      if (wall.kind === "island") {
        this.renderIslandDeck(wall, selectedWallId, selectedCabinetId, px, labelPositions);
        continue;
      }

      const a = px(wall.start.x, wall.start.y);
      const b = px(wall.start.x + wall.dir.x * wall.length, wall.start.y + wall.dir.y * wall.length);
      const lengthPx = wall.length * t.scale;

      // A thin rect drawn in the wall's own LOCAL frame (x: along the wall, y: thickness) then
      // rotated into place by the wall's own angle (cycle 017 — any angle, not just the old
      // horizontal/vertical special cases; byte-identical to the old branches at 0/90/180/270°).
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.classList.add("wall");
      if (wall.id === selectedWallId) rect.classList.add("is-selected");
      rect.dataset.wallId = wall.id;
      rect.setAttribute("x", "0");
      rect.setAttribute("y", String(-WALL_THICKNESS_PX / 2));
      rect.setAttribute("width", String(lengthPx));
      rect.setAttribute("height", String(WALL_THICKNESS_PX));
      rect.setAttribute("transform", `translate(${a.x} ${a.y}) rotate(${this.wallRotationDeg(wall)})`);
      this.svg.appendChild(rect);

      labelPositions.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, text: wall.label });
    }

    // Cabinet footprints (perimeter and island pieces alike — cabinetFootprint is wall-agnostic).
    // Drawn at the wall's own angle (cycle 017): the quad's near-near corner (quad[0]) is the
    // rotation origin, and drawCabinetRect's local width/height are the piece's true width/depth
    // — byte-identical to the old AABB-based draw for every axis-aligned wall (rotationDeg an
    // exact multiple of 90°), correctly rotated for an angled one.
    for (const wall of room.walls) {
      const rotationDeg = this.wallRotationDeg(wall);
      for (const cabinet of wall.cabinets) {
        const quad = cabinetFootprint(wall, cabinet);
        const origin = px(quad[0].x, quad[0].y);
        const g = drawCabinetRect(
          cabinet,
          { x: origin.x, y: origin.y, width: cabinet.width * t.scale, height: cabinet.depth * t.scale },
          {
            selected: cabinet.id === selectedCabinetId,
            interactive: true,
            finish: resolveFinish(room, cabinet),
            rotationDeg,
          },
        );
        this.svg.appendChild(g);
      }
    }

    // Wall/island labels last so they paint on top of any cabinet footprint.
    for (const pos of labelPositions) {
      const label = document.createElementNS(SVG_NS, "text");
      label.classList.add("wall__label");
      label.setAttribute("x", String(pos.x));
      label.setAttribute("y", String(pos.y));
      label.textContent = pos.text;
      this.svg.appendChild(label);
    }

    this.renderCatalogGhost(room, px);
    if (this.snapGuide) {
      const guideWall = room.walls.find((w) => w.id === this.snapGuide!.wallId);
      if (guideWall) this.renderSnapGuide(guideWall, this.snapGuide.along, px, t);
    }
  }

  /** A guide line across the wall's depth strip at the active snap alignment (cycle 019 Part 5)
   * — first definition of the .guide class family, dashed + token-colored, in the wall's own
   * local frame (same translate+rotate idiom as the wall rect/cabinet footprints above), so it
   * reads correctly at any wall angle. Cleared the instant a move un-snaps or the gesture ends. */
  private renderSnapGuide(
    wall: Wall,
    along: number,
    px: (xIn: number, yIn: number) => { x: number; y: number },
    t: Transform,
  ): void {
    const origin = px(wall.start.x, wall.start.y);
    const alongPx = along * t.scale;
    const depthPx = GUIDE_DEPTH_IN * t.scale;
    const line = document.createElementNS(SVG_NS, "line");
    line.classList.add("guide");
    line.setAttribute("x1", String(alongPx));
    line.setAttribute("y1", "0");
    line.setAttribute("x2", String(alongPx));
    line.setAttribute("y2", String(depthPx));
    line.setAttribute("transform", `translate(${origin.x} ${origin.y}) rotate(${this.wallRotationDeg(wall)})`);
    this.svg.appendChild(line);
  }

  /**
   * Coordinator drag-ghost preview (cycle 013, generalized cycle 019 Part 2): the SAME
   * drawCabinetRect renderer used for every real footprint above, for EITHER payload mode.
   * Projects the cursor onto the nearest wall/island (shared for both modes), then delegates to
   * whichever ghost builder matches — both ultimately call planCabinetDrop (the exact function
   * addCabinetAt/movePieceToWall call at drop time), so the ghost never promises a placement the
   * drop can't keep. canPlaceOn (island rejects openings/wall pieces) is checked first since
   * planCabinetDrop itself assumes a placeable kind/band.
   */
  private renderCatalogGhost(room: Room, px: (xIn: number, yIn: number) => { x: number; y: number }): void {
    const drag = catalogDrag.current();
    if (!drag || !this.transform || !this.containsPoint(drag.clientX, drag.clientY)) return;

    const svgRect = this.svg.getBoundingClientRect();
    const t = this.transform;
    const xIn = (drag.clientX - svgRect.left - t.originX) / t.scale;
    const yIn = (drag.clientY - svgRect.top - t.originY) / t.scale;
    const wall = this.nearestWall(room, xIn, yIn);
    if (!wall) return;
    const along = this.projectOntoWall(wall, xIn, yIn);

    if (drag.payload.mode === "add") {
      const { kind, band, width } = drag.payload.spec;
      const def = kindDefinition(kind, band);
      const depth = def.defaultSize.depth;
      const canPlace = canPlaceOn(wall.kind, kind, band);
      const plan = canPlace
        ? planCabinetDrop(room, wall, kind, band, width, along)
        : { xOffset: along, width: Math.max(1, width), valid: false };
      const ghostCabinet: Cabinet = {
        id: "ghost",
        kind,
        type: def.band,
        xOffset: plan.xOffset,
        width: plan.width,
        height: def.defaultSize.height,
        depth,
      };
      this.drawGhost(ghostCabinet, wall, plan.valid, depth, px, t);
      return;
    }

    // mode === "move" (cycle 019 Part 3) — the SAME cursor-aim/push/honest-fail planning
    // movePieceToWall itself runs at drop time, EXCLUDING the piece's own current footprint so
    // it never corner-blocks its own preview. Cycle 019 Part 5: snapping adjusts `along` BEFORE
    // planCabinetDrop, skipped while Ctrl is held — handleCatalogDrop below applies the IDENTICAL
    // snap (same wall/cabinet/ctrlKey, a pure function) so the ghost never shows a landing the
    // drop doesn't also produce.
    const located = this.locatePiece(room, drag.payload.pieceId);
    if (!located) return;
    const { cabinet } = located;
    const target = this.applySnap(wall, cabinet.width, cabinet.id, along, drag.ctrlKey, t.scale);
    const canPlace = canPlaceOn(wall.kind, cabinet.kind, cabinet.type);
    const plan = canPlace
      ? planCabinetDrop(room, wall, cabinet.kind, cabinet.type, cabinet.width, target, cabinet.id)
      : { xOffset: target, width: cabinet.width, valid: false };
    const ghostCabinet: Cabinet = { ...cabinet, id: "ghost", xOffset: plan.xOffset, width: plan.width };
    this.drawGhost(ghostCabinet, wall, plan.valid, cabinet.depth, px, t);
  }

  /** Snap `along` against `wall`'s own candidates (cycle 019 Part 5), unless Ctrl is held — pure,
   * no side effects (the guide line + one-time hint are owned by the pointer-gesture code that
   * already tracks a gesture to attach them to; this helper exists so the ghost preview and the
   * eventual drop dispatch apply the IDENTICAL adjustment via one shared call). `scale` is the
   * caller's own live COMPOSED transform scale (zoom included) — cycle 020 Part 2's
   * pixel-constant snap zone converts SNAP_THRESHOLD_PX to model inches HERE, at the one place
   * that knows the current scale; snapping.ts itself stays a pure, scale-agnostic model. */
  private applySnap(wall: Wall, width: number, excludeId: string, along: number, ctrlKey: boolean, scale: number): number {
    if (ctrlKey) return along;
    const snap = resolveSnap(along, snapCandidates(wall, width, excludeId), SNAP_THRESHOLD_PX / scale);
    return snap ? snap.offset : along;
  }

  /** Shared ghost draw for both coordinator payload modes — one draw path, no second renderer. */
  private drawGhost(
    ghostCabinet: Cabinet,
    wall: Wall,
    valid: boolean,
    depth: number,
    px: (xIn: number, yIn: number) => { x: number; y: number },
    t: Transform,
  ): void {
    const quad = cabinetFootprint(wall, ghostCabinet);
    const origin = px(quad[0].x, quad[0].y);
    const g = drawCabinetRect(
      ghostCabinet,
      { x: origin.x, y: origin.y, width: ghostCabinet.width * t.scale, height: depth * t.scale },
      { ghost: true, ghostInvalid: !valid, rotationDeg: this.wallRotationDeg(wall) },
    );
    this.svg.appendChild(g);
  }

  /** Find a piece by id anywhere in the room (perimeter or island) along with the wall it
   * currently lives on — the one lookup both the move-ghost preview and the plan-view drag
   * gesture (Part 3) need to know a piece's CURRENT home. */
  private locatePiece(room: Room, id: string): { wall: Wall; cabinet: Cabinet } | null {
    for (const wall of room.walls) {
      const cabinet = wall.cabinets.find((c) => c.id === id);
      if (cabinet) return { wall, cabinet };
    }
    return null;
  }

  private renderIslandDeck(
    island: Wall,
    selectedWallId: string | null,
    selectedCabinetId: string | null,
    px: (xIn: number, yIn: number) => { x: number; y: number },
    labelPositions: Array<{ x: number; y: number; text: string }>,
  ): void {
    const depth = this.islandDeckDepth(island);
    // Islands stay axis-aligned this cycle (locked decision) — quadBounds is exactly the deck's
    // true rectangle here, never an approximation.
    const footprint = quadBounds(cabinetFootprint(island, { xOffset: 0, width: island.length, depth }));
    const topLeft = px(footprint.minX, footprint.minY);
    const bottomRight = px(footprint.maxX, footprint.maxY);

    const deck = document.createElementNS(SVG_NS, "rect");
    deck.classList.add("island-deck");
    const isSelected = island.id === selectedWallId;
    if (isSelected) deck.classList.add("is-selected");
    deck.dataset.wallId = island.id;
    deck.setAttribute("x", String(topLeft.x));
    deck.setAttribute("y", String(topLeft.y));
    deck.setAttribute("width", String(bottomRight.x - topLeft.x));
    deck.setAttribute("height", String(bottomRight.y - topLeft.y));
    this.svg.appendChild(deck);

    labelPositions.push({
      x: (topLeft.x + bottomRight.x) / 2,
      y: (topLeft.y + bottomRight.y) / 2,
      text: island.label,
    });

    // End handles only in ISLAND mode (the island itself selected, not one of its own pieces) —
    // same "island mode" condition statusbar.ts/properties.ts already use.
    if (isSelected && selectedCabinetId === null) {
      this.renderIslandHandles(island, topLeft, bottomRight);
    }
  }

  /** Two length handles at the island deck's ends, oriented along whichever axis the island
   * actually runs — same .handle class family elevationView's piece handles use. */
  private renderIslandHandles(
    island: Wall,
    topLeft: { x: number; y: number },
    bottomRight: { x: number; y: number },
  ): void {
    const orientation = islandOrientation(island);
    const cursorClass = orientation === "ew" ? "handle--ew-resize" : "handle--ns-resize";

    const makeHandle = (end: IslandHandleEnd, rect: { x: number; y: number; width: number; height: number }) => {
      const handle = document.createElementNS(SVG_NS, "rect");
      handle.classList.add("handle", "handle--island-end", cursorClass);
      handle.dataset.islandHandleId = island.id;
      handle.dataset.islandHandleEnd = end;
      handle.setAttribute("x", String(rect.x));
      handle.setAttribute("y", String(rect.y));
      handle.setAttribute("width", String(Math.max(0, rect.width)));
      handle.setAttribute("height", String(Math.max(0, rect.height)));
      this.svg.appendChild(handle);
    };

    if (orientation === "ew") {
      makeHandle("start", {
        x: topLeft.x - HANDLE_THICKNESS_PX / 2,
        y: topLeft.y,
        width: HANDLE_THICKNESS_PX,
        height: bottomRight.y - topLeft.y,
      });
      makeHandle("end", {
        x: bottomRight.x - HANDLE_THICKNESS_PX / 2,
        y: topLeft.y,
        width: HANDLE_THICKNESS_PX,
        height: bottomRight.y - topLeft.y,
      });
    } else {
      makeHandle("start", {
        x: topLeft.x,
        y: topLeft.y - HANDLE_THICKNESS_PX / 2,
        width: bottomRight.x - topLeft.x,
        height: HANDLE_THICKNESS_PX,
      });
      makeHandle("end", {
        x: topLeft.x,
        y: bottomRight.y - HANDLE_THICKNESS_PX / 2,
        width: bottomRight.x - topLeft.x,
        height: HANDLE_THICKNESS_PX,
      });
    }
  }
}
