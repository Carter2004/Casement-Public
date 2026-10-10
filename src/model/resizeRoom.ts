// resizeRoom.ts — pure room-resize planner. Rebuilds the perimeter via createPolygonRoom from a
// caller-supplied footprint (cycle 017 — a SAME-SHAPE resize's own build(params) output; the
// caller, store.ts, is the one place that knows which shape preset is active) and reattaches
// each old wall's cabinets in order: keep their kind/dimensions, keep their old xOffset if that
// interval is still free on the new wall, otherwise relocate via occupancy.ts's firstFittingGap;
// drop (and count) anything that fits nowhere. Collision-aware by construction (vertical-range
// rule included) — a shrunken wall can never end up with overlapping survivors, because each
// cabinet is reattached (and pushed into the new room) before the next one is checked, the same
// sequential discipline planFill/applyTemplate use.
//
// Islands are carried across explicitly, AFTER the perimeter is rebuilt and reattached: each
// island keeps its id (so a selection pointing at it survives), length, and orientation, with
// its position clamped back inside the new room; its pieces are then reattached the same
// sequential way. An island whose length itself can't fit the new room at all is dropped, its
// pieces counted as casualties. A SAME-SHAPE resize always produces the same wall COUNT as the
// old room (a shape's build() is deterministic in vertex count regardless of its params), so
// perimeter wall ids line up 1:1 by construction; a genuinely mismatched wall count (which
// should only ever happen if a caller mistakenly calls this across a SHAPE SWITCH, which must
// instead go through store.setRoomShape's confirmed fresh start) drops that wall's cabinets as
// casualties rather than silently discarding them.
//
// Wall-height changes never drop a cabinet — the vertical-fit invariant (clamping/denying
// cabinets that don't fit under a shorter ceiling) is explicitly out of scope this cycle.
//
// Pure, no store/DOM access — directly unit-testable.

import { createCabinet, type Cabinet } from "./cabinet";
import { cabinetVerticalPlacement } from "./kinds";
import { firstFittingGap, freeIntervals } from "./occupancy";
import { carryIslandInto, createPolygonRoom, perimeterWalls, type Room, type Vec2, type Wall } from "./room";

export interface RoomResizeResult {
  room: Room;
  droppedCount: number;
  /**
   * Old cabinet id -> new cabinet id, for every cabinet that survived (dropped ones are
   * absent). Every reattached cabinet gets a freshly minted id (ids are never carried by
   * value across a rebuild — see cabinet.ts / persistence.ts for why), so this is how a caller
   * can carry a cabinet selection across the resize despite that. Island ids ARE carried
   * as-is (see carryIslandInto), so an island selection needs no such map.
   */
  survivedIds: Map<string, string>;
}

/** Given the OLD room and a new footprint (the active shape's own build(params) output), build
 * the new room — perimeter walls first, then carried islands — and reattach as many old
 * cabinets as still fit on each. */
export function planRoomResize(oldRoom: Room, footprint: Vec2[], wallHeight: number): RoomResizeResult {
  const room = createPolygonRoom(footprint, wallHeight);
  // createPolygonRoom seeds a FRESH room with the default look (Classic White) — a resize is the
  // SAME room, just a new size, so it must keep whatever look the homeowner already chose
  // rather than silently reverting it.
  room.style = { ...oldRoom.style };
  let droppedCount = 0;
  const survivedIds = new Map<string, string>();

  for (const oldWall of perimeterWalls(oldRoom)) {
    const newWall = room.walls.find((w) => w.id === oldWall.id);
    if (!newWall) {
      droppedCount += oldWall.cabinets.length; // wall count mismatch — see header comment
      continue;
    }
    droppedCount += reattachAll(room, newWall, oldWall.cabinets, survivedIds);
  }

  for (const oldIsland of oldRoom.walls) {
    if (oldIsland.kind !== "island") continue;
    const carried = carryIslandInto(oldIsland, room);
    if (!carried) {
      droppedCount += oldIsland.cabinets.length;
      continue;
    }
    room.walls.push(carried);
    droppedCount += reattachAll(room, carried, oldIsland.cabinets, survivedIds);
  }

  return { room, droppedCount, survivedIds };
}

/** Reattach every cabinet from an old wall onto its (already-in-room) new counterpart,
 * sequentially, so each reattachment sees the ones before it. Returns the count that didn't fit. */
function reattachAll(room: Room, newWall: Wall, oldCabinets: Cabinet[], survivedIds: Map<string, string>): number {
  let dropped = 0;
  for (const oldCabinet of oldCabinets) {
    const placed = reattach(room, newWall, oldCabinet);
    if (placed) {
      newWall.cabinets.push(placed);
      survivedIds.set(oldCabinet.id, placed.id);
    } else {
      dropped += 1;
    }
  }
  return dropped;
}

/**
 * Try to keep a cabinet at its old xOffset on the new wall; if that interval is no longer free
 * (the wall shrank, or a corner neighbor now blocks it), relocate to the first gap that fits;
 * if nothing fits at all, return null so the caller drops and counts it.
 */
function reattach(room: Room, wall: Wall, oldCabinet: Cabinet): Cabinet | null {
  const verticalRange = cabinetVerticalPlacement(oldCabinet);

  const fitsAtOldOffset = freeIntervals(room, wall, verticalRange, oldCabinet.depth).some(
    (gap) => oldCabinet.xOffset >= gap.start && oldCabinet.xOffset + oldCabinet.width <= gap.end,
  );

  const xOffset = fitsAtOldOffset
    ? oldCabinet.xOffset
    : firstFittingGap(room, wall, verticalRange, oldCabinet.depth, oldCabinet.width)?.start;

  if (xOffset === undefined) return null;

  const cabinet = createCabinet(oldCabinet.kind, oldCabinet.type, xOffset);
  cabinet.width = oldCabinet.width;
  cabinet.height = oldCabinet.height;
  cabinet.depth = oldCabinet.depth;
  // Finish/door-style overrides (cycle 014) carry across a resize like any other dimension —
  // absent stays absent (falls back to the room default either way).
  if (oldCabinet.finish !== undefined) cabinet.finish = oldCabinet.finish;
  if (oldCabinet.doorStyle !== undefined) cabinet.doorStyle = oldCabinet.doorStyle;
  return cabinet;
}
