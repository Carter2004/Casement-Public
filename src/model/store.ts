// store.ts — THE application state and the SINGLE mutation path. The current Room, the
// selected wall, and the selected cabinet live here and nowhere else. Views subscribe and
// re-render on change; they mutate ONLY by calling these methods. There is deliberately no
// view-to-view sync code — both views read one model, so a single change reaches both.

import { clamp, createCabinet, MIN_DIMENSION, type CabinetType, type Cabinet } from "./cabinet";
import {
  BACKSPLASHES,
  CABINET_FINISHES,
  COUNTER_MATERIALS,
  CUSTOM_PRESET,
  DOOR_STYLES,
  FLOOR_MATERIALS,
  PRESETS,
  roomStyleForPreset,
  WALL_PAINTS,
  type BacksplashKey,
  type CabinetFinishKey,
  type CounterMaterialKey,
  type DoorStyle,
  type FloorMaterialKey,
  type PresetKey,
  type SurfaceCategory,
  type WallPaintKey,
} from "./finishes";
import { anchorBottomFor, canPlaceOn, kindDefinition, type PieceKind } from "./kinds";
import {
  candidateStrip,
  clampIntoGap,
  crossWallBlockers,
  currentGapFor,
  EPSILON,
  firstFittingGap,
  footprintsConflict,
  freeIntervals,
  maxDepthWithoutCollision,
  maxWidthWithoutCollision,
  quadsOverlap,
  type Interval,
} from "./occupancy";
import { planInsertWithPush, planMoveWithPush } from "./push";
import {
  applyRectangleLabelsIfNeeded,
  cabinetFootprint,
  createIsland,
  createPolygonRoom,
  createRectangularRoom,
  islandOrientation,
  perimeterWalls,
  quadInsidePolygon,
  reorientIsland,
  type IslandOrientation,
  type Room,
  type Wall,
} from "./room";
import { planRoomResize } from "./resizeRoom";
import { ROOM_SHAPES, type RoomShapeKey } from "./roomShapes";
import { planFill } from "./run";
import { templateWalls, type TemplateKey } from "./templates";
import { formatInches, quantize } from "./units";

/** Which shape preset (+ its own params) produced the current room, if any (cycle 017) — lives
 * alongside `room` in State rather than ON Room itself, since Room stays a pure geometry type
 * (footprint/walls/style) with zero notion of "which preset authored me"; a future footprint
 * editor would leave this null. The room form reads it straight off store state (the SAME
 * live-sync pattern every other truthful-form field in this app already uses) to keep the shape
 * picker + per-shape fields honest, including after a reload (persistence.ts's roomShape). */
export interface RoomShapeRef {
  key: RoomShapeKey;
  params: Record<string, number>;
}

/** The outcome of an edit that can be partially honored (clamped, pushed short, or rejected):
 * `achieved` is false whenever the applied result differs from what was requested, with
 * `reason` a short human string for the properties panel's message line — THE single feedback
 * channel for every current and future edit rejection (Part 4). Drag/keyboard paths that already
 * give real-time visual feedback (dragCabinet, moveIsland) don't need this — only the
 * properties-panel field methods return it. */
export interface EditOutcome {
  achieved: boolean;
  reason?: string;
}

/** Optional variant preset a catalog add-row can carry (cycle 016 Part C) — applied at create
 * via the SAME recreate-then-set pattern every other per-piece override already uses. Carried
 * through BOTH add paths (addCabinet, addCabinetAt) as one argument, never a parallel add
 * mutation. Absent fields mean "use the kind's own catalog default." */
export interface PieceOverrides {
  height?: number;
  doorStyle?: DoorStyle;
}

/** Apply a variant preset to a freshly created cabinet. Height is clamped exactly like
 * resizeCabinet's own height case (never pokes through the ceiling from the piece's anchor) —
 * the only overridable field that needs a live clamp; doorStyle is registry-driven and always
 * valid coming from a catalog row. */
function applyPieceOverrides(room: Room, cabinet: Cabinet, overrides?: PieceOverrides): void {
  if (!overrides) return;
  if (overrides.height !== undefined) {
    const maxHeight = Math.max(MIN_DIMENSION, room.wallHeight - anchorBottomFor(cabinet));
    cabinet.height = clamp(overrides.height, MIN_DIMENSION, maxHeight);
  }
  if (overrides.doorStyle !== undefined) cabinet.doorStyle = overrides.doorStyle;
}

interface State {
  room: Room | null;
  roomShape: RoomShapeRef | null;
  selectedWallId: string | null;
  selectedCabinetId: string | null;
}

type Listener = () => void;

/** Candidate coordinates from 0 to `extent` (inclusive of both ends) spaced `step` apart, for
 * findValidIslandSpot's grid search. Always includes 0 and `extent` even if the last regular
 * step overshoots it, so the search still tries the room's own edges. */
function gridSteps(extent: number, step: number): number[] {
  const steps: number[] = [];
  for (let v = 0; v <= extent; v += step) steps.push(v);
  if (steps[steps.length - 1] < extent) steps.push(extent);
  return steps;
}

/** How far `point` sits outside `gap` — 0 if it's already inside. addCabinetAt's "nearest gap to
 * the drop point" ranking, the same shape as push.ts's own gap-distance-to-target helper. */
function gapDistanceToPoint(gap: Interval, point: number): number {
  if (point < gap.start) return gap.start - point;
  if (point > gap.end) return point - gap.end;
  return 0;
}

/** The result of planning a catalog drop: where the piece would land (and its clamped width),
 * whether that placement is actually achievable, and any OTHER pieces it would relocate. */
export interface CabinetDropPlan {
  xOffset: number;
  width: number;
  valid: boolean;
  relocations: Map<string, number>;
}

/**
 * PURE placement planner for a catalog drop (cycle 013) — the single source addCabinetAt's
 * mutation and the drag-ghost's live preview both call, so the ghost never shows a placement the
 * actual drop wouldn't produce. Given a wall/kind/band/width AIMED at `targetXOffset`: (1) the
 * free gap nearest the target that fits the piece, clamped into it; (2) else planInsertWithPush
 * aimed at the target via its targetOffset parameter; (3) else `valid: false` — nothing would
 * land here, callers (addCabinetAt, the ghost) each decide what "invalid" means for them (a
 * failed mutation vs. a red ghost). Does NOT check canPlaceOn — callers already do (the ghost
 * needs to distinguish "wrong wall kind" from "no room" with a different upstream message).
 *
 * `excludeCabinetId` (cycle 019, the move authority): when planning where an EXISTING piece
 * would land if moved here, its own current footprint must never count against itself — on the
 * SAME wall (a carry that jumps to a different segment) or on some OTHER wall the piece still
 * physically occupies at planning time (a cross-wall move, corner-adjacent case). Threaded all
 * the way through both freeIntervals (same-wall AND cross-wall) and planInsertWithPush's
 * segment/feasibility math — a partially-threaded exclude would still let the piece's old self
 * block its own new spot in whichever path missed it. Omitted (undefined) for every existing
 * caller (addCabinetAt, duplicateCabinet, the two ghost previews) — byte-identical, since no
 * real cabinet id ever equals undefined.
 */
export function planCabinetDrop(
  room: Room,
  wall: Wall,
  kind: PieceKind,
  band: CabinetType,
  width: number,
  targetXOffset: number,
  excludeCabinetId?: string,
): CabinetDropPlan {
  const def = kindDefinition(kind, band);
  const pieceWidth = Math.max(MIN_DIMENSION, width);
  const bottom = anchorBottomFor({ kind, type: def.band });
  const verticalRange = { bottom, top: bottom + def.defaultSize.height };

  const gaps = freeIntervals(room, wall, verticalRange, def.defaultSize.depth, excludeCabinetId);
  const fitting = gaps.filter((gap) => gap.end - gap.start >= pieceWidth - EPSILON);
  if (fitting.length > 0) {
    const nearest = fitting.reduce((best, gap) =>
      gapDistanceToPoint(gap, targetXOffset) < gapDistanceToPoint(best, targetXOffset) ? gap : best,
    );
    const maxOffset = Math.max(nearest.start, nearest.end - pieceWidth);
    const xOffset = clamp(targetXOffset, nearest.start, maxOffset);
    return { xOffset, width: pieceWidth, valid: true, relocations: new Map() };
  }

  const pushed = planInsertWithPush(
    room,
    wall,
    verticalRange,
    def.defaultSize.depth,
    pieceWidth,
    targetXOffset,
    excludeCabinetId,
  );
  if (!pushed) {
    const xOffset = clamp(targetXOffset, 0, Math.max(0, wall.length - pieceWidth));
    return { xOffset, width: pieceWidth, valid: false, relocations: new Map() };
  }
  return { xOffset: pushed.xOffset, width: pieceWidth, valid: true, relocations: pushed.relocations };
}

/**
 * Which OTHER wall (if any) cross-blocks the exact [xOffset, xOffset+width) span a failed
 * placement was aimed at (cycle 018 friction #2 — naming the blocker in a rejection reason).
 * Several blockers can overlap the requested span; the first one encountered in crossWallBlockers'
 * own traversal order wins — deterministic, and in practice there is rarely more than one at a
 * single corner. Returns null when nothing cross-wall-blocks the request (e.g. the wall itself
 * is simply full end to end) — the reason then stays the plain, unextended message.
 */
function findBlockingWall(
  room: Room,
  wall: Wall,
  verticalRange: { bottom: number; top: number },
  depth: number,
  xOffset: number,
  width: number,
): Wall | null {
  const requested = { start: xOffset, end: xOffset + width };
  const blocker = crossWallBlockers(room, wall, verticalRange, depth).find(
    (b) => Math.min(b.interval.end, requested.end) - Math.max(b.interval.start, requested.start) > EPSILON,
  );
  return blocker?.wall ?? null;
}

/**
 * The rejection reason for a failed `plan` (addCabinetAt/duplicateCabinet's only two "No space"
 * sites): the plain short reason, extended with the blocking wall's own label when the
 * requested span is actually cross-wall blocked — "No space for a 48" piece here — blocked by
 * pieces around the corner (Wall 5)". `noun` distinguishes addCabinetAt's "piece" from
 * duplicateCabinet's "duplicate" — the only wording difference between the two sites.
 */
function noSpaceReason(
  room: Room,
  wall: Wall,
  kind: PieceKind,
  band: CabinetType,
  plan: CabinetDropPlan,
  noun: "piece" | "duplicate" = "piece",
): string {
  const def = kindDefinition(kind, band);
  const bottom = anchorBottomFor({ kind, type: def.band });
  const verticalRange = { bottom, top: bottom + def.defaultSize.height };
  const blocker = findBlockingWall(room, wall, verticalRange, def.defaultSize.depth, plan.xOffset, plan.width);
  const base = `No space for a ${formatInches(plan.width)}" ${noun} here`;
  return blocker ? `${base} — blocked by pieces around the corner (${blocker.label})` : base;
}

// ---- Undo/redo (Part 0) ----------------------------------------------------------
// Snapshot-based memento on the store's ONE mutation path. Every mutating method below
// checkpoints (pushes a pre-mutation snapshot) before it applies — except while a "gesture" is
// open (drag, or a properties-panel field focus session), which checkpoints exactly ONCE at
// gesture-open so a whole drag or typing session collapses to a single undo step instead of one
// step per pointermove/keystroke. Session-only: never persisted (persistence.ts is untouched).

type Snapshot = State;

/** Rooms are plain JSON-safe data (every field is a string/number/nested plain object — see
 * persistence.ts, which already round-trips this exact shape through JSON) — a stringify/parse
 * round-trip is a simple, dependency-free deep clone that can't miss a nested mutable field as
 * the shape grows, unlike a hand-written field-by-field copy. */
function cloneRoom(room: Room): Room {
  return JSON.parse(JSON.stringify(room));
}

function cloneSnapshot(state: State): Snapshot {
  return {
    room: state.room ? cloneRoom(state.room) : null,
    roomShape: state.roomShape ? { key: state.roomShape.key, params: { ...state.roomShape.params } } : null,
    selectedWallId: state.selectedWallId,
    selectedCabinetId: state.selectedCabinetId,
  };
}

/** Undo stack cap — FIFO eviction of the oldest entry once exceeded. Rooms are tens of pieces;
 * even 50 deep clones is a trivial memory cost, kept finite so an extreme session can't grow
 * this unboundedly. */
const UNDO_CAP = 50;

class Store {
  private state: State = { room: null, roomShape: null, selectedWallId: null, selectedCabinetId: null };
  private listeners = new Set<Listener>();
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  /** >0 while a gesture (drag, or a properties-panel field focus session) is open — see
   * beginGesture/endGesture. Suppresses checkpoint() so the whole gesture collapses to the ONE
   * snapshot beginGesture already took, instead of one per pointermove/keystroke. */
  private gestureDepth = 0;

  getState(): Readonly<State> {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  // ---- Undo/redo -------------------------------------------------------------

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Revert to the state just before the most recent checkpointed edit (a whole gesture counts
   * as one). The state being left is pushed onto the redo stack so redo() can restore it. No-op
   * if there's nothing to undo. */
  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(cloneSnapshot(this.state));
    this.state = previous;
    this.notify();
  }

  /** Reapply the edit most recently undone. No-op if there's nothing to redo. Any NEW edit
   * (via checkpoint()) clears this stack — redo only ever replays what undo() just took back. */
  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(cloneSnapshot(this.state));
    this.state = next;
    this.notify();
  }

  /**
   * Open a gesture (drag pointerdown, or a properties-panel field gaining focus): takes ONE
   * checkpoint now, then suppresses every checkpoint() call until the matching endGesture() —
   * so a multi-step drag or a keystroke-by-keystroke typing session becomes a single undo step.
   * Depth-counted defensively (nested begin/end pairs collapse to the outermost one) though the
   * UI only ever opens one at a time in practice.
   */
  beginGesture(): void {
    if (this.gestureDepth === 0) this.pushUndoSnapshot();
    this.gestureDepth += 1;
  }

  /** Close a gesture opened by beginGesture (pointerup/pointercancel/blur). */
  endGesture(): void {
    this.gestureDepth = Math.max(0, this.gestureDepth - 1);
  }

  /**
   * Establish the undo floor (cycle 015 audit #4): wipe both stacks so a fresh boot's Ctrl+Z is
   * a no-op instead of popping the very checkpoint hydrate()/setRoom() just took, which used to
   * blank the workspace on the single most reflexive editor keystroke. app.ts calls this once,
   * right after the initial hydrate/setRoom at boot completes — never mid-session. notify() so
   * the Undo/Redo buttons (subscribed to canUndo/canRedo) immediately reflect the cleared floor.
   */
  clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }

  /**
   * Abandon the gesture currently open (cycle 015 audit #5's Esc-abort): restore the snapshot
   * beginGesture took at the top of the undo stack and pop it back off, WITHOUT pushing it onto
   * redoStack — the gesture is swallowed entirely, as if it never happened, rather than becoming
   * an undoable step. Only meaningful while gestureDepth > 0 (a gesture's own beginGesture always
   * pushed exactly the one snapshot this restores); a no-op otherwise.
   */
  abortGesture(): void {
    if (this.gestureDepth === 0) return;
    const before = this.undoStack.pop();
    if (before) this.state = before;
    this.gestureDepth = 0;
    this.notify();
  }

  /** Push the CURRENT (pre-mutation) state onto the undo stack and clear redo (any new edit
   * invalidates whatever was undone before it). FIFO-capped at UNDO_CAP. */
  private pushUndoSnapshot(): void {
    this.undoStack.push(cloneSnapshot(this.state));
    if (this.undoStack.length > UNDO_CAP) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Call at the top of every mutating method, AFTER its own no-op guards (a rejected/no-op
   * call must never waste an undo step) but BEFORE it touches any state. No-ops while a gesture
   * is open — that gesture's own beginGesture() already took the one checkpoint it needs. */
  private checkpoint(): void {
    if (this.gestureDepth > 0) return;
    this.pushUndoSnapshot();
  }

  // ---- Lookups -------------------------------------------------------------

  getSelectedWall(): Wall | null {
    const { room, selectedWallId } = this.state;
    if (!room || !selectedWallId) return null;
    return room.walls.find((w) => w.id === selectedWallId) ?? null;
  }

  private locateCabinet(id: string): { wall: Wall; cabinet: Cabinet } | null {
    if (!this.state.room) return null;
    for (const wall of this.state.room.walls) {
      const cabinet = wall.cabinets.find((c) => c.id === id);
      if (cabinet) return { wall, cabinet };
    }
    return null;
  }

  getSelectedCabinet(): Cabinet | null {
    const { selectedCabinetId } = this.state;
    if (!selectedCabinetId) return null;
    return this.locateCabinet(selectedCabinetId)?.cabinet ?? null;
  }

  // ---- Mutations (the only way state changes) ------------------------------

  /** Replace the room from typed dimensions — always the "rectangle" shape preset. Selection
   * resets to nothing selected. Signature UNCHANGED since cycle 001 (every existing test seeds
   * a room this way); a shape SWITCH to something other than a plain rectangle goes through
   * setRoomShape instead. */
  setRoom(width: number, length: number, wallHeight: number): void {
    this.checkpoint();
    this.state = {
      room: createRectangularRoom(width, length, wallHeight),
      roomShape: { key: "rectangle", params: { width, length } },
      selectedWallId: null,
      selectedCabinetId: null,
    };
    this.notify();
  }

  /**
   * Install an already-built room (e.g. restored from persistence.ts), clearing both
   * selections. Unlike setRoom — which builds a fresh room from typed dimensions — this
   * installs a room that already has its walls and cabinets. `roomShape` carries whichever
   * preset/params produced it (persistence.ts's own optional roomShape field), so the room
   * form stays truthful immediately after a reload — null for an older migrated save or a
   * hand-crafted payload with no preset on record. Single notify().
   */
  hydrate(room: Room, roomShape: RoomShapeRef | null = null): void {
    this.checkpoint();
    this.state = { room, roomShape, selectedWallId: null, selectedCabinetId: null };
    this.notify();
  }

  /**
   * Preview a SAME-SHAPE room resize WITHOUT mutating anything: reports how many cabinets would
   * be dropped if resizeRoom were called with these same params. Lets the UI confirm with an
   * exact count before anything actually changes. A no-op (0 dropped) without an active room or
   * shape reference — shouldn't happen in practice (the room form only ever shows once a room
   * exists), but is a safe, honest answer rather than a throw.
   */
  previewResize(params: Record<string, number>, wallHeight: number): { droppedCount: number } {
    const room = this.state.room;
    const shape = this.state.roomShape;
    if (!room || !shape) return { droppedCount: 0 };
    const footprint = ROOM_SHAPES[shape.key].build(params);
    const { droppedCount } = planRoomResize(room, footprint, wallHeight);
    return { droppedCount };
  }

  /**
   * Resize the room WITHIN ITS CURRENT SHAPE preset — rebuilds via that shape's own
   * build(params), REATTACHING existing cabinets wherever they still fit (relocating within
   * their wall if their old spot is gone, dropping only what fits nowhere) — unlike setRoom/
   * setRoomShape, which always start from an empty room. Wall selection survives (a same-shape
   * rebuild always produces the same wall ids); the cabinet selection follows its cabinet
   * across the resize if it survived, or clears if it was dropped (every reattached cabinet
   * gets a fresh id, so this is tracked explicitly via planRoomResize's survivedIds map rather
   * than an id lookup). No-op without an active room/shape reference. Single notify().
   */
  resizeRoom(params: Record<string, number>, wallHeight: number): void {
    const oldRoom = this.state.room;
    const shape = this.state.roomShape;
    if (!oldRoom || !shape) return;
    this.checkpoint();
    const footprint = ROOM_SHAPES[shape.key].build(params);
    const { room, survivedIds } = planRoomResize(oldRoom, footprint, wallHeight);
    // planRoomResize rebuilds via the general polygon path (resizeRoom.ts has no notion of
    // shape presets) — a rectangle resize must still read North/East/South/West.
    if (shape.key === "rectangle") applyRectangleLabelsIfNeeded(room);

    const { selectedCabinetId } = this.state;
    const newSelectedCabinetId = selectedCabinetId ? (survivedIds.get(selectedCabinetId) ?? null) : null;

    this.state = {
      room,
      roomShape: { key: shape.key, params },
      selectedWallId: this.state.selectedWallId,
      selectedCabinetId: newSelectedCabinetId,
    };
    this.notify();
  }

  /**
   * Switch the room to a DIFFERENT shape preset entirely — a confirmed FRESH START (locked
   * decision: cross-shape wall correspondence is ambiguous, honest over clever), not a resize:
   * every cabinet/island is gone, same as "Start over." The caller (app.ts) confirms with the
   * owner before calling this; the store itself never confirms. One checkpoint, one undo step.
   */
  setRoomShape(key: RoomShapeKey, params: Record<string, number>, wallHeight: number): void {
    this.checkpoint();
    const footprint = ROOM_SHAPES[key].build(params);
    const room = createPolygonRoom(footprint, wallHeight);
    if (key === "rectangle") applyRectangleLabelsIfNeeded(room);
    this.state = {
      room,
      roomShape: { key, params },
      selectedWallId: null,
      selectedCabinetId: null,
    };
    this.notify();
  }

  /**
   * ONE-CLICK LOOK (cycle 014): replace the room's ENTIRE style with a curated preset bundle,
   * clearing every piece's finish/door-style override — islands included — in the SAME
   * checkpoint, so the whole repaint (and the loss of any personalization it overwrites)
   * undoes in a single Ctrl+Z. No confirm dialog (locked decision): undo is the safety net.
   */
  applyPreset(key: PresetKey): void {
    const room = this.state.room;
    if (!room) return;
    if (!(key in PRESETS)) return;
    this.checkpoint();
    room.style = roomStyleForPreset(key);
    for (const wall of room.walls) {
      for (const cabinet of wall.cabinets) {
        delete cabinet.finish;
        delete cabinet.doorStyle;
      }
    }
    this.notify();
  }

  /**
   * Set one room-wide surface default (floor/walls/counter/backsplash) — independent of the
   * cabinet-finish/door-style cascade, which flows through applyPreset + per-piece overrides
   * instead. Silently ignores an unknown key (defensive; the UI only ever offers valid ones).
   */
  setRoomSurface(category: SurfaceCategory, key: string): void {
    const room = this.state.room;
    if (!room) return;
    switch (category) {
      case "counter":
        if (!(key in COUNTER_MATERIALS)) return;
        this.checkpoint();
        room.style = { ...room.style, preset: CUSTOM_PRESET, counter: key as CounterMaterialKey };
        break;
      case "floor":
        if (!(key in FLOOR_MATERIALS)) return;
        this.checkpoint();
        room.style = { ...room.style, preset: CUSTOM_PRESET, floor: key as FloorMaterialKey };
        break;
      case "walls":
        if (!(key in WALL_PAINTS)) return;
        this.checkpoint();
        room.style = { ...room.style, preset: CUSTOM_PRESET, walls: key as WallPaintKey };
        break;
      case "backsplash":
        if (!(key in BACKSPLASHES)) return;
        this.checkpoint();
        room.style = { ...room.style, preset: CUSTOM_PRESET, backsplash: key as BacksplashKey };
        break;
    }
    this.notify();
  }

  /**
   * Select a wall (or an island's deck) for the elevation/properties view. Selecting a wall
   * clears any selected cabinet — INCLUDING when the wall id is unchanged: a deck/wall click
   * while one of its own pieces is selected must still switch the panel to wall/island mode in
   * one click (previously this early-returned on unchanged id without clearing the piece
   * selection, trapping the island's properties behind an undiscoverable two-click ritual — the
   * audit's island-selection trap). Only truly no-op (skip notify) when NEITHER the wall nor the
   * cabinet selection would change.
   */
  selectWall(id: string): void {
    if (this.state.selectedWallId === id && this.state.selectedCabinetId === null) return;
    this.state = { ...this.state, selectedWallId: id, selectedCabinetId: null };
    this.notify();
  }

  /** Clear the wall selection (and, implicitly, any piece selection) — the Esc chain's final
   * fallback (cycle 015 audit #5): active gesture -> abort, else deselect piece, else this. */
  deselectWall(): void {
    if (this.state.selectedWallId === null && this.state.selectedCabinetId === null) return;
    this.state = { ...this.state, selectedWallId: null, selectedCabinetId: null };
    this.notify();
  }

  /** Select a cabinet (and, implicitly, the wall it lives on so the elevation shows it). */
  selectCabinet(id: string | null): void {
    if (id === null) {
      this.state = { ...this.state, selectedCabinetId: null };
      this.notify();
      return;
    }
    const found = this.locateCabinet(id);
    if (!found) return;
    this.state = { ...this.state, selectedWallId: found.wall.id, selectedCabinetId: id };
    this.notify();
  }

  /**
   * Add a piece of the given kind to the selected wall: the first free gap (of its vertical
   * range) that fits its width — the catalog default width, or `width` if given (used by the
   * cabinet add buttons' width input; appliances/openings use their fixed catalog width) — the
   * catalog default width, or `width` if given. If no plain gap fits, tries planInsertWithPush
   * (growing the largest gap in a segment with enough AGGREGATE free space, cascading neighbors
   * rightward as needed). Physical overlap is still hard-blocked: a silent no-op if NEITHER
   * fits, as a defensive backstop — the palette UI disables a button before it can reach this
   * (now consulting push feasibility too), so this should not normally trigger blind.
   */
  addCabinet(kind: PieceKind, band: CabinetType, width?: number, overrides?: PieceOverrides): void {
    const wall = this.getSelectedWall();
    if (!wall) return;
    if (!canPlaceOn(wall.kind, kind, band)) return; // defensive backstop; the UI disables first
    const room = this.state.room!;
    const def = kindDefinition(kind, band);
    const pieceWidth = Math.max(MIN_DIMENSION, width ?? def.defaultSize.width);
    const bottom = anchorBottomFor({ kind, type: def.band });
    const verticalRange = { bottom, top: bottom + def.defaultSize.height };

    const gap = firstFittingGap(room, wall, verticalRange, def.defaultSize.depth, pieceWidth);
    if (gap) {
      this.checkpoint();
      const cabinet = createCabinet(kind, def.band, gap.start);
      cabinet.width = pieceWidth;
      applyPieceOverrides(room, cabinet, overrides);
      wall.cabinets.push(cabinet);
      this.state = { ...this.state, selectedCabinetId: cabinet.id };
      this.notify();
      return;
    }

    const pushed = planInsertWithPush(room, wall, verticalRange, def.defaultSize.depth, pieceWidth);
    if (!pushed) return; // neither a plain gap nor pushing works — defensive backstop

    this.checkpoint();
    for (const [relocatedId, relocatedOffset] of pushed.relocations) {
      const relocated = this.locateCabinet(relocatedId);
      if (relocated) relocated.cabinet.xOffset = relocatedOffset;
    }
    const cabinet = createCabinet(kind, def.band, pushed.xOffset);
    cabinet.width = pieceWidth;
    applyPieceOverrides(room, cabinet, overrides);
    wall.cabinets.push(cabinet);
    this.state = { ...this.state, selectedCabinetId: cabinet.id };
    this.notify();
  }

  /**
   * DROP entry point (cycle 013): add a piece of the given kind/band/width to a specific wall
   * AIMED at `xOffset` — the catalog drag-ghost's landing spot, rather than addCabinet's "first
   * free gap" rule. Delegates the placement decision to planCabinetDrop — the SAME pure function
   * the ghost preview calls, so what the ghost shows is exactly what a drop produces. A drop is
   * one click-like mutation (not a multi-step gesture), so the normal checkpoint applies, same
   * as addCabinet.
   */
  addCabinetAt(
    kind: PieceKind,
    band: CabinetType,
    width: number,
    wallId: string,
    xOffset: number,
    overrides?: PieceOverrides,
  ): EditOutcome {
    const room = this.state.room;
    if (!room) return { achieved: false, reason: "No room" };
    const wall = room.walls.find((w) => w.id === wallId);
    if (!wall) return { achieved: false, reason: "Wall not found" };
    if (!canPlaceOn(wall.kind, kind, band)) return { achieved: false, reason: "Can't place on an island" };

    // Gesture entry point (cycle 016 audit #2, second flag) — quantize the raw drop target to
    // the ½" grid before planning, the one entry point cycle 015's quantize sweep missed.
    const plan = planCabinetDrop(room, wall, kind, band, width, quantize(xOffset));
    if (!plan.valid) return { achieved: false, reason: noSpaceReason(room, wall, kind, band, plan) };

    this.checkpoint();
    for (const [relocatedId, relocatedOffset] of plan.relocations) {
      const relocated = this.locateCabinet(relocatedId);
      if (relocated) relocated.cabinet.xOffset = relocatedOffset;
    }
    const def = kindDefinition(kind, band);
    const cabinet = createCabinet(kind, def.band, plan.xOffset);
    cabinet.width = plan.width;
    applyPieceOverrides(room, cabinet, overrides);
    wall.cabinets.push(cabinet);
    // Cycle 016 audit #1: a drop must select the piece AND its wall — every other selection
    // path (selectCabinet) has always implied the wall; this path used to leave the elevation
    // and properties panel believing nothing was selected.
    this.state = { ...this.state, selectedWallId: wall.id, selectedCabinetId: cabinet.id };
    this.notify();
    return { achieved: true };
  }

  /**
   * MOVE entry point (cycle 019, the drag-first re-anchor authority): relocate an EXISTING
   * piece to `targetWallId` AIMED at `xOffset` — cross-wall (a true carry off one wall onto
   * another, island included) and same-wall (a carry that jumps to a different segment) alike.
   * `canPlaceOn` guards first (an opening can't land on an island; a wall-band piece can't
   * land on an island) with the same honest reason addCabinetAt uses. planCabinetDrop — cursor-
   * aimed, push-fallback, and critically EXCLUDING the piece's own id from its own occupancy
   * contribution — decides where it actually lands; a failure never mutates anything and
   * reuses noSpaceReason (cycle 018's blocker naming) exactly like addCabinetAt/duplicateCabinet.
   * On success, splices the SAME Cabinet object (id/finish/doorStyle/dimensions all untouched —
   * only xOffset changes) out of its old wall's array and into the target's, applying any
   * relocations first (the identical cascading-neighbors mechanism every other placement path
   * already uses); `selectedWallId` follows the piece to its new home. Gesture-aware like every
   * mutation: called from inside an open drag gesture, checkpoint() no-ops (beginGesture already
   * took the one snapshot), so a full slide-then-carry drag collapses to ONE undo step with zero
   * new undo machinery — a standalone call (e.g. a future keyboard "move to wall") checkpoints
   * normally.
   */
  movePieceToWall(id: string, targetWallId: string, xOffset: number): EditOutcome {
    const found = this.locateCabinet(id);
    if (!found) return { achieved: false, reason: "Piece not found" };
    const room = this.state.room;
    if (!room) return { achieved: false, reason: "No room" };
    const targetWall = room.walls.find((w) => w.id === targetWallId);
    if (!targetWall) return { achieved: false, reason: "Wall not found" };

    const { wall: oldWall, cabinet } = found;
    if (!canPlaceOn(targetWall.kind, cabinet.kind, cabinet.type)) {
      return { achieved: false, reason: "Can't place on an island" };
    }

    const plan = planCabinetDrop(room, targetWall, cabinet.kind, cabinet.type, cabinet.width, quantize(xOffset), cabinet.id);
    if (!plan.valid) return { achieved: false, reason: noSpaceReason(room, targetWall, cabinet.kind, cabinet.type, plan) };

    this.checkpoint();
    for (const [relocatedId, relocatedOffset] of plan.relocations) {
      const relocated = this.locateCabinet(relocatedId);
      if (relocated) relocated.cabinet.xOffset = relocatedOffset;
    }
    oldWall.cabinets = oldWall.cabinets.filter((c) => c.id !== id);
    cabinet.xOffset = plan.xOffset;
    targetWall.cabinets.push(cabinet);
    this.state = { ...this.state, selectedWallId: targetWall.id, selectedCabinetId: cabinet.id };
    this.notify();
    return { achieved: true };
  }

  /**
   * DRAG entry point: move a cabinet horizontally along its wall (inches from the wall start).
   * `push` false (the default) is today's stop-at-neighbor physics — hard-blocked, clamped into
   * the free gap it currently occupies, same-band neighbors or cross-wall corners stop the slide
   * flush (decision 1: plain drag keeps this). `push` true (Alt-drag, cycle 013) routes through
   * the SAME cascade moveCabinet already uses — no duplicated relocation logic, just delegating
   * and discarding the EditOutcome a live drag doesn't need (the view shows the result directly).
   */
  dragCabinet(id: string, xOffset: number, push = false): void {
    // Gesture entry point (cycle 015 audit #6) — quantize the raw pointer-derived offset to the
    // ½" grid before it ever reaches state, in BOTH branches (push routes through moveCabinet,
    // which is also the typed position-field path and so must NOT quantize internally).
    const quantized = quantize(xOffset);
    if (push) {
      this.moveCabinet(id, quantized);
      return;
    }
    const found = this.locateCabinet(id);
    if (!found) return;
    this.checkpoint();
    const room = this.state.room!;
    found.cabinet.xOffset = clampIntoGap(room, found.wall, found.cabinet, quantized);
    this.notify();
  }

  /**
   * POSITION-FIELD entry point: slide a cabinet toward `xOffset`, pushing neighbors in the
   * travel direction (planMoveWithPush) rather than stopping flush at the first one — a typed
   * position can cross a whole packed run, cascading it aside, never reordering or crossing an
   * opening/corner. Returns the furthest offset actually achieved; `achieved: false` (with a
   * reason) when the cascade fell short of the request, for the properties panel's message line.
   */
  moveCabinet(id: string, xOffset: number): EditOutcome {
    const found = this.locateCabinet(id);
    if (!found) return { achieved: false, reason: "Piece not found" };
    const room = this.state.room!;
    const result = planMoveWithPush(room, found.wall, found.cabinet, xOffset);

    if (Math.abs(result.achievedOffset - found.cabinet.xOffset) > EPSILON || result.relocations.size > 0) {
      this.checkpoint();
      found.cabinet.xOffset = result.achievedOffset;
      for (const [relocatedId, relocatedOffset] of result.relocations) {
        const relocated = this.locateCabinet(relocatedId);
        if (relocated) relocated.cabinet.xOffset = relocatedOffset;
      }
      this.notify();
    }

    if (Math.abs(result.achievedOffset - xOffset) < EPSILON) return { achieved: true };
    return { achieved: false, reason: `Stopped at ${formatInches(result.achievedOffset)}" — blocked` };
  }

  /**
   * Resize a cabinet. Width and depth are hard-clamped so growing either one can never create
   * a physical overlap with a same-band neighbor (same-wall or cross-wall corner); height is
   * clamped to the band/ceiling as before. Returns `achieved: false` with a reason when any
   * provided value got clamped — the properties panel's message line reports it (Part 4); these
   * clamps already existed, this just gives them a voice instead of silently snapping back.
   */
  resizeCabinet(id: string, patch: Partial<Pick<Cabinet, "width" | "height" | "depth">>): EditOutcome {
    const found = this.locateCabinet(id);
    if (!found) return { achieved: false, reason: "Piece not found" };
    this.checkpoint();
    const { wall, cabinet } = found;
    const room = this.state.room!;
    let reason: string | undefined;

    if (patch.width !== undefined) {
      const maxWidth = maxWidthWithoutCollision(room, wall, cabinet);
      const applied = clamp(patch.width, MIN_DIMENSION, maxWidth);
      if (Math.abs(applied - patch.width) > EPSILON) reason = `Width clamped to ${formatInches(applied)}"`;
      cabinet.width = applied;
    }
    if (patch.depth !== undefined) {
      const maxDepth = maxDepthWithoutCollision(room, wall, cabinet);
      const applied = clamp(patch.depth, MIN_DIMENSION, maxDepth);
      if (Math.abs(applied - patch.depth) > EPSILON) reason = `Depth clamped to ${formatInches(applied)}"`;
      cabinet.depth = applied;
    }
    if (patch.height !== undefined) {
      // A piece may not poke through the ceiling from its (possibly kind-overridden) anchor.
      const maxHeight = Math.max(MIN_DIMENSION, room.wallHeight - anchorBottomFor(cabinet));
      const applied = clamp(patch.height, MIN_DIMENSION, maxHeight);
      if (Math.abs(applied - patch.height) > EPSILON) reason = `Height clamped to ${formatInches(applied)}"`;
      cabinet.height = applied;
    }
    this.notify();
    return reason ? { achieved: false, reason } : { achieved: true };
  }

  /**
   * HANDLE-DRAG entry point (cycle 013): resize a cabinet by dragging one of its elevation
   * handles. `right` grows/shrinks the width from the right edge (xOffset fixed) — identical
   * clamp to resizeCabinet's width case (maxWidthWithoutCollision). `left` grows/shrinks from the
   * left edge with the RIGHT edge pinned: both xOffset and width change together, the left edge
   * clamped to the current gap's start (currentGapFor — the same primitive clampIntoGap and
   * maxWidthWithoutCollision are built on) and width floored at MIN_DIMENSION. `top` resizes
   * height from the top edge — identical clamp to resizeCabinet's height case. One undo step per
   * gesture (the view wraps every handle drag in beginGesture/endGesture, same as any other drag).
   */
  resizeCabinetEdge(id: string, edge: "left" | "right" | "top", value: number): EditOutcome {
    const found = this.locateCabinet(id);
    if (!found) return { achieved: false, reason: "Piece not found" };
    this.checkpoint();
    const { wall, cabinet } = found;
    const room = this.state.room!;
    // Gesture entry point (cycle 015 audit #6) — quantize the raw pointer-derived handle
    // position to the ½" grid before any clamp math, so a handle drag never lands on a float
    // like 36.42677744929885.
    const quantizedValue = quantize(value);

    if (edge === "right") {
      const desiredWidth = quantizedValue - cabinet.xOffset;
      const maxWidth = maxWidthWithoutCollision(room, wall, cabinet);
      const applied = clamp(desiredWidth, MIN_DIMENSION, maxWidth);
      cabinet.width = applied;
      this.notify();
      return Math.abs(applied - desiredWidth) > EPSILON
        ? { achieved: false, reason: `Width clamped to ${formatInches(applied)}"` }
        : { achieved: true };
    }

    if (edge === "left") {
      const rightEdge = cabinet.xOffset + cabinet.width;
      const gap = currentGapFor(room, wall, cabinet, cabinet.depth) ?? { start: 0, end: wall.length };
      const desiredLeft = clamp(quantizedValue, gap.start, rightEdge - MIN_DIMENSION);
      cabinet.xOffset = desiredLeft;
      cabinet.width = rightEdge - desiredLeft;
      this.notify();
      return Math.abs(desiredLeft - quantizedValue) > EPSILON
        ? { achieved: false, reason: `Position clamped to ${formatInches(desiredLeft)}"` }
        : { achieved: true };
    }

    // edge === "top"
    const desiredHeight = quantizedValue - anchorBottomFor(cabinet);
    const maxHeight = Math.max(MIN_DIMENSION, room.wallHeight - anchorBottomFor(cabinet));
    const applied = clamp(desiredHeight, MIN_DIMENSION, maxHeight);
    cabinet.height = applied;
    this.notify();
    return Math.abs(applied - desiredHeight) > EPSILON
      ? { achieved: false, reason: `Height clamped to ${formatInches(applied)}"` }
      : { achieved: true };
  }

  /**
   * PER-PIECE FINISH override (cycle 014) — cabinet/filler kinds only (guarded on kind;
   * properties.ts's Finish section only ever shows for those anyway). Silently ignores an
   * unknown key or a kind that can't take a finish (appliances/openings). Can't fail visibly —
   * the UI only ever offers valid keys via the swatch row, so no EditOutcome is needed.
   */
  setPieceFinish(id: string, key: CabinetFinishKey): void {
    const found = this.locateCabinet(id);
    if (!found) return;
    if (found.cabinet.kind !== "cabinet" && found.cabinet.kind !== "filler") return;
    if (!(key in CABINET_FINISHES)) return;
    this.checkpoint();
    found.cabinet.finish = key;
    const room = this.state.room!;
    room.style = { ...room.style, preset: CUSTOM_PRESET };
    this.notify();
  }

  /**
   * PER-PIECE DOOR STYLE override (cycle 014) — `kind:'cabinet'` only (a filler strip has no
   * door; appliances/openings have their own fixed geometry). Same no-EditOutcome rationale as
   * setPieceFinish above.
   */
  setPieceDoorStyle(id: string, style: DoorStyle): void {
    const found = this.locateCabinet(id);
    if (!found) return;
    if (found.cabinet.kind !== "cabinet") return;
    if (!(style in DOOR_STYLES)) return;
    this.checkpoint();
    found.cabinet.doorStyle = style;
    const room = this.state.room!;
    room.style = { ...room.style, preset: CUSTOM_PRESET };
    this.notify();
  }

  /**
   * One-shot "fill this wall": flush-fill every FREE stretch of the given band with
   * standard-width cabinets (plus filler strips for leftover inches) — corner-aware, so
   * filling an adjacent wall stops short instead of interpenetrating. No-op without a
   * selected wall. Generated pieces are pushed as plain cabinets — there is no persistent
   * run entity, so this never re-runs or redistributes on its own.
   */
  fillWall(type: CabinetType): void {
    const wall = this.getSelectedWall();
    if (!wall) return;
    if (!canPlaceOn(wall.kind, "cabinet", type)) return; // defensive backstop; the UI disables first
    this.checkpoint();
    const room = this.state.room!;
    wall.cabinets.push(...planFill(room, wall, type));
    this.notify();
  }

  /**
   * Apply a layout template: replace EVERYTHING — every island is removed (a template is a
   * complete, predictable layout, not a partial one that leaves stray unrelated entities
   * behind; "Replace the current layout?" means the whole layout) — then fill the template's
   * selected PERIMETER walls SEQUENTIALLY — wall A's generated pieces are pushed into the room
   * before wall B is planned, so wall B sees wall A via occupancy.ts and corners stay honest
   * (planFill is pure; planning every wall up front and applying at once would let the corner
   * overlap cycle 004 eliminated come back through this door). Templates never fill an island
   * (templateWalls only ever selects from perimeterWalls). One notify() at the end. No-op
   * without a room. The store never confirms — that's the UI's job, before this is even called.
   */
  applyTemplate(key: TemplateKey): void {
    const room = this.state.room;
    if (!room) return;
    this.checkpoint();

    room.walls = perimeterWalls(room);
    for (const wall of room.walls) wall.cabinets = [];

    for (const wall of templateWalls(room, key)) {
      wall.cabinets.push(...planFill(room, wall, "base"));
      wall.cabinets.push(...planFill(room, wall, "wall"));
    }

    this.state = { ...this.state, selectedWallId: null, selectedCabinetId: null };
    this.notify();
  }

  /**
   * Add a new freestanding island, centered in the room by default — but only if that spot is
   * actually valid: with an existing island parked near center, a second island's centered
   * default can overlap the first island's pieces, a placement islandPlacementValid (added for
   * MOVES) would reject outright if you tried to drag there. Spawning unchecked let that happen
   * silently (Eris's double-island repro) — moves were strict, spawns weren't. If the centered
   * spot is invalid, nudge to the NEAREST valid spot via a deterministic outward grid search
   * from center; a pathologically full room (search exhausted) is a no-op rather than spawning
   * an island on top of something.
   */
  addIsland(): void {
    const room = this.state.room;
    if (!room) return;
    const island = this.findValidIslandSpot(room, createIsland(room));
    if (!island) return;
    this.checkpoint();
    room.walls.push(island);
    this.state = { ...this.state, selectedWallId: island.id, selectedCabinetId: null };
    this.notify();
  }

  /**
   * Drag an island to a new plan position. REJECT-if-collision (sticky drag): the move applies
   * only if the island's own footprint stays inside the room AND every one of its pieces' new
   * footprints stays inside the room and conflicts with no piece on any OTHER wall. Otherwise
   * a no-op — the island simply doesn't move past whatever it hit.
   */
  moveIsland(id: string, x: number, y: number): void {
    const room = this.state.room;
    if (!room) return;
    const island = room.walls.find((w) => w.id === id && w.kind === "island");
    if (!island) return;
    // Gesture entry point (cycle 015 audit #6) — quantize the raw drag position to the ½" grid.
    const qx = quantize(x);
    const qy = quantize(y);

    const hypothetical: Wall = { ...island, start: { x: qx, y: qy } };
    if (!this.islandPlacementValid(room, hypothetical)) return;

    this.checkpoint();
    island.start = { x: qx, y: qy };
    this.notify();
  }

  /**
   * Rotate an island between east-west and north-south. Refuses (no-op) if the reoriented
   * island would poke outside the room or collide with another wall's pieces — same
   * reject-if-invalid rule as moveIsland, reusing the same validity check. A rotation can't be
   * meaningfully "partial" (decision 4), so this stays reject-if-invalid rather than clamping;
   * the returned reason is what the properties panel's message line shows for the rejection.
   */
  setIslandOrientation(id: string, orientation: IslandOrientation): EditOutcome {
    const room = this.state.room;
    if (!room) return { achieved: false, reason: "No room" };
    const island = room.walls.find((w) => w.id === id && w.kind === "island");
    if (!island) return { achieved: false, reason: "Island not found" };
    if (islandOrientation(island) === orientation) return { achieved: true };

    const hypothetical: Wall = { ...island };
    reorientIsland(hypothetical, orientation, room);
    if (!this.islandPlacementValid(room, hypothetical)) {
      return { achieved: false, reason: "Can't rotate here — blocked by wall pieces" };
    }

    this.checkpoint();
    island.dir = hypothetical.dir;
    island.inward = hypothetical.inward;
    island.start = hypothetical.start;
    this.notify();
    return { achieved: true };
  }

  /**
   * POSITION-FIELD entry point for an island: clamp-toward along the given axis — slide to the
   * FURTHEST valid position toward `target`, holding the other axis fixed (a 1D scan via the
   * existing islandPlacementValid, binary-searched the same way occupancy.ts's
   * maxDepthWithoutCollision finds its own monotonic boundary). Islands are NOT pushed and do
   * NOT push (decision 4) — this only ever moves the island itself, never another wall's pieces.
   * Deliberately separate from moveIsland (the drag path, unchanged reject-if-invalid/sticky).
   */
  setIslandPosition(id: string, axis: "x" | "y", target: number): EditOutcome {
    const room = this.state.room;
    if (!room) return { achieved: false, reason: "No room" };
    const island = room.walls.find((w) => w.id === id && w.kind === "island");
    if (!island) return { achieved: false, reason: "Island not found" };

    const achievedValue = this.clampIslandTowardTarget(room, island, axis, target);
    if (Math.abs(achievedValue - island.start[axis]) > EPSILON) {
      this.checkpoint();
      island.start = { ...island.start, [axis]: achievedValue };
      this.notify();
    }

    if (Math.abs(achievedValue - target) < EPSILON) return { achieved: true };
    return { achieved: false, reason: `Stopped at ${formatInches(achievedValue)}" — blocked` };
  }

  /**
   * The furthest value along `axis` (toward `target`, holding the other axis fixed) at which
   * `island` still validates. Binary search between the island's current (always valid) position
   * and `target` — monotonic in practice for this app's rectangular obstacles: continuing past a
   * blockage in one direction doesn't un-block further along the same direction, the same
   * assumption occupancy.ts's own binary searches make.
   */
  private clampIslandTowardTarget(room: Room, island: Wall, axis: "x" | "y", target: number): number {
    const at = (value: number): Wall => ({ ...island, start: { ...island.start, [axis]: value } });
    if (this.islandPlacementValid(room, at(target))) return target;

    let lo = island.start[axis]; // known valid — the island is already legitimately there
    let hi = target; // known invalid, checked above
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (this.islandPlacementValid(room, at(mid))) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /**
   * Resize an island's length. Refuses (no-op) if the new length would orphan an existing
   * piece (cut it off below its own end) or push the island's end outside the room — the
   * simplest honest rule: growing/shrinking never silently repositions a piece.
   */
  setIslandLength(id: string, length: number): void {
    const room = this.state.room;
    if (!room) return;
    const island = room.walls.find((w) => w.id === id && w.kind === "island");
    if (!island) return;

    const clampedLength = Math.max(MIN_DIMENSION, length);
    const lastPieceEnd = island.cabinets.reduce((max, c) => Math.max(max, c.xOffset + c.width), 0);
    if (clampedLength < lastPieceEnd) return;

    const orientation = islandOrientation(island);
    const startAlongAxis = orientation === "ew" ? island.start.x : island.start.y;
    const roomExtent = orientation === "ew" ? room.width : room.length;
    if (startAlongAxis + clampedLength > roomExtent) return;

    this.checkpoint();
    island.length = clampedLength;
    this.notify();
  }

  /**
   * HANDLE-DRAG entry point (cycle 013) for an island's plan-view end handles. `end: "end"`
   * (the far end) is exactly setIslandLength — start held fixed, length changes, same orphan
   * rule. `end: "start"` (the near end) shifts island.start along its own orientation axis WHILE
   * keeping the far end in place: every existing piece's xOffset shifts by the same delta so it
   * stays physically where it was (only the deck's near edge actually moves), then the shifted
   * layout is checked against the SAME two existing rules setIslandLength already enforces — no
   * piece orphaned off either edge of the new length, and islandPlacementValid (room bounds +
   * no collision with any other wall's pieces) — no new validity logic, just the existing checks
   * applied to the start-end case setIslandLength doesn't handle.
   */
  resizeIslandEnd(id: string, end: "start" | "end", value: number): void {
    const room = this.state.room;
    if (!room) return;
    const island = room.walls.find((w) => w.id === id && w.kind === "island");
    if (!island) return;
    // Gesture entry point (cycle 015 audit #6) — quantize the raw handle-drag position to the
    // ½" grid before it feeds either branch below. setIslandLength itself stays unquantized
    // (it's ALSO the typed-field entry point from properties.ts, which must keep exact values).
    const quantizedValue = quantize(value);

    if (end === "end") {
      const startAlongAxis = islandOrientation(island) === "ew" ? island.start.x : island.start.y;
      this.setIslandLength(id, quantizedValue - startAlongAxis);
      return;
    }

    const axis: "x" | "y" = islandOrientation(island) === "ew" ? "x" : "y";
    const currentStart = island.start[axis];
    const currentEnd = currentStart + island.length;
    const clampedStart = Math.min(quantizedValue, currentEnd - MIN_DIMENSION);
    const newLength = currentEnd - clampedStart;
    const delta = currentStart - clampedStart;

    const shiftedEnd = island.cabinets.reduce((max, c) => Math.max(max, c.xOffset + delta + c.width), 0);
    const shiftedStart = island.cabinets.reduce((min, c) => Math.min(min, c.xOffset + delta), 0);
    if (shiftedEnd > newLength || shiftedStart < 0) return; // would orphan a piece off either edge

    const hypothetical: Wall = {
      ...island,
      start: { ...island.start, [axis]: clampedStart },
      length: newLength,
      cabinets: island.cabinets.map((c) => ({ ...c, xOffset: c.xOffset + delta })),
    };
    if (!this.islandPlacementValid(room, hypothetical)) return;

    this.checkpoint();
    island.start = { ...island.start, [axis]: clampedStart };
    island.length = newLength;
    for (const cabinet of island.cabinets) cabinet.xOffset += delta;
    this.notify();
  }

  /** Remove an island and its pieces; clears whichever selection pointed at it. */
  deleteIsland(id: string): void {
    const room = this.state.room;
    if (!room) return;
    const island = room.walls.find((w) => w.id === id && w.kind === "island");
    if (!island) return;

    this.checkpoint();
    room.walls = room.walls.filter((w) => w.id !== id);
    const selectedWallId = this.state.selectedWallId === id ? null : this.state.selectedWallId;
    const cabinetWasOnIsland = island.cabinets.some((c) => c.id === this.state.selectedCabinetId);
    const selectedCabinetId = cabinetWasOnIsland ? null : this.state.selectedCabinetId;
    this.state = { ...this.state, selectedWallId, selectedCabinetId };
    this.notify();
  }

  /**
   * Shared validity check for moveIsland/setIslandOrientation: does this hypothetical island
   * placement (position + orientation, real pieces) stay inside the room's FOOTPRINT (cycle
   * 017 — an arbitrary polygon, not just its bounding box, so an island can't park in an
   * L-shape's notch even though the notch sits inside the bbox), and does none of its pieces'
   * PLAN FOOTPRINTS overlap any other wall's piece — base or wall cabinet, regardless of
   * height? Footprint-only by design: an island sliding under a wall's uppers (no vertical
   * overlap, but a real 2D overlap in plan) is exactly the case this must reject, so this uses
   * footprintsConflict, not the vertical-range-aware rule fill/add collision uses. Read-only —
   * never mutates `hypothetical` or the real island.
   *
   * Containment is quadInsidePolygon (point-in-polygon on all four corners PLUS an edge-crossing
   * check) rather than a corners-only test — a wide island whose two ends both land inside
   * separate arms of a U-shape would pass a corners-only check while its middle cuts straight
   * through the notch.
   *
   * An EMPTY island (no pieces yet) has nothing to run that check against, but planView still
   * draws its deck as a real rectangle — length x default base depth (see planView's
   * islandDeckDepth) — so that exact rectangle is what gets tested instead: candidateStrip is
   * the SAME footprint geometry cabinetFootprint would produce for a piece spanning the whole
   * island at that depth, reused rather than duplicated. Without this, an empty island's drawn
   * deck could overlap a wall run with nothing to explain it (the audit's 4" overlap repro).
   */
  private islandPlacementValid(room: Room, hypothetical: Wall): boolean {
    if (hypothetical.cabinets.length === 0) {
      const deckDepth = kindDefinition("cabinet", "base").defaultSize.depth;
      const deck = candidateStrip(hypothetical, deckDepth);
      if (!quadInsidePolygon(deck, room.footprint)) return false;
      for (const otherWall of room.walls) {
        if (otherWall.id === hypothetical.id) continue;
        for (const otherPiece of otherWall.cabinets) {
          if (quadsOverlap(deck, cabinetFootprint(otherWall, otherPiece))) return false;
        }
      }
      return true;
    }

    for (const piece of hypothetical.cabinets) {
      const fp = cabinetFootprint(hypothetical, piece);
      if (!quadInsidePolygon(fp, room.footprint)) return false;
    }

    for (const otherWall of room.walls) {
      if (otherWall.id === hypothetical.id) continue;
      for (const otherPiece of otherWall.cabinets) {
        for (const piece of hypothetical.cabinets) {
          if (footprintsConflict(hypothetical, piece, otherWall, otherPiece)) return false;
        }
      }
    }
    return true;
  }

  /**
   * Find where to actually spawn `island` (fresh from createIsland, so always centered and
   * empty): its own default spot if valid, else the NEAREST valid spot found by a deterministic
   * outward search over a coarse grid of candidate positions (along the island's own
   * orientation axis, and across it), ordered by distance from the default center. Returns a
   * new Wall at the first valid candidate (same id, same length/orientation — only `start`
   * changes), or null if nothing on the grid validates (a pathologically full room — addIsland
   * treats this as a no-op rather than spawning on top of something).
   */
  private findValidIslandSpot(room: Room, island: Wall): Wall | null {
    if (this.islandPlacementValid(room, island)) return island;

    const orientation = islandOrientation(island);
    const alongExtent = orientation === "ew" ? room.width : room.length;
    const crossExtent = orientation === "ew" ? room.length : room.width;
    const maxAlong = Math.max(0, alongExtent - island.length);
    const centerAlong = orientation === "ew" ? island.start.x : island.start.y;
    const centerCross = orientation === "ew" ? island.start.y : island.start.x;

    const GRID_STEP = 6; // coarse but cheap — a few thousand candidates at most, one-time cost
    const alongSteps = gridSteps(maxAlong, GRID_STEP);
    const crossSteps = gridSteps(crossExtent, GRID_STEP);

    const candidates = alongSteps.flatMap((along) =>
      crossSteps.map((cross) => ({ along, cross, dist: Math.hypot(along - centerAlong, cross - centerCross) })),
    );
    candidates.sort((a, b) => a.dist - b.dist || a.along - b.along || a.cross - b.cross);

    for (const { along, cross } of candidates) {
      const start = orientation === "ew" ? { x: along, y: cross } : { x: cross, y: along };
      const hypothetical: Wall = { ...island, start };
      if (this.islandPlacementValid(room, hypothetical)) return hypothetical;
    }
    return null;
  }

  /** Delete a cabinet; clears the selection if it was the selected one. */
  deleteCabinet(id: string): void {
    const found = this.locateCabinet(id);
    if (!found) return;
    this.checkpoint();
    found.wall.cabinets = found.wall.cabinets.filter((c) => c.id !== id);
    const selectedCabinetId = this.state.selectedCabinetId === id ? null : this.state.selectedCabinetId;
    this.state = { ...this.state, selectedCabinetId };
    this.notify();
  }

  /**
   * Duplicate a piece (cycle 016 Part D): a true copy — kind/band/width/height/depth/finish/
   * doorStyle — landing flush beside the original. Tries AFTER first, then BEFORE, through
   * planCabinetDrop — the SAME targeted-push planner addCabinetAt uses, never a second
   * placement path — so a duplicate pushes exactly like any other drop when the wall is tight.
   * Honest failure (nothing lands, a reason) when neither side works even with push. Success
   * selects the COPY, not the original, so repeated Ctrl+D builds a run one keystroke at a time.
   * Openings duplicate too (they're pieces, same as a plain cabinet); islands are not (queued).
   */
  duplicateCabinet(id: string): EditOutcome {
    const found = this.locateCabinet(id);
    if (!found) return { achieved: false, reason: "Piece not found" };
    const room = this.state.room!;
    const { wall, cabinet } = found;

    const afterPlan = planCabinetDrop(room, wall, cabinet.kind, cabinet.type, cabinet.width, cabinet.xOffset + cabinet.width);
    const beforePlan = planCabinetDrop(room, wall, cabinet.kind, cabinet.type, cabinet.width, cabinet.xOffset - cabinet.width);
    const plan = afterPlan.valid ? afterPlan : beforePlan;
    if (!plan.valid) return { achieved: false, reason: noSpaceReason(room, wall, cabinet.kind, cabinet.type, plan, "duplicate") };

    this.checkpoint();
    for (const [relocatedId, relocatedOffset] of plan.relocations) {
      const relocated = this.locateCabinet(relocatedId);
      if (relocated) relocated.cabinet.xOffset = relocatedOffset;
    }
    const copy = createCabinet(cabinet.kind, cabinet.type, plan.xOffset);
    copy.width = cabinet.width;
    copy.height = cabinet.height;
    copy.depth = cabinet.depth;
    if (cabinet.finish !== undefined) copy.finish = cabinet.finish;
    if (cabinet.doorStyle !== undefined) copy.doorStyle = cabinet.doorStyle;
    wall.cabinets.push(copy);
    this.state = { ...this.state, selectedWallId: wall.id, selectedCabinetId: copy.id };
    this.notify();
    return { achieved: true };
  }
}

/** The one app store. */
export const store = new Store();
