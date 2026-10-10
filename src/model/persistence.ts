// persistence.ts — THE one home of serialization. Persists the MINIMAL model (room footprint,
// each perimeter piece's kind/band/position/size, and each island's position/orientation/
// length/pieces) and re-derives everything else on load: wall geometry (start/dir/inward) comes
// back through createPolygonRoom/createIsland, and piece ids are freshly minted through
// createCabinet — never persisted, since the id counter is module-level and resets on page
// reload, so a saved id would eventually collide with a freshly minted one.
//
// SCHEMA_VERSION is 5 (cycle 017 replaced room.width/length with room.footprint — an arbitrary
// polygon — and added the optional roomShape{key,params} so the room form's shape picker/fields
// stay truthful after a reload; cycle 014 added room.style + per-cabinet finish/doorStyle;
// cycle 009 added islands; cycle 008 added `kind`, retiring the old `filler` boolean).
// Migrations chain STEPWISE: v1 -> v2 -> v3 -> v4 -> v5, each step validating its OWN shape
// before transforming, so a v1..v4 save all load intact as v5 — including the owner's real,
// previously-saved kitchens.
//
// A bad save can never crash or half-load the app: any corrupt, missing, version-mismatched, or
// shape-invalid payload is treated as "no save exists" (whole-payload rejection — never a
// partial load of a half-valid design). Future export/import or named-designs work extends
// this module; there must never be a second serialization path.

import { createCabinet, type Cabinet, type CabinetType } from "./cabinet";
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
  type StylePreset,
  type WallPaintKey,
} from "./finishes";
import { APPLIANCE_KIND_LIST, canPlaceOn, type PieceKind } from "./kinds";
import {
  applyRectangleLabelsIfNeeded,
  createIsland,
  createPolygonRoom,
  isValidFootprint,
  islandOrientation,
  perimeterWalls,
  type IslandOrientation,
  type Room,
  type Vec2,
} from "./room";
import { ROOM_SHAPES, type RoomShapeKey } from "./roomShapes";

const SCHEMA_VERSION = 5;
const STORAGE_KEY = "casement.design";
/** The pre-rename storage key (cycle 008 through cycle 016, before the app became Casement) —
 * read ONCE as a fallback when the new key is empty (cycle 018's [HIGH] data-continuity fix:
 * the rename shipped with no fallback, silently orphaning every pre-rename design). Left in
 * place after a successful rescue rather than cleared: harmless (app.ts's existing post-load
 * save() already writes the design back under STORAGE_KEY, so the new key is non-empty from
 * then on and this path is never reached again — self-retiring by construction, and keeping
 * the old key is one less thing that could go wrong during a rollback). */
const LEGACY_STORAGE_KEY = "cabinet-studio.design";

const VALID_KINDS = new Set<string>(["cabinet", "filler", ...APPLIANCE_KIND_LIST]);
const VALID_ORIENTATIONS = new Set(["ew", "ns"]);
/** Value vocabulary only (cycle 015, no schema bump — same posture as cycle 010's opening kinds):
 * a saved room.style.preset may be any real preset key OR the "custom" divergence sentinel. */
const VALID_PRESETS = new Set<string>([...Object.keys(PRESETS), CUSTOM_PRESET]);
const VALID_CABINET_FINISHES = new Set(Object.keys(CABINET_FINISHES));
const VALID_DOOR_STYLES = new Set(Object.keys(DOOR_STYLES));
const VALID_COUNTER_MATERIALS = new Set(Object.keys(COUNTER_MATERIALS));
const VALID_FLOOR_MATERIALS = new Set(Object.keys(FLOOR_MATERIALS));
const VALID_WALL_PAINTS = new Set(Object.keys(WALL_PAINTS));
const VALID_BACKSPLASHES = new Set(Object.keys(BACKSPLASHES));
const VALID_SHAPE_KEYS = new Set(Object.keys(ROOM_SHAPES));

interface SavedCabinet {
  kind: PieceKind;
  type: CabinetType;
  xOffset: number;
  width: number;
  height: number;
  depth: number;
  /** Per-piece overrides (cycle 014) — absent means "use the room's default." */
  finish?: CabinetFinishKey;
  doorStyle?: DoorStyle;
}

interface SavedIsland {
  x: number;
  y: number;
  orientation: IslandOrientation;
  length: number;
  cabinets: SavedCabinet[];
}

interface SavedRoomStyle {
  preset: StylePreset;
  cabinetFinish: CabinetFinishKey;
  doorStyle: DoorStyle;
  counter: CounterMaterialKey;
  floor: FloorMaterialKey;
  walls: WallPaintKey;
  backsplash: BacksplashKey;
}

/** The shape preset (+ its params) that produced the room's footprint, if any (cycle 017) —
 * optional so the schema stays honest about a future footprint-editor-authored room having no
 * preset at all. Purely a form-truthfulness aid; never consulted for geometry (the footprint
 * itself is always authoritative). */
export interface SavedRoomShape {
  key: RoomShapeKey;
  params: Record<string, number>;
}

interface SavedPayload {
  version: number;
  room: { footprint: Vec2[]; wallHeight: number; style: SavedRoomStyle };
  roomShape?: SavedRoomShape;
  cabinetsByWall: Record<string, SavedCabinet[]>;
  islands: SavedIsland[];
}

/** What load() hands back: the rebuilt room, plus whichever shape preset/params produced it (or
 * null — an older save migrated forward, or a hand-crafted payload with no roomShape at all). */
export interface LoadResult {
  room: Room;
  roomShape: SavedRoomShape | null;
}

/**
 * Serialize the current room and write it to localStorage. Wrapped in try/catch — localStorage
 * can throw (quota exceeded, private-browsing restrictions) — a failed save is silent but must
 * never break editing. Returns whether the write actually succeeded (cycle 016 audit #A4) — the
 * one signal app.ts's autosave needs to show the "Saved ✓" whisper only on a real write.
 */
export function save(room: Room, roomShape?: SavedRoomShape | null): boolean {
  const payload: SavedPayload = {
    version: SCHEMA_VERSION,
    room: { footprint: room.footprint, wallHeight: room.wallHeight, style: room.style },
    cabinetsByWall: Object.fromEntries(
      perimeterWalls(room).map((wall) => [wall.id, serializeCabinets(wall.cabinets)]),
    ),
    islands: room.walls
      .filter((wall) => wall.kind === "island")
      .map((wall) => ({
        x: wall.start.x,
        y: wall.start.y,
        orientation: islandOrientation(wall),
        length: wall.length,
        cabinets: serializeCabinets(wall.cabinets),
      })),
  };
  if (roomShape) payload.roomShape = { key: roomShape.key, params: { ...roomShape.params } };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    // Quota exceeded, private-mode restrictions, etc. — silently skip this save.
    return false;
  }
}

function serializeCabinets(cabinets: readonly Cabinet[]): SavedCabinet[] {
  return cabinets.map((cabinet) => ({
    kind: cabinet.kind,
    type: cabinet.type,
    xOffset: cabinet.xOffset,
    width: cabinet.width,
    height: cabinet.height,
    depth: cabinet.depth,
    finish: cabinet.finish,
    doorStyle: cabinet.doorStyle,
  }));
}

/**
 * Load and rebuild the saved room, or null if there is no valid save under EITHER key. Tries
 * the current key first; only when that's empty/absent/invalid does it fall back to the legacy
 * pre-rename key (cycle 018) — a design already under the new key always wins outright, the
 * legacy key is never even read. app.ts's existing post-load save() call (unconditional after
 * any successful load(), added in cycle 017 for schema migrations) already writes whatever
 * comes back here under STORAGE_KEY, so a legacy-key rescue needs no second write path — it's
 * the exact same "normalize storage right after a successful restore" step already in place.
 */
export function load(): LoadResult | null {
  return loadFromKey(STORAGE_KEY) ?? loadFromKey(LEGACY_STORAGE_KEY);
}

/**
 * The actual parse -> migrate -> validate -> rebuild pipeline, against whichever key is given —
 * ONE deserializer, no special-casing per key. The footprint is rebuilt via createPolygonRoom
 * (which seeds its own default style — immediately overwritten below by the saved one), islands
 * via createIsland (then repositioned to the exact saved x/y — no reclamping on load, unlike a
 * resize); every piece is recreated via createCabinet with a fresh, session-scoped id and the
 * saved dimensions (+ any finish/door-style override) applied. A v1..v4 payload (under either
 * key — the legacy key's own newest save is always v4, the last schema before the rename, but
 * the full v1->v5 chain still runs against it like any other old save) is migrated to v5 shape
 * before validation (see migrateIfNeeded).
 */
function loadFromKey(key: string): LoadResult | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  const migrated = migrateIfNeeded(payload);
  if (!migrated || !isValidPayload(migrated)) return null;

  const room = createPolygonRoom(migrated.room.footprint, migrated.room.wallHeight);
  room.style = migrated.room.style;
  // load() always builds via the general polygon path (it works from an arbitrary saved
  // footprint) — a restored rectangle must still read North/East/South/West, not "Wall 1..4",
  // the one thing createRectangularRoom does beyond createPolygonRoom.
  if (migrated.roomShape?.key === "rectangle") applyRectangleLabelsIfNeeded(room);
  for (const wall of perimeterWalls(room)) {
    const savedCabinets = migrated.cabinetsByWall[wall.id] ?? [];
    wall.cabinets = rebuildCabinets(savedCabinets);
  }
  for (const savedIsland of migrated.islands) {
    const island = createIsland(room, savedIsland.length, savedIsland.orientation);
    island.start = { x: savedIsland.x, y: savedIsland.y };
    island.cabinets = rebuildCabinets(savedIsland.cabinets);
    room.walls.push(island);
  }
  return { room, roomShape: migrated.roomShape ?? null };
}

function rebuildCabinets(saved: SavedCabinet[]) {
  return saved.map((s) => {
    const cabinet = createCabinet(s.kind, s.type, s.xOffset);
    cabinet.width = s.width;
    cabinet.height = s.height;
    cabinet.depth = s.depth;
    if (s.finish !== undefined) cabinet.finish = s.finish;
    if (s.doorStyle !== undefined) cabinet.doorStyle = s.doorStyle;
    return cabinet;
  });
}

// ---- stepwise migration: v1 -> v2 -> v3 -> v4 -> v5 -----------------------------------------

/**
 * Chain v1 -> v2 -> v3 -> v4 -> v5 as needed, each step validating its OWN shape before
 * transforming (a malformed payload at any step is rejected here, never partially migrated). A
 * payload that's already v5 (or anything unrecognized) passes through unchanged for the v5
 * validator to accept or reject on its own terms.
 */
/** Exported for persistence.test.ts: the migration chain is pure (string/object in, object or
 * null out) and testable without touching localStorage — "no browser mocks" per the test plan. */
export function migrateIfNeeded(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null) return payload;
  let record = payload as Record<string, unknown>;

  if (record.version === 1) {
    const migrated = migrateV1ToV2(record);
    if (!migrated) return null;
    record = migrated;
  }

  if (record.version === 2) {
    const migrated = migrateV2ToV3(record);
    if (!migrated) return null;
    record = migrated;
  }

  if (record.version === 3) {
    const migrated = migrateV3ToV4(record);
    if (!migrated) return null;
    record = migrated;
  }

  if (record.version === 4) {
    const migrated = migrateV4ToV5(record);
    if (!migrated) return null;
    record = migrated;
  }

  return record;
}

interface V1SavedCabinet {
  type: CabinetType;
  xOffset: number;
  width: number;
  height: number;
  depth: number;
  filler?: boolean;
}

function migrateV1ToV2(record: Record<string, unknown>): Record<string, unknown> | null {
  if (!isValidV1Shape(record)) return null;
  const cabinetsByWall: Record<string, SavedCabinet[]> = {};
  for (const [wallId, cabinets] of Object.entries(record.cabinetsByWall)) {
    cabinetsByWall[wallId] = cabinets.map((cabinet) => ({
      kind: cabinet.filler ? "filler" : "cabinet",
      type: cabinet.type,
      xOffset: cabinet.xOffset,
      width: cabinet.width,
      height: cabinet.height,
      depth: cabinet.depth,
    }));
  }
  return { version: 2, room: record.room, cabinetsByWall };
}

function isValidV1Shape(
  record: Record<string, unknown>,
): record is { version: 1; room: unknown; cabinetsByWall: Record<string, V1SavedCabinet[]> } {
  if (typeof record.room !== "object" || record.room === null) return false;
  const { width, length, wallHeight } = record.room as Record<string, unknown>;
  if (!isFinitePositive(width) || !isFinitePositive(length) || !isFinitePositive(wallHeight)) return false;

  if (typeof record.cabinetsByWall !== "object" || record.cabinetsByWall === null) return false;
  for (const cabinets of Object.values(record.cabinetsByWall)) {
    if (!Array.isArray(cabinets)) return false;
    for (const cabinet of cabinets) {
      if (!isValidV1SavedCabinet(cabinet)) return false;
    }
  }
  return true;
}

function isValidV1SavedCabinet(value: unknown): value is V1SavedCabinet {
  if (typeof value !== "object" || value === null) return false;
  const cabinet = value as Record<string, unknown>;
  if (cabinet.type !== "base" && cabinet.type !== "wall") return false;
  if (!isFiniteNonNegative(cabinet.xOffset)) return false;
  if (!isFinitePositive(cabinet.width) || !isFinitePositive(cabinet.height) || !isFinitePositive(cabinet.depth)) {
    return false;
  }
  if (cabinet.filler !== undefined && typeof cabinet.filler !== "boolean") return false;
  return true;
}

function migrateV2ToV3(record: Record<string, unknown>): Record<string, unknown> | null {
  if (!isValidV2Shape(record)) return null;
  return { version: 3, room: record.room, cabinetsByWall: record.cabinetsByWall, islands: [] };
}

/** v2's shape is exactly today's v3 shape minus `islands` (v2 predates the island feature). */
function isValidV2Shape(
  record: Record<string, unknown>,
): record is { version: 2; room: unknown; cabinetsByWall: Record<string, SavedCabinet[]> } {
  if (typeof record.room !== "object" || record.room === null) return false;
  const { width, length, wallHeight } = record.room as Record<string, unknown>;
  if (!isFinitePositive(width) || !isFinitePositive(length) || !isFinitePositive(wallHeight)) return false;

  if (typeof record.cabinetsByWall !== "object" || record.cabinetsByWall === null) return false;
  for (const cabinets of Object.values(record.cabinetsByWall)) {
    if (!Array.isArray(cabinets)) return false;
    for (const cabinet of cabinets) {
      if (!isValidV3SavedCabinet(cabinet)) return false;
    }
  }
  return true;
}

/**
 * Cycle 014: every pre-finishes save gets the Classic White look on first load — a coherent
 * look, not an arbitrary one, and the SAME bundle createRectangularRoom seeds a brand-new room
 * with. No piece gets a finish/door-style override (v3 cabinets never had the fields at all).
 */
function migrateV3ToV4(record: Record<string, unknown>): Record<string, unknown> | null {
  if (!isValidV3Shape(record)) return null;
  const room = record.room as Record<string, unknown>;
  return {
    version: 4,
    room: { ...room, style: roomStyleForPreset("classic-white") },
    cabinetsByWall: record.cabinetsByWall,
    islands: record.islands,
  };
}

/** v3's shape is exactly today's (v4) shape minus `room.style` and any per-cabinet
 * finish/doorStyle (both cycle-014 additions) — the version check itself happens at the
 * migrateIfNeeded call site, same convention as isValidV1Shape/isValidV2Shape above. */
function isValidV3Shape(
  record: Record<string, unknown>,
): record is { version: 3; room: unknown; cabinetsByWall: Record<string, SavedCabinet[]>; islands: unknown[] } {
  if (typeof record.room !== "object" || record.room === null) return false;
  const { width, length, wallHeight } = record.room as Record<string, unknown>;
  if (!isFinitePositive(width) || !isFinitePositive(length) || !isFinitePositive(wallHeight)) return false;

  if (typeof record.cabinetsByWall !== "object" || record.cabinetsByWall === null) return false;
  for (const cabinets of Object.values(record.cabinetsByWall)) {
    if (!Array.isArray(cabinets)) return false;
    for (const cabinet of cabinets) {
      if (!isValidV3SavedCabinet(cabinet)) return false;
    }
  }

  if (!Array.isArray(record.islands)) return false;
  for (const island of record.islands) {
    if (!isValidV3SavedIsland(island)) return false;
  }
  return true;
}

/** A v3 cabinet has no finish/doorStyle fields at all — same shape check as isValidSavedCabinet
 * below, minus the (cycle-014-only) override validation. */
function isValidV3SavedCabinet(value: unknown): value is SavedCabinet {
  if (typeof value !== "object" || value === null) return false;
  const cabinet = value as Record<string, unknown>;
  if (typeof cabinet.kind !== "string" || !VALID_KINDS.has(cabinet.kind)) return false;
  if (cabinet.type !== "base" && cabinet.type !== "wall") return false;
  if (!isFiniteNonNegative(cabinet.xOffset)) return false;
  if (!isFinitePositive(cabinet.width) || !isFinitePositive(cabinet.height) || !isFinitePositive(cabinet.depth)) {
    return false;
  }
  return true;
}

function isValidV3SavedIsland(value: unknown): value is SavedIsland {
  if (typeof value !== "object" || value === null) return false;
  const island = value as Record<string, unknown>;
  if (!isFiniteNumber(island.x) || !isFiniteNumber(island.y)) return false;
  if (typeof island.orientation !== "string" || !VALID_ORIENTATIONS.has(island.orientation)) return false;
  if (!isFinitePositive(island.length)) return false;
  if (!Array.isArray(island.cabinets)) return false;
  for (const cabinet of island.cabinets) {
    if (!isValidV3SavedCabinet(cabinet)) return false;
    if (!canPlaceOn("island", cabinet.kind, cabinet.type)) return false;
  }
  return true;
}

/**
 * Cycle 017: replace room.width/length with a footprint (the rectangle's own 4 corners, in the
 * SAME order createRectangularRoom builds them) and record roomShape:{key:"rectangle",
 * params:{width,length}} — a v4 rectangle re-expressed as this cycle's shape-preset vocabulary,
 * not a new design decision. No piece touched.
 */
function migrateV4ToV5(record: Record<string, unknown>): Record<string, unknown> | null {
  if (!isValidV4Shape(record)) return null;
  const { width, length, wallHeight, style } = record.room;
  const footprint: Vec2[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: length },
    { x: 0, y: length },
  ];
  return {
    version: 5,
    room: { footprint, wallHeight, style },
    roomShape: { key: "rectangle", params: { width, length } },
    cabinetsByWall: record.cabinetsByWall,
    islands: record.islands,
  };
}

/** v4's shape is exactly today's (v5) payload minus footprint/roomShape (this cycle's own
 * additions) — width/length/wallHeight/style instead of a footprint, no roomShape at all. Used
 * only as migrateV4ToV5's pre-transform validator, same convention as isValidV1/V2/V3Shape. */
function isValidV4Shape(record: Record<string, unknown>): record is {
  version: 4;
  room: { width: number; length: number; wallHeight: number; style: SavedRoomStyle };
  cabinetsByWall: Record<string, SavedCabinet[]>;
  islands: SavedIsland[];
} {
  if (typeof record.room !== "object" || record.room === null) return false;
  const { width, length, wallHeight, style } = record.room as Record<string, unknown>;
  if (!isFinitePositive(width) || !isFinitePositive(length) || !isFinitePositive(wallHeight)) return false;
  if (!isValidRoomStyle(style)) return false;

  if (typeof record.cabinetsByWall !== "object" || record.cabinetsByWall === null) return false;
  for (const cabinets of Object.values(record.cabinetsByWall)) {
    if (!Array.isArray(cabinets)) return false;
    for (const cabinet of cabinets) {
      if (!isValidSavedCabinet(cabinet)) return false;
    }
  }

  if (!Array.isArray(record.islands)) return false;
  for (const island of record.islands) {
    if (!isValidSavedIsland(island)) return false;
  }
  return true;
}

// ---- v5 validation -------------------------------------------------------

/** Whole-payload shape + value validation. Any violation rejects the ENTIRE save — no partial
 * loads of a half-valid design. Exported for persistence.test.ts, same rationale as
 * migrateIfNeeded above. */
export function isValidPayload(value: unknown): value is SavedPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  if (payload.version !== SCHEMA_VERSION) return false;

  if (typeof payload.room !== "object" || payload.room === null) return false;
  const { footprint, wallHeight, style } = payload.room as Record<string, unknown>;
  if (!isValidFootprint(footprint)) return false;
  if (!isFinitePositive(wallHeight)) return false;
  if (!isValidRoomStyle(style)) return false;

  if (payload.roomShape !== undefined && !isValidRoomShape(payload.roomShape)) return false;

  if (typeof payload.cabinetsByWall !== "object" || payload.cabinetsByWall === null) return false;
  for (const [wallId, cabinets] of Object.entries(payload.cabinetsByWall)) {
    if (!isValidPerimeterWallId(wallId, footprint.length)) return false;
    if (!Array.isArray(cabinets)) return false;
    for (const cabinet of cabinets) {
      if (!isValidSavedCabinet(cabinet)) return false;
    }
  }

  if (!Array.isArray(payload.islands)) return false;
  for (const island of payload.islands) {
    if (!isValidSavedIsland(island)) return false;
  }

  return true;
}

/** A `cabinetsByWall` key must be `wall-${index}` for an index that actually exists on the
 * loaded footprint — a hand-edited or corrupted save referencing `wall-7` on a 4-vertex
 * rectangle rejects the whole payload rather than silently dropping or misreading it. */
function isValidPerimeterWallId(id: string, wallCount: number): boolean {
  const match = /^wall-(\d+)$/.exec(id);
  if (!match) return false;
  const index = Number(match[1]);
  return index >= 0 && index < wallCount;
}

/** A saved shape-preset reference is optional, but if present must name a real preset key and
 * carry only finite-number params — a hand-crafted payload can't smuggle a bogus key the room
 * form's shape picker wouldn't recognize. */
function isValidRoomShape(value: unknown): value is SavedRoomShape {
  if (typeof value !== "object" || value === null) return false;
  const shape = value as Record<string, unknown>;
  if (typeof shape.key !== "string" || !VALID_SHAPE_KEYS.has(shape.key)) return false;
  if (typeof shape.params !== "object" || shape.params === null) return false;
  for (const v of Object.values(shape.params as Record<string, unknown>)) {
    if (typeof v !== "number" || !Number.isFinite(v)) return false;
  }
  return true;
}

/** Every field checked against its own finishes.ts registry — an unrecognized preset/finish/
 * material/door-style key rejects the WHOLE payload, same whole-payload-rejection semantics as
 * every other value check here. */
function isValidRoomStyle(value: unknown): value is SavedRoomStyle {
  if (typeof value !== "object" || value === null) return false;
  const style = value as Record<string, unknown>;
  if (typeof style.preset !== "string" || !VALID_PRESETS.has(style.preset)) return false;
  if (typeof style.cabinetFinish !== "string" || !VALID_CABINET_FINISHES.has(style.cabinetFinish)) return false;
  if (typeof style.doorStyle !== "string" || !VALID_DOOR_STYLES.has(style.doorStyle)) return false;
  if (typeof style.counter !== "string" || !VALID_COUNTER_MATERIALS.has(style.counter)) return false;
  if (typeof style.floor !== "string" || !VALID_FLOOR_MATERIALS.has(style.floor)) return false;
  if (typeof style.walls !== "string" || !VALID_WALL_PAINTS.has(style.walls)) return false;
  if (typeof style.backsplash !== "string" || !VALID_BACKSPLASHES.has(style.backsplash)) return false;
  return true;
}

function isValidSavedCabinet(value: unknown): value is SavedCabinet {
  if (typeof value !== "object" || value === null) return false;
  const cabinet = value as Record<string, unknown>;
  if (typeof cabinet.kind !== "string" || !VALID_KINDS.has(cabinet.kind)) return false;
  if (cabinet.type !== "base" && cabinet.type !== "wall") return false;
  if (!isFiniteNonNegative(cabinet.xOffset)) return false;
  if (!isFinitePositive(cabinet.width) || !isFinitePositive(cabinet.height) || !isFinitePositive(cabinet.depth)) {
    return false;
  }
  if (cabinet.finish !== undefined && (typeof cabinet.finish !== "string" || !VALID_CABINET_FINISHES.has(cabinet.finish))) {
    return false;
  }
  if (cabinet.doorStyle !== undefined && (typeof cabinet.doorStyle !== "string" || !VALID_DOOR_STYLES.has(cabinet.doorStyle))) {
    return false;
  }
  return true;
}

function isValidSavedIsland(value: unknown): value is SavedIsland {
  if (typeof value !== "object" || value === null) return false;
  const island = value as Record<string, unknown>;
  if (!isFiniteNumber(island.x) || !isFiniteNumber(island.y)) return false;
  if (typeof island.orientation !== "string" || !VALID_ORIENTATIONS.has(island.orientation)) return false;
  if (!isFinitePositive(island.length)) return false;
  if (!Array.isArray(island.cabinets)) return false;
  for (const cabinet of island.cabinets) {
    if (!isValidSavedCabinet(cabinet)) return false;
    // Islands only ever accept floor-anchored kinds — the same rule the live app enforces via
    // canPlaceOn (a hand-edited or future-buggy-writer payload could otherwise smuggle a wall
    // cabinet or hood onto an island, which nothing in occupancy.ts would ever produce itself).
    if (!canPlaceOn("island", cabinet.kind, cabinet.type)) return false;
  }
  return true;
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
